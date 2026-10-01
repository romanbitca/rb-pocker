/**
 * The `#bench` run (PLAN §15.4): the hidden speed test. main.tsx loads this module (and the
 * screen, `ui/screens/Bench.tsx`) with `import()` only when the page opens at `#bench`, and then
 * starts no game: the test gets a fresh `equity.worker` to itself, sends one `bench` job
 * (Appendix A.6), and terminates the worker when the answer comes. The worker measures itself
 * (`workers/bench.ts`), so the numbers are the ones the game gets on this device.
 *
 * Hint latency (`brain.worker`'s `bench`) arrives with the brain worker in Stage 5; until then the
 * report has `hint: null` and the screen says so.
 */
import { spawnEquityWorker } from '../workers/spawn.ts';
import type { EquityBenchResult, EquityReply, EquityRequest } from '../workers/protocol.ts';
import { realTimers, type Timers } from './controller.ts';
import { createEquityClient, fromWorker, type SpawnWorker } from './workerClient.ts';

/** A slow phone needs several seconds; a stuck worker gets an error after this long. */
export const BENCH_TIMEOUT_MS = 120_000;

export interface BenchReport {
  equity: EquityBenchResult;
  /** `brain.worker`'s hint latency p50 / p95 in ms (Stage 5); null until it exists. */
  hint: { p50Ms: number; p95Ms: number } | null;
}

export interface BenchOptions {
  /** Starts the worker (default: the app's `equity.worker`). */
  spawn?: SpawnWorker<EquityRequest, EquityReply>;
  timers?: Timers;
}

/** Runs the §15.4 measurements in a worker of their own; rejects when they cannot finish. */
export function runBench(options: BenchOptions = {}): Promise<BenchReport> {
  const spawn = options.spawn ?? fromWorker<EquityRequest, EquityReply>(spawnEquityWorker);
  const client = createEquityClient(spawn, options.timers ?? realTimers);
  return new Promise<BenchReport>((resolve, reject) => {
    const end = (outcome: BenchReport | Error): void => {
      client.dispose();
      if (outcome instanceof Error) reject(outcome);
      else resolve(outcome);
    };
    const jobId = client.request({
      slot: 'bench',
      epoch: 0,
      timeoutMs: BENCH_TIMEOUT_MS,
      build: (id) => ({ kind: 'bench', jobId: id }),
      onEvent: (event) => {
        if (event.type === 'timeout') end(new Error('no answer within 2 minutes'));
        else if (event.type === 'failed') end(new Error(event.reason));
        else if (event.reply.kind === 'bench') end({ equity: event.reply.result, hint: null });
        else if (event.reply.kind === 'error') end(new Error(event.reply.message));
      },
    });
    if (jobId === null) end(new Error('this browser cannot start the game worker'));
  });
}
