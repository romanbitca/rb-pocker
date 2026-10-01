import { describe, expect, it } from 'vitest';
import { classOf, parseCard, parseCards } from '../../src/core/cards.ts';
import {
  classByName,
  COMBOS_TOTAL,
  comboCount,
  rangeAcceptance,
} from '../../src/data/rangesLayout.ts';
import {
  classAtRank,
  equityVsKnot,
  equityVsTop,
  equityVsTopOfClass,
  RANGE_CLASSES,
  RANGE_KNOTS,
  RANGES_SAMPLE_TRIALS,
  rankOfClass,
  rankPct,
  rankPctOfClass,
  topRangeWeights,
} from '../../src/brain/rangesData.ts';

const pct = (name: string): number => rankPctOfClass(classByName(name));

describe('range acceptance (PLAN §8.3)', () => {
  it('the top 5% contains AA to JJ and AKs', () => {
    for (const name of ['AA', 'KK', 'QQ', 'JJ', 'AKs'])
      expect(pct(name), name).toBeLessThanOrEqual(5);
  });

  it('the top 15% contains 88+, ATs+, KQs, AJo+ and KQo', () => {
    const hands = [
      ...['88', '99', 'TT', 'JJ', 'QQ', 'KK', 'AA'],
      ...['ATs', 'AJs', 'AQs', 'AKs', 'KQs'],
      ...['AJo', 'AQo', 'AKo', 'KQo'],
    ];
    for (const name of hands) expect(pct(name), name).toBeLessThanOrEqual(15);
  });

  it('72o is in the bottom 1%', () => {
    expect(pct('72o')).toBeGreaterThanOrEqual(99);
  });

  it('76s ranks above K2o', () => {
    expect(pct('76s')).toBeLessThan(pct('K2o'));
  });

  it('the acceptance function of the layout agrees', () => {
    expect(rangeAcceptance(rankPctOfClass)).toEqual([]);
  });
});

describe('the ranking', () => {
  it('ranks every class once, AA first, and the percentile adds up the combos', () => {
    const seen = new Set<number>();
    let through = 0;
    for (let rank = 0; rank < RANGE_CLASSES; rank++) {
      const cls = classAtRank(rank);
      seen.add(cls);
      expect(rankOfClass(cls)).toBe(rank);
      through += comboCount(cls);
      expect(rankPctOfClass(cls)).toBeCloseTo((100 * through) / COMBOS_TOTAL, 9);
    }
    expect(seen.size).toBe(RANGE_CLASSES);
    expect(classAtRank(0)).toBe(classByName('AA'));
    expect(rankPctOfClass(classAtRank(168))).toBeCloseTo(100, 9);
  });

  it('starts like the charts: pairs and big aces first, AA, KK, QQ, JJ, TT, then AKs', () => {
    const first = Array.from({ length: 6 }, (_, rank) => classAtRank(rank));
    expect(first).toEqual(['AA', 'KK', 'QQ', 'JJ', 'TT', 'AKs'].map(classByName));
    expect(pct('AA')).toBeCloseTo((100 * 6) / COMBOS_TOTAL, 9);
  });

  it('reads two hole cards of any suits as their class', () => {
    expect(rankPct(parseCards('As Ah'))).toBe(pct('AA'));
    expect(rankPct(parseCards('Kd Kc'))).toBe(pct('KK'));
    expect(rankPct(parseCards('Ah Kh'))).toBe(pct('AKs'));
    expect(rankPct(parseCards('Kc Ah'))).toBe(pct('AKo'));
    expect(rankPct([parseCard('2c'), parseCard('7d')])).toBe(pct('72o'));
  });

  it('rejects bad classes, ranks and hole cards', () => {
    expect(() => rankPctOfClass(169)).toThrow(RangeError);
    expect(() => rankPctOfClass(-1)).toThrow(RangeError);
    expect(() => rankOfClass(0.5)).toThrow(RangeError);
    expect(() => classAtRank(169)).toThrow(RangeError);
    expect(() => rankPct([1])).toThrow(RangeError);
    expect(() => rankPct([3, 3])).toThrow(RangeError);
    expect(() => rankPct([3, 52])).toThrow(RangeError);
  });
});

