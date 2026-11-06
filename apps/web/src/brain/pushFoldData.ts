/**
 * Typed accessors over the build-time push/fold ranges (PLAN §7.5, §8.4). The data comes from
 * `scripts/gen-pushfold.ts` (`data/generated/pushfold.ts`, base64: no runtime fetches) and lives in
 * the brain worker's chunk, never in the main bundle (§15.3). ⚠️ The generated file is never edited
 * by hand. It is decoded once, at the first lookup (`data/rangesLayout.ts` describes the layout).
 *
 * - `pushPct(k, S)`: the share of all 1,326 starting-hand combos (percent) that shove all-in when
 *   unopened, with `k` players still to act behind and `S` big blinds effective, no antes. The
 *   runtime rule is "shove if `rankPct ≤ pushPct(k, S)`" (§8.4).
 * - `callPct(S)`: the share of combos the big blind calls a small-blind shove with (percent): how
 *   many hands call an all-in of `S` big blinds.
 * - `inPushSet(k, S, cls)`: whether the solver shoves the class (at least half the time) in that
 *   game; `pushSetPct(k, S)` the set's share of the combos; `pushOrderPct(k, S, cls)` the class's
 *   place in the game's push order (the set first, then the rest, each part by `rankPct`), the
 *   percentile the §8.4 rule compares (fix/coach-strategy-audit).
 *
 * "Everywhere, `S = clamp(round(effBB), 1, 15)` and `k = clamp(k, 1, 8)`" (§8.4): both accessors do
 * that, so a caller can pass `effBB` and the raw count of players behind.
 */
import { PUSH_FOLD_B64 } from '../data/generated/pushfold.ts';
import {
  COMBOS_TOTAL,
  comboCount,
  decodePushFold,
  PUSH_MAX_PLAYERS_BEHIND,
  PUSH_MAX_STACK_BB,
  PUSH_WORDS,
  pushGameIndex,
  pushSetHas,
  RANGE_CLASSES,
  type PushFoldTable,
} from '../data/rangesLayout.ts';
import { rankPctOfClass } from './rangesData.ts';

export { PUSH_MAX_PLAYERS_BEHIND, PUSH_MAX_STACK_BB };

let decoded: PushFoldTable | undefined;

function table(): PushFoldTable {
  return (decoded ??= decodePushFold(PUSH_FOLD_B64));
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** `k` as the table's row, 1..8 (players behind, rounded and clamped). */
export function pushFoldPlayers(k: number): number {
  if (Number.isNaN(k)) throw new RangeError('pushFold: k is not a number');
  return clamp(Math.round(k), 1, PUSH_MAX_PLAYERS_BEHIND);
}

/** `effBB` as the table's column, 1..15 (big blinds, rounded and clamped). */
export function pushFoldStack(effBB: number): number {
  if (Number.isNaN(effBB)) throw new RangeError('pushFold: S is not a number');
  return clamp(Math.round(effBB), 1, PUSH_MAX_STACK_BB);
}

/** Percent of all combos that shove with `k` players behind and `effBB` big blinds. */
export function pushPct(k: number, effBB: number): number {
  const row = pushFoldPlayers(k) - 1;
  const col = pushFoldStack(effBB) - 1;
  return (table().push[row * PUSH_MAX_STACK_BB + col] as number) / 100;
}

/** Percent of all combos that call an all-in of `effBB` big blinds (the big blind vs the SB). */
export function callPct(effBB: number): number {
  return (table().call[pushFoldStack(effBB) - 1] as number) / 100;
}

function gameOf(k: number, effBB: number): number {
  return pushGameIndex(pushFoldPlayers(k), pushFoldStack(effBB));
}

/** Does the solver shove class `cls` with `k` players behind and `effBB` big blinds? */
export function inPushSet(k: number, effBB: number, cls: number): boolean {
  if (!Number.isInteger(cls) || cls < 0 || cls >= RANGE_CLASSES) {
    throw new RangeError(`inPushSet: not a class index 0..${RANGE_CLASSES - 1}: ${String(cls)}`);
  }
  return pushSetHas(table().sets, gameOf(k, effBB), cls);
}

/** Each game's push order as percentiles: `orders[game][cls]`, computed at the first lookup. */
const orders: (Float64Array | undefined)[] = new Array<Float64Array | undefined>(PUSH_WORDS);
const setPcts: (number | undefined)[] = new Array<number | undefined>(PUSH_WORDS);

function pushOrder(game: number): Float64Array {
  let pct = orders[game];
  if (pct === undefined) {
    const sets = table().sets;
    const classes = Array.from({ length: RANGE_CLASSES }, (_, cls) => cls);
    const inSet = (cls: number): number => (pushSetHas(sets, game, cls) ? 0 : 1);
    classes.sort((a, b) => inSet(a) - inSet(b) || rankPctOfClass(a) - rankPctOfClass(b) || a - b);
    pct = new Float64Array(RANGE_CLASSES);
    let through = 0;
    let setCombos = 0;
    for (const cls of classes) {
      through += comboCount(cls);
      pct[cls] = (100 * through) / COMBOS_TOTAL;
      if (inSet(cls) === 0) setCombos += comboCount(cls);
    }
    orders[game] = pct;
    setPcts[game] = (100 * setCombos) / COMBOS_TOTAL;
  }
  return pct;
}

/** The push set's share of all combos (percent) with `k` players behind and `effBB` big blinds. */
export function pushSetPct(k: number, effBB: number): number {
  const game = gameOf(k, effBB);
  pushOrder(game);
  return setPcts[game] as number;
}

/**
 * Where class `cls` stands in the push order of the game (percent of the combos at least as
 * good, its own included, like `rankPct`): the push set first, then every other class, each part
 * in `rankPct` order. So `pushOrderPct ≤ pushSetPct` is exactly "in the push set", and a looser
 * or tighter threshold (a bot's looseness, §9.4; limpers, §8.4) widens or narrows the set by the
 * general ranking.
 */
export function pushOrderPct(k: number, effBB: number, cls: number): number {
  if (!Number.isInteger(cls) || cls < 0 || cls >= RANGE_CLASSES) {
    throw new RangeError(`pushOrderPct: not a class index 0..${RANGE_CLASSES - 1}: ${String(cls)}`);
  }
  return pushOrder(gameOf(k, effBB))[cls] as number;
}
