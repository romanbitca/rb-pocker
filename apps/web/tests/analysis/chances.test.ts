/**
 * Chances by the river (PLAN §6.6): every Appendix D.3 value to 0.01 points, the Appendix C.5
 * outs table, sums, `atLeast`, `boardShared`, and pitfall 12 (never the rule of 2 and 4). The
 * comparison with an independent enumeration is in `chances.property.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  chancesByRiver,
  finalCounts,
  outsChances,
  type Chances,
} from '../../src/analysis/chances.ts';
import type { Card } from '../../src/core/cards.ts';
import { HAND_CATEGORIES, type HandCategory } from '../../src/eval/evaluate.ts';
import { card, cards } from '../helpers/cards.ts';

/** Appendix D.3: % finishing with exactly each listed category. */
const D3: [string, string, Partial<Record<HandCategory, number>>][] = [
  [
    '2♣ 2♦',
    '',
    {
      pair: 35.98,
      twoPair: 39.67,
      trips: 11.77,
      straight: 1.22,
      flush: 1.96,
      fullHouse: 8.55,
      quads: 0.84,
    },
  ],
  [
    'A♥ K♥',
    '',
    {
      highCard: 18.22,
      pair: 43.27,
      twoPair: 22.14,
      trips: 4.34,
      straight: 3.09,
      flush: 6.53,
      fullHouse: 2.22,
      quads: 0.13,
      royalFlush: 0.05,
    },
  ],
  ['9♠ 8♠', '', { straight: 8.53, flush: 6.38, straightFlush: 0.2 }],
  ['A♥ K♥', 'Q♥ 7♥ 2♣', { flush: 34.88, royalFlush: 0.09 }],
  ['9♠ 8♠', 'J♦ 7♣ 2♥', { straight: 17.95 }],
  ['J♠ J♦', 'J♥ 7♣ 2♥', { fullHouse: 29.14, quads: 4.26 }],
];

/** Appendix C.5: outs → [flop → turn, turn → river, flop → river, rule of 4, rule of 2]. */
const C5: [number, number, number, number, number, number][] = [
  [4, 8.5, 8.7, 16.5, 16, 8],
  [8, 17.0, 17.4, 31.5, 32, 16],
  [9, 19.1, 19.6, 35.0, 36, 18],
  [12, 25.5, 26.1, 45.0, 48, 24],
  [15, 31.9, 32.6, 54.1, 60, 30],
  [21, 44.7, 45.7, 69.9, 84, 42],
];

const sumExactly = (c: Chances): number => HAND_CATEGORIES.reduce((n, k) => n + c[k].exactly, 0);

describe('Appendix D.3: chances by the river, exact', () => {
  for (const [hole, board, want] of D3) {
    it(`${hole}${board === '' ? ' preflop' : ` on ${board}`}`, { timeout: 60_000 }, () => {
      const got = chancesByRiver(cards(hole), cards(board));
      for (const [category, pct] of Object.entries(want)) {
        // "to 0.01 points": the exact value rounds to the table's value.
        expect(got[category as HandCategory].exactly, category).toBeCloseTo(pct, 2);
      }
      expect(sumExactly(got)).toBeCloseTo(100, 9);
    });
  }

  it('A♥K♥ on Q♥7♥2♣: flush + royal = the 9-out value, 378 of 1,081 boards', () => {
    const got = chancesByRiver(cards('A♥ K♥'), cards('Q♥ 7♥ 2♣'));
    const nineOuts = outsChances(9, 3).byRiverPct as number;
    expect(got.flush.exactly + got.royalFlush.exactly).toBeCloseTo(nineOuts, 9);
    expect(nineOuts).toBeCloseTo((100 * 378) / 1081, 9);
    expect(got.flush.atLeast).toBeCloseTo(nineOuts, 9);
  });

  it('9♠8♠ on J♦7♣2♥: 17.95% straight beats the 4-out formula (runner-runner counts)', () => {
    const got = chancesByRiver(cards('9♠ 8♠'), cards('J♦ 7♣ 2♥'));
    const fourOuts = outsChances(4, 3).byRiverPct as number;
    expect(fourOuts).toBeCloseTo(16.47, 2);
    // 178 boards with a Ten + 16 with a Six and a Five.
    expect(finalCounts(cards('9♠ 8♠'), cards('J♦ 7♣ 2♥')).counts[4]).toBe(178 + 16);
    expect(got.straight.exactly).toBeGreaterThan(fourOuts + 1);
  });
});

