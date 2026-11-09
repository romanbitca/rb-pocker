/**
 * `publicHand(h, viewer)` (PLAN §19.4, §19.9): a hand as one player may see it, the only hand a
 * multiplayer message may carry (L1). Besides `observe` (§4.8) it is the one function that reads
 * hole cards for someone outside the engine. It copies a closed list of fields, so the deck, the
 * deck position and the seed never reach the result. A seat's `hole` is copied only for `viewer`
 * and for the seats in `h.revealed`; `viewer` null sees only those. `log` and `result` hold nothing
 * hidden (§A.3: the log is public, `result.shown` lists only revealed seats).
 *
 * `tests/engine/project.test.ts` proves it the way §9.6 proves `observe`: permuting every other
 * seat's unrevealed cards and the undealt stub leaves the result deep-equal.
 */
import { cloneEvent, cloneResult } from './clone.ts';
import type { HandState, PublicHand, PublicSeat, SeatState } from './types.ts';

function publicSeat(s: SeatState, visible: boolean): PublicSeat {
  return {
    dealtIn: s.dealtIn,
    stack: s.stack,
    hole: visible && s.hole !== null ? [...s.hole] : null,
    folded: s.folded,
    allIn: s.allIn,
    streetBet: s.streetBet,
    totalBet: s.totalBet,
  };
}

/** What `viewer` (a seat, or null for nobody seated) may see of `h`. Shares nothing with `h`. */
export function publicHand(h: HandState, viewer: number | null): PublicHand {
  return {
    handSeq: h.handSeq,
    sb: h.sb,
    bb: h.bb,
    seats: h.seats.map((s, i) => publicSeat(s, i === viewer || h.revealed.includes(i))),
    button: h.button,
    sbSeat: h.sbSeat,
    bbSeat: h.bbSeat,
    street: h.street,
    phase: h.phase,
    board: h.board.slice(),
    currentBet: h.currentBet,
    minRaiseInc: h.minRaiseInc,
    toAct: h.toAct,
    runout: h.runout,
    revealed: h.revealed.slice(),
    startStacks: h.startStacks.slice(),
    log: h.log.map(cloneEvent),
    result: h.result === null ? null : cloneResult(h.result),
  };
}
