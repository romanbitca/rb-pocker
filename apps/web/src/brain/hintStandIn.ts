/**
 * The stand-in coach hint (PLAN §18 Stage 5, chunk 5.9): what the coach strip shows until chunk 5.7
 * adds the real `hint(obs, eRandom)` (Appendix A.5, `brain/decide.ts`) behind `brain.worker`. It
 * has the signature of `hint` and returns a full `Decision` with reason codes (§8.10), so the coach
 * UI is built and tested against the real shapes; 5.7 swaps the source in `app/coachJobs.ts`
 * (`standInHints`), then deletes this file and its test.
 *
 * It is a plain pot-odds coach, honest but simple: it never computes a win chance (no Monte Carlo
 * on the main thread, §15.3), so it needs the HUD's number (`eRandom`) and uses it for both
 * equities (`eRange = eRandom`: no RANGE_ADJUST). Facing a bet it calls when the win chance covers
 * the price (`need`, §0.3 with the capped `winPot`), raises with a big edge and folds otherwise;
 * with nothing to call it bets half the pot after the flop with a Strong hand (§8.2 bucket of the
 * per-opponent strength `p`), checks a Medium one (pot control), else checks. Like
 * the real thing it sees an `Observation` only (§4.8). It stays small: the main bundle carries it
 * (no range tables, no equity code).
 */
import { rankOf } from '../core/cards.ts';
import type { LegalActions, Observation, PlayerAction } from '../engine/types.ts';
import { describe } from '../eval/describe.ts';
import { BUCKET_MEDIUM, BUCKET_MONSTER, BUCKET_STRONG } from './tunables.ts';
import type { Bucket, Decision, Reason, ReasonCode } from './types.ts';

/** Raise a bet when the win chance beats `need` by this much (postflop). */
export const STAND_IN_RAISE_EDGE = 0.3;
/** A call or fold this close to the price is a close spot (§8.10 CLOSE_SPOT). */
export const STAND_IN_CLOSE = 0.03;
/** Below this gap the decision is not a clear one. */
export const STAND_IN_CLEAR = 0.1;
/** Pocket pairs up to this rank (0 = Two, 6 = Eight) are "small" (F.1 SET_MINING). */
export const SMALL_PAIR = 6;

const reason = (code: ReasonCode, data: Reason['data'] = {}): Reason => ({ code, data });

/** Live opponents of the observer: dealt in and not folded. */
function liveOpponents(obs: Observation): number {
  let n = 0;
  obs.dealtIn.forEach((dealt, seat) => {
    if (dealt && seat !== obs.seat && obs.folded[seat] !== true) n++;
  });
  return n;
}

/**
 * §0.3 pot the observer can win after calling `call` chips: its own chips in, plus from every other
 * dealt-in seat at most what the observer will have put in.
 */
export function winPotOf(obs: Observation, call: number): number {
  const mine = obs.totalBets[obs.seat] ?? 0;
  const cap = mine + call;
  return obs.totalBets.reduce(
    (sum, bet, seat) =>
      seat !== obs.seat && obs.dealtIn[seat] === true ? sum + Math.min(bet, cap) : sum,
    mine,
  );
}

/** §0.3 `need = toCall / (winPot + toCall)`; 0 when there is nothing to call. */
export function needOf(obs: Observation): number {
  const call = obs.legal.callAmount;
  return call === 0 ? 0 : call / (winPotOf(obs, call) + call);
}

const snap = (x: number, sb: number): number => Math.round(x / sb) * sb;
const clamp = (to: number, b: { min: number; max: number }): number =>
  Math.min(b.max, Math.max(b.min, to));

/** The §8.10 strength label from the per-opponent strength `p` (meter segments, lower bounds inclusive). */
export function strengthOf(p: number): Decision['strength'] {
  if (p >= BUCKET_MONSTER) return 'monster';
  if (p >= BUCKET_STRONG) return 'strong';
  if (p >= BUCKET_MEDIUM) return 'decent';
  return p >= 0.35 ? 'marginal' : 'weak';
}

function bucketOf(p: number, street: Observation['street']): Bucket | null {
  if (street === 'preflop') return null;
  if (p >= BUCKET_MONSTER) return 'monster';
  if (p >= BUCKET_STRONG) return 'strong';
  return p >= BUCKET_MEDIUM ? 'medium' : 'air';
}