describe('Appendix C.5: outs → exact chance to hit', () => {
  for (const [outs, flopTurn, turnRiver, flopRiver, rule4, rule2] of C5) {
    it(`${outs} outs`, () => {
      const flop = outsChances(outs, 3);
      const turn = outsChances(outs, 4);
      expect(flop.nextCardPct).toBeCloseTo(flopTurn, 1);
      expect(turn.nextCardPct).toBeCloseTo(turnRiver, 1);
      expect(flop.byRiverPct).toBeCloseTo(flopRiver, 1);
      // From the turn, "by the river" is the next card.
      expect(turn.byRiverPct).toBe(turn.nextCardPct);
      // Pitfall 12: never the rule of 4 / 2.
      expect(flop.byRiverPct).not.toBeCloseTo(rule4, 1);
      expect(turn.nextCardPct).not.toBeCloseTo(rule2, 1);
    });
  }

  it('matches a count of every turn/river pair for 0..47 outs', () => {
    for (let outs = 0; outs <= 47; outs++) {
      let hit = 0;
      let all = 0;
      for (let a = 0; a < 47; a++) {
        for (let b = a + 1; b < 47; b++) {
          all++;
          if (a < outs || b < outs) hit++;
        }
      }
      expect(outsChances(outs, 3).byRiverPct).toBeCloseTo((100 * hit) / all, 12);
      expect(outsChances(outs, 3).nextCardPct).toBeCloseTo((100 * outs) / 47, 12);
    }
    for (let outs = 0; outs <= 46; outs++) {
      expect(outsChances(outs, 4).nextCardPct).toBeCloseTo((100 * outs) / 46, 12);
    }
  });

  it('pitfall 12: 15 outs on the flop is 54.1%, not the rule-of-4 60%', () => {
    expect(outsChances(15, 3).byRiverPct).toBeCloseTo(54.12, 2);
  });

  it('no rule of 2 and 4 in the analysis code (comments aside)', () => {
    const sources = import.meta.glob('../../src/analysis/*.ts', {
      query: '?raw',
      import: 'default',
      eager: true,
    });
    expect(Object.keys(sources).length).toBeGreaterThan(0);
    for (const [file, text] of Object.entries(sources)) {
      const code = (text as string).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code, file).not.toMatch(/\bouts\s*\*\s*[24]\b|\b[24]\s*\*\s*outs\b/);
      expect(code, file).not.toMatch(/rule\s*of\s*[24]|ruleOf[24]/i);
    }
  });

  it('no chances preflop or on the river; outs must fit the unseen cards', () => {
    expect(outsChances(0, 0)).toEqual({ nextCardPct: null, byRiverPct: null });
    expect(outsChances(0, 5)).toEqual({ nextCardPct: null, byRiverPct: null });
    expect(outsChances(0, 3)).toEqual({ nextCardPct: 0, byRiverPct: 0 });
    expect(outsChances(47, 3)).toEqual({ nextCardPct: 100, byRiverPct: 100 });
    expect(() => outsChances(48, 3)).toThrow(RangeError);
    expect(() => outsChances(-1, 4)).toThrow(RangeError);
    expect(() => outsChances(2.5, 4)).toThrow(RangeError);
  });
});

