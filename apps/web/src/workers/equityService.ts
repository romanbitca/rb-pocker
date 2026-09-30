/**
 * The job runner of `equity.worker` (PLAN §2.2, §7.3, Appendix A.6), without the worker globals so
 * tests can run it in Node. `equity.worker.ts` connects it to `self`; the maths comes in through
 * the `EquityMath` interface (`equityMath.ts` in the worker, fakes in tests).
 *
 * - `equity` and `equityKnown` jobs are step generators (§7.3): a `null` step is a checkpoint, a
 *   result is posted at once (progress at n = 2,500 and 10,000, then the final one). Between steps
 *   the runner pauses with `setTimeout(0)` once a time slice (8 ms) of work is done, so a `cancel`
 *   or a newer job is seen within one slice.
 * - A cancelled or superseded job never posts again: it is checked after every pause, and nothing
 *   else can run between that check and the next post. A newer `equity` job supersedes the older
 *   one (a new request cancels the old one, §7.4), even before its `cancel` arrives. `equityKnown`
 *   jobs stop only at their `cancel`: during an all-in run-out two run at once, the street's
 *   equity bars and the board at the all-in (the luck line, chunk 4.7), in two client slots.
 * - Safety cap (§7.3): a job still running after 3 s (a broken device) posts its last estimate as
 *   final with `truncated: true`, or an `error` when it has none. Results never depend on time
 *   otherwise: n is fixed.
 * - `handInfo` is synchronous (typically < 20 ms, §6). A job that throws posts an `error` reply.
 * - Timing (§15.3): every reply of these three carries `timing` (`JobTiming`): the wall time since
 *   the request was taken, and how much of it the worker spent computing (this job and any other
 *   that ran in between), so a test can model a slower CPU.
 * - `bench` (§15.4) runs `options.bench` (`workers/bench.ts` in the worker) and answers once.
 */
import type { EquityResult, HandAnalysis } from '../analysis/types.ts';
import type { Card } from '../core/cards.ts';
import type { EquityBenchResult, EquityReply, EquityRequest, JobTiming } from './protocol.ts';

/** A step generator: `null` = a checkpoint (pause here if needed), a value = post it. */
export type Steps<T> = Iterator<T | null, unknown, undefined>;

/** The maths the worker runs (`analysis/*`). */
export interface EquityMath {
  /** §7.2–7.3: the hero against `nOpp` random hands. The last result has `final: true`. */
  equitySteps(hero: readonly Card[], board: readonly Card[], nOpp: number): Steps<EquityResult>;
  /** §7.2: known hands (an all-in run-out), one result per hand, in the order of `hands`. */
  runoutSteps(hands: readonly (readonly Card[])[], board: readonly Card[]): Steps<EquityResult[]>;
  /** §6: draws, outs, risky outs, chances by the river, beaters and nuts. */
  handInfo(hero: readonly Card[], board: readonly Card[]): HandAnalysis;
}

export interface EquityServiceOptions {
  math: EquityMath;
  post(reply: EquityReply): void;
  /** Lets queued messages run (default `setTimeout(0)`, §7.3). */
  pause?: () => Promise<void>;
  /** Clock for the time slices and the cap (default `performance.now`). */
  now?: () => number;
  /** Work between two pauses, in ms (default 8). 0 = pause at every checkpoint. */
  sliceMs?: number;
  /** The safety cap in ms (default 3,000, §7.3). */
  capMs?: number;
  /** The `#bench` measurements (§15.4); without it a `bench` request gets an `error` reply. */
  bench?: () => Promise<EquityBenchResult>;
}

export interface EquityService {
  /** One message from the main thread. */
  handle(msg: EquityRequest): void;
  /** The ids of the jobs still running (tests). */
  running(): number[];
}

export const SLICE_MS = 8;
export const CAP_MS = 3000;

type StepKind = 'equity' | 'equityKnown';

