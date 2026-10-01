/**
 * The `#bench` measurements of equity.worker (PLAN §15.4, `workers/bench.ts`): the seeded hand
 * pool, the evaluator timing, the time to a final win chance through the job runner, and the
 * whole `bench` reply with the real maths (small sizes, so it stays fast).
 */
import { describe, expect, it } from 'vitest';
import { isCard } from '../../src/core/cards.ts';
import { score7 } from '../../src/eval/evaluate.ts';
import {
  BENCH_EVALS,
  BENCH_POOL,
  BENCH_SPOTS,
  evaluatorSpeed,
  handPool,
  runBench,
  timeToFinal,
} from '../../src/workers/bench.ts';
import { equityMath } from '../../src/workers/equityMath.ts';
import type { EquityMath } from '../../src/workers/equityService.ts';

const result = (final: boolean) => ({
  n: final ? 40_000 : 2_500,
  win: 0.5,
  split: 0,
  equity: 0.5,
  exact: false,
  final,
  truncated: false,
});

describe('bench (§15.4)', () => {
  it('uses the §15.4 sizes: 5,000,000 evaluations, three spots', () => {
    expect(BENCH_EVALS).toBe(5_000_000);
    expect(BENCH_POOL * 7).toBeLessThanOrEqual(2_000_000); // under 2 MB on a phone
    expect(Object.values(BENCH_SPOTS).map((s) => [s.board === '' ? 0 : 3, s.nOpp])).toEqual([
      [0, 8],
      [3, 8],
      [3, 1],
    ]);
  });

  it('deals a seeded pool of seven distinct cards per hand', () => {
    const pool = handPool(2_000);
    expect(pool).toHaveLength(14_000);
    for (let o = 0; o < pool.length; o += 7) {
      const hand = [...pool.subarray(o, o + 7)];
      expect(hand.every(isCard)).toBe(true);
      expect(new Set(hand).size).toBe(7);
    }
    expect(handPool(2_000)).toEqual(pool); // the same hands on every device
    // Not the same few hands again and again.
    const firsts = new Set<string>();
    for (let o = 0; o < pool.length; o += 7) firsts.add(pool.subarray(o, o + 7).join(','));
    expect(firsts.size).toBe(2_000);
  });

  it('times the evaluations only, cycling through the pool', () => {
    const pool = handPool(100);
    let t = 0;
    const clock = () => (t += 50); // every reading moves 50 ms on
    const { evalsPerSec, checksum } = evaluatorSpeed(250, pool, clock);
    expect(evalsPerSec).toBe(5_000); // 250 evaluations in 50 ms
    let expected = 0;
    for (let k = 0; k < 250; k++) {
      const o = (k % 100) * 7;
      expected = (expected + score7(pool.subarray(o, o + 7), 7)) | 0;
    }
    expect(checksum).toBe(expected);
  });

  it('measures the time to the final win chance through the job runner', async () => {
    let t = 0;
    const math: EquityMath = {
      *equitySteps() {
        t += 3;
        yield result(false);
        t += 4;
        yield null;
        t += 5;
        yield result(true);
      },
      runoutSteps: () => {
        throw new Error('not used');
      },
      handInfo: () => {
        throw new Error('not used');
      },
    };
    await expect(timeToFinal(math, [51, 47], [], 8, () => t)).resolves.toBe(12);
    const broken: EquityMath = {
      ...math,
      equitySteps: () => {
        throw new RangeError('equity: nOpp must be 1..8, got 9');
      },
    };
    await expect(timeToFinal(broken, [51, 47], [], 9, () => t)).rejects.toThrow('nOpp');
  });

  it('answers with every number, from the real maths', { timeout: 20_000 }, async () => {
    const r = await runBench(equityMath, { evals: 50_000, pool: 5_000, runs: 1 });
    expect(r.evalsPerSec).toBeGreaterThan(0);
    // Before the flop the win chance is a table lookup (§7.5): it may round to 0.0 ms.
    expect(r.eq8PreflopMs).toBeGreaterThanOrEqual(0);
    for (const ms of [r.eq8PreflopMs, r.eq8FlopMs, r.eq1FlopMs]) {
      expect(Number.isFinite(ms)).toBe(true);
    }
    // On the flop it is a Monte Carlo run through the job runner: it takes time.
    expect(r.eq8FlopMs).toBeGreaterThan(0);
    expect(r.eq1FlopMs).toBeGreaterThan(0);
    expect(typeof r.ua).toBe('string');
    expect(Object.keys(r).sort()).toEqual([
      'eq1FlopMs',
      'eq8FlopMs',
      'eq8PreflopMs',
      'evalsPerSec',
      'ua',
    ]);
  });
});
