/**
 * The decision features (PLAN §8.2): everything the policies (§8.3–8.5), the guardrails (§8.8) and
 * the EV model (§8.9) read about a decision, computed from the `Observation` alone.
 *
 * `eRandom` is the HUD number (§7): the coach takes the controller's value when it has one, else
 * computes it here with the identical deterministic function (preflop table, else `equity()`), so
 * the coach's text and the HUD agree (C9). Bots never compute it: for a bot profile
 * `eRandom = eRange`.
 */
import { equity } from '../analysis/equity.ts';
import { findDraws, findOuts } from '../analysis/handinfo.ts';
import { preflopEquity } from '../analysis/preflop.ts';
import { classOf } from '../core/cards.ts';
import { deriveSeed, ZERO_SEED, type Seed128 } from '../core/rng.ts';
import { observationKey } from '../engine/types.ts';
import type { Observation, Street } from '../engine/types.ts';
import { describe } from '../eval/describe.ts';
import {
  liveOpponents,
  opponentRanges,
  preflopOrder,
  RANGE_TABLES,
  rangeEquity,
  type RangeTables,
} from './ranges.ts';
import {
  BUCKET_MEDIUM,
  BUCKET_MONSTER,
  BUCKET_STRONG,
  DRAW_MIN_OUTS,
  RANGE_ADJUST_GAP,
  TEXTURE_MAX_CONNECTED,
  TEXTURE_MAX_GAP,
  TEXTURE_VERY_WET,
  TEXTURE_WET,
} from './tunables.ts';
import type { BrainProfile, Bucket, Facing, Features, Position, Texture } from './types.ts';

/** `BrainProfile.id` of the coach (Appendix A.5 `COACH`). */
export const COACH_ID = 'coach';

/** §2.4: the coach's Monte Carlo seed, `deriveSeed(ZERO_SEED, 'coach|' + observationKey)`. */
export function coachSeed(obs: Observation): Seed128 {
  return deriveSeed(ZERO_SEED, `coach|${observationKey(obs)}`);
}

/**
 * The HUD win chance of the observer (§7.2): the preflop table before the flop, else `equity()`
 * against the live opponents' random hands (exact or the seeded Monte Carlo). 1 with nobody left.
 */
export function hudEquity(obs: Observation): number {
  const nOpp = liveOpponents(obs).length;
  if (nOpp === 0) return 1;
  if (obs.board.length === 0) return preflopEquity(obs.hole, nOpp).equity;
  return equity({ hero: obs.hole, board: obs.board, nOpp }).equity;
}

/** §8.2 bucket from the per-opponent strength `p` (null preflop). */
export function bucketOf(p: number, outs: number, street: Street): Bucket | null {
  if (street === 'preflop') return null;
  if (p >= BUCKET_MONSTER) return 'monster';
  if (p >= BUCKET_STRONG) return 'strong';
  if (p >= BUCKET_MEDIUM) return 'medium';
  return street !== 'river' && outs >= DRAW_MIN_OUTS ? 'draw' : 'air';
}

/**
 * §8.2 texture score `W = [2 of one suit: +1] + [≥ 3 of one suit: +2] + min(#adjacent sorted
 * distinct board ranks with gap ≤ 2, 2) − [board paired: 1]` (the suit term counts the largest
 * suit once). Dry `W ≤ 1`, Wet `W == 2`, Very wet `W ≥ 3`; null preflop.
 */
export function textureOf(board: readonly number[]): Texture | null {
  if (board.length === 0) return null;
  return textureOfScore(textureScore(board));
}

export function textureScore(board: readonly number[]): number {
  const suits = [0, 0, 0, 0];
  for (const c of board) suits[c & 3] = (suits[c & 3] as number) + 1;
  const most = Math.max(...suits);
  let w = most >= 3 ? 2 : most === 2 ? 1 : 0;
  const ranks = [...new Set(board.map((c) => c >> 2))].sort((a, b) => a - b);
  let connected = 0;
  for (let i = 0; i + 1 < ranks.length; i++) {
    if ((ranks[i + 1] as number) - (ranks[i] as number) <= TEXTURE_MAX_GAP) connected++;
  }
  w += Math.min(connected, TEXTURE_MAX_CONNECTED);
  if (ranks.length < board.length) w -= 1;
  return w;
}

function textureOfScore(w: number): Texture {
  return w >= TEXTURE_VERY_WET ? 'veryWet' : w === TEXTURE_WET ? 'wet' : 'dry';
}

/** §8.2 `facing`: what the hero faces on this street. */
export function facingOf(obs: Observation): Facing {
  const raises = obs.history.filter(
    (a) => a.street === obs.street && (a.type === 'bet' || a.type === 'raise'),
  );
  const last = raises[raises.length - 1];
  if (last !== undefined && last.allIn && obs.legal.toCall > 0) return 'allin';
  if (obs.street === 'preflop') {
    if (raises.length === 0) {
      return obs.history.some((a) => a.street === 'preflop' && a.type === 'call')
        ? 'limpers'
        : 'none';
    }
    return raises.length === 1 ? 'open' : raises.length === 2 ? '3bet' : '4bet+';
  }
  return raises.length === 0 ? 'none' : raises.length === 1 ? 'bet' : 'raise';
}

