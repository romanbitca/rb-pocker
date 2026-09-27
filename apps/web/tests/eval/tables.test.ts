import { describe, expect, it } from 'vitest';
import { MASK_COUNT, POPCOUNT, STRAIGHT_HIGH, TOP5 } from '../../src/eval/tables.ts';

const maskOf = (...ranks: number[]): number => ranks.reduce((m, r) => m | (1 << r), 0);

describe('rank-mask tables (PLAN §5.3)', () => {
  it('has 8,192 entries each', () => {
    expect(MASK_COUNT).toBe(8192);
    expect(POPCOUNT).toHaveLength(8192);
    expect(STRAIGHT_HIGH).toHaveLength(8192);
    expect(TOP5).toHaveLength(8192);
  });

  it('POPCOUNT counts bits', () => {
    for (let m = 0; m < MASK_COUNT; m++) {
      expect(POPCOUNT[m]).toBe(
        m
          .toString(2)
          .split('')
          .filter((b) => b === '1').length,
      );
    }
  });

  it('TOP5 packs the five highest ranks, left-aligned', () => {
    for (let m = 0; m < MASK_COUNT; m++) {
      const ranks: number[] = [];
      for (let r = 12; r >= 0; r--) if (m & (1 << r)) ranks.push(r);
      const expected = ranks.slice(0, 5).reduce((acc, r, i) => acc | (r << (16 - 4 * i)), 0);
      expect(TOP5[m]).toBe(expected);
    }
  });

  it('STRAIGHT_HIGH finds the best run of five; the wheel is five-high', () => {
    for (let m = 0; m < MASK_COUNT; m++) {
      // Independent definition: the highest h with h, h-1, …, h-4 all present (rank -1 = Ace).
      let expected = -1;
      for (let h = 12; h >= 3 && expected < 0; h--) {
        const run = [h, h - 1, h - 2, h - 3, h - 4].map((r) => (r < 0 ? 12 : r));
        if (run.every((r) => m & (1 << r))) expected = h;
      }
      expect(STRAIGHT_HIGH[m]).toBe(expected);
    }
    expect(STRAIGHT_HIGH[maskOf(12, 0, 1, 2, 3)]).toBe(3);
    expect(STRAIGHT_HIGH[maskOf(12, 0, 1, 2, 3, 4)]).toBe(4);
    expect(STRAIGHT_HIGH[maskOf(12, 11, 10, 9, 8)]).toBe(12);
    expect(STRAIGHT_HIGH[maskOf(10, 11, 12, 0, 1)]).toBe(-1); // Q-K-A-2-3
  });
});
