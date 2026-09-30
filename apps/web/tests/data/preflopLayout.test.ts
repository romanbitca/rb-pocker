import { describe, expect, it } from 'vitest';
import {
  decodeEquityTable,
  decodeFinalsTable,
  EQUITY_WORDS,
  equityWordIndex,
  FINAL_CATEGORIES,
  FINALS_BOARDS,
  FINALS_WORDS,
  PREFLOP_CLASSES,
  PREFLOP_MAX_OPPONENTS,
} from '../../src/data/preflopLayout.ts';
import { HAND_CATEGORIES } from '../../src/eval/evaluate.ts';

/** Bytes as base64, the way the generated modules carry them. */
function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

describe('data/preflopLayout.ts (PLAN §7.5)', () => {
  it('has the sizes of the PLAN: 169 classes, 1..8 opponents, 10 categories, C(50,5) boards', () => {
    expect(PREFLOP_CLASSES).toBe(169);
    expect(PREFLOP_MAX_OPPONENTS).toBe(8);
    expect(FINAL_CATEGORIES).toBe(HAND_CATEGORIES.length);
    expect(FINALS_BOARDS).toBe(2_118_760);
    expect(EQUITY_WORDS).toBe(169 * 8 * 2);
    expect(FINALS_WORDS).toBe(1690);
  });

  it('numbers the equity words class by class, win then split', () => {
    expect(equityWordIndex(0, 1)).toBe(0);
    expect(equityWordIndex(0, 8)).toBe(14);
    expect(equityWordIndex(1, 1)).toBe(16);
    expect(equityWordIndex(168, 8)).toBe(EQUITY_WORDS - 2);
  });

  it('reads the equity table as two byte planes: the high bytes, then the low bytes', () => {
    const bytes = new Uint8Array(EQUITY_WORDS * 2);
    bytes[0] = 0x21; // word 0, high byte
    bytes[EQUITY_WORDS] = 0x4d; // word 0, low byte: 0x214d = 8525
    bytes[EQUITY_WORDS - 1] = 0x01; // the last word
    bytes[EQUITY_WORDS * 2 - 1] = 0xff; // 0x01ff = 511
    const words = decodeEquityTable(base64(bytes));
    expect(words).toHaveLength(EQUITY_WORDS);
    expect(words[0]).toBe(8525);
    expect(words[EQUITY_WORDS - 1]).toBe(511);
    expect(words[1]).toBe(0);
  });

  it('reads the finals table as Uint32 little-endian words', () => {
    const bytes = new Uint8Array(FINALS_WORDS * 4);
    bytes.set([0x68, 0x2e, 0x20, 0x00], 0); // 0x00202e68 = 2,109,032
    bytes.set([0x01, 0x00, 0x00, 0x00], 4 * (FINALS_WORDS - 1));
    const words = decodeFinalsTable(base64(bytes));
    expect(words).toHaveLength(FINALS_WORDS);
    expect(words[0]).toBe(2_109_032);
    expect(words[FINALS_WORDS - 1]).toBe(1);
  });

  it('rejects a table of the wrong size', () => {
    expect(() => decodeEquityTable('')).toThrow(RangeError);
    expect(() => decodeEquityTable(base64(new Uint8Array(EQUITY_WORDS * 2 - 1)))).toThrow(
      /preflop-equity/,
    );
    expect(() => decodeFinalsTable('')).toThrow(RangeError);
    expect(() => decodeFinalsTable(base64(new Uint8Array(FINALS_WORDS * 4 + 4)))).toThrow(/finals/);
  });
});
