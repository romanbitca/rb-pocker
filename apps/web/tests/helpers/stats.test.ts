import { describe, expect, it } from 'vitest';
import { chiSquarePValue, chiSquareStat, gammaQ, lnGamma } from './stats.ts';

// The statistical tests are only as good as this p-value, so check it against known values.
describe('chi-square helper', () => {
  it('computes log-gamma', () => {
    expect(lnGamma(1)).toBeCloseTo(0, 12);
    expect(lnGamma(5)).toBeCloseTo(Math.log(24), 12);
    expect(lnGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 12);
    expect(lnGamma(101)).toBeCloseTo(363.73937555556347, 8); // ln(100!)
  });

  it('matches the closed form for 2 degrees of freedom', () => {
    for (const x of [0.1, 1, 5, 13.815510557964274, 40]) {
      expect(chiSquarePValue(x, 2)).toBeCloseTo(Math.exp(-x / 2), 12);
    }
  });

  it('matches published critical values', () => {
    // [statistic, df, p] from standard chi-square tables.
    const table: [number, number, number][] = [
      [3.841458820694124, 1, 0.05],
      [6.634896601021214, 1, 0.01],
      [29.58829844507442, 10, 0.001],
      [86.66086565, 50, 0.001],
      [149.4493, 100, 0.001],
      [124.3421, 100, 0.05],
    ];
    for (const [stat, df, p] of table) {
      expect(chiSquarePValue(stat, df)).toBeCloseTo(p, 5);
    }
  });

  it('is continuous where it switches from the series to the continued fraction', () => {
    const a = 1300.5;
    expect(gammaQ(a, a + 1 - 1e-9)).toBeCloseTo(gammaQ(a, a + 1 + 1e-9), 9);
    // Large df: the median is about df − 2/3.
    expect(chiSquarePValue(2601 - 2 / 3, 2601)).toBeCloseTo(0.5, 2);
  });

  it('computes the Pearson statistic', () => {
    expect(chiSquareStat([10, 10, 10], 10)).toBe(0);
    expect(chiSquareStat([12, 8, 10], 10)).toBeCloseTo(0.8, 12);
  });
});
