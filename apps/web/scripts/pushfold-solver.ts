/**
 * The push/fold game of PLAN §8.4 solved by fictitious play, for one `k` (players still to act
 * behind the pusher) and one effective stack `S` (big blinds). Pure arithmetic over a matrix of
 * class against class equities; `gen-pushfold.ts` samples the matrix and calls `solvePushFold`
 * for every (k, S).
 *
 * The game, no antes, blinds 0.5 and 1, every stack `S`:
 * - The pusher is all-in for `S` with `h`, or folds. Everyone behind folds or calls; a call is
 *   heads-up for all the chips and the hand is played out (equity realised in full).
 * - Callers best-respond: call when `eq(h vs the pushing range) × finalPot − callCost > 0`.
 * - The pusher best-responds: push when `EV(push) > 0`, where, relative to folding,
 *   `EV(push) = Pfold × blinds + (1 − Pfold) × (eq(h vs the calling range) × finalPot − risk)`.
 *   With `k` callers, `Pfold = (1 − callFreq)^k` (card removal ignored), and the equity is
 *   taken against ONE caller's calling range.
 * - `k = 1` is the small blind against the big blind, the exact heads-up game: the pusher has
 *   posted 0.5 (risk `S − 0.5`, pot `2S`), the caller has posted 1 (cost `S − 1`). For `k ≥ 2` the
 *   pusher is on no blind and every caller is generic: cost `S`, final pot `2S + 1.5` (the blinds
 *   are dead money), risk `S`.
 *
 * Fictitious play: each side best-responds to the average of the other side's past best
 * responses. The pusher moves first (against "nobody calls" at the start, so it begins by pushing
 * everything), then the caller answers the updated average. After `iterations` rounds the average
 * strategies are the answer: `push[c]` and `call[c]` are the share of class `c`'s combos that
 * push and call. Everything is plain IEEE arithmetic in a fixed order, so the result is the same
 * on every machine.
 */
import { COMBOS_TOTAL, RANGE_CLASSES, comboCount } from '../src/data/rangesLayout.ts';

/** PLAN §8.4: "Average over 300 iterations". */
export const ITERATIONS = 300;

/** Dead money of the two blinds. */
export const BLINDS = 1.5;

const N = RANGE_CLASSES;

/**
 * The equity of every class against every class: `eq[h * 169 + c]` is the hero class `h`'s equity
 * against a rival holding a random combo of class `c` that shares no card with it, and
 * `free[h * 169 + c]` is how many combos of `c` those are.
 */
export interface Matchups {
  readonly eq: Float64Array;
  readonly free: Float64Array;
}

/** What one game is worth to each side: see the file header. */
export interface Stakes {
  /** The pusher's gain from everyone folding, relative to folding himself. */
  readonly gain: number;
  /** The pot when a push is called, and what the pusher has to put in on top of his blind. */
  readonly pushPot: number;
  readonly pushRisk: number;
  /** The pot when a caller calls, and what it costs him on top of his blind. */
  readonly callPot: number;
  readonly callCost: number;
}

/** The stakes of the game with `k` players behind and stacks of `S` big blinds. */
export function stakes(k: number, S: number): Stakes {
  if (!Number.isInteger(k) || k < 1) throw new RangeError(`k must be a positive integer: ${k}`);
  if (!(S >= 1)) throw new RangeError(`S must be at least 1: ${S}`);
  if (k === 1) {
    return { gain: BLINDS, pushPot: 2 * S, pushRisk: S - 0.5, callPot: 2 * S, callCost: S - 1 };
  }
  return {
    gain: BLINDS,
    pushPot: 2 * S + BLINDS,
    pushRisk: S,
    callPot: 2 * S + BLINDS,
    callCost: S,
  };
}

export interface Solution {
  /** The share of each class's combos that push / call, averaged over the rounds. */
  readonly push: Float64Array;
  readonly call: Float64Array;
  /** The pushing and calling ranges as a percent of all 1,326 combos. */
  readonly pushPct: number;
  readonly callPct: number;
  /** `pushPct` after half of the rounds: how far the answer still moved in the second half. */
  readonly halfwayPushPct: number;
}

function rangePct(share: Float64Array): number {
  let combos = 0;
  for (let c = 0; c < N; c++) combos += (share[c] as number) * comboCount(c);
  return (100 * combos) / COMBOS_TOTAL;
}

/** Solves the game for `k` players behind and `S` big blinds (see the file header). */
export function solvePushFold(
  mu: Matchups,
  k: number,
  S: number,
  iterations: number = ITERATIONS,
): Solution {
  if (!Number.isInteger(iterations) || iterations < 2) {
    throw new RangeError(`iterations must be an integer of at least 2: ${iterations}`);
  }
  const { eq, free } = mu;
  const st = stakes(k, S);
  const push = new Float64Array(N);
  const call = new Float64Array(N);
  const combos = new Float64Array(N);
  for (let c = 0; c < N; c++) combos[c] = comboCount(c);
  const half = Math.floor(iterations / 2);
  let halfwayPushPct = 0;

  for (let t = 1; t <= iterations; t++) {
    // The pusher answers the calling range so far.
    let callFreq = 0;
    for (let c = 0; c < N; c++) callFreq += (call[c] as number) * (combos[c] as number);
    callFreq /= COMBOS_TOTAL;
    const pfold = Math.pow(1 - callFreq, k);
    for (let h = 0; h < N; h++) {
      const row = h * N;
      let mass = 0;
      let sum = 0;
      for (let c = 0; c < N; c++) {
        const w = (call[c] as number) * (free[row + c] as number);
        mass += w;
        sum += w * (eq[row + c] as number);
      }
      const eqCalled = mass > 0 ? sum / mass : 0.5;
      const ev = pfold * st.gain + (1 - pfold) * (eqCalled * st.pushPot - st.pushRisk);
      const best = mass === 0 || ev > 0 ? 1 : 0;
      push[h] = (push[h] as number) + (best - (push[h] as number)) / t;
    }
    if (t === half) halfwayPushPct = rangePct(push);
    // The caller answers the pushing range so far, this round included.
    for (let h = 0; h < N; h++) {
      const row = h * N;
      let mass = 0;
      let sum = 0;
      for (let c = 0; c < N; c++) {
        const w = (push[c] as number) * (free[row + c] as number);
        mass += w;
        sum += w * (eq[row + c] as number);
      }
      const best = mass > 0 && (sum / mass) * st.callPot - st.callCost > 0 ? 1 : 0;
      call[h] = (call[h] as number) + (best - (call[h] as number)) / t;
    }
  }
  return { push, call, pushPct: rangePct(push), callPct: rangePct(call), halfwayPushPct };
}
