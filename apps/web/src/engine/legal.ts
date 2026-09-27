/**
 * Legal actions (PLAN §3.5, §3.6): what the seat to act may do, with exact "raise to" bounds.
 * The reducer accepts an action only inside these bounds; the UI and the bots read them and never
 * compute `currentBet + x` themselves (Known pitfall 1).
 */
import { isActive } from './rules.ts';
import type { HandState, LegalActions, SeatState } from './types.ts';

/**
 * §3.5 `raiseReopened(p)`: the seat has not acted yet this street, or the bet has grown by at
 * least a full raise since it last acted. One short all-in, or several that together stay below
 * a full raise, do not reopen the betting for a seat that already acted (TDA r.47; B6, B37);
 * several that add up to a full raise do (B8), because this measures from the level where the
 * seat last acted.
 */
export function raiseReopened(h: HandState, p: SeatState): boolean {
  return p.lastActedAtBet === null || h.currentBet - p.lastActedAtBet >= h.minRaiseInc;
}

/**
 * The seat to act and its options (§3.5); null unless the phase is 'betting'. Every amount in
 * `bet` and `raise` is a "to" amount (the seat's street total after the action):
 * - fold only when there is something to call (folding when a check is free is illegal), check
 *   only when there is nothing to call, call puts in `min(toCall, stack)` (less is all-in);
 * - bet (postflop, nobody has bet yet): `to ∈ [min(bb, stack), stack]`, so an all-in below the
 *   big blind is a legal (incomplete) bet (B37);
 * - raise: the seat has more than the call, the betting is open to it (`raiseReopened`) and
 *   `to ∈ [min(currentBet + minRaiseInc, streetBet + stack), streetBet + stack]`: all-in only
 *   when the stack cannot make a full raise (B38).
 * A bet or raise needs a responder: another dealt-in seat that is neither folded nor all-in
 * (B35).
 */
export function legalActions(h: HandState): LegalActions | null {
  if (h.phase !== 'betting' || h.toAct === null) return null;
  const seat = h.toAct;
  const p = h.seats[seat] as SeatState;
  const toCall = h.currentBet - p.streetBet;
  const allInTo = p.streetBet + p.stack;
  const responder = h.seats.some((s, i) => i !== seat && isActive(s));
  const canBet = h.currentBet === 0 && responder;
  const canRaise = h.currentBet > 0 && p.stack > toCall && raiseReopened(h, p) && responder;
  return {
    seat,
    toCall,
    callAmount: Math.min(toCall, p.stack),
    callIsAllIn: toCall > 0 && p.stack <= toCall,
    canFold: toCall > 0,
    canCheck: toCall === 0,
    canCall: toCall > 0,
    bet: canBet ? { min: Math.min(h.bb, allInTo), max: allInTo } : null,
    raise: canRaise ? { min: Math.min(h.currentBet + h.minRaiseInc, allInTo), max: allInTo } : null,
  };
}
