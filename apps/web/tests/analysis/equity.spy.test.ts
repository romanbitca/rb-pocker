import { describe, expect, it, vi } from 'vitest';
import type { Rng } from '../../src/core/rng.ts';
import { parseCards } from '../../src/core/cards.ts';

// The sampler's argument list: every `randInt(rng, n)` records its `n`.
const draws = vi.hoisted(() => [] as number[]);
vi.mock('../../src/core/rng.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/core/rng.ts')>();
  return {
    ...real,
    randInt: (rng: Rng, n: number): number => {
      draws.push(n);
      return real.randInt(rng, n);
    },
  };
});

const { equity, runoutEquity } = await import('../../src/analysis/equity.ts');

describe('folded cards stay in the pool (pitfall 14)', () => {
  it('every trial draws from all 52 − 2 − board cards, whatever the table size', () => {
    // Nine players, five folded: 3 live opponents. The other five hands are unknown, so they are
    // NOT dead: the pool is 47 cards on a three-card board, not 47 − 10.
    for (const [boardText, pool] of [
      ['Qh 7h 2c', 47],
      ['Qh 7h 2c 3d', 46],
      ['', 50],
    ] as const) {
      draws.length = 0;
      const board = parseCards(boardText);
      const nOpp = 3;
      const trials = 50;
      equity({ hero: parseCards('Ah Kh'), board, nOpp }, { mode: 'montecarlo', trials });
      const perTrial = 2 * nOpp + (5 - board.length);
      expect(draws.length).toBe(trials * perTrial);
      for (let t = 0; t < trials; t++) {
        // partial Fisher–Yates: n = pool, pool − 1, pool − 2, ...
        const mine = draws.slice(t * perTrial, (t + 1) * perTrial);
        expect(mine).toEqual(Array.from({ length: perTrial }, (_, i) => pool - i));
      }
    }
  });

  it('a known-hands run-out samples only what nobody holds or shows', () => {
    draws.length = 0;
    runoutEquity(
      { hands: [parseCards('As Ah'), parseCards('Ks Kh')], board: [] },
      { mode: 'montecarlo', trials: 10 },
    );
    expect(draws.slice(0, 5)).toEqual([48, 47, 46, 45, 44]);
  });
});
