import { describe, expect, it } from 'vitest';
import { chancesByRiver, finalCounts } from '../../src/analysis/chances.ts';
import {
  FINALS_BOARDS,
  PREFLOP_CLASSES,
  PREFLOP_MAX_OPPONENTS,
  PREFLOP_TRIALS,
  preflopChances,
  preflopEquity,
  preflopEquityOfClass,
  preflopFinalCounts,
  preflopFinalCountsOfClass,
} from '../../src/analysis/preflop.ts';
import { classCards, classCombos, classOf, className } from '../../src/core/cards.ts';
import { HAND_CATEGORIES, type HandCategory } from '../../src/eval/evaluate.ts';
import { hole } from '../helpers/cards.ts';

/**
 * Appendix C.3: equity (%) against N random hands, preflop, Monte Carlo with 2M trials per cell.
 * The PLAN says this table "also checks the committed preflop table", with a test tolerance of
 * ±0.5 points (the committed cells have 500,000 trials, standard error ≤ 0.07, and the reference
 * ≤ 0.035, so 0.5 points is more than six standard deviations).
 */
const VS_RANDOM: readonly (readonly [string, readonly number[]])[] = [
  ['A♠ A♥', [85.24, 73.48, 63.9, 55.86, 49.24, 43.6, 38.7, 34.63]],
  ['K♥ K♦', [82.35, 68.84, 58.19, 49.76, 42.97, 37.46, 32.83, 29.17]],
  ['A♠ K♥', [65.32, 48.26, 38.55, 32.3, 27.87, 24.37, 21.58, 19.23]],
  ['2♣ 2♦', [50.28, 30.63, 21.91, 17.72, 15.49, 14.15, 13.2, 12.51]],
  ['7♣ 2♦', [34.58, 20.46, 14.25, 10.76, 8.61, 7.2, 6.17, 5.39]],
];

