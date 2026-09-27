/**
 * Hand states built by hand, straight from the PLAN text, for the invariant tests (there is no
 * reducer yet): §3.3 blinds, §3.4 dealing, §3.7 round ends, §3.8 refunds and the §4.3 steps.
 * Every builder returns a fresh object, so a test may mutate it.
 *
 * Seats are listed with their stacks; blinds are 50/100 unless a spec says otherwise (Appendix B).
 */
import { newDeck, parseCards, type Card } from '../../src/core/cards.ts';
import type { Seed128 } from '../../src/core/rng.ts';
import { categoryOf, score5, score7 } from '../../src/eval/evaluate.ts';
import {
  ENGINE_VERSION,
  type HandState,
  type LogEvent,
  type SeatState,
} from '../../src/engine/types.ts';

/** The Appendix C.4 seed. */
export const SEED: Seed128 = '0123456789abcdef0123456789abcdef';

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

/** A JSON deep copy (states are plain JSON, §4.6). */
export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** A deck that starts with `first` (text form, in deck order) and then has the rest in order. */
export function deckStartingWith(first: string): Card[] {
  const head = parseCards(first);
  if (new Set(head).size !== head.length) throw new RangeError(`duplicate card in "${first}"`);
  return [...head, ...newDeck().filter((c) => !head.includes(c))];
}

/** The first seat clockwise strictly after `from` (wrapping) for which `ok` holds. */
function nextSeat(n: number, from: number, ok: (seat: number) => boolean): number {
  for (let d = 1; d <= n; d++) {
    const seat = (from + d) % n;
    if (ok(seat)) return seat;
  }
  throw new RangeError('no such seat');
}

const seatAt = (h: HandState, seat: number): SeatState => {
  const s = h.seats[seat];
  if (s === undefined) throw new RangeError(`no seat ${seat}`);
  return s;
};

/** §3.8 uncalled refund: the top street bet minus the largest other one goes back to its seat. */
export function refundUncalled(h: HandState): void {
  let top = 0;
  let topSeat = -1;
  let second = 0;
  h.seats.forEach((s, i) => {
    if (!s.dealtIn) return;
    if (s.streetBet > top) {
      second = top;
      top = s.streetBet;
      topSeat = i;
    } else if (s.streetBet > second) {
      second = s.streetBet;
    }
  });
  if (topSeat < 0 || top === second) return;
  const s = seatAt(h, topSeat);
  const x = top - second;
  s.streetBet -= x;
  s.totalBet -= x;
  s.stack += x;
  s.allIn = s.dealtIn && !s.folded && s.stack === 0;
  h.log.push({ e: 'refund', seat: topSeat, amount: x });
}

export interface StartSpec {
  /** Stack per seat; 0 = not dealt in (engine mode). */
  stacks: number[];
  /** This hand's button (a dealt-in seat). */
  button: number;
  sb?: number;
  bb?: number;
  /** Default: the unshuffled deck 0..51. */
  deck?: Card[];
  seed?: Seed128;
  handSeq?: number;
}

/**
 * A hand right after the blinds (§3.3, §3.4, §3.7): hole cards dealt one at a time from the seat
 * left of the button, blinds posted (short blinds all-in), then either the first seat to act
 * (strictly after the BB) or, when the blinds already end the round, the refund and
 * 'roundComplete'.
 */
