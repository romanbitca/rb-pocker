/**
 * `runBench` (PLAN §15.4, `app/bench.ts`): one `bench` job to a worker of its own, which is
 * terminated when the answer comes; failures reject with a reason the screen can show.
 */
import { describe, expect, it } from 'vitest';
import { BENCH_TIMEOUT_MS, runBench } from '../../src/app/bench.ts';
import type { Timers } from '../../src/app/controller.ts';
import type { EquityBenchResult } from '../../src/workers/protocol.ts';
import { fakeWorker } from '../workers/fakeWorker.ts';

const RESULT: EquityBenchResult = {
  evalsPerSec: 9_000_000,
  eq8PreflopMs: 1,
  eq8FlopMs: 60,
  eq1FlopMs: 9,
  ua: 'test',
};

/** Timers that never fire unless `fire()` is called. */
function manualTimers(): Timers & { fire(): void } {
  const due: (() => void)[] = [];
  return {
    setTimeout: (fn) => due.push(fn),
    clearTimeout: () => {},
    now: () => 0,
    fire: () => due.splice(0).forEach((fn) => fn()),
  };
}

describe('runBench', () => {
  it('sends one bench job, resolves with its result, and terminates the worker', async () => {
    const fake = fakeWorker();
    const pending = runBench({ spawn: fake.spawn, timers: manualTimers() });
    expect(fake.received).toEqual([{ kind: 'bench', jobId: 1 }]);
    fake.current().reply({ kind: 'bench', jobId: 1, result: RESULT });
    await expect(pending).resolves.toEqual({ equity: RESULT, hint: null });
    expect(fake.current().terminated).toBe(true);
  });

  it('rejects with the worker’s error, a crash, a timeout, or no worker at all', async () => {
    const errored = fakeWorker();
    const a = runBench({ spawn: errored.spawn, timers: manualTimers() });
    errored.current().reply({ kind: 'error', jobId: 1, epoch: 0, message: 'out of memory' });
    await expect(a).rejects.toThrow('out of memory');

    const crashed = fakeWorker();
    const b = runBench({ spawn: crashed.spawn, timers: manualTimers() });
    crashed.current().crash('boom');
    await expect(b).rejects.toThrow('boom');

    const silent = fakeWorker();
    const timers = manualTimers();
    const c = runBench({ spawn: silent.spawn, timers });
    timers.fire();
    await expect(c).rejects.toThrow('no answer within 2 minutes');
    expect(BENCH_TIMEOUT_MS).toBe(120_000);

    const none = fakeWorker();
    none.failSpawns = 2; // no module workers: the first start and the one retry both fail
    await expect(runBench({ spawn: none.spawn, timers: manualTimers() })).rejects.toThrow(
      'cannot start the game worker',
    );
  });
});
