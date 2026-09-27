/**
 * The reducer (PLAN §4.1–§4.3). `step(h, input)` is pure: it deep-clones `h`, applies the input to
 * the clone, runs `checkInvariants` and returns the clone, so the caller's state is never touched
 * (not even when the input is refused). An illegal input throws `EngineError` (§4.5):
 * - `BAD_PHASE`: the input does not fit the phase (an action outside 'betting', `advance` while
 *   betting or after the hand, a reshuffle after a reveal);
 * - `NOT_YOUR_TURN`: an action for a seat other than `toAct`;
 * - `ILLEGAL_ACTION`: a malformed input or an action the seat may not take now (§3.5), e.g. a
 *   fold when checking is free (B32);
 * - `BAD_AMOUNT`: a bet or raise outside the `legalActions` bounds, or a bad undo counter;
 * - `UNDO_USED`: a second reshuffle for the same decision (§11.3).
 *
 * ⚠️ New cards appear only on `advance` (Known pitfall 23): the action that closes a betting round
 * only moves the hand to 'roundComplete'; the controller decides when the next street comes.
 */
import { EngineError } from '../core/assert.ts';
import { deriveSeed, rngFromSeed, shuffleRange } from '../core/rng.ts';
import { cloneHand, deepFreeze } from './clone.ts';
import { checkInvariants } from './invariants.ts';
import { legalActions } from './legal.ts';
import { firstToAct, isActive, isLive, nextSeat, put, roundComplete } from './rules.ts';
import { refundUncalled, settle } from './settle.ts';
import {
  STREETS,
  type EngineInput,
  type HandState,
  type LegalActions,
  type PlayerAction,
  type SeatState,
  type Street,
} from './types.ts';

/**
 * Deep-freeze returned states in development builds (Vite dev and the tests), so an accidental
 * mutation by the caller throws (§4.2). Production builds skip it; so does plain Node (the
 * scripts), where `import.meta.env` does not exist.
 */
const FREEZE_OUTPUT = import.meta.env?.DEV === true;

/** Applies one input (§4.3) to a copy of `h` and returns the copy. Never changes `h`. */
export function step(h: HandState, input: EngineInput): HandState {
  const next = cloneHand(h);
  const inp = input as Partial<Record<string, unknown>> | null;
  if (typeof inp !== 'object' || inp === null) illegal('the input must be an object');
  switch (inp.kind) {
    case 'act':
      applyAct(next, inp.seat, inp.action);
      break;
    case 'advance':
      advance(next);
      break;
    case 'reshuffle':
      reshuffle(next, inp.decisionId, inp.undoIndex);
      break;
    default:
      illegal(`unknown input kind ${String(inp.kind)}`);
  }
  checkInvariants(next);
  return FREEZE_OUTPUT ? deepFreeze(next) : next;
}

// ---------------------------------------------------------------------------------------------
// act

/**
 * §4.3 `applyAct`: the seat to act folds, checks, calls, bets or raises ("to" amounts). A bet or
 * raise of at least `minRaiseInc` over the current bet is a full raise and sets the new minimum
 * increment (and, preflop, the preflop aggressor); a smaller one (only possible all-in) is
 * incomplete and leaves `minRaiseInc` as it is (§3.6). Either way it sets `currentBet` and the
 * last aggressor. Every action but a fold records the bet level the seat acted at
 * (`lastActedAtBet`), which is what `raiseReopened` measures from.
 * Then, if one seat is left or the round is over (§3.7), the uncalled chips go back (§3.8) and
 * the phase becomes 'roundComplete'; otherwise the turn passes clockwise to the next seat that
 * still has to act.
 */
