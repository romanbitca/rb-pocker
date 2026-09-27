/**
 * Seeded randomness (PLAN §2.4, §5.6, Appendix C.4). ⚠️ Every random choice that affects a game
 * goes through this file; `Math.random` is banned in `src/` (it cannot be seeded).
 *
 * `fnv1a32`, `splitmix32` and `sfc32` are verbatim ports of the Appendix C.4 reference code, and
 * the golden values there pin them: do not "improve" them.
 */

/** 128-bit seed as 32 lowercase hex characters: four big-endian uint32 words. */
export type Seed128 = string;
export const ZERO_SEED: Seed128 = '00000000000000000000000000000000';

/** A stream of raw uint32 values. */
export interface Rng {
  next(): number;
}

/** FNV-1a over UTF-16 code units. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** splitmix32: used only to expand a 32-bit hash into seed words (`deriveSeed`). */
export function splitmix32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    t = t ^ (t >>> 15);
    return t >>> 0;
  };
}

/** sfc32 (Small Fast Counting, 128-bit state): raw outputs, nothing discarded. */
export function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return t >>> 0;
  };
}

const SEED_TEXT = /^[0-9a-f]{32}$/;

export function isSeed128(s: unknown): s is Seed128 {
  return typeof s === 'string' && SEED_TEXT.test(s);
}

/** The four big-endian uint32 words of a seed (chars 0–7, 8–15, 16–23, 24–31). */
export function seedWords(seed: Seed128): [number, number, number, number] {
  if (!isSeed128(seed)) throw new RangeError(`Not a Seed128: "${seed}"`);
  return [
    parseInt(seed.slice(0, 8), 16),
    parseInt(seed.slice(8, 16), 16),
    parseInt(seed.slice(16, 24), 16),
    parseInt(seed.slice(24, 32), 16),
  ];
}

const hex8 = (w: number): string => (w >>> 0).toString(16).padStart(8, '0');

export function seedFromWords(w0: number, w1: number, w2: number, w3: number): Seed128 {
  return hex8(w0) + hex8(w1) + hex8(w2) + hex8(w3);
}

/** A fresh random seed from `crypto.getRandomValues` (works in workers and on plain http). */
export function randomSeed(): Seed128 {
  const w = globalThis.crypto.getRandomValues(new Uint32Array(4));
  return seedFromWords(w[0] as number, w[1] as number, w[2] as number, w[3] as number);
}

/** sfc32 seeded with the four seed words, first 16 outputs discarded. */
export function rngFromSeed(seed: Seed128): Rng {
  const [a, b, c, d] = seedWords(seed);
  const next = sfc32(a, b, c, d);
  for (let i = 0; i < 16; i++) next();
  return { next };
}

/**
 * Child seed: `h = fnv1a32(parent + '|' + label + '|' + ints.join(','))`, `g = splitmix32(h)`,
 * word `i` = `(g() ^ parentWord[i]) >>> 0`. ⚠️ A child reveals its parent after ~2^32 guesses,
 * so never derive a stream that others see from a seed that must stay secret (PLAN §2.4).
 */
export function deriveSeed(parent: Seed128, label: string, ...ints: number[]): Seed128 {
  const [p0, p1, p2, p3] = seedWords(parent);
  for (const n of ints) {
    if (!Number.isSafeInteger(n)) throw new RangeError(`deriveSeed: not an integer: ${n}`);
  }
  const g = splitmix32(fnv1a32(`${parent}|${label}|${ints.join(',')}`));
  const w0 = (g() ^ p0) >>> 0;
  const w1 = (g() ^ p1) >>> 0;
  const w2 = (g() ^ p2) >>> 0;
  const w3 = (g() ^ p3) >>> 0;
  return seedFromWords(w0, w1, w2, w3);
}

const TWO_32 = 2 ** 32;

/** Unbiased integer in 0..n-1 (1 ≤ n ≤ 2^32) by rejection sampling: no modulo bias. */
export function randInt(rng: Rng, n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > TWO_32) {
    throw new RangeError(`randInt: n must be an integer in 1..2^32, got ${n}`);
  }
  const lim = TWO_32 - (TWO_32 % n);
  let x: number;
  do {
    x = rng.next();
  } while (x >= lim);
  return x % n;
}

/**
 * Fisher–Yates on `arr[lo..hi]` (inclusive): for i = hi down to lo+1, j = lo + randInt(i − lo + 1),
 * swap(i, j). Full deck: lo = 0, hi = 51; undo reshuffle: lo = deckPos (PLAN §5.6).
 */
export function shuffleRange<T>(arr: T[], lo: number, hi: number, rng: Rng): void {
  if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < 0 || hi >= arr.length || lo > hi) {
    throw new RangeError(`shuffleRange: bad range ${lo}..${hi} for length ${arr.length}`);
  }
  for (let i = hi; i > lo; i--) {
    const j = lo + randInt(rng, i - lo + 1);
    const tmp = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = tmp;
  }
}
