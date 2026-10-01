/**
 * The job runner of equity.worker (PLAN §7.3, Appendix A.6; Stage 4 acceptance 2): progress and
 * final replies, cancel, a newer equity job superseding an older one (and two equityKnown jobs
 * side by side), the 3 s safety cap, errors, the timing every reply carries (§15.3) and the
 * `bench` reply (§15.4). Fake maths and a hand-driven pause, so every interleaving is exact.
 */
import { describe, expect, it } from 'vitest';
import type { EquityResult, HandAnalysis } from '../../src/analysis/types.ts';
import {
  createEquityService,
  type EquityMath,
  type EquityService,
} from '../../src/workers/equityService.ts';
import type { EquityBenchResult, EquityReply, EquityRequest } from '../../src/workers/protocol.ts';

const HERO: [number, number] = [50, 46];

function result(n: number, final: boolean): EquityResult {
  const win = n / 100_000;
  return { n, win, split: 0.01, equity: win + 0.01, exact: false, final, truncated: false };
}

/** Steps like analysis/equity.ts: checkpoints, 2,500, checkpoint, 10,000, checkpoints, final. */
function* steps(counter: { next: number; returned: boolean }): Generator<EquityResult | null> {
  const plan: (EquityResult | null)[] = [
    null,
    result(2_500, false),
    null,
    result(10_000, false),
    null,
    null,
    result(40_000, true),
  ];
  try {
    for (const step of plan) {
      counter.next++;
      yield step;
    }
  } finally {
    counter.returned = true;
  }
}

const ANALYSIS: HandAnalysis = {
  draws: [],
  outs: [],
  nextCardPct: null,
  byRiverPct: null,
  chances: null,
  beaters: null,
  nuts: false,
};

interface Rig {
  service: EquityService;
  posted: EquityReply[];
  /** Resolves the oldest pending pause. */
  resume(): Promise<void>;
  pauses(): number;
  counters: { next: number; returned: boolean }[];
  clock: { t: number };
}

function rig(math: Partial<EquityMath> = {}, capMs = 3000): Rig {
  const posted: EquityReply[] = [];
  const waiting: (() => void)[] = [];
  const counters: Rig['counters'] = [];
  const clock = { t: 0 };
  const full: EquityMath = {
    equitySteps: () => {
      const counter = { next: 0, returned: false };
      counters.push(counter);
      return steps(counter);
    },
    runoutSteps: () => {
      throw new Error('not used');
    },
    handInfo: () => ANALYSIS,
    ...math,
  };
  const service = createEquityService({
    math: full,
    post: (reply) => posted.push(reply),
    pause: () => new Promise<void>((resolve) => waiting.push(resolve)),
    now: () => clock.t,
    sliceMs: 0, // pause at every checkpoint
    capMs,
  });
  return {
    service,
    posted,
    counters,
    clock,
    pauses: () => waiting.length,
    async resume() {
      const next = waiting.shift();
      if (next === undefined) throw new Error('nothing is paused');
      next();
      for (let i = 0; i < 5; i++) await Promise.resolve();
    },
  };
}

const equity = (jobId: number, epoch = 1): EquityRequest => ({
  kind: 'equity',
  jobId,
  epoch,
  hero: HERO,
  board: [],
  nOpp: 3,
});

const ns = (posted: EquityReply[], jobId: number): number[] =>
  posted.flatMap((r) => (r.kind === 'equity' && r.jobId === jobId ? [r.result.n] : []));

async function runToEnd(r: Rig): Promise<void> {
  for (let i = 0; i < 50 && r.pauses() > 0; i++) await r.resume();
}

