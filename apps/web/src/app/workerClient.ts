/**
 * The main-thread side of the worker protocol (PLAN §2.2, §12.14, Appendix A.6, pitfall 22).
 *
 * - Job ids: one increasing id per client; every reply carries its job's id back.
 * - Epochs: a job carries the epoch it was made for (the controller's). A newer epoch
 *   (`setEpoch`, or a request made with it) cancels every older job, and a reply whose epoch is
 *   not current is dropped.
 * - "Latest for its kind": every job has a slot ('equity', 'handInfo', later 'bot:3'); a new job
 *   cancels the one in its slot, and only the newest job of a slot is ever delivered.
 * - Cancel: `cancel(jobId)` and `cancelAll()` post `{ kind: 'cancel', jobId }` and forget the job:
 *   its callback is never called again, whatever the worker still sends.
 * - Timeouts: a job with no final reply within its `timeoutMs` is cancelled and gets `timeout`.
 * - Crashes (§12.14): a worker `error` / `messageerror` event, or 2 timeouts in a row, terminates
 *   the worker, fails its pending jobs (`failed`) and starts a new one (a new generation: nothing
 *   from the old worker is delivered). Once only: when the new one fails too, the client is
 *   `failed` and `request` returns null. `retry()` starts over (the brain's [Try again], Stage 5).
 * - A log of what went out and came back, without card data (Diagnostics, `window.__pc.logs()`).
 */
import type { EquityReply, EquityRequest } from '../workers/protocol.ts';
import { spawnEquityWorker } from '../workers/spawn.ts';

/**
 * The clock and timers the client uses: the controller's `Timers` (`realTimers` in the app), since
 * only `app/controller.ts` calls the timer functions on the main thread (§0.3).
 */
export interface ClientTimers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  now: () => number;
}

/** What every request and reply has (Appendix A.6). */
export interface WorkerMessage {
  kind: string;
  jobId: number;
}

/** The part of a `Worker` the client uses (a fake in tests). */
export interface WorkerPort<Req> {
  postMessage(message: Req): void;
  terminate(): void;
}

/** Where a worker's events go. `error` = an `error` or `messageerror` event: the worker is broken. */
export interface WorkerEvents<Rep> {
  message(reply: Rep): void;
  error(reason: string): void;
}

/** Starts a worker and connects its events. May throw (no module workers). */
export type SpawnWorker<Req, Rep> = (events: WorkerEvents<Rep>) => WorkerPort<Req>;

/** A `SpawnWorker` over a real `Worker` made by `create`. */
export function fromWorker<Req, Rep>(create: () => Worker): SpawnWorker<Req, Rep> {
  return (events) => {
    const worker = create();
    worker.onmessage = (event: MessageEvent<Rep>) => events.message(event.data);
    worker.onerror = (event: ErrorEvent) => {
      event.preventDefault(); // handled here: no uncaught error in the console
      events.error(event.message === '' ? 'worker error' : event.message);
    };
    worker.onmessageerror = () => events.error('messageerror');
    return worker;
  };
}

/** What a job's callback hears. After `timeout` or `failed`, or a `final` reply, nothing more. */
export type JobEvent<Rep> =
  /** A reply for this job: progress (`final: false`) or its last one (an `error` reply is final). */
  | { type: 'reply'; reply: Rep; final: boolean }
  /** No final reply within the job's timeout; the job was cancelled. */
  | { type: 'timeout' }
  /** The worker crashed (or could not start) while the job was pending. */
  | { type: 'failed'; reason: string };

export interface JobSpec<Req, Rep> {
  /** Only the newest job of a slot is delivered; a new one cancels the old one. */
  slot: string;
  /** The epoch this job is made for; an older one is refused, a newer one becomes current. */
  epoch: number;
  timeoutMs: number;
  /** The request, given its job id. */
  build(jobId: number): Req;
  onEvent(event: JobEvent<Rep>): void;
}

export type ClientStatus = 'ready' | 'failed';

export interface WorkerLogEntry {
  at: number;
  /**
   * out: a message was posted · in: a reply was delivered · drop: a reply was dropped (cancelled,
   * finished, stale epoch, older job of its slot, old worker) · timeout · crash · restart ·
   * failed: no worker any more · refused: a request for an older epoch.
   */
  what: 'out' | 'in' | 'drop' | 'timeout' | 'crash' | 'restart' | 'failed' | 'refused';
  kind?: string;
  jobId?: number;
  epoch?: number;
  detail?: string;
}

export interface WorkerClientOptions<Req, Rep> {
  spawn: SpawnWorker<Req, Rep>;
  /** Is this reply the job's last one? (`error` replies always are.) */
  isFinal(reply: Rep): boolean;
  cancelMessage(jobId: number): Req;
  timers: ClientTimers;
  /** Restarts before giving up (§12.14: once). */
  maxRestarts?: number;
  /** Timeouts in a row that count as a crash (§12.14: 2). */
  timeoutsToRestart?: number;
}

