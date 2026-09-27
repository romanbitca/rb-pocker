import { newDeck } from '../../src/core/cards.ts';
import {
  deriveSeed,
  randInt,
  rngFromSeed,
  shuffleRange,
  type Seed128,
} from '../../src/core/rng.ts';
import { chiSquarePValue, chiSquareStat } from '../helpers/stats.ts';

/**
 * Shared bodies of the statistical RNG tests (PLAN §5.6): the unit project runs them small, the
 * slow project at full size. Every run uses a fixed seed (see `testSeed`).
 */

export interface ShuffleUniformity {
  /** p-value of the whole 52 × 52 card-by-position table (df = 51²). */
  tableP: number;
  /** Smallest per-card p-value (df = 51), and the card it belongs to. */
  minCardP: number;
  minCard: number;
}

/**
 * Shuffles the deck `shuffles` times the way a hand does (a fresh derived seed per deck) and
 * tests that every card's final position is uniform.
 */
export function shuffleUniformity(seed: Seed128, shuffles: number): ShuffleUniformity {
  const counts = new Uint32Array(52 * 52); // [card * 52 + position]
  for (let i = 0; i < shuffles; i++) {
    const deck = newDeck();
    shuffleRange(deck, 0, 51, rngFromSeed(deriveSeed(seed, 'deck', i)));
    for (let pos = 0; pos < 52; pos++) counts[(deck[pos] as number) * 52 + pos]! += 1;
  }
  const expected = shuffles / 52;
  let tableStat = 0;
  let minCardP = 1;
  let minCard = -1;
  for (let card = 0; card < 52; card++) {
    const stat = chiSquareStat(counts.subarray(card * 52, card * 52 + 52), expected);
    tableStat += stat;
    const p = chiSquarePValue(stat, 51);
    if (p < minCardP) {
      minCardP = p;
      minCard = card;
    }
  }
  return { tableP: chiSquarePValue(tableStat, 51 * 51), minCardP, minCard };
}

/** p-value of `randInt(n)` over `draws` draws, with values grouped into `buckets` equal ranges. */
export function randIntUniformityP(seed: Seed128, n: number, draws: number, buckets = n): number {
  if (n % buckets !== 0) throw new RangeError('buckets must divide n');
  const width = n / buckets;
  const counts = new Float64Array(buckets);
  const rng = rngFromSeed(seed);
  for (let i = 0; i < draws; i++) {
    const v = randInt(rng, n);
    if (v < 0 || v >= n || !Number.isInteger(v)) throw new RangeError(`randInt out of range: ${v}`);
    counts[Math.floor(v / width)]! += 1;
  }
  return chiSquarePValue(chiSquareStat(counts, draws / buckets), buckets - 1);
}
