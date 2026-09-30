/**
 * `chances.ts` against independent sources of truth (PLAN "Testing strategy" → Oracles: "Outs and
 * chances: exact enumeration"), on random flops, turns and rivers (fast-check, fixed seed):
 * - the same enumeration written from the rules with the naive 21-subset evaluator of the
 *   evaluator tests (no score packing, no tables);
 * - street consistency: a flop's counts are the sum of its turns' counts (each turn/river pair
 *   is seen once from each of its two cards), and a turn's are the sum of its rivers'.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { chancesByRiver, finalCounts } from '../../src/analysis/chances.ts';
import type { Card } from '../../src/core/cards.ts';
import { HAND_CATEGORIES } from '../../src/eval/evaluate.ts';
import { naiveBest } from '../eval/naive.ts';
import { FC_SEED, heroHand } from './states.ts';

/** Display category index (royal flush = 9) of the naive evaluator's best hand. */
function naiveLevel(cards: readonly Card[]): number {
  const best = naiveBest(cards);
  return best.category === 8 && best.ranks[0] === 12 ? 9 : best.category;
}

/** Every remaining board, dealt one by one and judged with the naive evaluator. */
function naiveCounts(hole: readonly Card[], board: readonly Card[]): number[] {
  const known = [...hole, ...board];
  const unseen = Array.from({ length: 52 }, (_, c) => c).filter((c) => !known.includes(c));
  const counts = new Array<number>(10).fill(0);
  const deal = (from: number, missing: number, dealt: Card[]): void => {
    if (missing === 0) {
      counts[naiveLevel([...known, ...dealt])]!++;
      return;
    }
    for (let i = from; i < unseen.length; i++) {
      deal(i + 1, missing - 1, [...dealt, unseen[i] as Card]);
    }
  };
  deal(0, 5 - board.length, []);
  return counts;
}

const add = (a: number[], b: readonly number[]): number[] => a.map((x, i) => x + (b[i] ?? 0));

describe('chances match an independent enumeration with the naive evaluator', () => {
  const streets = [
    ['flop', 3, 60],
    ['turn', 4, 600],
    ['river', 5, 3_000], // one made hand each: more hands, so quads and royals turn up
  ] as const;
  for (const [street, boardLength, runs] of streets) {
    it(`${runs} random ${street}s`, { timeout: 120_000 }, () => {
      const seen = new Array<number>(10).fill(0);
      fc.assert(
        fc.property(heroHand(boardLength), ({ hole, board }) => {
          const { counts, total } = finalCounts(hole, board);
          expect(counts).toEqual(naiveCounts(hole, board));
          const chances = chancesByRiver(hole, board);
          HAND_CATEGORIES.forEach((k, i) => {
            expect(chances[k].exactly).toBeCloseTo((100 * (counts[i] as number)) / total, 12);
          });
          const sum = HAND_CATEGORIES.reduce((n, k) => n + chances[k].exactly, 0);
          expect(sum).toBeCloseTo(100, 9);
          counts.forEach((c, i) => (seen[i]! += c));
        }),
        { seed: FC_SEED + 10 + boardLength, numRuns: runs },
      );
      // Every category turns up, royal flush included (the small decks make it common).
      seen.forEach((n, i) => expect(n, HAND_CATEGORIES[i]).toBeGreaterThan(0));
    });
  }
});

describe('street consistency', () => {
  it('300 random flops: counts = ½ × the sum over every turn card', { timeout: 120_000 }, () => {
    fc.assert(
      fc.property(heroHand(3), ({ hole, board }) => {
        const known = [...hole, ...board];
        let sum = new Array<number>(10).fill(0);
        for (let t = 0; t < 52; t++) {
          if (!known.includes(t)) sum = add(sum, finalCounts(hole, [...board, t]).counts);
        }
        expect(sum.map((x) => x / 2)).toEqual(finalCounts(hole, board).counts);
      }),
      { seed: FC_SEED + 20, numRuns: 300 },
    );
  });

  it('1,000 random turns: counts = the sum over every river card', { timeout: 120_000 }, () => {
    fc.assert(
      fc.property(heroHand(4), ({ hole, board }) => {
        const known = [...hole, ...board];
        let sum = new Array<number>(10).fill(0);
        for (let r = 0; r < 52; r++) {
          if (!known.includes(r)) sum = add(sum, finalCounts(hole, [...board, r]).counts);
        }
        expect(sum).toEqual(finalCounts(hole, board).counts);
      }),
      { seed: FC_SEED + 21, numRuns: 1_000 },
    );
  });

  it('preflop: relabelling suits leaves the counts unchanged', { timeout: 120_000 }, () => {
    // A♥K♥ and A♣K♣ are the same class: identical counts over all 2,118,760 boards.
    const hearts = finalCounts([50, 46], []);
    const clubs = finalCounts([48, 44], []);
    expect(clubs).toEqual(hearts);
  });
});
