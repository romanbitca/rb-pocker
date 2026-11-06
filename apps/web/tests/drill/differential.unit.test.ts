// PLAN §13.5: the unit-size run of `differential.test.ts` (the volume project runs 100,000 pairs of
// each size): RB's evaluator and the standalone drill's own scoring agree on category and result.
import { describe, expect, it } from 'vitest';
import { deriveSeed, ZERO_SEED } from '../../src/core/rng.ts';
import { testSeed } from '../helpers/seed.ts';
import { differential } from './differential.ts';

describe('hand drill: RB evaluator against the standalone drill (unit size)', () => {
  it('agrees on 10,000 pairs of 5-card hands', { timeout: 30_000 }, () => {
    const r = differential(testSeed(deriveSeed(ZERO_SEED, 'test|drill-diff-5u')), 10_000, 5);
    expect(r.failures).toEqual([]);
    expect(r.ties).toBeGreaterThan(0);
  });

  it('agrees on 2,000 pairs of 7-card hands', { timeout: 60_000 }, () => {
    const r = differential(testSeed(deriveSeed(ZERO_SEED, 'test|drill-diff-7u')), 2_000, 7);
    expect(r.failures).toEqual([]);
    expect(r.ties).toBeGreaterThan(0);
  });
});
