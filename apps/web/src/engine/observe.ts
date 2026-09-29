/**
 * `observe(h, seat, extras)` — PLAN §4.8, the non-cheating boundary: the ONLY function in the
 * engine that is allowed to read another seat's hidden hole cards or the deck. It builds the
 * Observation (Appendix A.4), the sole object the brain (bots and the coach) ever sees. It never
 * contains the deck, `deckPos`, the seed, or an unrevealed hole card of another seat: everything
 * about other seats' hands comes only from `h.revealed`. §9.6 proves this with a property test
 * (permuting every other seat's unrevealed hole cards and the undealt stub leaves the observation
 * unchanged) run from `tests/engine/observe.test.ts`.
 *
 * `legal` describes the observed seat's own bounds, exactly as `legalActions(h)` would for the
 * seat to act: real bounds when it is this seat's turn to act (`h.phase === 'betting' &&
 * h.toAct === seat`), and the closed (nothing legal) shape otherwise — a different seat's turn, or
 * a phase with no betting at all (roundComplete, showdown, complete). `toCall` still reflects the
 * seat's own street bet against `h.currentBet`, since that is public information.
 */
import { EngineError } from '../core/assert.ts';
import { legalActions } from './legal.ts';
import type {
  HandState,
  LegalActions,
  LogEvent,
  Observation,
  ObserveExtras,
  PublicAction,
  SeatState,
} from './types.ts';

function closedLegal(h: HandState, seat: number): LegalActions {
  const s = h.seats[seat] as SeatState;
  const toCall = Math.max(0, h.currentBet - s.streetBet);
  return {
    seat,
    toCall,
    callAmount: Math.min(toCall, s.stack),
    callIsAllIn: toCall > 0 && s.stack <= toCall, // the same public facts as `legalActions`
    canFold: false,
    canCheck: false,
    canCall: false,
    bet: null,
    raise: null,
  };
}

/** The seat's own legal bounds (see the module comment): real only on this seat's own turn. */
function legalFor(h: HandState, seat: number): LegalActions {
  const real = legalActions(h);
  return real !== null && real.seat === seat ? real : closedLegal(h, seat);
}

/**
 * The public action history so far (Appendix A.4 `PublicAction[]`), built from `h.log`: blind
 * posts and every `act` event, each with the pot immediately before it (`potBefore`, tracked here
 * as a running total of `totalBet`: it grows with every post and act, and shrinks with a refund,
 * which is never shown as a `PublicAction` of its own). `street`, `refund` and `reshuffle`
 * events carry no public action and are skipped; `award` only ever follows the last one.
 */
function buildHistory(log: readonly LogEvent[]): PublicAction[] {
  const history: PublicAction[] = [];
  let pot = 0;
  for (const ev of log) {
    if (ev.e === 'post') {
      history.push({
        seat: ev.seat,
        street: 'preflop',
        type: ev.blind === 'sb' ? 'postSB' : 'postBB',
        to: null,
        amountIn: ev.amount,
        allIn: ev.allIn,
        full: false,
        potBefore: pot,
      });
      pot += ev.amount;
    } else if (ev.e === 'act') {
      history.push({
        seat: ev.seat,
        street: ev.street,
        type: ev.action.type,
        to: ev.action.type === 'bet' || ev.action.type === 'raise' ? ev.action.to : null,
        amountIn: ev.amountIn,
        allIn: ev.allIn,
        full: ev.full,
        potBefore: pot,
      });
      pot += ev.amountIn;
    } else if (ev.e === 'refund') {
      pot -= ev.amount;
    }
    // 'street', 'reveal', 'reshuffle' and 'award' carry no PublicAction and do not move `pot`
    // (an 'award' only ever comes after every action has already been recorded).
  }
  return history;
}

/**
 * Builds `seat`'s observation of `h` (§4.8). Throws `EngineError('ILLEGAL_ACTION')` for a seat
 * index out of range or a seat that was never dealt into this hand (the brain is never asked to
 * decide for such a seat, so this is a caller bug, not a game situation).
 */
export function observe(h: HandState, seat: number, extras: ObserveExtras): Observation {
  const n = h.seats.length;
  if (!Number.isInteger(seat) || seat < 0 || seat >= n) {
    throw new EngineError('ILLEGAL_ACTION', `observe: seat ${String(seat)} does not exist`);
  }
  const self = h.seats[seat] as SeatState;
  if (self.hole === null) {
    throw new EngineError('ILLEGAL_ACTION', `observe: seat ${seat} was not dealt into this hand`);
  }
  return {
    seat,
    hole: [...self.hole],
    board: h.board.slice(),
    street: h.street,
    handSeq: h.handSeq,
    sb: h.sb,
    bb: h.bb,
    button: h.button,
    sbSeat: h.sbSeat,
    bbSeat: h.bbSeat,
    pot: h.seats.reduce((a, s) => a + s.totalBet, 0),
    legal: legalFor(h, seat),
    stacks: h.seats.map((s) => s.stack),
    streetBets: h.seats.map((s) => s.streetBet),
    totalBets: h.seats.map((s) => s.totalBet),
    dealtIn: h.seats.map((s) => s.dealtIn),
    folded: h.seats.map((s) => s.folded),
    allIn: h.seats.map((s) => s.allIn),
    history: buildHistory(h.log),
    revealedHoles: h.seats.map((s, i) =>
      h.revealed.includes(i) ? [...(s.hole as [number, number])] : null,
    ) as Observation['revealedHoles'],
    seatStats: extras.seatStats.slice(),
    visiblePersonality: extras.visiblePersonality.slice(),
    seatLevels: extras.seatLevels.slice(),
  };
}
