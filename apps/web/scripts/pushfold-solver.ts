/**
 * The push/fold game of PLAN §8.4 solved by fictitious play, for one `k` (players still to act
 * behind the pusher) and one effective stack `S` (big blinds). Pure arithmetic over a matrix of
 * class against class equities; `gen-pushfold.ts` samples the matrix and calls `solvePushFold`
 * for every (k, S).
 *
 * The game, no antes, blinds 0.5 and 1, every stack `S`:
 * - The pusher is all-in for `S` with `h`, or folds. The players behind act in turn: the first one
 *   to call plays the pusher heads-up for all the chips (the others fold: no overcalls) and the
 *   hand is played out (equity realised in full).
 * - Who is behind (positional callers, risk R16): with `k = 1` the pusher is the small blind and
 *   the big blind is the only caller. With `k ≥ 2` the pusher has posted nothing; behind him are
 *   `k − 2` players who have posted nothing, then the small blind (0.5 posted) and the big blind
 *   (1 posted), in that order.
 * - A caller who has posted `p` best-responds: call when `eq(c vs the pushing range) × pot − cost
 *   > 0`, with `cost = S − p` and `pot = 2S +` the blinds of the players who are not in the pot.
 *   The three kinds of caller (nothing posted, small blind, big blind) each have a strategy.
 * - The pusher best-responds: push when `EV(push) > 0`, where, relative to folding,
 *   `EV(push) = Pfold × 1.5 + Σ_i P(i calls first) × (eq(h vs i's calling range) × pot_i − risk)`,
 *   `risk = S −` the pusher's own blind. Each caller's chance to hold a calling hand is counted
 *   with the pusher's two cards removed: `c_i(h)` = the share of the 1,225 hands left that call,
 *   `Pfold = Π (1 − c_i(h))` and `P(i calls first) = Π_{j < i} (1 − c_j(h)) × c_i(h)` (the callers'
 *   hands are otherwise independent).
 *
 * Fictitious play: each side best-responds to the average of the other side's past best
 * responses. The pusher moves first (against "nobody calls" at the start, so it begins by pushing
 * everything), then each caller answers the updated average. After `iterations` rounds the average
 * strategies are the answer: `push[c]` and `call[c]` are the share of class `c`'s combos that
 * push and call. Everything is plain IEEE arithmetic in a fixed order, so the result is the same
 * on every machine.
 *
 * Why positional callers: the model first written in §8.4 made every caller a player with nothing
 * posted, `Pfold = (1 − callFreq)^k` with card removal ignored. Against the published no-ante
 * Nash chart it shoved 5.5 points too wide on the button (38.5% against 33.0% at 10 bb), whose
 * two callers are the blinds and call wider at their discount. This game, averaged over 3,000
 * rounds, is within 0.5 points of the chart on average and 1.9 at most at every position from 5
 * to 15 bb (PLAN §8.4, risk R16).
 */
import { COMBOS_TOTAL, RANGE_CLASSES, comboCount } from '../src/data/rangesLayout.ts';

/**
 * Fictitious-play rounds (PLAN §8.4). The plan first said 300; the average of 300 rounds was
 * still up to 6 points wide at 4 to 6 bb from early position, the average of 3,000 is not.
 */
export const ITERATIONS = 3000;

/** Dead money of the two blinds. */
export const BLINDS = 1.5;

/** The hands a caller can hold once the pusher's two cards are out: C(50, 2). */
export const HANDS_LEFT = 1225;

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

/** A player behind the pusher: what he has posted, what calling costs him and the pot he plays. */
export interface CallerSpot {
  /** Chips already in: 0, the small blind 0.5 or the big blind 1. */
  readonly posted: number;
  /** What a call puts in on top: `S − posted`. */
  readonly cost: number;
  /** The pot when he calls: both stacks plus the blinds of the players not in the pot. */
  readonly pot: number;
}

/** What one game is worth to each side: see the file header. */
export interface Game {
  /** The pusher's gain from everyone folding, relative to folding himself. */
  readonly gain: number;
  /** The pusher's own blind (0.5 as the small blind, else 0) and what a push adds to it. */
  readonly pusherPosted: number;
  readonly risk: number;
  /** The players behind, in the order they act. */
  readonly callers: readonly CallerSpot[];
}

function callerSpot(S: number, posted: number, pusherPosted: number): CallerSpot {
  return { posted, cost: S - posted, pot: 2 * S + (BLINDS - posted - pusherPosted) };
}