interface Job<Rep> {
  jobId: number;
  kind: string;
  slot: string;
  epoch: number;
  timeout: unknown;
  onEvent(event: JobEvent<Rep>): void;
}

const LOG_SIZE = 200;

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function epochOf(message: WorkerMessage): number | undefined {
  const epoch = (message as { epoch?: unknown }).epoch;
  return typeof epoch === 'number' ? epoch : undefined;
}

export class WorkerClient<Req extends WorkerMessage, Rep extends WorkerMessage> {
  private readonly options: WorkerClientOptions<Req, Rep>;
  private readonly timers: ClientTimers;
  private readonly maxRestarts: number;
  private readonly timeoutsToRestart: number;
  private worker: WorkerPort<Req> | null = null;
  /** Bumped by every start and stop: events of an older worker are ignored. */
  private generation = 0;
  private seq = 0;
  private currentEpoch = 0;
  private restarts = 0;
  private timeoutStreak = 0;
  private state: ClientStatus = 'ready';
  private readonly jobs = new Map<number, Job<Rep>>();
  private readonly slots = new Map<string, number>();
  private readonly entries: WorkerLogEntry[] = [];

  constructor(options: WorkerClientOptions<Req, Rep>) {
    this.options = options;
    this.timers = options.timers;
    this.maxRestarts = options.maxRestarts ?? 1;
    this.timeoutsToRestart = options.timeoutsToRestart ?? 2;
    this.start(); // warmed at start (§15.3)
  }

  /** 'failed' once the worker failed after its restart: no more jobs. */
  get status(): ClientStatus {
    return this.state;
  }

  get epoch(): number {
    return this.currentEpoch;
  }

  /** Worker restarts so far. */
  get restartCount(): number {
    return this.restarts;
  }

  /** Makes `epoch` current: every job of another epoch is cancelled. */
  setEpoch(epoch: number): void {
    if (epoch === this.currentEpoch) return;
    this.currentEpoch = epoch;
    for (const job of [...this.jobs.values()]) if (job.epoch !== epoch) this.cancel(job.jobId);
  }

  /**
   * Sends a job. Returns its id, or null when it was not sent: the client has `failed`, or the
   * epoch is older than the current one. The job in the same slot is cancelled first.
   */
  request(spec: JobSpec<Req, Rep>): number | null {
    if (spec.epoch < this.currentEpoch) {
      this.note({ what: 'refused', epoch: spec.epoch, detail: `slot ${spec.slot}` });
      return null;
    }
    this.setEpoch(spec.epoch);
    const old = this.slots.get(spec.slot);
    if (old !== undefined) this.cancel(old);
    if (this.state === 'failed') return null;
    const jobId = ++this.seq;
    const message = spec.build(jobId);
    if (!this.send(message)) return null;
    const job: Job<Rep> = {
      jobId,
      kind: message.kind,
      slot: spec.slot,
      epoch: spec.epoch,
      timeout: null,
      onEvent: spec.onEvent,
    };
    this.jobs.set(jobId, job);
    this.slots.set(spec.slot, jobId);
    job.timeout = this.timers.setTimeout(() => this.onTimeout(job), spec.timeoutMs);
    return jobId;
  }

  /** Cancels one job: `cancel` goes to the worker; the job's callback is never called again. */
  cancel(jobId: number): void {
    const job = this.jobs.get(jobId);
    if (job === undefined) return;
    this.forget(job);
    this.send(this.options.cancelMessage(jobId));
  }

  /** Cancels every pending job (the page is hidden, acceptance 5). */
  cancelAll(): void {
    for (const jobId of [...this.jobs.keys()]) this.cancel(jobId);
  }

  /** The ids of the pending jobs, oldest first. */
  pending(): number[] {
    return [...this.jobs.keys()];
  }

  /** After `failed`: a fresh worker and a fresh restart allowance (the brain's [Try again]). */
  retry(): void {
    if (this.state !== 'failed') return;
    this.state = 'ready';
    this.restarts = 0;
    this.timeoutStreak = 0;
    this.note({ what: 'restart', detail: 'retry' });
    this.start();
  }

  /** Cancels everything and terminates the worker for good. */
  dispose(): void {
    this.cancelAll();
    this.stop();
    this.state = 'failed';
  }

  /** The last 200 log lines (copies). */
  log(): WorkerLogEntry[] {
    return this.entries.map((e) => ({ ...e }));
  }

  // -------------------------------------------------------------------------------------------

