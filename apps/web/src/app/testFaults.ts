/**
 * Faults for `brain.worker`, for development and E2E builds only (PLAN "Testing strategy" → Rules,
 * §18 Stage 6 acceptance 4, chunk 6.5): a layer between the brain client and its worker (the
 * script's bots and the coach included) that a spec switches on through `window.__pc.faults`:
 *
 * - `delay(kind, ms)`: replies to jobs of `kind` come `ms` later, on the page's clock (a slow
 *   worker: a grade later than the 1,500 ms the hand waits for it, §11.3 r5);
 * - `fail(kind, n)`: the next `n` jobs of `kind` are answered with an `error` reply, and the worker
 *   never sees them (a grade job that errors twice, §11.3 r5);
 * - `think(ms)`: bot decisions carry `ms` as their think time at Normal speed (§9.8), so a bot
 *   stays "thinking" for as long as a spec needs (the hero's Undo window stays open);
 * - `kill()`: the worker dies now, as `worker.onerror` would report it: it is terminated and the
 *   client hears a crash (§12.14: recreated once; the second time the client has `failed`).
 *
 * Only what comes back from the worker is changed: the client, the controller and the worker are
 * the app's own, so a spec sees the real §11.3 r5 and §12.14 behaviour in a real browser. With no
 * fault switched on the layer passes every message through unchanged.
 *
 * ⚠️ Loaded only through `app/testHooks.ts`, which main.tsx imports behind `__PC_TEST_HOOKS__`:
 * never in a production build (tests/app/testHooks.bundle.test.ts searches the built files for
 * `FAULT_HOOK_MARKER`).
 */
import type { BrainReply, BrainRequest } from '../workers/protocol.ts';
import type { ClientTimers, SpawnWorker, WorkerEvents, WorkerPort } from './workerClient.ts';

/** Present in every build that has the fault hook, and in no other (the bundle test looks). */
export const FAULT_HOOK_MARKER = 'rb-pc-fault-hook-v1';

/** The brain jobs a fault can hit. */
export type FaultKind = 'botDecision' | 'hint' | 'grade';

/** One thing the layer did, for a spec to check (the last 100). */
export interface FaultLogEntry {
  /** The page clock when it happened. */
  at: number;
  what: 'delay' | 'fail' | 'think' | 'kill' | 'kill nothing';
  kind?: FaultKind;
  jobId?: number;
  ms?: number;
}

/** `window.__pc.faults`. */
export interface BrainFaults {
  /** From now on replies to jobs of `kind` come `ms` later (page clock); null: on time again. */
  delay(kind: FaultKind, ms: number | null): void;
  /** The next `count` jobs of `kind` are answered with an `error` reply (0 clears it). */
  fail(kind: FaultKind, count: number): void;
  /** Bot decisions carry this think time at Normal speed, ms; null: the brain's own. */
  think(ms: number | null): void;
  /** The worker dies now (see above). False when there is no worker to kill. */
  kill(): boolean;
  /** What the layer did, oldest first (copies). */
  log(): FaultLogEntry[];
}

/** The injected `error` reply's text. */
export const INJECTED_ERROR = 'injected fault';

const LOG_SIZE = 100;

type FaultRequest = Extract<BrainRequest, { kind: FaultKind }>;

const faultable = (message: BrainRequest): message is FaultRequest =>
  message.kind === 'botDecision' || message.kind === 'hint' || message.kind === 'grade';

/** One started worker, as the layer holds it. */
interface Instance {
  events: WorkerEvents<BrainReply>;
  /** Null until the spawn returned. */
  inner: WorkerPort<BrainRequest> | null;
  /** Held-back replies (timer handles): dropped with the worker. */
  held: Set<unknown>;
  alive: boolean;
}