const isAllIn = (legal: LegalActions, action: PlayerAction): boolean =>
  (action.type === 'bet' && legal.bet !== null && action.to === legal.bet.max) ||
  (action.type === 'raise' && legal.raise !== null && action.to === legal.raise.max);

/**
 * The stand-in for `hint(obs, eRandom)` (A.5). `eRandom` is the HUD's win chance for this
 * situation (0..1), which the stand-in cannot compute itself.
 */
export function standInHint(obs: Observation, eRandom: number): Decision {
  const { legal, street, sb } = obs;
  const E = eRandom;
  const need = needOf(obs);
  const nOpp = Math.max(1, liveOpponents(obs));
  const p = E ** (1 / nOpp);
  const info = describe(obs.hole, obs.board);
  const trace: Reason[] = [];
  let action: PlayerAction;
  let alt: PlayerAction | null = null;
  let gap: number;

  if (legal.canCheck) {
    // Before the flop the stand-in only checks its option: opens need the §8.3 ranges (5.3).
    // After it, the §8.2 buckets of `p` pick the line, so the words agree with the strength meter.
    const bet = street === 'preflop' ? null : legal.bet;
    if (p >= BUCKET_STRONG && bet !== null) {
      const to = clamp(snap(obs.pot / 2, sb), bet);
      action = { type: 'bet', to };
      trace.push(
        reason('VALUE_BET', {
          handName: info.name,
          category: info.category,
          size: to,
          sizeBB: to / obs.bb,
        }),
        reason('WHY_NOT_CHECK'),
      );
      gap = p - BUCKET_STRONG;
    } else {
      action = { type: 'check' };
      if (street !== 'preflop' && p >= BUCKET_MEDIUM) {
        trace.push(reason('POT_CONTROL', { handName: info.name }));
      } else {
        trace.push(
          reason(street === 'preflop' || street === 'river' ? 'CHECK_FREE' : 'CHECK_WEAK'),
        );
      }
      if (bet !== null) trace.push(reason('WHY_NOT_BET'));
      gap = 1;
    }
  } else if (E >= need) {
    gap = E - need;
    const raise = legal.raise;
    if (raise !== null && E >= Math.min(0.95, need + STAND_IN_RAISE_EDGE) && street !== 'preflop') {
      // §8.7: raise fraction f → to = currentBet + f × (pot + toCall); the stand-in uses f = 3/4.
      const currentBet = Math.max(...obs.streetBets);
      const to = clamp(snap(currentBet + 0.75 * (obs.pot + legal.toCall), sb), raise);
      action = { type: 'raise', to };
      trace.push(reason('VALUE_RAISE', { size: to, sizeBB: to / obs.bb }));
    } else {
      action = { type: 'call' };
      // A small pocket pair before the flop calls to hit a set (F.1 SET_MINING).
      const pair = rankOf(obs.hole[0]) === rankOf(obs.hole[1]);
      const setMining = street === 'preflop' && pair && rankOf(obs.hole[0]) <= SMALL_PAIR;
      trace.push(
        setMining
          ? reason('SET_MINING')
          : reason('CALL_PROFITABLE', {
              E,
              need,
              toCall: legal.callAmount,
              pot: winPotOf(obs, legal.callAmount),
            }),
        reason('WHY_NOT_FOLD'),
      );
      if (gap < STAND_IN_CLOSE) alt = { type: 'fold' };
    }
  } else {
    gap = need - E;
    action = { type: 'fold' };
    trace.push(reason('FOLD_PRICE', { E, need }), reason('WHY_NOT_CALL', { E, need }));
    if (gap < STAND_IN_CLOSE) alt = { type: 'call' };
  }
  if (alt !== null) trace.push(reason('CLOSE_SPOT', {}));

  return {
    action,
    kind: isAllIn(legal, action) ? 'allin' : action.type,
    ev: {},
    eRandom: E,
    eRange: E,
    need,
    bucket: bucketOf(p, street),
    strength: strengthOf(p),
    confidence: alt !== null ? 'close' : gap >= STAND_IN_CLEAR ? 'clear' : 'normal',
    alt,
    trace,
  };
}