describe('equity jobs', () => {
  it('posts the progress results and the final one, pausing at every checkpoint', async () => {
    const r = rig();
    r.service.handle(equity(1, 4));
    expect(r.posted).toEqual([]); // the first step is a checkpoint
    await runToEnd(r);
    expect(ns(r.posted, 1)).toEqual([2_500, 10_000, 40_000]);
    expect(r.posted.every((p) => p.kind === 'equity' && p.epoch === 4)).toBe(true);
    expect(r.posted.at(-1)).toMatchObject({ result: { final: true, truncated: false } });
    expect(r.service.running()).toEqual([]);
  });

  it('a cancelled job never posts again and stops computing', async () => {
    const r = rig();
    r.service.handle(equity(1));
    await r.resume(); // → 2,500 posted, then a checkpoint
    expect(ns(r.posted, 1)).toEqual([2_500]);
    r.service.handle({ kind: 'cancel', jobId: 1 });
    await runToEnd(r);
    expect(ns(r.posted, 1)).toEqual([2_500]);
    expect(r.counters[0]?.returned).toBe(true);
    expect(r.counters[0]?.next).toBe(2); // no step after the cancel
    expect(r.service.running()).toEqual([]);
  });

  it('a newer equity job supersedes the older one before its cancel arrives', async () => {
    const r = rig();
    r.service.handle(equity(1));
    await r.resume();
    r.service.handle(equity(2)); // no cancel for job 1
    await runToEnd(r);
    expect(ns(r.posted, 1)).toEqual([2_500]);
    expect(ns(r.posted, 2)).toEqual([2_500, 10_000, 40_000]);
  });

  it('cancelling an unknown or finished job changes nothing', async () => {
    const r = rig();
    r.service.handle({ kind: 'cancel', jobId: 42 });
    r.service.handle(equity(1));
    await runToEnd(r);
    r.service.handle({ kind: 'cancel', jobId: 1 });
    expect(ns(r.posted, 1)).toEqual([2_500, 10_000, 40_000]);
  });

  it('pauses only after a time slice of work (default 8 ms)', () => {
    const posted: EquityReply[] = [];
    let pauses = 0;
    const service = createEquityService({
      math: {
        equitySteps: () => steps({ next: 0, returned: false }),
        runoutSteps: () => steps({ next: 0, returned: false }) as never,
        handInfo: () => ANALYSIS,
      },
      post: (reply) => posted.push(reply),
      pause: () => {
        pauses++;
        return new Promise<void>(() => {});
      },
      now: () => 0, // no time passes: never pauses
    });
    service.handle(equity(1));
    expect(pauses).toBe(0);
    expect(ns(posted, 1)).toEqual([2_500, 10_000, 40_000]);
  });

  it('the 3 s cap posts the last estimate as final and truncated', async () => {
    const r = rig();
    r.service.handle(equity(1));
    await r.resume(); // 2,500 posted
    r.clock.t = 3000;
    await r.resume(); // the next checkpoint sees the cap
    const last = r.posted.at(-1);
    expect(last).toMatchObject({ kind: 'equity', jobId: 1 });
    expect(last?.kind === 'equity' && last.result).toMatchObject({
      n: 2_500,
      final: true,
      truncated: true,
    });
    expect(r.counters[0]?.returned).toBe(true);
    expect(r.pauses()).toBe(0);
  });

  it('every reply carries its timing: wall time since the request, and the busy time in it', async () => {
    // A clock the maths moves: each step "computes" for 2 ms, each pause waits 5 ms.
    const clock = { t: 100 };
    const posted: EquityReply[] = [];
    const service = createEquityService({
      math: {
        *equitySteps() {
          clock.t += 2;
          yield null; // a checkpoint: pause
          clock.t += 2;
          yield result(2_500, false);
          clock.t += 2;
          yield result(40_000, true);
        },
        runoutSteps: () => {
          throw new Error('not used');
        },
        handInfo: () => {
          clock.t += 3;
          return ANALYSIS;
        },
      },
      post: (reply) => posted.push(reply),
      pause: () => {
        clock.t += 5;
        return Promise.resolve();
      },
      now: () => clock.t,
      sliceMs: 0,
    });
    service.handle(equity(1));
    service.handle({ kind: 'handInfo', jobId: 2, epoch: 1, hero: HERO, board: [] });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const timing = (jobId: number) =>
      posted.filter((p) => p.jobId === jobId).map((p) => ('timing' in p ? p.timing : null));
    // handInfo ran while job 1 was paused: 3 ms, all of it busy.
    expect(timing(2)).toEqual([{ ms: 3, busyMs: 3 }]);
    // Job 1: 2 ms of work, a 5 ms pause, handInfo's 3 ms, 2 ms of work → the 2,500 mark at 12 ms,
    // 7 of them busy (its own 4 and handInfo's 3); another pause and 2 ms → the final at 19 ms.
    expect(timing(1)).toEqual([
      { ms: 12, busyMs: 7 },
      { ms: 19, busyMs: 9 },
    ]);
  });

  it('the cap without any estimate posts an error', () => {
    const r = rig({}, 0);
    r.service.handle(equity(1));
    expect(r.posted).toEqual([
      { kind: 'error', jobId: 1, epoch: 1, message: 'equity: no estimate within 0 ms' },
    ]);
  });

  it('maths that throws posts an error reply', async () => {
    const r = rig({
      equitySteps: () => {
        throw new RangeError('equity: nOpp must be 1..8, got 0');
      },
    });
    r.service.handle(equity(1));
    expect(r.posted).toEqual([
      { kind: 'error', jobId: 1, epoch: 1, message: 'equity: nOpp must be 1..8, got 0' },
    ]);
    const broken = rig({
      // eslint-disable-next-line require-yield
      equitySteps: function* () {
        throw new Error('broken table');
      },
    });
    broken.service.handle(equity(2));
    expect(broken.posted).toEqual([{ kind: 'error', jobId: 2, epoch: 1, message: 'broken table' }]);
    const short = rig({
      equitySteps: function* () {
        yield null;
      },
    });
    short.service.handle(equity(3));
    await runToEnd(short);
    expect(short.posted).toEqual([
      {
        kind: 'error',
        jobId: 3,
        epoch: 1,
        message: 'equity: the steps ended without a final result',
      },
    ]);
  });
});