/** Appendix D.3, preflop rows: % finishing with exactly this category, exact over all boards. */
const FINISH: readonly (readonly [string, Partial<Record<HandCategory, number>>])[] = [
  [
    '2♣ 2♦',
    { pair: 35.98, twoPair: 39.67, trips: 11.77, straight: 1.22, flush: 1.96, fullHouse: 8.55 },
  ],
  [
    'A♥ K♥',
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
  ['9♠ 8♠', { straight: 8.53, flush: 6.38, straightFlush: 0.2 }],
];

describe('preflop equity table (PLAN §7.2, §7.5)', () => {
  it('answers with an EquityResult: fractions, equity = win + split, n = the cell trials', () => {
    expect(PREFLOP_TRIALS).toBe(500_000);
    for (let cls = 0; cls < PREFLOP_CLASSES; cls++) {
      for (let nOpp = 1; nOpp <= PREFLOP_MAX_OPPONENTS; nOpp++) {
        const r = preflopEquityOfClass(cls, nOpp);
        expect(r.n).toBe(PREFLOP_TRIALS);
        expect(r.equity).toBe(r.win + r.split);
        expect(r.win).toBeGreaterThan(0);
        expect(r.split).toBeGreaterThanOrEqual(0);
        expect(r.equity).toBeLessThan(1);
        expect([r.exact, r.final, r.truncated]).toEqual([false, true, false]);
      }
    }
  });

  it('reads one cell for every suit combination and either card order', () => {
    const cases = [
      ['A♥ K♥', 'K♠ A♠', 'suited'],
      ['A♥ K♦', 'A♣ K♠', 'offsuit'],
      ['9♦ 9♣', '9♠ 9♥', 'pair'],
    ] as const;
    for (const [a, b] of cases) {
      for (let nOpp = 1; nOpp <= 8; nOpp++) {
        expect(preflopEquity(hole(a), nOpp)).toEqual(preflopEquity(hole(b), nOpp));
      }
    }
    expect(preflopEquity(hole('A♥ K♥'), 2)).not.toEqual(preflopEquity(hole('A♥ K♦'), 2));
    const [a, b] = hole('T♠ 9♦');
    expect(preflopEquity([a, b], 4)).toEqual(preflopEquityOfClass(classOf(a, b), 4));
  });

  it('has Aces on top, and every hand falls as opponents are added', () => {
    for (let nOpp = 1; nOpp <= PREFLOP_MAX_OPPONENTS; nOpp++) {
      const aces = preflopEquityOfClass(0, nOpp).equity;
      for (let cls = 1; cls < PREFLOP_CLASSES; cls++) {
        expect(aces, `${className(cls)} against ${nOpp}`).toBeGreaterThan(
          preflopEquityOfClass(cls, nOpp).equity,
        );
      }
    }
    for (let cls = 0; cls < PREFLOP_CLASSES; cls++) {
      for (let nOpp = 1; nOpp < PREFLOP_MAX_OPPONENTS; nOpp++) {
        const fewer = preflopEquityOfClass(cls, nOpp);
        const more = preflopEquityOfClass(cls, nOpp + 1);
        expect(fewer.equity, `${className(cls)}: ${nOpp} to ${nOpp + 1}`).toBeGreaterThan(
          more.equity,
        );
        expect(fewer.win).toBeGreaterThan(more.win);
      }
    }
  });

  it('averages 1 / (nOpp + 1) over all 1,326 starting hands: the players are interchangeable', () => {
    // An exact identity, so it checks all 169 x 8 cells at once against no sample at all. The
    // average of 169 cells has a standard error of about 0.006 points: the limit is 0.05.
    for (let nOpp = 1; nOpp <= PREFLOP_MAX_OPPONENTS; nOpp++) {
      let sum = 0;
      for (let cls = 0; cls < PREFLOP_CLASSES; cls++) {
        sum += classCombos(cls) * preflopEquityOfClass(cls, nOpp).equity;
      }
      expect(Math.abs(sum / 1326 - 1 / (nOpp + 1)) * 100, `${nOpp} opponents`).toBeLessThan(0.05);
    }
  });

  it('matches the Appendix C.3 reference values against random hands within 0.5 points', () => {
    let cells = 0;
    for (const [cards, expected] of VS_RANDOM) {
      expected.forEach((percent, i) => {
        const r = preflopEquity(hole(cards), i + 1);
        expect(Math.abs(r.equity * 100 - percent), `${cards} vs ${i + 1}`).toBeLessThanOrEqual(0.5);
        cells++;
      });
    }
    expect(cells).toBe(40);
    // "A♥K♥ vs 1 random hand: 67.04 (Monte Carlo, 1M trials)".
    expect(Math.abs(preflopEquity(hole('A♥ K♥'), 1).equity * 100 - 67.04)).toBeLessThanOrEqual(0.5);
  });

  it('rejects a bad opponent count, class or hand', () => {
    const aces = hole('A♠ A♥');
    for (const nOpp of [0, 9, -1, 1.5, Number.NaN]) {
      expect(() => preflopEquity(aces, nOpp), `nOpp ${nOpp}`).toThrow(RangeError);
    }
    for (const cls of [-1, 169, 0.5, Number.NaN]) {
      expect(() => preflopEquityOfClass(cls, 1), `class ${cls}`).toThrow(RangeError);
      expect(() => preflopFinalCountsOfClass(cls), `class ${cls}`).toThrow(RangeError);
    }
    for (const bad of [[], [50], [50, 50], [50, 49, 48], [52, 1], [-1, 1], [1.5, 2]]) {
      expect(() => preflopEquity(bad, 1), bad.join(',')).toThrow(RangeError);
      expect(() => preflopFinalCounts(bad), bad.join(',')).toThrow(RangeError);
      expect(() => preflopChances(bad), bad.join(',')).toThrow(RangeError);
    }
  });
});

describe('finals table: the chance to finish with each hand (PLAN §6.6, §7.5)', () => {
  it('has every class finish somewhere: ten counts add up to C(50,5)', () => {
    expect(FINALS_BOARDS).toBe((50 * 49 * 48 * 47 * 46) / (5 * 4 * 3 * 2));
    for (let cls = 0; cls < PREFLOP_CLASSES; cls++) {
      const { counts, total } = preflopFinalCountsOfClass(cls);
      expect(total).toBe(2_118_760);
      expect(counts).toHaveLength(HAND_CATEGORIES.length);
      expect(
        counts.reduce((sum, n) => sum + n, 0),
        className(cls),
      ).toBe(total);
    }
  });

  it('has rows that sum to 100%, with atLeast the running total from the royal flush down', () => {
    for (let cls = 0; cls < PREFLOP_CLASSES; cls++) {
      const chances = preflopChances(classCards(cls));
      let exactlySum = 0;
      let above = 0;
      for (const category of [...HAND_CATEGORIES].reverse()) {
        const c = chances[category];
        expect(c.boardShared).toBe(false);
        expect(c.atLeast).toBeCloseTo(above + c.exactly, 9);
        above = c.atLeast;
        exactlySum += c.exactly;
      }
      expect(exactlySum, className(cls)).toBeCloseTo(100, 9);
      expect(chances.highCard.atLeast, className(cls)).toBeCloseTo(100, 9);
    }
  });

  it('reproduces the preflop chances of Appendix D.3 to two decimals', () => {
    for (const [cards, expected] of FINISH) {
      const chances = preflopChances(hole(cards));
      for (const [category, percent] of Object.entries(expected)) {
        const got = chances[category as HandCategory].exactly;
        expect(Math.abs(got - (percent as number)), `${cards} ${category}: ${got}`).toBeLessThan(
          0.005 + 1e-9,
        );
      }
    }
  });

  it('gives the same numbers, to the last bit, as enumerating the boards live', () => {
    // One pair, one suited and one offsuit class, each from a hand that is not the table's own
    // (As Ah, As Ks, As Kh): every other suit combination must read the same row.
    for (const cards of ['9♦ 9♣', 'Q♥ J♥', '7♠ 2♦']) {
      const live = chancesByRiver(hole(cards), []);
      expect(preflopChances(hole(cards)), cards).toEqual(live);
      expect(preflopFinalCounts(hole(cards)), cards).toEqual(finalCounts(hole(cards), []));
    }
  }, 60_000);
});