/** The layer: `faults` is what the spec drives, `wrap` goes around the brain client's spawn. */
export function createBrainFaults(timers: ClientTimers): {
  faults: BrainFaults;
  wrap(spawn: SpawnWorker<BrainRequest, BrainReply>): SpawnWorker<BrainRequest, BrainReply>;
} {
  const delays = new Map<FaultKind, number>();
  const failures = new Map<FaultKind, number>();
  let thinkMs: number | null = null;
  let current: Instance | null = null;
  const entries: FaultLogEntry[] = [];

  const note = (entry: Omit<FaultLogEntry, 'at'>): void => {
    entries.push({ at: timers.now(), ...entry });
    if (entries.length > LOG_SIZE) entries.splice(0, entries.length - LOG_SIZE);
  };

  /** The worker is gone: nothing it still holds is ever delivered. */
  const stop = (live: Instance): void => {
    live.alive = false;
    for (const handle of live.held) timers.clearTimeout(handle);
    live.held.clear();
  };

  const faults: BrainFaults = {
    delay(kind, ms) {
      if (ms === null || ms <= 0) delays.delete(kind);
      else delays.set(kind, ms);
    },
    fail(kind, count) {
      if (count <= 0) failures.delete(kind);
      else failures.set(kind, count);
    },
    think(ms) {
      thinkMs = ms;
      note({ what: 'think', ...(ms !== null && { ms }) });
    },
    kill() {
      const live = current;
      if (live === null || !live.alive) {
        note({ what: 'kill nothing' });
        return false;
      }
      note({ what: 'kill' });
      stop(live);
      try {
        live.inner?.terminate();
      } catch {
        // A worker that cannot be terminated is gone either way.
      }
      // What `worker.onerror` would tell the client; it terminates and recreates the worker.
      live.events.error('killed');
      return true;
    },
    log() {
      return entries.map((e) => ({ ...e }));
    },
  };

  const wrap = (
    spawn: SpawnWorker<BrainRequest, BrainReply>,
  ): SpawnWorker<BrainRequest, BrainReply> => {
    return (events) => {
      /** The kind of each job posted, so an `error` reply is held like the job it answers. */
      const kinds = new Map<number, string>();
      const live: Instance = { events, inner: null, held: new Set(), alive: true };

      /** A reply of the worker (or an injected one) on its way to the client. */
      const toClient = (reply: BrainReply): void => {
        if (!live.alive) return;
        const kind = kinds.get(reply.jobId);
        kinds.delete(reply.jobId); // a brain job has one reply
        const out: BrainReply =
          reply.kind === 'botDecision' && thinkMs !== null ? { ...reply, thinkMs } : reply;
        const ms = kind === undefined ? undefined : delays.get(kind as FaultKind);
        if (ms === undefined) {
          events.message(out);
          return;
        }
        note({ what: 'delay', kind: kind as FaultKind, jobId: reply.jobId, ms });
        const handle = timers.setTimeout(() => {
          live.held.delete(handle);
          if (live.alive) events.message(out);
        }, ms);
        live.held.add(handle);
      };

      live.inner = spawn({
        message: toClient,
        error: (reason) => {
          if (!live.alive) return;
          stop(live);
          events.error(reason);
        },
      });
      current = live;

      return {
        postMessage(message) {
          if (!live.alive || live.inner === null) throw new Error('posted to a killed worker');
          if (message.kind !== 'cancel') kinds.set(message.jobId, message.kind);
          const left = faultable(message) ? (failures.get(message.kind) ?? 0) : 0;
          if (faultable(message) && left > 0) {
            if (left === 1) failures.delete(message.kind);
            else failures.set(message.kind, left - 1);
            note({ what: 'fail', kind: message.kind, jobId: message.jobId });
            const reply: BrainReply = {
              kind: 'error',
              jobId: message.jobId,
              epoch: message.epoch,
              message: INJECTED_ERROR,
            };
            // Like a worker's reply: in a later task, not inside `postMessage`.
            void Promise.resolve().then(() => toClient(reply));
            return;
          }
          live.inner.postMessage(message);
        },
        terminate() {
          stop(live);
          live.inner?.terminate();
        },
      };
    };
  };

  return { faults, wrap };
}
