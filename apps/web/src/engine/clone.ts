/**
 * Copying and freezing hand states (PLAN §4.2, §4.6). `step` deep-clones its input before it
 * changes anything and, in development builds, deep-freezes what it returns.
 */
import { InvariantError } from '../core/assert.ts';
import type { Card } from '../core/cards.ts';
import type { HandResult, HandState, LogEvent, SeatState } from './types.ts';

/**
 * A deep copy of a hand state that shares no object or array with `h`. Written out field by field
 * because `step` copies the state on every input (a generic recursive copy was a third of the
 * reducer's time). The object literals are typed, so a field added to `HandState`, `SeatState` or
 * `HandResult` fails to compile here until it is copied too. A state that is not shaped like a
 * hand state (a corrupt resume, say) throws `InvariantError` (I0), never a `TypeError`.
 */
export function cloneHand(h: HandState): HandState {
  try {
    return {
      schema: h.schema,
      engineVersion: h.engineVersion,
      handSeq: h.handSeq,
      seed: h.seed,
      sb: h.sb,
      bb: h.bb,
      seats: h.seats.map(cloneSeat),
      button: h.button,
      sbSeat: h.sbSeat,
      bbSeat: h.bbSeat,
      street: h.street,
      phase: h.phase,
      board: h.board.slice(),
      deck: h.deck.slice(),
      deckPos: h.deckPos,
      currentBet: h.currentBet,
      minRaiseInc: h.minRaiseInc,
      lastAggressor: h.lastAggressor,
      preflopAggressor: h.preflopAggressor,
      toAct: h.toAct,
      runout: h.runout,
      revealed: h.revealed.slice(),
      undoneDecisions: h.undoneDecisions.slice(),
      startTotal: h.startTotal,
      startStacks: h.startStacks.slice(),
      log: h.log.map(cloneEvent),
      result: h.result === null ? null : cloneResult(h.result),
    };
  } catch (e) {
    throw new InvariantError([
      `I0 well-formed: the state cannot be copied (${e instanceof Error ? e.message : String(e)})`,
    ]);
  }
}

function cloneSeat(s: SeatState): SeatState {
  return {
    dealtIn: s.dealtIn,
    stack: s.stack,
    hole: s.hole === null ? null : (s.hole.slice() as [Card, Card]),
    folded: s.folded,
    allIn: s.allIn,
    streetBet: s.streetBet,
    totalBet: s.totalBet,
    lastActedAtBet: s.lastActedAtBet,
  };
}

function cloneEvent(ev: LogEvent): LogEvent {
  switch (ev.e) {
    case 'act':
      return { ...ev, action: { ...ev.action } };
    case 'street':
      return { ...ev, cards: ev.cards.slice() };
    case 'reveal':
      return { ...ev, seats: ev.seats.slice() };
    case 'award':
      return { ...ev, seats: ev.seats.slice(), amounts: ev.amounts.slice() };
    default:
      // post, refund, reshuffle: numbers and strings only
      return { ...ev };
  }
}

function cloneResult(r: HandResult): HandResult {
  return {
    endedBy: r.endedBy,
    pots: r.pots.map((p) => ({ amount: p.amount, eligible: p.eligible.slice() })),
    potWinners: r.potWinners.map((w) => w.slice()),
    payouts: r.payouts.slice(),
    net: r.net.slice(),
    shown: r.shown.map((s) => ({
      seat: s.seat,
      score: s.score,
      category: s.category,
      best5: s.best5.slice(),
    })),
  };
}

/** Freezes `x` and every object and array inside it; returns `x`. */
export function deepFreeze<T>(x: T): T {
  if (typeof x === 'object' && x !== null && !Object.isFrozen(x)) {
    Object.freeze(x);
    if (Array.isArray(x)) {
      for (let i = 0; i < x.length; i++) {
        const v: unknown = x[i];
        if (typeof v === 'object' && v !== null) deepFreeze(v);
      }
    } else {
      for (const key in x) {
        const v: unknown = x[key];
        if (typeof v === 'object' && v !== null) deepFreeze(v);
      }
    }
  }
  return x;
}
