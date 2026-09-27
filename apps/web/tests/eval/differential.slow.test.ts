import { describe, expect, it } from 'vitest';
import { deriveSeed, ZERO_SEED } from '../../src/core/rng.ts';
import { testSeed } from '../helpers/seed.ts';
import { diffHandEvaluator, diffNaive, diffPokersolver } from './differential.ts';

// Stage 1 acceptance 2 at full size (PLAN §5.5).
describe('evaluator differential (slow)', () => {
  it(
    'agrees with @poker-apprentice/hand-evaluator on 1,000,000 random pairs',
    { timeout: 600_000 },
    () => {
      const r = diffHandEvaluator(
        testSeed(deriveSeed(ZERO_SEED, 'slow|diff-he')),
        1_000_000,
        false,
      );
      expect(r.failures).toEqual([]);
      expect(r.failureCount).toBe(0);
      expect(r.pairs).toBe(1_000_000);
      expect(r.ties).toBeGreaterThan(0);
    },
  );

  it('agrees with hand-evaluator on 200,000 pairs from small decks', { timeout: 300_000 }, () => {
    const r = diffHandEvaluator(testSeed(deriveSeed(ZERO_SEED, 'slow|diff-he-b')), 200_000, true);
    expect(r.failures).toEqual([]);
  });

  it('agrees with pokersolver on 200,000 random pairs', { timeout: 600_000 }, () => {
    const r = diffPokersolver(testSeed(deriveSeed(ZERO_SEED, 'slow|diff-ps')), 200_000, false);
    expect(r.failures).toEqual([]);
    expect(r.pairs).toBe(200_000);
  });

  it('agrees with the naive oracle on 1,000,000 random hands', { timeout: 600_000 }, () => {
    const r = diffNaive(testSeed(deriveSeed(ZERO_SEED, 'slow|naive7')), 1_000_000, 7, false);
    expect(r.failures).toEqual([]);
    expect(r.pairs).toBe(1_000_000);
  });
});