export function handAtStart(spec: StartSpec): HandState {
  const sb = spec.sb ?? 50;
  const bb = spec.bb ?? 100;
  const n = spec.stacks.length;
  const deck = spec.deck ?? newDeck();
  const dealtIn = spec.stacks.map((s) => s > 0);
  const isIn = (seat: number): boolean => dealtIn[seat] === true;
  const k = dealtIn.filter(Boolean).length;
  const sbSeat = k === 2 ? spec.button : nextSeat(n, spec.button, isIn);
  const bbSeat = nextSeat(n, sbSeat, isIn);
  const seats: SeatState[] = spec.stacks.map((stack) => ({
    dealtIn: stack > 0,
    stack,
    hole: null,
    folded: false,
    allIn: false,
    streetBet: 0,
    totalBet: 0,
    lastActedAtBet: null,
  }));
  let j = 0;
  for (let d = 1; d <= n; d++) {
    const seat = (spec.button + d) % n;
    if (!isIn(seat)) continue;
    (seats[seat] as SeatState).hole = [deck[j] as Card, deck[k + j] as Card];
    j++;
  }
  const log: LogEvent[] = [];
  const post = (seat: number, blind: 'sb' | 'bb', size: number): void => {
    const s = seats[seat] as SeatState;
    const amount = Math.min(size, s.stack);
    s.stack -= amount;
    s.streetBet += amount;
    s.totalBet += amount;
    s.allIn = s.stack === 0;
    log.push({ e: 'post', seat, blind, amount, allIn: s.allIn });
  };
  post(sbSeat, 'sb', sb);
  post(bbSeat, 'bb', bb);
  const h: HandState = {
    schema: 1,
    engineVersion: ENGINE_VERSION,
    handSeq: spec.handSeq ?? 1,
    seed: spec.seed ?? SEED,
    sb,
    bb,
    seats,
    button: spec.button,
    sbSeat,
    bbSeat,
    street: 'preflop',
    phase: 'betting',
    board: [],
    deck: [...deck],
    deckPos: 2 * k,
    currentBet: bb,
    minRaiseInc: bb,
    lastAggressor: null,
    preflopAggressor: null,
    toAct: null,
    runout: false,
    revealed: [],
    undoneDecisions: [],
    startTotal: sum(spec.stacks),
    startStacks: [...spec.stacks],
    log,
    result: null,
  };
  const active = seats.filter((s) => s.dealtIn && !s.folded && !s.allIn);
  const over =
    active.length === 0 || (active.length === 1 && (active[0] as SeatState).streetBet >= bb);
  if (over) {
    refundUncalled(h);
    h.phase = 'roundComplete';
  } else {
    h.toAct = nextSeat(n, bbSeat, (seat) => {
      const s = seats[seat] as SeatState;
      return s.dealtIn && !s.folded && !s.allIn;
    });
  }
  return h;
}

/** §4.3 `put`. */
function put(s: SeatState, x: number): number {
  const amount = Math.min(x, s.stack);
  s.stack -= amount;
  s.streetBet += amount;
  s.totalBet += amount;
  if (s.stack === 0) s.allIn = true;
  return amount;
}

/** Call (no raise, no round-end logic): the caller sets toAct / phase. */
export function callBy(h: HandState, seat: number): void {
  const s = seatAt(h, seat);
  const amountIn = put(s, h.currentBet - s.streetBet);
  s.lastActedAtBet = h.currentBet;
  h.log.push({
    e: 'act',
    seat,
    street: h.street,
    action: { type: 'call' },
    amountIn,
    allIn: s.allIn,
    full: false,
  });
}

export function checkBy(h: HandState, seat: number): void {
  seatAt(h, seat).lastActedAtBet = h.currentBet;
  h.log.push({
    e: 'act',
    seat,
    street: h.street,
    action: { type: 'check' },
    amountIn: 0,
    allIn: false,
    full: false,
  });
}

export function foldBy(h: HandState, seat: number): void {
  seatAt(h, seat).folded = true;
  h.log.push({
    e: 'act',
    seat,
    street: h.street,
    action: { type: 'fold' },
    amountIn: 0,
    allIn: false,
    full: false,
  });
}

/** Bet or raise to `to` (§4.3 applyAct), without round-end logic: the caller sets toAct. */
export function betTo(h: HandState, seat: number, to: number): void {
  const s = seatAt(h, seat);
  const type = h.currentBet === 0 ? 'bet' : 'raise';
  const before = h.currentBet;
  const amountIn = put(s, to - s.streetBet);
  const inc = to - before;
  const full = inc >= h.minRaiseInc;
  if (full) {
    h.minRaiseInc = inc;
    if (h.street === 'preflop') h.preflopAggressor = seat;
  }
  h.currentBet = to;
  h.lastAggressor = seat;
  s.lastActedAtBet = h.currentBet;
  h.log.push({
    e: 'act',
    seat,
    street: h.street,
    action: { type, to },
    amountIn,
    allIn: s.allIn,
    full,
  });
}

/** §4.3 advance, the "next street" part: reset the street, burn, deal. */
export function dealNextStreet(h: HandState): void {
  const k = h.seats.filter((s) => s.dealtIn).length;
  for (const s of h.seats) {
    s.streetBet = 0;
    s.lastActedAtBet = null;
  }
  h.currentBet = 0;
  h.minRaiseInc = h.bb;
  h.lastAggressor = null;
  const next = h.street === 'preflop' ? 'flop' : h.street === 'flop' ? 'turn' : 'river';
  const count = next === 'flop' ? 3 : 1;
  const start = h.deckPos + 1; // after the burn
  const cards = h.deck.slice(start, start + count);
  h.board.push(...cards);
  h.deckPos = start + count;
  h.street = next;
  h.log.push({ e: 'street', street: next, cards });
  if (h.deckPos !== 2 * k + { flop: 4, turn: 6, river: 8 }[next]) throw new Error('deck slip');
}

