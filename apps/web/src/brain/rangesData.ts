/**
 * Typed accessors over the build-time starting-hand ranking and range equities (PLAN §7.5, §8.3,
 * §8.6). The data comes from `scripts/gen-ranges.ts` (`data/generated/ranges.ts`, base64: no
 * runtime fetches, §7.5) and lives in the brain worker's chunk, never in the main bundle (§15.3).
 * ⚠️ The generated file is never edited by hand. It is decoded once, at the first lookup
 * (`data/rangesLayout.ts` describes the layout).
 *
 * - `rankPctOfClass`: where a starting-hand class stands, in percent of the 1,326 combos: the
 *   share that ranks at least as well, its own combos included (AA 0.45, 32o 100). "In the top X%"
 *   is exactly `rankPct ≤ X`. Class indexes are `classOf` in `core/cards.ts` (AA = 0, AKs = 1,
 *   AKo = 13, 22 = 168): suits do not matter.
 * - `equityVsTopOfClass`: the class's equity against ONE rival holding a hand from the top X% of
 *   that ranking, linear between the 13 ranges of `RANGE_KNOTS` (3 to 100 percent), as §8.3 asks.
 */
import { classOf, isCard, type Card } from '../core/cards.ts';
import { RANGES_B64, RANGES_TRIALS } from '../data/generated/ranges.ts';
import {
  COMBOS_TOTAL,
  decodeRanges,
  RANGE_CLASSES,
  RANGE_KNOTS,
  rangeWordIndex,
  rankPctFromOrder,
  topWeights,
  type RangesTable,
} from '../data/rangesLayout.ts';

export { COMBOS_TOTAL, RANGE_CLASSES, RANGE_KNOTS };

/** Monte Carlo trials behind every cell of the table (the ranking and each range equity). */
export const RANGES_SAMPLE_TRIALS: number = RANGES_TRIALS;

let decoded: RangesTable | undefined;
let percentiles: Float64Array | undefined;

function table(): RangesTable {
  return (decoded ??= decodeRanges(RANGES_B64));
}

function checkClass(fn: string, cls: number): void {
  if (!Number.isInteger(cls) || cls < 0 || cls >= RANGE_CLASSES) {
    throw new RangeError(`${fn}: not a class index 0..${RANGE_CLASSES - 1}: ${String(cls)}`);
  }
}

function classOfHole(fn: string, hole: readonly Card[]): number {
  const [a, b] = hole;
  if (hole.length !== 2 || !isCard(a) || !isCard(b) || a === b) {
    throw new RangeError(`${fn}: need two different cards 0..51, got ${hole.join(',')}`);
  }
  return classOf(a, b);
}

/** The class at `rank` (0 = AA, 168 = the worst class, 32o). */
export function classAtRank(rank: number): number {
  if (!Number.isInteger(rank) || rank < 0 || rank >= RANGE_CLASSES) {
    throw new RangeError(`classAtRank: not a rank 0..${RANGE_CLASSES - 1}: ${String(rank)}`);
  }
  return table().order[rank] as number;
}

/** The position of `cls` in the ranking (0 = best): the inverse of `classAtRank`. */
export function rankOfClass(cls: number): number {
  checkClass('rankOfClass', cls);
  return table().order.indexOf(cls);
}

/** `rankPct` of a class, in percent (see the file header). */
export function rankPctOfClass(cls: number): number {
  checkClass('rankPct', cls);
  return (percentiles ??= rankPctFromOrder(table().order))[cls] as number;
}

/** `rankPct` of two hole cards: "the top X% of starting hands". */
export function rankPct(hole: readonly Card[]): number {
  return rankPctOfClass(classOfHole('rankPct', hole));
}

/**
 * The class weights of "the top `pct`% of the 1,326 combos" in this ranking: 1, 0, and on the edge
 * the share that fits (so the range is exactly `pct`% of the combos). A new array each call.
 */
export function topRangeWeights(pct: number): Float64Array {
  return topWeights(table().order, pct);
}

/**
 * The equity (a fraction of 1) of `cls` against one rival holding a hand from the top `pct`% of the
 * ranking: the table's value at a knot, a straight line between two knots, and the nearest knot
 * beyond the ends (below 3% there is no table: a 2.5% range reads as 3%).
 */
export function equityVsTopOfClass(cls: number, pct: number): number {
  checkClass('equityVsTop', cls);
  if (Number.isNaN(pct)) throw new RangeError('equityVsTop: pct is not a number');
  const { eq } = table();
  const at = (knot: number): number => (eq[rangeWordIndex(cls, knot)] as number) / 10_000;
  const last = RANGE_KNOTS.length - 1;
  if (pct <= (RANGE_KNOTS[0] as number)) return at(0);
  if (pct >= (RANGE_KNOTS[last] as number)) return at(last);
  let j = 0;
  while (pct > (RANGE_KNOTS[j + 1] as number)) j++;
  const lo = RANGE_KNOTS[j] as number;
  const hi = RANGE_KNOTS[j + 1] as number;
  const t = (pct - lo) / (hi - lo);
  return at(j) + t * (at(j + 1) - at(j));
}

/** `equityVsTopOfClass` for two hole cards. */
export function equityVsTop(hole: readonly Card[], pct: number): number {
  return equityVsTopOfClass(classOfHole('equityVsTop', hole), pct);
}

/** The raw table value: the equity of `cls` against the top `RANGE_KNOTS[knot]`%, in [0, 1]. */
export function equityVsKnot(cls: number, knot: number): number {
  checkClass('equityVsKnot', cls);
  if (!Number.isInteger(knot) || knot < 0 || knot >= RANGE_KNOTS.length) {
    throw new RangeError(`equityVsKnot: not a range number 0..${RANGE_KNOTS.length - 1}: ${knot}`);
  }
  return (table().eq[rangeWordIndex(cls, knot)] as number) / 10_000;
}