describe('the chances record', () => {
  const hands: [string, string][] = [
    ['A♥ K♥', ''],
    ['7♣ 2♦', 'K♠ 9♥ 4♦'],
    ['Q♠ Q♦', 'Q♥ 7♣ 7♦ 2♠'],
    ['A♠ 5♦', 'K♣ K♥ 7♦ 7♠ 2♣'],
  ];

  for (const [hole, board] of hands) {
    it(`${hole} / ${board || 'preflop'}: exactly sums to 100, atLeast accumulates`, () => {
      const got = chancesByRiver(cards(hole), cards(board));
      expect(Object.keys(got)).toEqual([...HAND_CATEGORIES]);
      expect(sumExactly(got)).toBeCloseTo(100, 9);
      let above = 0;
      for (let i = HAND_CATEGORIES.length - 1; i >= 0; i--) {
        const c = got[HAND_CATEGORIES[i] as HandCategory];
        above += c.exactly;
        expect(c.atLeast).toBeCloseTo(above, 9);
        expect(c.exactly).toBeGreaterThanOrEqual(0);
      }
      expect(got.highCard.atLeast).toBeCloseTo(100, 9);
      const { counts, total } = finalCounts(cards(hole), cards(board));
      expect(counts.reduce((a, b) => a + b, 0)).toBe(total);
    });
  }

  it('totals: 2,118,760 boards preflop, 1,081 on the flop, 46 on the turn, 1 on the river', () => {
    expect(finalCounts(cards('7♣ 2♦'), []).total).toBe(2_118_760);
    expect(finalCounts(cards('7♣ 2♦'), cards('K♠ 9♥ 4♦')).total).toBe(1081);
    expect(finalCounts(cards('7♣ 2♦'), cards('K♠ 9♥ 4♦ 3♣')).total).toBe(46);
    expect(finalCounts(cards('7♣ 2♦'), cards('K♠ 9♥ 4♦ 3♣ 5♠')).total).toBe(1);
  });

  it('on the river only the made hand: 100%', () => {
    const got = chancesByRiver(cards('A♠ 5♦'), cards('K♣ K♥ 7♦ 7♠ 2♣'));
    expect(got.twoPair).toEqual({ exactly: 100, atLeast: 100, boardShared: true });
    expect(got.trips).toEqual({ exactly: 0, atLeast: 0, boardShared: false });
    expect(got.highCard.atLeast).toBe(100);
  });

  it('boardShared marks the category the board makes by itself (a pair or better)', () => {
    const shared = (hole: string, board: string): HandCategory[] =>
      Object.entries(chancesByRiver(cards(hole), cards(board)))
        .filter(([, c]) => c.boardShared)
        .map(([k]) => k as HandCategory);
    expect(shared('A♥ K♥', '')).toEqual([]);
    expect(shared('A♥ K♥', 'Q♥ 7♥ 2♣')).toEqual([]); // an unpaired board makes nothing
    expect(shared('A♥ K♥', 'Q♥ Q♠ 2♣')).toEqual(['pair']);
    expect(shared('A♥ K♥', 'Q♥ Q♠ Q♣')).toEqual(['trips']);
    expect(shared('A♥ K♥', 'Q♥ Q♠ 2♣ 2♦')).toEqual(['twoPair']);
    expect(shared('A♥ K♥', 'Q♥ Q♠ Q♣ Q♦')).toEqual(['quads']);
    expect(shared('A♥ K♥', 'Q♥ Q♠ Q♣ 2♦')).toEqual(['trips']);
    expect(shared('2♣ 3♦', 'A♠ K♦ Q♣ J♥ 10♠')).toEqual(['straight']);
    expect(shared('2♣ 3♦', '9♠ 7♠ 5♠ 4♠ K♠')).toEqual(['flush']);
    expect(shared('2♣ 3♦', '9♠ 9♦ 9♣ 4♠ 4♦')).toEqual(['fullHouse']);
  });
});

describe('input checks', () => {
  const bad: [string, Card[], Card[]][] = [
    ['one hole card', [card('A♠')], cards('K♦ Q♣ J♥')],
    ['a two-card board', cards('A♠ K♠'), cards('K♦ Q♣')],
    ['a repeated card', cards('A♠ K♠'), cards('A♠ Q♣ J♥')],
    ['not a card', [card('A♠'), -1], cards('K♦ Q♣ J♥')],
  ];
  for (const [name, h, b] of bad) {
    it(`rejects ${name}`, () => {
      expect(() => chancesByRiver(h, b)).toThrow(RangeError);
      expect(() => finalCounts(h, b)).toThrow(RangeError);
    });
  }
});