/**
 * Heads-up, button 0 (SB) and seat 1 (BB), 10,000 each: the button calls, the BB checks, and the
 * flop is dealt. Betting on the flop; the BB acts first after the flop (§3.3).
 */
export function headsUpFlop(): HandState {
  const h = handAtStart({ stacks: [10000, 10000], button: 0 });
  callBy(h, 0);
  h.toAct = 1;
  checkBy(h, 1);
  h.toAct = null;
  h.phase = 'roundComplete';
  dealNextStreet(h);
  h.phase = 'betting';
  h.toAct = 1;
  return h;
}

/**
 * Appendix B12: three players (button 0, SB 1, BB 2, 10,000 each); the button and the SB fold.
 * `roundOver`: the BB got its uncalled 50 back ('roundComplete'). `complete`: after `advance` the
 * BB wins the 100 pot; net BB +50, SB −50.
 */
export function foldedToBigBlind(): { roundOver: HandState; complete: HandState } {
  const h = handAtStart({ stacks: [10000, 10000, 10000], button: 0 });
  foldBy(h, 0);
  h.toAct = 1;
  foldBy(h, 1);
  refundUncalled(h);
  h.toAct = null;
  h.phase = 'roundComplete';
  const roundOver = clone(h);
  const bb = seatAt(h, 2);
  bb.stack += 100;
  h.result = {
    endedBy: 'fold',
    pots: [{ amount: 100, eligible: [2] }],
    potWinners: [[2]],
    payouts: [0, 0, 100],
    net: [0, -50, 50],
    shown: [],
  };
  h.log.push({ e: 'award', pot: 0, seats: [2], amounts: [100] });
  h.phase = 'complete';
  return { roundOver, complete: h };
}

/**
 * Appendix B36: heads-up, button 0 (SB) with 40 and seat 1 (BB) with 80. Both blinds are all-in,
 * so the round is over at once and the BB gets 40 back: 40 against 40.
 */
export function allInAtBlinds(deck?: Card[]): HandState {
  return handAtStart({ stacks: [40, 80], button: 0, ...(deck === undefined ? {} : { deck }) });
}

/** The best five of seven cards, by brute force. */
export function best5(seven: readonly Card[]): Card[] {
  let best: Card[] = [];
  let bestScore = -1;
  for (let a = 0; a < 7; a++) {
    for (let b = a + 1; b < 7; b++) {
      const five = seven.filter((_, i) => i !== a && i !== b);
      const score = score5(five);
      if (score > bestScore) {
        bestScore = score;
        best = five;
      }
    }
  }
  return best;
}

/**
 * B36 played to the end: the run-out (hands face up at the first `advance`, §3.7), the showdown
 * and the settlement. The deck gives the button (seat 0) a pair of aces and the BB (seat 1) king
 * high, so the button wins the 80 pot. Returns every state along the way.
 */
export function allInShowdown(): {
  flop: HandState;
  turn: HandState;
  river: HandState;
  showdown: HandState;
  complete: HandState;
} {
  // Deal order heads-up: BB first (§3.4). Positions: 0 BB, 1 button, 2 BB, 3 button, 4 burn,
  // 5–7 flop, 8 burn, 9 turn, 10 burn, 11 river.
  const deck = deckStartingWith('7c Ac 2d As 5c 3h 8s 9d 6c Jc 6d Kh');
  const h = allInAtBlinds(deck);
  // advance 1: nobody can bet, so the run-out starts: both hands face up, in §3.9 order (no
  // river bet: first live seat left of the button, then clockwise).
  h.runout = true;
  h.revealed = [1, 0];
  h.log.push({ e: 'reveal', seats: [1, 0], reason: 'runout' });
  dealNextStreet(h);
  const flop = clone(h);
  dealNextStreet(h);
  const turn = clone(h);
  dealNextStreet(h);
  const river = clone(h);
  h.phase = 'showdown';
  const showdown = clone(h);
  // advance 5: settle. One pot of 80 (40 each), won by the button's aces.
  const shown = [1, 0].map((seat) => {
    const seven = [...(seatAt(h, seat).hole as [Card, Card]), ...h.board];
    const score = score7(seven, 7);
    return { seat, score, category: categoryOf(score), best5: best5(seven) };
  });
  seatAt(h, 0).stack += 80;
  for (const s of h.seats) s.allIn = s.dealtIn && !s.folded && s.stack === 0;
  h.result = {
    endedBy: 'showdown',
    pots: [{ amount: 80, eligible: [0, 1] }],
    potWinners: [[0]],
    payouts: [80, 0],
    net: [40, -40],
    shown,
  };
  h.log.push({ e: 'award', pot: 0, seats: [0], amounts: [80] });
  h.phase = 'complete';
  return { flop, turn, river, showdown, complete: h };
}
