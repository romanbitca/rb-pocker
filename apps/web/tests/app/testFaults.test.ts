/**
 * The faults layer of the dev/E2E builds (`app/testFaults.ts`, chunk 6.5): what a spec can switch on
 * through `window.__pc.faults` for Stage 6 acceptance 4. The layer sits between the brain client and
 * its worker; here the worker is a fake one the test answers by hand. That the layer never reaches a
 * production build is tests/app/testHooks.bundle.test.ts; the flow it exercises in a browser is
 * tests/e2e/grading.spec.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { realTimers } from '../../src/app/controller.ts';
import { createBrainFaults, INJECTED_ERROR, type BrainFaults } from '../../src/app/testFaults.ts';
import { createBrainClient, type BrainClient, type JobEvent } from '../../src/app/workerClient.ts';
import type { Observation } from '../../src/engine/types.ts';
import type { BrainReply, BrainRequest } from '../../src/workers/protocol.ts';
import { fakeBrainWorker, type FakeBrainWorker } from '../workers/fakeBrainWorker.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** A request body the fake worker never reads (manual mode). */
const obs = {} as Observation;

interface Rig {
  fake: FakeBrainWorker;
  faults: BrainFaults;
  brain: BrainClient;
}

function rig(): Rig {
  const fake = fakeBrainWorker();
  const { faults, wrap } = createBrainFaults(realTimers);
  return { fake, faults, brain: createBrainClient(wrap(fake.spawn), realTimers) };
}

interface Recorded {
  jobId: number | null;
  events: JobEvent<BrainReply>[];
}

const gradeJob = (brain: BrainClient, decisionId = 0): Recorded => {
  const rec: Recorded = { jobId: null, events: [] };
  rec.jobId = brain.request({
    slot: 'grade',
    epoch: 1,
    timeoutMs: 5000,
    build: (jobId): BrainRequest => ({
      kind: 'grade',
      jobId,
      epoch: 1,
      obs,
      taken: { type: 'check' },
      eRandom: null,
      decisionId,
    }),
    onEvent: (event) => rec.events.push(event),
  });
  return rec;
};

const botJob = (brain: BrainClient, seat = 1): Recorded => {
  const rec: Recorded = { jobId: null, events: [] };
  rec.jobId = brain.request({
    slot: `bot:${seat}`,
    epoch: 1,
    timeoutMs: 2000,
    build: (jobId): BrainRequest => ({
      kind: 'botDecision',
      jobId,
      epoch: 1,
      obs,
      profile: {} as never,
      seed: '0'.repeat(32),
    }),
    onEvent: (event) => rec.events.push(event),
  });
  return rec;
};

const gradeReply = (jobId: number): BrainReply => ({
  kind: 'grade',
  jobId,
  epoch: 1,
  result: { decisionId: 0, grade: 'best' } as never,
});

const botReply = (jobId: number, thinkMs = 400): BrainReply => ({
  kind: 'botDecision',
  jobId,
  epoch: 1,
  decision: { action: { type: 'check' } } as never,
  thinkMs,
});

describe('with no fault switched on', () => {
  it('passes requests and replies through unchanged', () => {
    const { fake, brain } = rig();
    const job = gradeJob(brain);
    expect(fake.received).toHaveLength(1);
    expect(fake.received[0]).toMatchObject({ kind: 'grade', jobId: job.jobId });
    fake.current().reply(gradeReply(job.jobId as number));
    expect(job.events).toEqual([
      { type: 'reply', reply: gradeReply(job.jobId as number), final: true },
    ]);
  });

  it('kill with no worker started says so', () => {
    const { faults } = createBrainFaults(realTimers);
    expect(faults.kill()).toBe(false);
    expect(faults.log().map((e) => e.what)).toEqual(['kill nothing']);
  });
});

describe('delay(kind, ms)', () => {
  it('holds replies of that kind for ms of the page clock, and no others', async () => {
    const { fake, faults, brain } = rig();
    faults.delay('grade', 3000);
    const grade = gradeJob(brain);
    const bot = botJob(brain);
    fake.current().reply(gradeReply(grade.jobId as number));
    fake.current().reply(botReply(bot.jobId as number));
    expect(bot.events).toHaveLength(1); // not held
    expect(grade.events).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2999);
    expect(grade.events).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(grade.events).toEqual([
      { type: 'reply', reply: gradeReply(grade.jobId as number), final: true },
    ]);
    expect(faults.log()).toEqual([
      expect.objectContaining({ what: 'delay', kind: 'grade', jobId: grade.jobId, ms: 3000 }),
    ]);
  });

  it('null puts the replies on time again', () => {
    const { fake, faults, brain } = rig();
    faults.delay('grade', 3000);
    faults.delay('grade', null);
    const grade = gradeJob(brain);
    fake.current().reply(gradeReply(grade.jobId as number));
    expect(grade.events).toHaveLength(1);
  });

  it('a delay longer than the job timeout is the job timing out (the client keeps its 5 s)', async () => {
    const { fake, faults, brain } = rig();
    faults.delay('grade', 60_000);
    const grade = gradeJob(brain);
    fake.current().reply(gradeReply(grade.jobId as number));
    await vi.advanceTimersByTimeAsync(5000);
    expect(grade.events).toEqual([{ type: 'timeout' }]);
    await vi.advanceTimersByTimeAsync(60_000); // the late reply is dropped
    expect(grade.events).toEqual([{ type: 'timeout' }]);
  });
});