function applyAct(h: HandState, seat: unknown, action: unknown): void {
  if (h.phase !== 'betting') {
    throw new EngineError('BAD_PHASE', `no action is expected in the ${h.phase} phase`);
  }
  const toAct = h.toAct as number;
  if (seat !== toAct) {
    throw new EngineError('NOT_YOUR_TURN', `seat ${String(seat)} acted, seat ${toAct} is to act`);
  }
  const legal = legalActions(h) as LegalActions;
  const a = checkedAction(action, legal);
  const p = h.seats[toAct] as SeatState;
  let amountIn = 0;
  let full = false;
  switch (a.type) {
    case 'fold':
      p.folded = true;
      break;
    case 'check':
      break;
    case 'call':
      amountIn = put(p, legal.callAmount);
      break;
    default: {
      const before = h.currentBet;
      amountIn = put(p, a.to - p.streetBet);
      const inc = a.to - before;
      full = inc >= h.minRaiseInc;
      if (full) {
        h.minRaiseInc = inc;
        if (h.street === 'preflop') h.preflopAggressor = toAct;
      }
      h.currentBet = a.to;
      h.lastAggressor = toAct;
    }
  }
  if (a.type !== 'fold') p.lastActedAtBet = h.currentBet;
  h.log.push({
    e: 'act',
    seat: toAct,
    street: h.street,
    action: a,
    amountIn,
    allIn: p.allIn,
    full,
  });

  if (h.seats.filter(isLive).length === 1 || roundComplete(h)) {
    refundUncalled(h);
    h.phase = 'roundComplete';
    h.toAct = null;
  } else {
    h.toAct = nextSeat(h.seats.length, toAct, (i) => stillToAct(h, h.seats[i] as SeatState));
  }
}

/** Live, not all-in, and not (already acted at this bet level and matched it) (§4.3). */
function stillToAct(h: HandState, s: SeatState): boolean {
  return isActive(s) && !(s.lastActedAtBet !== null && s.streetBet === h.currentBet);
}

/**
 * The action as a fresh object (the log never shares objects with the caller's input), after
 * checking it against the legal actions: the type must be allowed now (`ILLEGAL_ACTION`) and a
 * bet or raise must be a whole "to" amount inside the bounds (`BAD_AMOUNT`).
 */
function checkedAction(action: unknown, legal: LegalActions): PlayerAction {
  const a = action as Partial<Record<string, unknown>> | null;
  if (typeof a !== 'object' || a === null) illegal('the action must be an object');
  switch (a.type) {
    case 'fold':
      if (!legal.canFold) illegal('folding when checking is free is not allowed (§3.5)');
      return { type: 'fold' };
    case 'check':
      if (!legal.canCheck) illegal(`cannot check facing a bet (${legal.toCall} to call)`);
      return { type: 'check' };
    case 'call':
      if (!legal.canCall) illegal('there is nothing to call');
      return { type: 'call' };
    case 'bet':
    case 'raise': {
      const type = a.type;
      const bounds = legal[type];
      if (bounds === null) illegal(`a ${type} is not allowed now`);
      const to = a.to;
      if (
        typeof to !== 'number' ||
        !Number.isSafeInteger(to) ||
        to < bounds.min ||
        to > bounds.max
      ) {
        throw new EngineError(
          'BAD_AMOUNT',
          `${type} to must be a whole number from ${bounds.min} to ${bounds.max}, got ${String(to)}`,
        );
      }
      return { type, to };
    }
    default:
      illegal(`unknown action ${String(a.type)}`);
  }
}

// ---------------------------------------------------------------------------------------------
// advance

/**
 * §4.3 `advance`, from 'roundComplete' or 'showdown':
 * - after the showdown, or with one live seat left (a hand won by folds), settle → 'complete';
 * - if at most one live seat can still bet, the run-out starts: every live hand turns face up
 *   now, once (TDA r.16), in the §3.9 order;
 * - after the river: 'showdown' (the live hands turn face up now, unless a run-out already
 *   showed them; an all-in called on the river is a run-out that starts on the river);
 * - otherwise the next street: reset the street's bets, burn one card, deal, and either bet
 *   (two or more seats can act; the first active seat after the button starts) or stay in
 *   'roundComplete' so the run-out deals one street per `advance`.
 */
