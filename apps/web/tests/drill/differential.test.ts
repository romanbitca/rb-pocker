// PLAN §13.5: the hand drill uses RB's evaluator as its one hand logic, and the standalone drill's
// own `score5` / `cmp` / `bestOf` are its oracle. 100,000 pairs of 5-card hands and 100,000 pairs
// of 7-card hands (400,000 hands) must get the same category and the same result (who wins, or a
// split). A volume test (vitest.config.ts `VOLUME_TESTS`, `npm run test:volume`); the unit run has
// `differential.unit.test.ts`, a smaller run of the same check.
import { describe, expect, it } from 'vitest';
import { deriveSeed, ZERO_SEED } from '../../src/core/rng.ts';
import { testSeed } from '../helpers/seed.ts';
import { differential } from './differential.ts';

describe('hand drill: RB evaluator against the standalone drill (oracle)', () => {
  it('agrees on 100,000 pairs of 5-card hands', { timeout: 120_000 }, () => {
    const r = differential(testSeed(deriveSeed(ZERO_SEED, 'test|drill-diff-5')), 100_000, 5);
    expect(r.failures).toEqual([]);
    expect(r.hands).toBe(200_000);
    expect(r.ties).toBeGreaterThan(0);
    // Every category came up, the royal flush too (the small deck).
    for (let p = 1; p <= 10; p++) expect(r.byPosition[p], `#${p}`).toBeGreaterThan(0);
  });

  it('agrees on 100,000 pairs of 7-card hands (best five of seven)', { timeout: 600_000 }, () => {
    const r = differential(testSeed(deriveSeed(ZERO_SEED, 'test|drill-diff-7')), 100_000, 7);
    expect(r.failures).toEqual([]);
    expect(r.hands).toBe(200_000);
    expect(r.ties).toBeGreaterThan(0);
    for (let p = 1; p <= 10; p++) expect(r.byPosition[p], `#${p}`).toBeGreaterThan(0);
  });
});