interface Job {
  kind: StepKind;
  jobId: number;
  epoch: number;
  /** `now()` and the busy clock when the request was taken (`JobTiming`). */
  at: number;
  busyAt: number;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function createEquityService(options: EquityServiceOptions): EquityService {
  const { math, post } = options;
  const pause = options.pause ?? ((): Promise<void> => new Promise((r) => setTimeout(r, 0)));
  const now = options.now ?? ((): number => performance.now());
  const sliceMs = options.sliceMs ?? SLICE_MS;
  const capMs = options.capMs ?? CAP_MS;
  /** Running step jobs by id. */
  const live = new Map<number, Job>();
  /** The newest `equity` job: an older one stops at its next checkpoint. */
  let newestEquity = 0;
  /** Computing time so far (every job), and when the slice running now began (JobTiming). */
  let busy = 0;
  let workingSince: number | null = null;

  const busyNow = (): number => busy + (workingSince === null ? 0 : now() - workingSince);
  const work = (): void => {
    workingSince ??= now();
  };
  const rest = (): void => {
    if (workingSince === null) return;
    busy += now() - workingSince;
    workingSince = null;
  };
  const timingOf = (at: number, busyAt: number): JobTiming => ({
    ms: now() - at,
    busyMs: busyNow() - busyAt,
  });

  const alive = (job: Job): boolean =>
    live.get(job.jobId) === job && (job.kind !== 'equity' || newestEquity === job.jobId);

  const fail = (jobId: number, epoch: number, e: unknown): void =>
    post({ kind: 'error', jobId, epoch, message: messageOf(e) });

  /**
   * Runs one step job to its end. `reply` turns a step into its reply; `truncated` gives the
   * capped final reply from the last estimate (or null when there is none).
   */
  async function run<T>(
    job: Job,
    steps: Steps<T>,
    reply: (step: T, timing: JobTiming) => { msg: EquityReply; final: boolean },
    truncated: (last: T, timing: JobTiming) => EquityReply,
  ): Promise<void> {
    const started = now();
    let sliceStart = started;
    let last: T | null = null;
    work();
    try {
      for (;;) {
        const step = steps.next();
        if (step.done === true)
          throw new Error(`${job.kind}: the steps ended without a final result`);
        if (step.value !== null) {
          last = step.value;
          const { msg, final } = reply(step.value, timingOf(job.at, job.busyAt));
          post(msg);
          if (final) return;
        }
        const t = now();
        if (t - started >= capMs) {
          steps.return?.();
          if (last === null) throw new Error(`${job.kind}: no estimate within ${capMs} ms`);
          post(truncated(last, timingOf(job.at, job.busyAt)));
          return;
        }
        if (t - sliceStart >= sliceMs) {
          rest();
          await pause();
          if (!alive(job)) {
            steps.return?.();
            return;
          }
          work();
          sliceStart = now();
        }
      }
    } catch (e) {
      if (alive(job)) fail(job.jobId, job.epoch, e);
    } finally {
      rest();
      if (live.get(job.jobId) === job) live.delete(job.jobId);
    }
  }

  function start(job: Job, begin: () => Promise<void>): void {
    if (job.kind === 'equity') newestEquity = job.jobId;
    live.set(job.jobId, job);
    void begin();
  }

  const jobOf = (kind: StepKind, jobId: number, epoch: number): Job => ({
    kind,
    jobId,
    epoch,
    at: now(),
    busyAt: busyNow(),
  });

  return {
    handle(msg: EquityRequest): void {
      switch (msg.kind) {
        case 'cancel':
          live.delete(msg.jobId);
          return;
        case 'equity': {
          const job = jobOf('equity', msg.jobId, msg.epoch);
          start(job, async () => {
            let steps: Steps<EquityResult>;
            try {
              steps = math.equitySteps(msg.hero, msg.board, msg.nOpp);
            } catch (e) {
              live.delete(job.jobId);
              fail(job.jobId, job.epoch, e);
              return;
            }
            await run(
              job,
              steps,
              (result, timing) => ({
                msg: { kind: 'equity', jobId: job.jobId, epoch: job.epoch, result, timing },
                final: result.final,
              }),
              (last, timing) => ({
                kind: 'equity',
                jobId: job.jobId,
                epoch: job.epoch,
                result: { ...last, final: true, truncated: true },
                timing,
              }),
            );
          });
          return;
        }
        case 'equityKnown': {
          const job = jobOf('equityKnown', msg.jobId, msg.epoch);
          const known = (
            results: EquityResult[],
            final: boolean,
            timing: JobTiming,
          ): EquityReply => ({
            kind: 'equityKnown',
            jobId: job.jobId,
            epoch: job.epoch,
            perPlayer: results.map((r) => r.equity),
            exact: results.every((r) => r.exact),
            final,
            timing,
          });
          start(job, async () => {
            let steps: Steps<EquityResult[]>;
            try {
              steps = math.runoutSteps(msg.hands, msg.board);
            } catch (e) {
              live.delete(job.jobId);
              fail(job.jobId, job.epoch, e);
              return;
            }
            await run(
              job,
              steps,
              (results, timing) => {
                const final = results.every((r) => r.final);
                return { msg: known(results, final, timing), final };
              },
              (last, timing) => known(last, true, timing),
            );
          });
          return;
        }
        case 'handInfo': {
          const at = now();
          const busyAt = busyNow();
          work();
          try {
            const analysis = math.handInfo(msg.hero, msg.board);
            const timing = timingOf(at, busyAt);
            post({ kind: 'handInfo', jobId: msg.jobId, epoch: msg.epoch, analysis, timing });
          } catch (e) {
            fail(msg.jobId, msg.epoch, e);
          } finally {
            rest();
          }
          return;
        }
        case 'bench': {
          const bench = options.bench;
          if (bench === undefined) {
            fail(msg.jobId, 0, new Error('bench: not available'));
            return;
          }
          const jobId = msg.jobId;
          void (async () => {
            let result: EquityBenchResult;
            try {
              result = await bench();
            } catch (e) {
              fail(jobId, 0, e);
              return;
            }
            post({ kind: 'bench', jobId, result });
          })();
          return;
        }
      }
    },
    running(): number[] {
      return [...live.keys()];
    },
  };
}
