import { describe, expect, it } from 'vitest';
import { betChips, compactChips, formatChips } from '../../src/ui/format.ts';

describe('chip formats', () => {
  it('groups thousands with commas (Appendix F)', () => {
    expect(formatChips(0)).toBe('0');
    expect(formatChips(950)).toBe('950');
    expect(formatChips(2340)).toBe('2,340');
    expect(formatChips(1_000_000)).toBe('1,000,000');
    expect(formatChips(-1250)).toBe('-1,250');
  });

  it('compacts pod stacks, always rounding down (§12.4)', () => {
    expect(compactChips(999)).toBe('999');
    expect(compactChips(1000)).toBe('1k');
    expect(compactChips(1250)).toBe('1.2k');
    expect(compactChips(1299)).toBe('1.2k');
    expect(compactChips(2000)).toBe('2k');
    expect(compactChips(12_345)).toBe('12.3k');
    expect(compactChips(99_999)).toBe('99.9k');
    expect(compactChips(123_456)).toBe('123k');
    expect(compactChips(999_999)).toBe('999k');
    expect(compactChips(1_234_567)).toBe('1.2M');
    expect(compactChips(123_456_789)).toBe('123M');
  });

  it('never shows more chips than there are', () => {
    for (let n = 0; n < 200_000; n += 37) {
      const shown = compactChips(n);
      const value = shown.endsWith('M')
        ? parseFloat(shown) * 1e6
        : shown.endsWith('k')
          ? parseFloat(shown) * 1e3
          : parseFloat(shown);
      expect(value).toBeLessThanOrEqual(n);
    }
  });

  it('keeps bet labels short enough for the bet slot', () => {
    expect(betChips(60)).toBe('60');
    expect(betChips(9_999)).toBe('9,999');
    expect(betChips(12_345)).toBe('12.3k');
    for (const n of [5, 60, 1_250, 9_999, 10_000, 99_999, 123_456, 9_999_999]) {
      expect(betChips(n).length).toBeLessThanOrEqual(5);
    }
  });
});