/** The game with `k` players behind and stacks of `S` big blinds. */
export function game(k: number, S: number): Game {
  if (!Number.isInteger(k) || k < 1) throw new RangeError(`k must be a positive integer: ${k}`);
  if (!(S >= 1)) throw new RangeError(`S must be at least 1: ${S}`);
  if (k === 1) {
    return { gain: BLINDS, pusherPosted: 0.5, risk: S - 0.5, callers: [callerSpot(S, 1, 0.5)] };
  }
  const callers: CallerSpot[] = [];
  for (let i = 0; i < k - 2; i++) callers.push(callerSpot(S, 0, 0));
  callers.push(callerSpot(S, 0.5, 0), callerSpot(S, 1, 0));
  return { gain: BLINDS, pusherPosted: 0, risk: S, callers };
}

export interface Solution {
  /** The share of each class's combos that push, averaged over the rounds. */
  readonly push: Float64Array;
  /** The same for the big blind's calls (the last player behind in every game). */
  readonly call: Float64Array;
  /** The pushing range and the big blind's calling range as a percent of all 1,326 combos. */
  readonly pushPct: number;
  readonly callPct: number;
  /** Each kind of caller in the game (by what it has posted) and its calling range in percent. */
  readonly callers: readonly { readonly posted: number; readonly callPct: number }[];
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
  const g = game(k, S);
  // One strategy per kind of caller (what he has posted); callers of one kind play alike.
  const kinds = [...new Set(g.callers.map((c) => c.posted))];
  const spotOf = kinds.map((p) => g.callers.find((c) => c.posted === p) as CallerSpot);
  const kindOf = g.callers.map((c) => kinds.indexOf(c.posted));
  const calls = kinds.map(() => new Float64Array(N));
  const push = new Float64Array(N);
  const callChance = new Float64Array(kinds.length);
  const callEquity = new Float64Array(kinds.length);
  const half = Math.floor(iterations / 2);
  let halfwayPushPct = 0;

  for (let t = 1; t <= iterations; t++) {
    // The pusher answers the calling ranges so far, his own two cards removed.
    for (let h = 0; h < N; h++) {
      const row = h * N;
      for (let j = 0; j < kinds.length; j++) {
        const call = calls[j] as Float64Array;
        let mass = 0;
        let sum = 0;
        for (let c = 0; c < N; c++) {
          const w = (call[c] as number) * (free[row + c] as number);
          mass += w;
          sum += w * (eq[row + c] as number);
        }
        callChance[j] = mass / HANDS_LEFT;
        callEquity[j] = mass > 0 ? sum / mass : 0.5;
      }
      let reach = 1;
      let ev = 0;
      for (let i = 0; i < kindOf.length; i++) {
        const j = kindOf[i] as number;
        const chance = callChance[j] as number;
        const spot = spotOf[j] as CallerSpot;
        ev += reach * chance * ((callEquity[j] as number) * spot.pot - g.risk);
        reach *= 1 - chance;
      }
      ev += reach * g.gain;
      const best = ev > 0 ? 1 : 0;
      push[h] = (push[h] as number) + (best - (push[h] as number)) / t;
    }
    if (t === half) halfwayPushPct = rangePct(push);
    // Each kind of caller answers the pushing range so far, this round included: one equity
    // against the pushing range, a different price for each kind.
    for (let h = 0; h < N; h++) {
      const row = h * N;
      let mass = 0;
      let sum = 0;
      for (let c = 0; c < N; c++) {
        const w = (push[c] as number) * (free[row + c] as number);
        mass += w;
        sum += w * (eq[row + c] as number);
      }
      const equity = mass > 0 ? sum / mass : 0;
      for (let j = 0; j < kinds.length; j++) {
        const call = calls[j] as Float64Array;
        const spot = spotOf[j] as CallerSpot;
        const best = mass > 0 && equity * spot.pot - spot.cost > 0 ? 1 : 0;
        call[h] = (call[h] as number) + (best - (call[h] as number)) / t;
      }
    }
  }
  const bigBlind = calls[kinds.indexOf(1)] as Float64Array;
  return {
    push,
    call: bigBlind,
    pushPct: rangePct(push),
    callPct: rangePct(bigBlind),
    callers: kinds.map((posted, j) => ({ posted, callPct: rangePct(calls[j] as Float64Array) })),
    halfwayPushPct,
  };
}
