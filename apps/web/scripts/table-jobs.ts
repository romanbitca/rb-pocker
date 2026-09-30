/**
 * The work units of the preflop table scripts (PLAN §7.5) and a pool of `worker_threads` that runs
 * them: `gen-preflop.ts` uses it for the 1,352 Monte Carlo cells and the 169 exact rows,
 * `check-tables.ts` for the cells it re-samples.
 *
 * A job is a pure function of its fields (each cell has its own seed), so the results never depend
 * on how many threads run the jobs or in which order they finish.
 */
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { finalCounts } from '../src/analysis/chances.ts';
import { equity } from '../src/analysis/equity.ts';
import { classCards } from '../src/core/cards.ts';
import type { Seed128 } from '../src/core/rng.ts';

/** One class against `nOpp` random hands, Monte Carlo with its own seed (§7.3 method, §7.5 n). */
export interface McJob {
  readonly kind: 'mc';
  readonly cls: number;
  readonly nOpp: number;
  readonly trials: number;
  readonly seed: Seed128;
}

/** One class: exactly how often each final category comes up over all C(50,5) boards (§6.6). */
export interface FinalsJob {
  readonly kind: 'finals';
  readonly cls: number;
}

export type Job = McJob | FinalsJob;

export interface McResult {
  readonly kind: 'mc';
  /** P(win) and the tie share, as fractions of 1 (`equity = win + split`). */
  readonly win: number;
  readonly split: number;
}

export interface FinalsResult {
  readonly kind: 'finals';
  readonly counts: readonly number[];
  readonly total: number;
}

export type JobResult = McResult | FinalsResult;

/** Runs one job in this thread. */
export function runJob(job: Job): JobResult {
  const hero = classCards(job.cls);
  if (job.kind === 'finals') {
    const { counts, total } = finalCounts(hero, []);
    return { kind: 'finals', counts, total };
  }
  const result = equity(
    { hero, board: [], nOpp: job.nOpp },
    { mode: 'montecarlo', trials: job.trials, seed: job.seed },
  );
  return { kind: 'mc', win: result.win, split: result.split };
}

const WORKER_FILE = fileURLToPath(new URL('./table-worker.ts', import.meta.url));

/** One thread per core. */
export function defaultThreads(): number {
  return Math.max(1, availableParallelism());
}

interface Reply {
  readonly id: number;
  readonly result: JobResult;
}

/**
 * Runs the jobs on up to `threads` worker threads (in this thread when that is 1) and returns the
 * results in the order of `jobs`. Jobs are handed out one at a time to whichever thread is free,
 * so put the slow ones first. `onDone` is called after every finished job with the running count.
 */
export async function runJobs(
  jobs: readonly Job[],
  threads: number,
  onDone?: (done: number) => void,
): Promise<JobResult[]> {
  if (!Number.isInteger(threads) || threads < 1) {
    throw new RangeError(`threads must be a positive integer, got ${threads}`);
  }
  const results: JobResult[] = new Array<JobResult>(jobs.length);
  if (threads === 1 || jobs.length <= 1) {
    jobs.forEach((job, i) => {
      results[i] = runJob(job);
      onDone?.(i + 1);
    });
    return results;
  }
  return new Promise((resolve, reject) => {
    const workers: Worker[] = [];
    let next = 0;
    let done = 0;
    let settled = false;
    const finish = (error?: unknown): void => {
      if (settled) return;
      settled = true;
      for (const worker of workers) void worker.terminate();
      if (error === undefined) resolve(results);
      else reject(error instanceof Error ? error : new Error(String(error)));
    };
    const feed = (worker: Worker): void => {
      const id = next++;
      if (id < jobs.length) worker.postMessage({ id, job: jobs[id] });
    };
    for (let t = 0; t < Math.min(threads, jobs.length); t++) {
      const worker = new Worker(WORKER_FILE);
      workers.push(worker);
      worker.on('message', (reply: Reply) => {
        results[reply.id] = reply.result;
        done++;
        onDone?.(done);
        if (done === jobs.length) finish();
        else feed(worker);
      });
      worker.on('error', finish);
      worker.on('exit', (code) => {
        if (code !== 0) finish(new Error(`a table worker exited with code ${code}`));
      });
      feed(worker);
    }
  });
}
