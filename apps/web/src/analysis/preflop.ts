/**
 * Typed accessors over the build-time preflop tables (PLAN §7.2, §7.5, §6.6):
 *
 * - `preflopEquity`: the win chance before the flop, instantly. The equity of each of the 169
 *   starting-hand classes against 1..8 opponents holding random cards, sampled at build time by
 *   `scripts/gen-preflop.ts` (500,000 trials per cell, ±0.14% at 95%).
 * - `preflopChances`: the chance to finish with each hand category by the river, exact (over all
 *   C(50,5) boards), the preflop case of `chancesByRiver` (§6.6).
 *
 * The data lives in `src/data/generated/` as base64 modules that the worker bundles: no runtime
 * fetches (§7.5, §15.1). ⚠️ Those files are generated, never edited by hand. They are decoded once,
 * at the first lookup (`data/preflopLayout.ts` describes the layout). Class indexes are `classOf`
 * (AA = 0, AKs = 1, AKo = 13, 22 = 168): suits do not matter, so A♥K♥ and A♠K♠ read the same cell.
 */
import { classOf, isCard, type Card } from '../core/cards.ts';
import { FINALS_B64 } from '../data/generated/finals.ts';
import { PREFLOP_EQUITY_B64, PREFLOP_EQUITY_TRIALS } from '../data/generated/preflop-equity.ts';
import {
  decodeEquityTable,
  decodeFinalsTable,
  equityWordIndex,
  FINAL_CATEGORIES,
  FINALS_BOARDS,
  PREFLOP_CLASSES,
  PREFLOP_MAX_OPPONENTS,
} from '../data/preflopLayout.ts';
import { HAND_CATEGORIES } from '../eval/evaluate.ts';
import type { EquityResult, HandAnalysis } from './types.ts';

export { FINALS_BOARDS, PREFLOP_CLASSES, PREFLOP_MAX_OPPONENTS };

/** Monte Carlo trials behind every equity cell: the `n` of `preflopEquity`. */
export const PREFLOP_TRIALS: number = PREFLOP_EQUITY_TRIALS;

let equityWords: Uint16Array | undefined;
let finalsWords: Uint32Array | undefined;

function equityTable(): Uint16Array {
  return (equityWords ??= decodeEquityTable(PREFLOP_EQUITY_B64));
}

function finalsTable(): Uint32Array {
  return (finalsWords ??= decodeFinalsTable(FINALS_B64));
}

function checkClass(fn: string, cls: number): void {
  if (!Number.isInteger(cls) || cls < 0 || cls >= PREFLOP_CLASSES) {
    throw new RangeError(`${fn}: not a class index 0..${PREFLOP_CLASSES - 1}: ${String(cls)}`);
  }
}

function classOfHole(fn: string, hole: readonly Card[]): number {
  const [a, b] = hole;
  if (hole.length !== 2 || !isCard(a) || !isCard(b) || a === b) {
    throw new RangeError(`${fn}: need two different cards 0..51, got ${hole.join(',')}`);
  }
  return classOf(a, b);
}

/**
 * The win chance of a starting-hand class against `nOpp` (1..8) random hands, from the table.
 * Fractions of 1 like `equity()`: `equity === win + split`; `n` is the trials behind the cell;
 * never `exact`, always `final`.
 */
export function preflopEquityOfClass(cls: number, nOpp: number): EquityResult {
  checkClass('preflopEquity', cls);
  if (!Number.isInteger(nOpp) || nOpp < 1 || nOpp > PREFLOP_MAX_OPPONENTS) {
    throw new RangeError(`preflopEquity: nOpp must be 1..${PREFLOP_MAX_OPPONENTS}, got ${nOpp}`);
  }
  const words = equityTable();
  const i = equityWordIndex(cls, nOpp);
  const win = (words[i] as number) / 10_000;
  const split = (words[i + 1] as number) / 10_000;
  return {
    n: PREFLOP_TRIALS,
    win,
    split,
    equity: win + split,
    exact: false,
    final: true,
    truncated: false,
  };
}

/** The win chance of the hero's two hole cards against `nOpp` random hands (§7.2, preflop). */
export function preflopEquity(hole: readonly Card[], nOpp: number): EquityResult {
  return preflopEquityOfClass(classOfHole('preflopEquity', hole), nOpp);
}

/**
 * How many of the C(50,5) boards finish with exactly each display category, for a class: the same
 * `{ counts, total }` as `finalCounts(hole, [])`, without the two million evaluations.
 */
export function preflopFinalCountsOfClass(cls: number): { counts: number[]; total: number } {
  checkClass('preflopFinalCounts', cls);
  const row = finalsTable().subarray(cls * FINAL_CATEGORIES, (cls + 1) * FINAL_CATEGORIES);
  return { counts: Array.from(row), total: FINALS_BOARDS };
}

/** `preflopFinalCountsOfClass` for the hero's two hole cards. */
export function preflopFinalCounts(hole: readonly Card[]): { counts: number[]; total: number } {
  return preflopFinalCountsOfClass(classOfHole('preflopFinalCounts', hole));
}

/**
 * §6.6 chances for every category before the flop: `exactly` and `atLeast` (this or better), in
 * percent; `boardShared` is always false (no board yet). The same numbers, to the last bit, as
 * `chancesByRiver(hole, [])`, which enumerates every board instead.
 */
export function preflopChances(hole: readonly Card[]): NonNullable<HandAnalysis['chances']> {
  const { counts, total } = preflopFinalCounts(hole);
  const atLeast = new Array<number>(FINAL_CATEGORIES).fill(0);
  let sum = 0;
  for (let i = FINAL_CATEGORIES - 1; i >= 0; i--) {
    sum += counts[i] as number;
    atLeast[i] = sum;
  }
  return Object.fromEntries(
    HAND_CATEGORIES.map((category, i) => [
      category,
      {
        exactly: (100 * (counts[i] as number)) / total,
        atLeast: (100 * (atLeast[i] as number)) / total,
        boardShared: false,
      },
    ]),
  ) as NonNullable<HandAnalysis['chances']>;
}
