import { describe as suite, expect, it } from 'vitest';
import { parseCard } from '../../src/core/cards.ts';
import { RANKINGS } from '../../src/data/rankings.ts';
import { describe } from '../../src/eval/describe.ts';
import { HAND_CATEGORIES } from '../../src/eval/evaluate.ts';

/** Appendix F.7, row by row. */
const F7 = [
  ['royalFlush', 'Royal flush', 'As Ks Qs Js Ts', 0, 0.0032, 30900],
  ['straightFlush', 'Straight flush', '9h 8h 7h 6h 5h', 0, 0.0279, 3600],
  ['quads', 'Four of a kind', 'Qc Qd Qh Qs 7d', 1, 0.168, 595],
  ['fullHouse', 'Full house', 'Ks Kh Kd 4c 4h', 0, 2.6, 39],
  ['flush', 'Flush', 'Ad Jd 8d 5d 2d', 0, 3.03, 33],
  ['straight', 'Straight', 'Tc 9d 8s 7h 6c', 0, 4.62, 22],
  ['trips', 'Three of a kind', '7s 7h 7c Kd 2s', 2, 4.83, 21],
  ['twoPair', 'Two pair', 'Jh Jc 5s 5d Ac', 1, 23.5, 4],
  ['pair', 'One pair', 'Th Ts Kc 6d 3h', 3, 43.8, 2],
  ['highCard', 'High card', 'Ac Qd 9s 6h 3c', 4, 17.4, 6],
] as const;

suite('data/rankings.ts (Appendix F.7)', () => {
  it('has the ten rows of F.7, strongest first, with the exact values', () => {
    expect(
      RANKINGS.map((r) => [r.key, r.name, r.cards.join(' '), r.kickers, r.rarity, r.oneIn]),
    ).toEqual(F7.map((row) => [...row]));
  });

  it('has the F.7 tips and details', () => {
    expect(RANKINGS[3].tip).toBe('Three of one rank plus two of another.');
    expect(RANKINGS[3].detail).toBe(
      'The higher three-of-a-kind wins. Kings full of Fours beats Queens full of Aces.',
    );
    expect(RANKINGS[5].tip).toBe('Five in a row, mixed suits. A can be low: A-2-3-4-5.');
    expect(RANKINGS[9].detail).toBe(
      'Compare the highest card, then the next, down to the fifth. With 7 cards it is rarer than one pair, but it still ranks lowest.',
    );
    for (const row of RANKINGS) {
      expect(row.tip.length).toBeGreaterThan(10);
      expect(row.detail.length).toBeGreaterThan(20);
    }
  });

  it('covers every category once, in the evaluator’s order from the top', () => {
    expect(RANKINGS.map((r) => r.key)).toEqual([...HAND_CATEGORIES].reverse());
  });

  it('gives an example that really is that hand, with the non-forming cards as its kickers', () => {
    for (const row of RANKINGS) {
      const cards = row.cards.map(parseCard);
      // Two of the cards as "hole", three as the board: describe() needs a 5-card hand.
      const info = describe([cards[0] as number, cards[1] as number], cards.slice(2));
      expect(info.category, row.name).toBe(row.key);
      expect(info.kickers.length, row.name).toBe(row.kickers);
    }
  });

  it('rarities add up to 100% and match "1 in N"', () => {
    const total = RANKINGS.reduce((sum, r) => sum + r.rarity, 0);
    expect(total).toBeGreaterThan(99.9);
    expect(total).toBeLessThan(100.1);
    for (const row of RANKINGS) {
      expect(Math.abs(100 / row.oneIn - row.rarity) / row.rarity, row.name).toBeLessThan(0.15);
    }
  });
});