  private start(): void {
    const generation = ++this.generation;
    try {
      this.worker = this.options.spawn({
        message: (reply) => this.onMessage(generation, reply),
        error: (reason) => {
          if (generation === this.generation) this.crash(reason);
        },
      });
    } catch (e) {
      this.worker = null;
      this.crash(`cannot start: ${messageOf(e)}`);
    }
  }

  private stop(): void {
    const worker = this.worker;
    this.worker = null;
    this.generation++;
    try {
      worker?.terminate();
    } catch {
      // Terminating a broken worker may throw; it is gone either way.
    }
  }

  private send(message: Req): boolean {
    const worker = this.worker;
    if (worker === null) return false;
    try {
      worker.postMessage(message);
    } catch (e) {
      this.crash(`postMessage: ${messageOf(e)}`);
      return false;
    }
    const epoch = epochOf(message);
    this.note({
      what: 'out',
      kind: message.kind,
      jobId: message.jobId,
      ...(epoch !== undefined && { epoch }),
    });
    return true;
  }

  private forget(job: Job<Rep>): void {
    this.timers.clearTimeout(job.timeout);
    this.jobs.delete(job.jobId);
    if (this.slots.get(job.slot) === job.jobId) this.slots.delete(job.slot);
  }

  private onMessage(generation: number, reply: Rep): void {
    const job = this.jobs.get(reply.jobId);
    const epoch = epochOf(reply);
    const stale =
      generation !== this.generation ||
      job === undefined ||
      (reply.kind !== job.kind && reply.kind !== 'error') ||
      (epoch !== undefined && epoch !== job.epoch) ||
      job.epoch !== this.currentEpoch ||
      this.slots.get(job.slot) !== job.jobId;
    this.note({
      what: stale ? 'drop' : 'in',
      kind: reply.kind,
      jobId: reply.jobId,
      ...(epoch !== undefined && { epoch }),
    });
    if (stale || job === undefined) return;
    const final = reply.kind === 'error' || this.options.isFinal(reply);
    if (final) {
      this.forget(job);
      this.timeoutStreak = 0; // the worker answers
    }
    job.onEvent({ type: 'reply', reply, final });
  }

  private onTimeout(job: Job<Rep>): void {
    if (this.jobs.get(job.jobId) !== job) return;
    this.forget(job);
    this.send(this.options.cancelMessage(job.jobId));
    this.note({ what: 'timeout', kind: job.kind, jobId: job.jobId, epoch: job.epoch });
    this.timeoutStreak++;
    const broken = this.timeoutStreak >= this.timeoutsToRestart;
    job.onEvent({ type: 'timeout' });
    if (broken) this.crash(`${this.timeoutStreak} timeouts in a row`);
  }

  /** §12.14: terminate, fail the pending jobs, recreate once; after that, `failed`. */
  private crash(reason: string): void {
    const pending = [...this.jobs.values()];
    for (const job of pending) this.forget(job);
    this.stop();
    this.timeoutStreak = 0;
    this.note({ what: 'crash', detail: reason });
    if (this.state !== 'failed' && this.restarts < this.maxRestarts) {
      this.restarts++;
      this.note({ what: 'restart', detail: `restart ${this.restarts}` });
      this.start(); // may crash again, and then fail for good
    } else if (this.state !== 'failed') {
      this.state = 'failed';
      this.note({ what: 'failed', detail: reason });
    }
    for (const job of pending) job.onEvent({ type: 'failed', reason });
  }

  private note(entry: Omit<WorkerLogEntry, 'at'>): void {
    this.entries.push({ at: this.timers.now(), ...entry });
    if (this.entries.length > LOG_SIZE) this.entries.splice(0, this.entries.length - LOG_SIZE);
  }
}

// ---------------------------------------------------------------------------------------------
// equity.worker

/** Appendix A.6: equity replies may come for 4 s (the worker's own cap is 3 s). */
export const EQUITY_TIMEOUT_MS = 4000;

export type EquityClient = WorkerClient<EquityRequest, EquityReply>;

/** The last reply of an equity job: a final estimate, one `handInfo`, a bench result or an error. */
export function equityReplyIsFinal(reply: EquityReply): boolean {
  switch (reply.kind) {
    case 'equity':
      return reply.result.final;
    case 'equityKnown':
      return reply.final;
    default:
      return true;
  }
}

export function createEquityClient(
  spawn: SpawnWorker<EquityRequest, EquityReply>,
  timers: ClientTimers,
): EquityClient {
  return new WorkerClient<EquityRequest, EquityReply>({
    spawn,
    isFinal: equityReplyIsFinal,
    cancelMessage: (jobId) => ({ kind: 'cancel', jobId }),
    timers,
  });
}

/** The app's `equity.worker` (a module worker). Where there is none the client is `failed`. */
export function startEquityWorker(timers: ClientTimers): EquityClient {
  return createEquityClient(fromWorker<EquityRequest, EquityReply>(spawnEquityWorker), timers);
}
