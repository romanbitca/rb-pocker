/**
 * The layout of the generated preflop tables (PLAN §7.5): their sizes and the functions that read
 * the base64 text of `data/generated/preflop-equity.ts` and `finals.ts` back into numbers. Kept
 * apart from the generated modules, so `scripts/gen-preflop.ts` and `scripts/check-tables.ts` can
 * use them without loading data that may be stale or damaged. `analysis/preflop.ts` holds the
 * accessors the app uses.
 *
 * Class index: `classOf` in `core/cards.ts` (AA = 0, AKs = 1, AKo = 13, 22 = 168).
 */

/** Starting-hand classes: a 13 × 13 grid. */
export const PREFLOP_CLASSES = 169;
/** The equity table covers 1 to 8 opponents (a table has at most 9 seats). */
export const PREFLOP_MAX_OPPONENTS = 8;
/** The display categories: high card, pair, ..., straight flush, royal flush. */
export const FINAL_CATEGORIES = 10;
/** C(50,5): the boards behind every row of the finals table. */
export const FINALS_BOARDS = 2_118_760;

/** Words of the equity table: `win` and `split` for every (class, opponent count). */
export const EQUITY_WORDS = PREFLOP_CLASSES * PREFLOP_MAX_OPPONENTS * 2;
/** Words of the finals table: one count per (class, category). */
export const FINALS_WORDS = PREFLOP_CLASSES * FINAL_CATEGORIES;

function decodeBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Word index of a cell's `win`; its `split` is the next word. */
export function equityWordIndex(cls: number, nOpp: number): number {
  return 2 * (cls * PREFLOP_MAX_OPPONENTS + nOpp - 1);
}

/**
 * The equity table, in basis points (1 = 0.01 %): `win` at `equityWordIndex(class, nOpp)`, `split`
 * right after it. The base64 holds two byte planes: all the high bytes, then all the low bytes.
 */
export function decodeEquityTable(base64: string): Uint16Array {
  const bytes = decodeBase64(base64);
  if (bytes.length !== EQUITY_WORDS * 2) {
    throw new RangeError(`preflop-equity: ${bytes.length} bytes, expected ${EQUITY_WORDS * 2}`);
  }
  const words = new Uint16Array(EQUITY_WORDS);
  for (let i = 0; i < EQUITY_WORDS; i++) {
    words[i] = ((bytes[i] as number) << 8) | (bytes[EQUITY_WORDS + i] as number);
  }
  return words;
}

/**
 * The finals table: word `class * 10 + k` is the number of boards (of `FINALS_BOARDS`) on which the
 * class finishes with exactly display category `k`. Uint32 little-endian in the bytes.
 */
export function decodeFinalsTable(base64: string): Uint32Array {
  const bytes = decodeBase64(base64);
  if (bytes.length !== FINALS_WORDS * 4) {
    throw new RangeError(`finals: ${bytes.length} bytes, expected ${FINALS_WORDS * 4}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const words = new Uint32Array(FINALS_WORDS);
  for (let i = 0; i < FINALS_WORDS; i++) words[i] = view.getUint32(4 * i, true);
  return words;
}
