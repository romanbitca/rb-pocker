/**
 * The drill's random choices, all from one seeded `core/rng.ts` stream (PLAN §0.3, §2.4:
 * `Math.random` is banned). The app seeds it like a new table (`randomSeed()`); a test passes a
 * fixed seed and gets the same questions every time.
 */
import { randInt, type Rng } from '../core/rng.ts';

const TWO_32 = 2 ** 32;

/** A uniform number in [0, 1). */
export function unit(rng: Rng): number {
  return rng.next() / TWO_32;
}

/** A uniform whole number in 0..n−1 (no modulo bias). */
export function int(rng: Rng, n: number): number {
  return randInt(rng, n);
}

/** Fisher–Yates in place; returns the same array. */
export function shuffle<T>(rng: Rng, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    const tmp = items[i] as T;
    items[i] = items[j] as T;
    items[j] = tmp;
  }
  return items;
}

/** One entry of a non-empty list. */
export function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[randInt(rng, list.length)] as T;
}

/**
 * The index of the share that `unit(rng)` lands in: shares [0.2, 0.5, 0.3] give 0 with
 * probability 0.2, 1 with 0.5, 2 with 0.3. A share of 0 is never picked; the last non-zero share
 * takes any rounding left over.
 */
export function pickShare(rng: Rng, shares: readonly number[]): number {
  let x = unit(rng);
  let last = 0;
  for (let i = 0; i < shares.length; i++) {
    const share = shares[i] as number;
    if (share <= 0) continue;
    last = i;
    x -= share;
    if (x < 0) return i;
  }
  return last;
}