describe('equityKnown, handInfo and bench', () => {
  it('equityKnown posts one equity per hand, progress then final', async () => {
    const r = rig({
      runoutSteps: function* () {
        yield null;
        yield [result(2_500, false), result(2_500, false)];
        yield [result(20_000, true), result(20_000, true)];
      },
    });
    r.service.handle({ kind: 'equityKnown', jobId: 5, epoch: 2, hands: [HERO, [0, 1]], board: [] });
    await runToEnd(r);
    const e2500 = result(2_500, false).equity;
    const eFinal = result(20_000, true).equity;
    const timing = { ms: 0, busyMs: 0 }; // the rig's clock stands still
    expect(r.posted).toEqual([
      {
        kind: 'equityKnown',
        jobId: 5,
        epoch: 2,
        perPlayer: [e2500, e2500],
        exact: false,
        final: false,
        timing,
      },
      {
        kind: 'equityKnown',
        jobId: 5,
        epoch: 2,
        perPlayer: [eFinal, eFinal],
        exact: false,
        final: true,
        timing,
      },
    ]);
  });

  it('two equityKnown jobs run side by side: no supersession, each stops at its own cancel', async () => {
    // During a run-out the street's bars and the board at the all-in are computed at once
    // (chunk 4.7): a newer equityKnown job must not stop the older one.
    const r = rig({
      runoutSteps: function* (hands, board) {
        const e = board.length / 10;
        yield null;
        yield [result(2_500, false), result(2_500, false)];
        yield null;
        yield hands.map(() => ({ ...result(990, true), equity: e }));
      },
    });
    const known = (jobId: number, board: number[]): EquityRequest => ({
      kind: 'equityKnown',
      jobId,
      epoch: 1,
      hands: [HERO, [0, 1]],
      board,
    });
    r.service.handle(known(1, [8, 9, 10, 11]));
    r.service.handle(known(2, [8, 9, 10]));
    await runToEnd(r);
    const finals = r.posted.filter((p) => p.kind === 'equityKnown' && p.final);
    expect(finals.map((p) => [p.jobId, p.kind === 'equityKnown' && p.perPlayer[0]])).toEqual([
      [1, 0.4],
      [2, 0.3],
    ]);
    // A cancel still stops one of them at once.
    const c = rig({
      runoutSteps: function* () {
        yield null;
        yield [result(990, true), result(990, true)];
      },
    });
    c.service.handle(known(3, [8, 9, 10]));
    c.service.handle(known(4, [8, 9, 10, 11]));
    c.service.handle({ kind: 'cancel', jobId: 3 });
    await runToEnd(c);
    expect(c.posted.map((p) => p.jobId)).toEqual([4]);
  });

  it('equityKnown truncated by the cap is posted as final', async () => {
    const r = rig({
      runoutSteps: function* () {
        yield [result(2_500, false), result(2_500, false)];
        yield null;
        yield [result(20_000, true), result(20_000, true)];
      },
    });
    r.clock.t = 0;
    r.service.handle({ kind: 'equityKnown', jobId: 1, epoch: 1, hands: [HERO, [0, 1]], board: [] });
    r.clock.t = 5000;
    await runToEnd(r);
    expect(r.posted.at(-1)).toMatchObject({ kind: 'equityKnown', final: true, exact: false });
    expect(r.posted).toHaveLength(2);
  });

  it('equityKnown and equity jobs run side by side', async () => {
    const r = rig({
      runoutSteps: function* () {
        yield null;
        yield [result(990, true), result(990, true)];
      },
    });
    r.service.handle(equity(1));
    r.service.handle({ kind: 'equityKnown', jobId: 2, epoch: 1, hands: [HERO, [0, 1]], board: [] });
    await runToEnd(r);
    expect(ns(r.posted, 1)).toEqual([2_500, 10_000, 40_000]);
    expect(r.posted.filter((p) => p.jobId === 2)).toHaveLength(1);
  });

  it('handInfo answers once, at once; a throw is an error reply', () => {
    const r = rig();
    r.service.handle({ kind: 'handInfo', jobId: 9, epoch: 3, hero: HERO, board: [] });
    expect(r.posted).toEqual([
      {
        kind: 'handInfo',
        jobId: 9,
        epoch: 3,
        analysis: ANALYSIS,
        timing: { ms: 0, busyMs: 0 },
      },
    ]);
    const bad = rig({
      handInfo: () => {
        throw new RangeError('analyzeHand: need 2 hole cards, got 1');
      },
    });
    bad.service.handle({ kind: 'handInfo', jobId: 1, epoch: 1, hero: HERO, board: [] });
    expect(bad.posted).toEqual([
      { kind: 'error', jobId: 1, epoch: 1, message: 'analyzeHand: need 2 hole cards, got 1' },
    ]);
  });

  it('bench runs the measurements and answers once (§15.4)', async () => {
    const bench: EquityBenchResult = {
      evalsPerSec: 12_345_678,
      eq8PreflopMs: 41.5,
      eq8FlopMs: 52,
      eq1FlopMs: 7.5,
      ua: 'test-agent',
    };
    const posted: EquityReply[] = [];
    let calls = 0;
    const service = createEquityService({
      math: {
        equitySteps: () => steps({ next: 0, returned: false }),
        runoutSteps: () => {
          throw new Error('not used');
        },
        handInfo: () => ANALYSIS,
      },
      post: (reply) => posted.push(reply),
      bench: () => {
        calls++;
        return Promise.resolve(bench);
      },
    });
    service.handle({ kind: 'bench', jobId: 7 });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(calls).toBe(1);
    expect(posted).toEqual([{ kind: 'bench', jobId: 7, result: bench }]);
    // A failed measurement is an error reply (epoch 0: bench jobs have none).
    const failing = createEquityService({
      math: {
        equitySteps: () => steps({ next: 0, returned: false }),
        runoutSteps: () => {
          throw new Error('not used');
        },
        handInfo: () => ANALYSIS,
      },
      post: (reply) => posted.push(reply),
      bench: () => Promise.reject(new Error('out of memory')),
    });
    failing.handle({ kind: 'bench', jobId: 8 });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(posted.at(-1)).toEqual({ kind: 'error', jobId: 8, epoch: 0, message: 'out of memory' });
  });

  it('bench without the measurements (a runner made without them) answers with an error', () => {
    const r = rig();
    r.service.handle({ kind: 'bench', jobId: 1 });
    expect(r.posted).toEqual([
      { kind: 'error', jobId: 1, epoch: 0, message: 'bench: not available' },
    ]);
  });
});
