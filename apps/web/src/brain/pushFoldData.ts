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
 *
 * "Everywhere, `S = clamp(round(effBB), 1, 15)` and `k = clamp(k, 1, 8)`" (§8.4): both accessors do
 * that, so a caller can pass `effBB` and the raw count of players behind.
 */
import { PUSH_FOLD_B64 } from '../data/generated/pushfold.ts';
import {
  decodePushFold,
  PUSH_MAX_PLAYERS_BEHIND,
  PUSH_MAX_STACK_BB,
  type PushFoldTable,
} from '../data/rangesLayout.ts';

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
