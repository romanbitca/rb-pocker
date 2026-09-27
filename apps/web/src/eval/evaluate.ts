/**
 * The 5–7 card evaluator (PLAN §5.1–5.3). Pure, allocation-free, no dependencies beyond `core`.
 *
 * Score packing (§5.2): `category << 20 | n0 << 16 | n1 << 12 | n2 << 8 | n3 << 4 | n4`, a 24-bit
 * integer. The tiebreak ranks are left-aligned nibbles (unused = 0), so plain integer comparison
 * decides and equal scores tie.
 */
import type { Card } from '../core/cards.ts';
import * as tables from './tables.ts';

// Module-local references to the tables. Vitest's module runner turns every use of an imported
// binding into a property lookup on the module namespace, which made the hot path several times
// slower under test; a production bundle is the same either way.
const POPCOUNT = tables.POPCOUNT;
const STRAIGHT_HIGH = tables.STRAIGHT_HIGH;
const TOP5 = tables.TOP5;

export type HandCategory =
  | 'highCard'
  | 'pair'
  | 'twoPair'
  | 'trips'
  | 'straight'
  | 'flush'
  | 'fullHouse'
  | 'quads'
  | 'straightFlush'
  | 'royalFlush';

/** The 10 display categories, weakest first; the index is the display category (royal = 9). */
export const HAND_CATEGORIES: readonly HandCategory[] = [
  'highCard',
  'pair',
  'twoPair',
  'trips',
  'straight',
  'flush',
  'fullHouse',
  'quads',
  'straightFlush',
  'royalFlush',
];

// Score category codes (§5.2): the royal flush is STRAIGHT_FLUSH with n0 = 12.
const PAIR = 1;
const TWO_PAIR = 2;
const TRIPS = 3;
const STRAIGHT = 4;
const FLUSH = 5;
const FULL_HOUSE = 6;
const QUADS = 7;
const STRAIGHT_FLUSH = 8;

/** Highest rank in a non-empty mask. */
const highest = (mask: number): number => 31 - Math.clz32(mask);

/**
 * Score of the best five-card hand among `cards[0..n-1]` (n = 5, 6 or 7; §5.3). Cards must be
 * distinct. Hot path: no allocation, no validation.
 */
export function score7(cards: ArrayLike<Card>, n: number): number {
  // 1. Suit masks, and rank masks by multiplicity: m1 = ranks seen at least once, m2 twice,
  //    m3 three times, m4 four times (bit-parallel counting instead of cnt[13]).
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  let m1 = 0;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (let i = 0; i < n; i++) {
    const c = cards[i]!;
    const bit = 1 << (c >> 2);
    switch (c & 3) {
      case 0:
        s0 |= bit;
        break;
      case 1:
        s1 |= bit;
        break;
      case 2:
        s2 |= bit;
        break;
      default:
        s3 |= bit;
    }
    m4 |= m3 & bit;
    m3 |= m2 & bit;
    m2 |= m1 & bit;
    m1 |= bit;
  }

  // 2. At most one suit can hold five of seven cards.
  let flush = 0;
  if (POPCOUNT[s0]! >= 5) flush = s0;
  else if (POPCOUNT[s1]! >= 5) flush = s1;
  else if (POPCOUNT[s2]! >= 5) flush = s2;
  else if (POPCOUNT[s3]! >= 5) flush = s3;

  // 3. ⚠️ Straight flush: test straights inside the flush suit's mask only, never on m1.
  if (flush !== 0) {
    const sf = STRAIGHT_HIGH[flush]!;
    if (sf >= 0) return (STRAIGHT_FLUSH << 20) | (sf << 16);
  }

  // 4–5. The rank masks replace the scan from the Ace down: `highest()` takes the top rank.
  // Quads, kicker = the highest other rank.
  if (m4 !== 0) {
    const q = highest(m4);
    return (QUADS << 20) | (q << 16) | (highest(m1 ^ (1 << q)) << 12);
  }

  const trips = m3; // exactly three (no quads left)
  const pairs = m2 ^ m3; // exactly two
  // Full house: the highest trips + the best of (second trips, highest pair).
  if (trips !== 0) {
    const t = highest(trips);
    const rest = (trips ^ (1 << t)) | pairs;
    if (rest !== 0) return (FULL_HOUSE << 20) | (t << 16) | (highest(rest) << 12);
  }
  if (flush !== 0) return (FLUSH << 20) | TOP5[flush]!;
  const straight = STRAIGHT_HIGH[m1]!;
  if (straight >= 0) return (STRAIGHT << 20) | (straight << 16);
  if (trips !== 0) {
    const t = highest(trips);
    return (TRIPS << 20) | (t << 16) | ((TOP5[m1 ^ (1 << t)]! >> 12) << 8);
  }
  if (pairs !== 0) {
    const p1 = highest(pairs);
    const lower = pairs ^ (1 << p1);
    if (lower !== 0) {
      // Two pair; a third pair's rank can be the kicker.
      const p2 = highest(lower);
      const kicker = highest(m1 ^ (1 << p1) ^ (1 << p2));
      return (TWO_PAIR << 20) | (p1 << 16) | (p2 << 12) | (kicker << 8);
    }
    return (PAIR << 20) | (p1 << 16) | ((TOP5[m1 ^ (1 << p1)]! >> 8) << 4);
  }
  return TOP5[m1]!;
}

/** Score of exactly five cards. */
export function score5(cards: ArrayLike<Card>): number {
  return score7(cards, 5);
}

/** Score of the best five of six cards. */
export function score6(cards: ArrayLike<Card>): number {
  return score7(cards, 6);
}

const SCORE_LIMIT = (STRAIGHT_FLUSH + 1) << 20;

/** Display category of a score (§5.2: "Royal flush" is category 8 with n0 = 12). */
export function categoryOf(score: number): HandCategory {
  if (!Number.isInteger(score) || score < 0 || score >= SCORE_LIMIT) {
    throw new RangeError(`Not a hand score: ${score}`);
  }
  const code = score >> 20;
  if (code === STRAIGHT_FLUSH && ((score >> 16) & 15) === 12) return 'royalFlush';
  return HAND_CATEGORIES[code]!;
}

/** The five tiebreak nibbles n0..n4 of a score (unused = 0). */
export function scoreNibbles(score: number): [number, number, number, number, number] {
  return [(score >> 16) & 15, (score >> 12) & 15, (score >> 8) & 15, (score >> 4) & 15, score & 15];
}