function advance(h: HandState): void {
  if (h.phase !== 'roundComplete' && h.phase !== 'showdown') {
    throw new EngineError('BAD_PHASE', `advance is not expected in the ${h.phase} phase`);
  }
  if (h.phase === 'showdown' || h.seats.filter(isLive).length === 1) {
    settle(h);
    return;
  }
  const canBet = (): number => h.seats.filter(isActive).length;
  if (canBet() <= 1 && !h.runout) {
    h.runout = true;
    reveal(h, 'runout');
  }
  if (h.street === 'river') {
    h.phase = 'showdown';
    if (!h.runout) reveal(h, 'showdown');
    return;
  }
  dealNextStreet(h);
  if (canBet() >= 2) {
    h.phase = 'betting';
    h.toAct = firstToAct(h);
  } else {
    h.phase = 'roundComplete';
  }
}

/** §4.3 "next street": reset the street fields, burn one card, deal the flop (3) or one card. */
function dealNextStreet(h: HandState): void {
  for (const s of h.seats) {
    s.streetBet = 0;
    s.lastActedAtBet = null;
  }
  h.currentBet = 0;
  h.minRaiseInc = h.bb;
  h.lastAggressor = null;
  const street = STREETS[STREETS.indexOf(h.street) + 1] as Street;
  const from = h.deckPos + 1; // the burn card is skipped
  const cards = h.deck.slice(from, from + (street === 'flop' ? 3 : 1));
  h.board.push(...cards);
  h.deckPos = from + cards.length;
  h.street = street;
  h.log.push({ e: 'street', street, cards });
}

/** Turns the live hands face up in the §3.9 order and logs it (at most once per hand). */
function reveal(h: HandState, reason: 'runout' | 'showdown'): void {
  h.revealed = showdownOrder(h);
  h.log.push({ e: 'reveal', seats: [...h.revealed], reason });
}

/**
 * §3.9 (TDA r.17): if there was a bet or raise on the river, the river's last aggressor shows
 * first; otherwise the first live seat left of the button; then the other live seats clockwise.
 * (The last aggressor is always live here: only a later raise could make it fold, and that raise
 * would make its raiser the last aggressor.)
 */
function showdownOrder(h: HandState): number[] {
  const n = h.seats.length;
  const live = (seat: number): boolean => isLive(h.seats[seat] as SeatState);
  const first =
    h.street === 'river' && h.lastAggressor !== null
      ? h.lastAggressor
      : (nextSeat(n, h.button, live) as number);
  const order: number[] = [];
  for (let d = 0; d < n; d++) {
    const seat = (first + d) % n;
    if (live(seat)) order.push(seat);
  }
  return order;
}

// ---------------------------------------------------------------------------------------------
// reshuffle (undo only, §11.3)

/**
 * §4.3 `reshuffle`: after an undo the controller reshuffles the cards not dealt yet
 * (`deck[deckPos..51]`) with the `deriveSeed(seed, 'undo', decisionId, undoIndex)` stream, so the
 * undone decision cannot be replayed against known cards. Hole cards and the board never change.
 * Only while betting or between streets, before any hand is face up, and once per decision.
 */
function reshuffle(h: HandState, decisionId: unknown, undoIndex: unknown): void {
  const isCounter = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0;
  if (!isCounter(decisionId) || !isCounter(undoIndex)) {
    throw new EngineError('BAD_AMOUNT', 'decisionId and undoIndex must be whole numbers ≥ 0');
  }
  if (h.phase !== 'betting' && h.phase !== 'roundComplete') {
    throw new EngineError('BAD_PHASE', `no reshuffle in the ${h.phase} phase`);
  }
  if (h.revealed.length > 0) throw new EngineError('BAD_PHASE', 'no reshuffle after a reveal');
  if (h.undoneDecisions.includes(decisionId)) {
    throw new EngineError('UNDO_USED', `decision ${decisionId} was already undone`);
  }
  const rng = rngFromSeed(deriveSeed(h.seed, 'undo', decisionId, undoIndex));
  shuffleRange(h.deck, h.deckPos, h.deck.length - 1, rng);
  h.undoneDecisions.push(decisionId);
  h.log.push({ e: 'reshuffle', decisionId, undoIndex });
}

// ---------------------------------------------------------------------------------------------
// helpers

function illegal(detail: string): never {
  throw new EngineError('ILLEGAL_ACTION', detail);
}
