import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { makeCard, parseCards, rankOf, suitOf, type Suit } from '../../src/core/cards.ts';
import { deriveSeed, ZERO_SEED } from '../../src/core/rng.ts';
import {
  categoryOf,
  HAND_CATEGORIES,
  score5,
  score6,
  score7,
  scoreNibbles,
  type HandCategory,
} from '../../src/eval/evaluate.ts';
import { HandSource } from './hands.ts';

const score = (text: string): number => {
  const cards = parseCards(text);
  return score7(cards, cards.length);
};
const pack = (category: number, ...ranks: number[]): number =>
  ranks.reduce((acc, r, i) => acc | (r << (16 - 4 * i)), category << 20);

// Rank indexes: 2 → 0 … 9 → 7, T → 8, J → 9, Q → 10, K → 11, A → 12.
describe('score packing (PLAN §5.2)', () => {
  it('packs every category exactly', () => {
    expect(score('As Kd 9c 7h 4s 3d 2c')).toBe(pack(0, 12, 11, 7, 5, 2));
    expect(score('Kh Kc Ad 7s 2h 3c 4d')).toBe(pack(1, 11, 12, 5, 2));
    expect(score('Kh Kc 7d 7s Ah 3c 4d')).toBe(pack(2, 11, 5, 12));
    expect(score('Kh Kc Kd 7s Ah 3c 4d')).toBe(pack(3, 11, 12, 5));
    expect(score('9h 8c 7d 6s 5h Kc 2d')).toBe(pack(4, 7));
    expect(score('Ah 9h 7h 4h 2h Kc Kd')).toBe(pack(5, 12, 7, 5, 2, 0));
    expect(score('Kh Kc Kd 7s 7h 3c 4d')).toBe(pack(6, 11, 5));
    expect(score('Kh Kc Kd Ks 7h Ac 4d')).toBe(pack(7, 11, 12));
    expect(score('9h 8h 7h 6h 5h Kc 2d')).toBe(pack(8, 7));
    expect(score('Ah Kh Qh Jh Th 2c 2d')).toBe(pack(8, 12));
  });

  it('decodes nibbles and categories', () => {
    expect(scoreNibbles(pack(2, 11, 5, 12))).toEqual([11, 5, 12, 0, 0]);
    const cases: [string, HandCategory][] = [
      ['As Kd 9c 7h 4s', 'highCard'],
      ['As Ad 9c 7h 4s', 'pair'],
      ['As Ad 9c 9h 4s', 'twoPair'],
      ['As Ad Ac 9h 4s', 'trips'],
      ['As Kd Qc Jh Ts', 'straight'],
      ['As Ks 9s 7s 4s', 'flush'],
      ['As Ad Ac 9h 9s', 'fullHouse'],
      ['As Ad Ac Ah 9s', 'quads'],
      ['Ks Qs Js Ts 9s', 'straightFlush'],
      ['As Ks Qs Js Ts', 'royalFlush'],
    ];
    for (const [hand, category] of cases) expect(categoryOf(score(hand)), hand).toBe(category);
    expect(HAND_CATEGORIES).toEqual(cases.map(([, c]) => c));
    for (const bad of [-1, 9 << 20, 1.5]) expect(() => categoryOf(bad)).toThrow(RangeError);
  });
});

