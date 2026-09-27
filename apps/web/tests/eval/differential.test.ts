import { describe, expect, it } from 'vitest';
import { deriveSeed, ZERO_SEED } from '../../src/core/rng.ts';
import { testSeed } from '../helpers/seed.ts';
import { diffHandEvaluator, diffPokersolver } from './differential.ts';

// Stage 1 acceptance 2 (unit size; the slow project runs the full 1,000,000 pairs).
describe('evaluator vs @poker-apprentice/hand-evaluator', () => {
  it(
    'agrees on who wins for 100,000 random pairs of seven-card hands',
    { timeout: 120_000 },
    () => {
      const r = diffHandEvaluator(testSeed(deriveSeed(ZERO_SEED, 'test|diff-he')), 100_000, false);
      expect(r.failures).toEqual([]);
      expect(r.failureCount).toBe(0);
      expect(r.pairs).toBe(100_000);
      expect(r.ties).toBeGreaterThan(0);
    },
  );

  it('agrees on 20,000 pairs from small decks (rare categories)', { timeout: 60_000 }, () => {
    const r = diffHandEvaluator(testSeed(deriveSeed(ZERO_SEED, 'test|diff-he-b')), 20_000, true);
    expect(r.failures).toEqual([]);
    expect(r.ties).toBeGreaterThan(0);
  });
});

describe('evaluator vs pokersolver (second oracle)', () => {
  it('agrees on 20,000 random pairs', { timeout: 60_000 }, () => {
    const r = diffPokersolver(testSeed(deriveSeed(ZERO_SEED, 'test|diff-ps')), 20_000, false);
    expect(r.failures).toEqual([]);
    expect(r.pairs).toBe(20_000);
  });

  it('agrees on 5,000 pairs from small decks', { timeout: 60_000 }, () => {
    const r = diffPokersolver(testSeed(deriveSeed(ZERO_SEED, 'test|diff-ps-b')), 5_000, true);
    expect(r.failures).toEqual([]);
  });
});