describe('equity against the top X%', () => {
  it('against every hand (100%) it reproduces the published equities against one random hand', () => {
    // Appendix C.3 (Monte Carlo, 2M trials, ±0.07) and the A♥K♥ line; the table has ±0.11 (95%: ±0.22).
    const oracle: [string, number][] = [
      ['AA', 85.24],
      ['KK', 82.35],
      ['AKs', 67.04],
      ['AKo', 65.32],
      ['22', 50.28],
      ['72o', 34.58],
    ];
    for (const [name, expected] of oracle) {
      const got = 100 * equityVsTopOfClass(classByName(name), 100);
      expect(Math.abs(got - expected), `${name}: ${got}`).toBeLessThan(0.5);
    }
  });

  it('gives every player one half on average against a random hand', () => {
    let weighted = 0;
    for (let cls = 0; cls < RANGE_CLASSES; cls++) {
      weighted += comboCount(cls) * equityVsTopOfClass(cls, 100);
    }
    expect(weighted / COMBOS_TOTAL).toBeCloseTo(0.5, 2);
  });

  it('never falls by more than noise as the range widens, and never leaves (0, 1)', () => {
    for (let cls = 0; cls < RANGE_CLASSES; cls++) {
      for (let knot = 0; knot < RANGE_KNOTS.length; knot++) {
        const e = equityVsKnot(cls, knot);
        expect(e).toBeGreaterThan(0);
        expect(e).toBeLessThan(1);
        if (knot > 0) expect(e).toBeGreaterThan(equityVsKnot(cls, knot - 1) - 0.01);
      }
    }
  });

  it('is hard on weak hands and kind to strong ones: AA beats a tight range far more than 72o does', () => {
    const aa = classByName('AA');
    const trash = classByName('72o');
    expect(equityVsTopOfClass(aa, 3)).toBeGreaterThan(0.75);
    expect(equityVsTopOfClass(trash, 3)).toBeLessThan(0.2);
    expect(equityVsTopOfClass(aa, 3)).toBeLessThan(equityVsTopOfClass(aa, 100));
  });

  it('is the table value at a knot and a straight line between two knots', () => {
    const cls = classByName('T9s');
    RANGE_KNOTS.forEach((knot, j) => {
      expect(equityVsTopOfClass(cls, knot)).toBe(equityVsKnot(cls, j));
    });
    const mid = (equityVsKnot(cls, 4) + equityVsKnot(cls, 5)) / 2; // 15% and 20%
    expect(equityVsTopOfClass(cls, 17.5)).toBeCloseTo(mid, 12);
    const quarter = equityVsKnot(cls, 11) + 0.25 * (equityVsKnot(cls, 12) - equityVsKnot(cls, 11));
    expect(equityVsTopOfClass(cls, 85)).toBeCloseTo(quarter, 12);
  });

  it('reads the nearest knot beyond the ends (below 3% there is no table)', () => {
    const cls = classByName('AKs');
    expect(equityVsTopOfClass(cls, 2.5)).toBe(equityVsKnot(cls, 0));
    expect(equityVsTopOfClass(cls, 0)).toBe(equityVsKnot(cls, 0));
    expect(equityVsTopOfClass(cls, -4)).toBe(equityVsKnot(cls, 0));
    expect(equityVsTopOfClass(cls, 100)).toBe(equityVsKnot(cls, 12));
    expect(equityVsTopOfClass(cls, 250)).toBe(equityVsKnot(cls, 12));
  });

  it('reads two hole cards as their class and rejects bad input', () => {
    expect(equityVsTop(parseCards('Ah Kh'), 25)).toBe(equityVsTopOfClass(classByName('AKs'), 25));
    expect(equityVsTop([parseCard('As'), parseCard('Kd')], 25)).toBe(
      equityVsTopOfClass(classOf(parseCard('As'), parseCard('Kd')), 25),
    );
    expect(() => equityVsTop([1, 2, 3], 25)).toThrow(RangeError);
    expect(() => equityVsTopOfClass(0, Number.NaN)).toThrow(RangeError);
    expect(() => equityVsTopOfClass(169, 10)).toThrow(RangeError);
    expect(() => equityVsKnot(0, 13)).toThrow(RangeError);
    expect(() => equityVsKnot(0, -1)).toThrow(RangeError);
    expect(() => equityVsKnot(200, 0)).toThrow(RangeError);
  });

  it('builds the class weights of a top range: exactly X% of the combos', () => {
    for (const x of [3, 15, 40, 100]) {
      const w = topRangeWeights(x);
      let combos = 0;
      w.forEach((weight, cls) => (combos += weight * comboCount(cls)));
      expect(combos).toBeCloseTo((x / 100) * COMBOS_TOTAL, 9);
    }
    expect(topRangeWeights(3)[classByName('AA')]).toBe(1);
    expect(topRangeWeights(3)[classByName('72o')]).toBe(0);
  });

  it('says how many trials stand behind every cell', () => {
    expect(RANGES_SAMPLE_TRIALS).toBe(200_000);
  });
});
