/**
 * Balanced river bluffs (PLAN §9.2 "Bluffs" at Hard and Expert, chunk 7.1): "balanced by size,
 * river bluff share ≈ `B / (pot + 2B)`". A river bet of `B` into `pot` offers a caller
 * `B : pot + B`; when a share `s = B / (pot + 2B)` of the bets are bluffs, a call breaks even, so
 * neither always calling nor always folding beats the bot.
 *
 * The bot cannot see its own range as one number, so it estimates it: `publicRange` reads its own
 * seat with the §8.6 model, as the opponent can (the board and face-up hands blocked, never its
 * hole cards). Against the opponent's range (the one behind its own `eRange`), each combo of that
 * range gets its river share (`riverShares`); the combos the bot bets for value on the river
 * (Strong or Monster, share ≥ 0.65, §8.2 buckets) weigh `V`, its Air (share < 0.45) weighs `A`.
 * The bluffs it needs, `s / (1 − s) × V`, come from the Air: an Air hand bluffs with chance
 * `q = min(1, s / (1 − s) × V / A)`.
 *
 * Pure functions of the observation and the ranges (⚠️ §9.6: no hidden card is read).
 */
import type { Card } from '../core/cards.ts';
import type { Observation } from '../engine/types.ts';
import { score7 } from '../eval/evaluate.ts';
import { COMBO_HI, COMBO_LO, COMBOS, publicRange, type RangeModel } from './ranges.ts';
import { BUCKET_MEDIUM, BUCKET_STRONG } from './tunables.ts';

/** §9.2: the bluff share of river bets of `bet` chips into `pot` that makes a call break even. */
export function riverBluffShare(bet: number, pot: number): number {
  return bet / (pot + 2 * bet);
}

/**
 * Every combo's share of the pot on the river `board` against one opponent holding the weighted
 * range `w` (ties split): `(Σ w_j [s_j < s_i] + ½ Σ w_j [s_j = s_i]) / Σ w_j` over the combos `j`
 * that use no board card. Card removal between the two hands is left out (it estimates a range's
 * shape, not one hand's equity). A combo with a board card gets −1.
 */
export function riverShares(board: readonly Card[], w: Float64Array): Float64Array {
  const onBoard = new Uint8Array(52);
  for (const c of board) onBoard[c] = 1;
  const scores = new Int32Array(COMBOS);
  const live: number[] = [];
  const cards = [0, 0, ...board];
  for (let i = 0; i < COMBOS; i++) {
    const a = COMBO_LO[i] as number;
    const b = COMBO_HI[i] as number;
    if (onBoard[a] === 1 || onBoard[b] === 1) continue;
    cards[0] = a;
    cards[1] = b;
    scores[i] = score7(cards, cards.length);
    live.push(i);
  }
  live.sort((x, y) => (scores[x] as number) - (scores[y] as number) || x - y);
  let total = 0;
  for (const i of live) total += w[i] as number;
  const out = new Float64Array(COMBOS).fill(-1);
  let below = 0;
  for (let i = 0; i < live.length; ) {
    const s = scores[live[i] as number] as number;
    let j = i;
    let equal = 0;
    while (j < live.length && scores[live[j] as number] === s) equal += w[live[j++] as number] as number;
    const share = total > 0 ? (below + equal / 2) / total : 0.5;
    for (let t = i; t < j; t++) out[live[t] as number] = share;
    below += equal;
    i = j;
  }
  return out;
}

/** The value and air weights of the range a bot shows on the river (see the header). */
export interface RiverSplit {
  /** Weight of the combos that bet for value: river share ≥ 0.65 (Strong or Monster). */
  value: number;
  /** Weight of the Air combos: river share < 0.45. */
  air: number;
}

/** The value/air split of `range` against `villain` on the river `board`. */
export function riverSplit(
  board: readonly Card[],
  range: Float64Array,
  villain: Float64Array,
): RiverSplit {
  const shares = riverShares(board, villain);
  let value = 0;
  let air = 0;
  for (let i = 0; i < COMBOS; i++) {
    const w = range[i] as number;
    const p = shares[i] as number;
    if (w <= 0 || p < 0) continue;
    if (p >= BUCKET_STRONG) value += w;
    else if (p < BUCKET_MEDIUM) air += w;
  }
  return { value, air };
}

/** `q = min(1, s / (1 − s) × V / A)`: 0 with no air, and 0 when nothing bets for value. */
export function bluffChance(share: number, split: RiverSplit): number {
  if (!(split.air > 0) || !(share > 0) || share >= 1) return 0;
  return Math.min(1, ((share / (1 - share)) * split.value) / split.air);
}

/**
 * The chance that the observer, a Hard or Expert bot heads-up on the river with an Air hand,
 * bluffs `bet` chips into the pot (§9.2): its own range as the opponent reads it (`model`, the
 * bot's range model) against the opponent's range `villain`, so that `B / (pot + 2B)` of its river
 * bets are bluffs.
 */
export function balancedBluffChance(
  obs: Observation,
  model: RangeModel,
  villain: Float64Array,
  bet: number,
): number {
  const own = publicRange(obs, obs.seat, model);
  const split = riverSplit(obs.board, own.weights, villain);
  return bluffChance(riverBluffShare(bet, obs.pot), split);
}