describe('fail(kind, n)', () => {
  it('answers the next n jobs of that kind with an error reply; the worker never sees them', async () => {
    const { fake, faults, brain } = rig();
    faults.fail('grade', 2);
    const first = gradeJob(brain, 0);
    await vi.advanceTimersByTimeAsync(0);
    const second = gradeJob(brain, 0);
    await vi.advanceTimersByTimeAsync(0);
    for (const job of [first, second]) {
      expect(job.events).toEqual([
        {
          type: 'reply',
          reply: { kind: 'error', jobId: job.jobId, epoch: 1, message: INJECTED_ERROR },
          final: true,
        },
      ]);
    }
    expect(fake.received.filter((m) => m.kind === 'grade')).toHaveLength(0);
    // The third one reaches the worker.
    const third = gradeJob(brain, 0);
    expect(fake.received.filter((m) => m.kind === 'grade')).toHaveLength(1);
    fake.current().reply(gradeReply(third.jobId as number));
    expect(third.events).toHaveLength(1);
    expect(faults.log().filter((e) => e.what === 'fail')).toHaveLength(2);
  });

  it('is not an answer to other kinds of job', () => {
    const { fake, faults, brain } = rig();
    faults.fail('grade', 1);
    botJob(brain);
    expect(fake.received.filter((m) => m.kind === 'botDecision')).toHaveLength(1);
  });

  it('0 clears it', () => {
    const { fake, faults, brain } = rig();
    faults.fail('grade', 2);
    faults.fail('grade', 0);
    gradeJob(brain);
    expect(fake.received.filter((m) => m.kind === 'grade')).toHaveLength(1);
  });
});

describe('think(ms)', () => {
  it('sets the think time of bot decisions, and null gives the brain’s own back', () => {
    const { fake, faults, brain } = rig();
    faults.think(6000);
    const slow = botJob(brain, 1);
    fake.current().reply(botReply(slow.jobId as number, 400));
    expect(slow.events[0]).toMatchObject({ reply: { kind: 'botDecision', thinkMs: 6000 } });
    faults.think(null);
    const own = botJob(brain, 2);
    fake.current().reply(botReply(own.jobId as number, 400));
    expect(own.events[0]).toMatchObject({ reply: { kind: 'botDecision', thinkMs: 400 } });
  });
});

describe('kill()', () => {
  it('the worker dies: pending jobs fail, a new worker starts; the second kill fails the client', () => {
    const { fake, faults, brain } = rig();
    const bot = botJob(brain);
    expect(faults.kill()).toBe(true);
    expect(bot.events).toEqual([{ type: 'failed', reason: 'killed' }]);
    expect(fake.instances).toHaveLength(2);
    expect(fake.instances[0]?.terminated).toBe(true);
    expect(brain.status).toBe('ready');

    // The new worker serves the next job.
    const next = botJob(brain, 2);
    expect(fake.current().received).toHaveLength(1);
    fake.current().reply(botReply(next.jobId as number));
    expect(next.events).toHaveLength(1);

    expect(faults.kill()).toBe(true);
    expect(brain.status).toBe('failed');
    expect(fake.instances).toHaveLength(2);
    expect(botJob(brain, 3).jobId).toBeNull(); // a failed client sends nothing
    expect(faults.kill()).toBe(false); // nothing left to kill
    expect(faults.log().map((e) => e.what)).toEqual(['kill', 'kill', 'kill nothing']);
    // The client's own log saw both crashes and the failure.
    expect(brain.log().map((e) => e.what)).toEqual(
      expect.arrayContaining(['crash', 'restart', 'failed']),
    );
  });

  it('a reply the dead worker was holding never arrives', async () => {
    const { fake, faults, brain } = rig();
    faults.delay('grade', 3000);
    const grade = gradeJob(brain);
    fake.current().reply(gradeReply(grade.jobId as number));
    faults.kill();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(grade.events).toEqual([{ type: 'failed', reason: 'killed' }]);
  });

  it('retry() after a failed client starts a worker again, and kill works on it', () => {
    const { fake, faults, brain } = rig();
    faults.kill();
    faults.kill();
    expect(brain.status).toBe('failed');
    brain.retry();
    expect(brain.status).toBe('ready');
    expect(fake.instances).toHaveLength(3);
    expect(botJob(brain).jobId).not.toBeNull();
    expect(faults.kill()).toBe(true);
  });
});

describe('a real worker error reaches the client through the layer', () => {
  it('an error event of the worker is a crash, as without the layer', () => {
    const { fake, brain } = rig();
    const bot = botJob(brain);
    fake.current().crash('boom');
    expect(bot.events).toEqual([{ type: 'failed', reason: 'boom' }]);
    expect(fake.instances).toHaveLength(2);
  });
});
