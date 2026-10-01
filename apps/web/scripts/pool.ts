/**
 * A small pool of `worker_threads` for the build-time table scripts (PLAN §7.5): runs a list of
 * independent jobs on up to `threads` threads and returns the results in the order of the jobs.
 * The worker module (`workerFile`) answers `{ id, job }` with `{ id, result }`.
 *
 * A job must be a pure function of its fields (every Monte Carlo job carries its own seed), so the
 * results never depend on how many threads run the jobs or on the order they finish in.
 */
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';

/** One thread per core. */
export function defaultThreads(): number {
  return Math.max(1, availableParallelism());
}

interface Reply<R> {
  readonly id: number;
  readonly result: R;
}

/**
 * Runs `jobs` and returns the results in job order. With one thread (or at most one job) it runs
 * `runHere` in this thread. Jobs are handed out one at a time to whichever thread is free, so put
 * the slow ones first. `onDone` is called after every finished job with the running count.
 */
export async function runPool<J, R>(
  workerFile: string,
  runHere: (job: J) => R,
  jobs: readonly J[],
  threads: number,
  onDone?: (done: number) => void,
): Promise<R[]> {
  if (!Number.isInteger(threads) || threads < 1) {
    throw new RangeError(`threads must be a positive integer, got ${threads}`);
  }
  const results = new Array<R>(jobs.length);
  if (threads === 1 || jobs.length <= 1) {
    jobs.forEach((job, i) => {
      results[i] = runHere(job);
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
      const worker = new Worker(workerFile);
      workers.push(worker);
      worker.on('message', (reply: Reply<R>) => {
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