describe('rules that are easy to get wrong', () => {
  it('wheel A-2-3-4-5 is five-high and loses to 2-6 (pitfall 9, B21)', () => {
    const wheel = score('Ah 2c 3d 4s 5h Kc Qd');
    expect(wheel).toBe(pack(4, 3));
    expect(score('6c 2c 3d 4s 5h Kc Qd')).toBeGreaterThan(wheel);
    expect(score('Ah Kc Qd Jd Th 2c 3d')).toBe(pack(4, 12));
  });

  it('Q-K-A-2-3 is not a straight (pitfall 9, B21)', () => {
    expect(categoryOf(score('Qs Kd Ac 2h 3s 8d 9c'))).toBe('highCard');
    expect(categoryOf(score('Js Qs Kd Ac 2h 3s 8d'))).toBe('highCard');
  });

  it('5-high straight flush loses to 6-high straight flush (B21)', () => {
    const low = score('Ah 2h 3h 4h 5h Kc Qd');
    expect(low).toBe(pack(8, 3));
    expect(score('6h 2h 3h 4h 5h Kc Qd')).toBe(pack(8, 4));
    expect(score('6h 2h 3h 4h 5h Kc Qd')).toBeGreaterThan(low);
  });

  it('tests the straight inside the flush suit only (pitfall 8)', () => {
    // A straight (5-9) and a flush (hearts) that do not form a straight flush: it is a flush.
    expect(score('5h 6h 7h 8c 9h Kh 2d')).toBe(pack(5, 11, 7, 5, 4, 3));
    // Straight flush whose lowest card is paired (the old hand-evaluator v3 bug).
    expect(score('Kh Qh Jh Th 9h 9d 3s')).toBe(pack(8, 11));
    // A flush and a longer straight in other suits: still the flush.
    expect(categoryOf(score('4h 5h 6c 7h 8h 9d Qh'))).toBe('flush');
    // Six to a straight flush plays the top five.
    expect(score('9s 8s 7s 6s 5s 4s Ah')).toBe(pack(8, 7));
  });

  it('three pairs: the third pair can be the kicker (pitfall 9, B22)', () => {
    expect(score('9s 9d 8c 8h 7d 7s Kc')).toBe(pack(2, 7, 6, 11));
    expect(score('9s 9d 8c 8h 7d 7s 2c')).toBe(pack(2, 7, 6, 5));
  });

  it('two trips make a full house with the lower trips as the pair (B23)', () => {
    expect(score('7s 7d 7c Kh Kd Ks 2c')).toBe(pack(6, 11, 5));
    expect(categoryOf(score('7s 7d 7c Kh Kd Ks 2c'))).toBe('fullHouse');
  });

  it('full house takes the best pair, quads the best kicker', () => {
    expect(score('As Ad Ac Kh Kd Qs Qc')).toBe(pack(6, 12, 11));
    expect(score('Qs Qd Qh Qc Kh Kd 2c')).toBe(pack(7, 10, 11));
    expect(score('Qs Qd Qh Qc 7d 7c 2s')).toBe(pack(7, 10, 5));
    expect(score('Qs Qd Qh Qc 7d 7c 7s')).toBe(pack(7, 10, 5));
  });

  it('flush uses the top five of the suit (B24)', () => {
    expect(score('Ah 2h Kh Qh 9h 5h 3h')).toBe(pack(5, 12, 11, 10, 7, 3));
  });

  it('suits never break a tie', () => {
    expect(score('As Kd 9c 7h 4s 3d 2c')).toBe(score('Ah Kc 9d 7s 4h 3c 2d'));
    expect(score('As Ks 9s 7s 4s 3d 2c')).toBe(score('Ad Kd 9d 7d 4d 3c 2h'));
  });

  it('scores 5 and 6 cards with the same function', () => {
    const five = parseCards('Ah Kh Qh Jh Th');
    expect(score5(five)).toBe(pack(8, 12));
    expect(score6(parseCards('2c 3d 4h 5s 7c 7d'))).toBe(pack(1, 5, 3, 2, 1));
    expect(score7(parseCards('Ah Kh Qh Jh Th 2c 3c'), 5)).toBe(pack(8, 12));
    expect(score7(new Uint8Array(parseCards('Kh Kc 7d 7s Ah 3c 4d')), 7)).toBe(pack(2, 11, 5, 12));
  });
});

describe('properties', () => {
  const src = new HandSource(deriveSeed(ZERO_SEED, 'test|eval-properties'));
  const subsets = (cards: number[], k: number): number[][] => {
    if (k === 0) return [[]];
    if (cards.length < k) return [];
    const [head, ...tail] = cards as [number, ...number[]];
    return [...subsets(tail, k - 1).map((s) => [head, ...s]), ...subsets(tail, k)];
  };

  it('score7 = best score5 over the 21 five-card subsets; score6 likewise (20,000 hands)', () => {
    for (let i = 0; i < 20_000; i++) {
      const seven = i % 2 === 0 ? src.uniform(7) : src.biased(7);
      const best5 = Math.max(...subsets(seven, 5).map((s) => score5(s)));
      expect(score7(seven, 7)).toBe(best5);
      const six = seven.slice(0, 6);
      expect(score6(six)).toBe(Math.max(...subsets(six, 5).map((s) => score5(s))));
    }
  });

  it('does not depend on card order', () => {
    for (let i = 0; i < 10_000; i++) {
      const seven = src.biased(7);
      const reversed = [...seven].reverse();
      const rotated = [...seven.slice(3), ...seven.slice(0, 3)];
      expect(score7(reversed, 7)).toBe(score7(seven, 7));
      expect(score7(rotated, 7)).toBe(score7(seven, 7));
    }
  });

  it('suit relabelling leaves the score unchanged (PLAN §5.5)', () => {
    const suitPermutation = fc.shuffledSubarray([0, 1, 2, 3] as Suit[], {
      minLength: 4,
      maxLength: 4,
    });
    const sevenCards = fc.uniqueArray(fc.integer({ min: 0, max: 51 }), {
      minLength: 7,
      maxLength: 7,
    });
    fc.assert(
      fc.property(sevenCards, suitPermutation, (cards, perm) => {
        const relabelled = cards.map((c) => makeCard(rankOf(c), perm[suitOf(c)] as Suit));
        expect(score7(relabelled, 7)).toBe(score7(cards, 7));
      }),
      { seed: 20260928, numRuns: 20_000 },
    );
  });
});
