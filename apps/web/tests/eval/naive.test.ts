import { describe, expect, it } from 'vitest';
import { parseCards } from '../../src/core/cards.ts';
import { deriveSeed, ZERO_SEED } from '../../src/core/rng.ts';
import { testSeed } from '../helpers/seed.ts';
import { diffNaive } from './differential.ts';
import { compareNaive, naive5, naiveBest } from './naive.ts';

describe('naive 21-subset oracle: sanity', () => {
  it('scores textbook hands', () => {
    expect(naive5(parseCards('Ah 2c 3d 4s 5h'))).toEqual({ category: 4, ranks: [3] });
    expect(naive5(parseCards('Qs Kd Ac 2h 3s'))).toEqual({
      category: 0,
      ranks: [12, 11, 10, 1, 0],
    });
    expect(naive5(parseCards('9s 9d 8c 8h Kc'))).toEqual({ category: 2, ranks: [7, 6, 11] });
    expect(naive5(parseCards('7s 7d Kh Kd Ks'))).toEqual({ category: 6, ranks: [11, 5] });
    expect(naiveBest(parseCards('7s 7d 7c Kh Kd Ks 2c'))).toEqual({ category: 6, ranks: [11, 5] });
    expect(naiveBest(parseCards('9s 9d 8c 8h 7d 7s 2c'))).toEqual({
      category: 2,
      ranks: [7, 6, 5],
    });
    expect(naiveBest(parseCards('4h 7h 3h 5h 6h Kh 2h'))).toEqual({ category: 8, ranks: [5] });
  });

  it('orders hands by category, then tiebreak ranks', () => {
    const pair = naive5(parseCards('As Ad 9c 7h 4s'));
    const betterKicker = naive5(parseCards('As Ad Tc 7h 4s'));
    expect(compareNaive(betterKicker, pair)).toBeGreaterThan(0);
    expect(compareNaive(pair, pair)).toBe(0);
    expect(compareNaive(naive5(parseCards('2c 3d 4h 5s 7c')), pair)).toBeLessThan(0);
  });
});

// Stage 1 acceptance 2 (second half): identical category and tiebreak ranks for 200,000 hands.
describe('evaluator vs the naive oracle', () => {
  it('agrees on 200,000 random seven-card hands', { timeout: 120_000 }, () => {
    const r = diffNaive(testSeed(deriveSeed(ZERO_SEED, 'test|naive7')), 200_000, 7, false);
    expect(r.failures).toEqual([]);
    expect(r.failureCount).toBe(0);
    expect(r.pairs).toBe(200_000);
  });

  it('agrees on 50,000 hands from small decks (rare categories)', { timeout: 60_000 }, () => {
    const r = diffNaive(testSeed(deriveSeed(ZERO_SEED, 'test|naive7b')), 50_000, 7, true);
    expect(r.failures).toEqual([]);
  });

  it('agrees on five- and six-card hands', { timeout: 60_000 }, () => {
    for (const size of [5, 6] as const) {
      const seed = testSeed(deriveSeed(ZERO_SEED, 'test|naive', size));
      expect(diffNaive(seed, 20_000, size, false).failures).toEqual([]);
      expect(diffNaive(seed, 20_000, size, true).failures).toEqual([]);
    }
  });
});