/**
 * §8.10 RANGE_ADJUST: both equities are shown when they differ by at least 5 points, or when
 * `need` lies strictly between the two rounded percentages.
 */
export function showsRangeAdjust(eRandom: number, eRange: number, need: number): boolean {
  if (Math.abs(eRange - eRandom) >= RANGE_ADJUST_GAP - 1e-9) return true;
  const a = Math.round(eRandom * 100);
  const b = Math.round(eRange * 100);
  const n = need * 100;
  return Math.min(a, b) < n && n < Math.max(a, b);
}

/** A seat's chips at the start of this street: what is behind plus this street's bet. */
const chipsOf = (obs: Observation, seat: number): number =>
  (obs.stacks[seat] as number) + (obs.streetBets[seat] as number);

/** Is the observer last to act after the flop among the players who can still act? */
function positionOf(obs: Observation): Position {
  const n = obs.dealtIn.length;
  let last = -1;
  for (let d = 1; d <= n; d++) {
    const seat = (obs.button + d) % n;
    const canAct = obs.dealtIn[seat] === true && !obs.folded[seat] && !obs.allIn[seat];
    if (seat === obs.seat || canAct) last = seat;
  }
  return last === obs.seat ? 'IP' : 'OOP';
}

/** Preflop `k`: players after the observer in preflop order who can still act. */
function playersBehind(obs: Observation): number {
  const order = preflopOrder(obs);
  return order.slice(order.indexOf(obs.seat) + 1).filter((s) => !obs.folded[s] && !obs.allIn[s])
    .length;
}

/**
 * All §8.2 features of `obs` for `profile`: `eRange` from `profile.rangeModel` with
 * `profile.mcTrials` trials seeded by `seed` (the coach passes `coachSeed(obs)`, a bot its
 * decision seed); `eRandom` as described in the header.
 */
export function features(
  obs: Observation,
  profile: BrainProfile,
  seed: Seed128,
  eRandom: number | null = null,
  tables: RangeTables = RANGE_TABLES,
): Features {
  const hero = obs.seat;
  const { hole, board, street } = obs;
  const pot = obs.pot;
  const toCall = obs.legal.callAmount;
  const heroTotal = obs.totalBets[hero] as number;
  const capped = heroTotal + toCall;
  let winPot = heroTotal;
  for (let s = 0; s < obs.dealtIn.length; s++) {
    if (s !== hero && obs.dealtIn[s] === true) {
      winPot += Math.min(obs.totalBets[s] as number, capped);
    }
  }
  const need = toCall > 0 ? toCall / (winPot + toCall) : 0;

  const opponents = liveOpponents(obs);
  const nOpp = opponents.length;
  const effStack = Math.min(
    chipsOf(obs, hero),
    Math.max(0, ...opponents.map((s) => chipsOf(obs, s))),
  );
  const potStart =
    street === 'preflop'
      ? obs.history.reduce(
          (sum, a) => sum + (a.type === 'postSB' || a.type === 'postBB' ? a.amountIn : 0),
          0,
        )
      : pot - obs.streetBets.reduce((sum, b) => sum + b, 0);

  const ranges = opponentRanges(obs, profile.rangeModel, tables);
  const eRange =
    nOpp === 0
      ? 1
      : rangeEquity({
          hole,
          board,
          ranges: ranges.map((r) => r.weights),
          trials: profile.mcTrials,
          seed,
        });
  const shown = eRandom ?? (profile.id === COACH_ID ? hudEquity(obs) : eRange);
  const p = nOpp === 0 ? 1 : eRange ** (1 / nOpp);
  const drawStreet = street === 'flop' || street === 'turn';
  const outs = drawStreet ? findOuts(hole, board).length : 0;
  const lastFull = obs.history.filter(
    (a) => a.street === 'preflop' && (a.type === 'bet' || a.type === 'raise') && a.full,
  );

  return {
    street,
    pot,
    toCall,
    winPot,
    need,
    effStack,
    effBB: effStack / obs.bb,
    spr: effStack / potStart,
    k: street === 'preflop' ? playersBehind(obs) : 0,
    position: positionOf(obs),
    nOpp,
    eRandom: shown,
    eRange,
    p,
    bucket: bucketOf(p, outs, street),
    texture: textureOf(board),
    facing: facingOf(obs),
    wasPreflopAggressor: lastFull[lastFull.length - 1]?.seat === hero,
    handInfo: describe(hole, board),
    draws: drawStreet ? findDraws(hole, board) : [],
    outs,
    rankPct: tables.rankPctOfClass(classOf(hole[0], hole[1])),
    rangeAdjust: showsRangeAdjust(shown, eRange, need),
    ranges,
  };
}
