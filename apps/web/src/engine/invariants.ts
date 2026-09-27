/**
 * Hand-state invariants (PLAN §4.4). `checkInvariants` runs after every engine step in
 * development, tests and production. ⚠️ A violation is never ignored: the controller voids the
 * hand (§4.5).
 *
 * This file is independent, on purpose, of the code that builds states (start.ts, step.ts,
 * settle.ts): it re-derives what it expects (the deal order, the blind seats, whether the betting
 * round is over) from the PLAN text, so a slip there shows up here instead of being copied. It
 * reports every broken invariant, not only the first; each message starts with the invariant's id
 * ("I7 all-in flag: seat 2 …").
 *
 * I1–I14 are the §4.4 table. I0 (the state is well-formed, so the other checks can run) and I15
 * (button and blind seats) are this file's additions, listed in §4.4 too. I12 replays `h.log` and
 * runs only when asked (`{ replayLog: true }`, as tests do); the rest always run, in well under
 * 0.1 ms.
 */
import { InvariantError } from '../core/assert.ts';
import { formatCard, isCard, type Card } from '../core/cards.ts';
import { isSeed128 } from '../core/rng.ts';
import {
  PHASES,
  STREETS,
  type HandResult,
  type HandState,
  type LogEvent,
  type SeatState,
  type Street,
} from './types.ts';

export interface InvariantOptions {
  /** I12: also replay `h.log` and compare it with the state (tests; costs O(log length)). */
  replayLog?: boolean;
}

/** Throws `InvariantError` listing every broken invariant of `h`; returns quietly otherwise. */
export function checkInvariants(h: HandState, options: InvariantOptions = {}): void {
  const broken = findBroken(h, options.replayLog === true);
  if (broken.length > 0) throw new InvariantError(broken);
}

const NAMES = {
  I0: 'well-formed',
  I1: 'chip conservation',
  I2: 'amounts',
  I3: 'street bet within total bet',
  I4: 'current bet',
  I5: 'minimum raise',
  I6: 'uncalled chips',
  I7: 'all-in flag',
  I8: 'deck',
  I9: 'board size',
  I10: 'seat to act',
  I11: 'folded seats',
  I12: 'log replay',
  I13: 'seats not dealt in',
  I14: 'result',
  I15: 'button and blinds',
} as const;

type Id = keyof typeof NAMES;
type Fail = (id: Id, detail: string) => void;

/** Deck positions of the five board cards when k seats are dealt in (§3.4). */
const boardPositions = (k: number): number[] => [
  2 * k + 1,
  2 * k + 2,
  2 * k + 3,
  2 * k + 5,
  2 * k + 7,
];
const BOARD_SIZE: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5 };
/** deckPos − 2k after each street: burns included (§3.4). */
const DECK_POS_OFFSET: Record<Street, number> = { preflop: 0, flop: 4, turn: 6, river: 8 };

function findBroken(h: HandState, replayLog: boolean): string[] {
  const broken: string[] = [];
  const fail: Fail = (id, detail) => {
    broken.push(`${id} ${NAMES[id]}: ${detail}`);
  };
  try {
    if (!checkShape(h, fail)) return broken;
    checkChips(h, fail);
    checkAmounts(h, fail);
    checkStreetBets(h, fail);
    checkCurrentBet(h, fail);
    checkMinRaise(h, fail);
    checkUncalled(h, fail);
    checkAllInFlags(h, fail);
    checkDeck(h, fail);
    checkBoardSize(h, fail);
    checkToAct(h, fail);
    checkFoldedSeats(h, fail);
    checkNotDealtIn(h, fail);
    checkResult(h, fail);
    checkButtonAndBlinds(h, fail);
    if (replayLog) checkLogReplay(h, fail);
  } catch (e) {
    fail('I0', `the state could not be checked (${e instanceof Error ? e.message : String(e)})`);
  }
  return broken;
}

// ---------------------------------------------------------------------------------------------
// Small helpers (kept here rather than shared with the reducer: see the file comment).

const isSafeInt = (x: unknown): x is number => Number.isSafeInteger(x);
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
const isLive = (s: SeatState): boolean => s.dealtIn && !s.folded;
const isActive = (s: SeatState): boolean => s.dealtIn && !s.folded && !s.allIn;
const cards = (cs: readonly Card[]): string =>
  cs.length === 0 ? '(none)' : cs.map((c) => formatCard(c)).join(' ');
const seatList = (seats: readonly number[]): string => `[${seats.join(', ')}]`;

/** The first seat clockwise strictly after `from` (wrapping, `from` itself last) that is `ok`. */
function nextSeat(n: number, from: number, ok: (seat: number) => boolean): number | null {
  for (let d = 1; d <= n; d++) {
    const seat = (from + d) % n;
    if (ok(seat)) return seat;
  }
  return null;
}

/** Dealt-in seats in dealing order: from the first one left of the button, button last (§3.4). */
function dealOrder(h: HandState): number[] {
  const n = h.seats.length;
  const order: number[] = [];
  for (let d = 1; d <= n; d++) {
    const seat = (h.button + d) % n;
    if (h.seats[seat]?.dealtIn === true) order.push(seat);
  }
  return order;
}

function sameSet(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && new Set(a).size === a.length && a.every((x) => b.includes(x));
}

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** §3.7: the betting round is over (the reducer must then leave the 'betting' phase). */
function bettingRoundOver(h: HandState): boolean {
  const active = h.seats.filter(isActive);
  if (active.length === 0) return true;
  // One seat left that can act: over once it faces no bet. With a short all-in BB, currentBet
  // is still the full bb (§3.3), so a small blind with more in than the BB must still act (B34).
  if (active.length === 1) return (active[0] as SeatState).streetBet >= h.currentBet;
  return active.every((s) => s.lastActedAtBet !== null && s.streetBet === h.currentBet);
}

// ---------------------------------------------------------------------------------------------
// I0: the state is well-formed, so the checks below can run. On failure nothing else is checked.

function checkShape(h: HandState, fail: Fail): boolean {
  let ok = true;
  const bad = (detail: string): void => {
    fail('I0', detail);
    ok = false;
  };
  if (typeof h !== 'object' || h === null) {
    bad('the state is not an object');
    return false;
  }
  const seats: unknown = h.seats;
  if (!Array.isArray(seats) || seats.length < 2 || seats.length > 9) {
    bad('seats must be an array of 2 to 9 seats');
    return false;
  }
  const n = seats.length;
  const isSeat = (x: unknown): boolean => isSafeInt(x) && x >= 0 && x < n;
  const isSeatOrNull = (x: unknown): boolean => x === null || isSeat(x);
  const isNum = (x: unknown): boolean => typeof x === 'number';
  const isSeatArray = (x: unknown): boolean => Array.isArray(x) && x.every(isSeat);
  const isNumArray = (x: unknown): boolean => Array.isArray(x) && x.every(isNum);
  const isCardArray = (x: unknown): boolean => Array.isArray(x) && x.every((c) => isCard(c));

  if (h.schema !== 1) bad(`schema is ${String(h.schema)}, expected 1`);
  if (typeof h.engineVersion !== 'string' || h.engineVersion === '') bad('engineVersion is empty');
  if (!isSeed128(h.seed)) bad('seed is not 32 lowercase hex characters');
  if (!isSafeInt(h.handSeq) || h.handSeq < 1) bad(`handSeq is ${String(h.handSeq)}`);
  if (!isSafeInt(h.bb) || h.bb < 2 || h.bb % 2 !== 0 || h.sb !== h.bb / 2) {
    bad(`blinds are ${String(h.sb)}/${String(h.bb)}: bb must be even and ≥ 2, sb = bb / 2 (§3.2)`);
  }
  seats.forEach((s: unknown, i) => {
    const seat = s as Partial<SeatState> | null;
    const fields =
      typeof seat === 'object' &&
      seat !== null &&
      typeof seat.dealtIn === 'boolean' &&
      typeof seat.folded === 'boolean' &&
      typeof seat.allIn === 'boolean' &&
      isNum(seat.stack) &&
      isNum(seat.streetBet) &&
      isNum(seat.totalBet) &&
      (seat.lastActedAtBet === null || isNum(seat.lastActedAtBet)) &&
      (seat.hole === null || (isCardArray(seat.hole) && (seat.hole as Card[]).length === 2));
    if (!fields) bad(`seat ${i} is malformed`);
  });
  for (const key of ['button', 'sbSeat', 'bbSeat'] as const) {
    if (!isSeat(h[key])) bad(`${key} is ${String(h[key])}, not a seat`);
  }
  for (const key of ['toAct', 'lastAggressor', 'preflopAggressor'] as const) {
    if (!isSeatOrNull(h[key])) bad(`${key} is ${String(h[key])}, not a seat or null`);
  }
  if (!STREETS.includes(h.street)) bad(`street is ${String(h.street)}`);
  if (!PHASES.includes(h.phase)) bad(`phase is ${String(h.phase)}`);
  if (!isCardArray(h.board) || h.board.length > 5) bad('board must be at most 5 cards');
  if (!isNumArray(h.deck) || h.deck.length !== 52) bad('deck must be 52 numbers');
  if (!isSafeInt(h.deckPos) || h.deckPos < 0 || h.deckPos > 52) {
    bad(`deckPos is ${String(h.deckPos)}`);
  }
  for (const key of ['currentBet', 'minRaiseInc', 'startTotal'] as const) {
    if (!isNum(h[key])) bad(`${key} is not a number`);
  }
  if (!isNumArray(h.startStacks) || h.startStacks.length !== n) {
    bad(`startStacks must be ${n} numbers`);
  }
  if (typeof h.runout !== 'boolean') bad('runout is not a boolean');
  if (!isSeatArray(h.revealed)) bad('revealed must be a list of seats');
  if (!Array.isArray(h.undoneDecisions) || !h.undoneDecisions.every((d) => isSafeInt(d))) {
    bad('undoneDecisions must be integers');
  }
  if (!Array.isArray(h.log)) {
    bad('log is not an array');
  } else {
    h.log.forEach((ev, j) => {
      const problem = logEventProblem(ev, isSeat, isNum, isCardArray);
      if (problem !== null) bad(`log event ${j}: ${problem}`);
    });
  }
  if (h.result !== null) {
    const problem = resultProblem(h.result, n, isSeat, isSeatArray, isNum, isNumArray);
    if (problem !== null) bad(`result: ${problem}`);
  }
  return ok;
}

function logEventProblem(
  event: unknown,
  isSeat: (x: unknown) => boolean,
  isNum: (x: unknown) => boolean,
  isCardArray: (x: unknown) => boolean,
): string | null {
  if (typeof event !== 'object' || event === null) return 'not an object';
  const ev = event as LogEvent;
  switch (ev.e) {
    case 'post':
      return isSeat(ev.seat) &&
        (ev.blind === 'sb' || ev.blind === 'bb') &&
        isNum(ev.amount) &&
        typeof ev.allIn === 'boolean'
        ? null
        : 'malformed post';
    case 'act': {
      const a: unknown = ev.action;
      const action = a as { type?: unknown; to?: unknown } | null;
      const actionOk =
        typeof action === 'object' &&
        action !== null &&
        (action.type === 'fold' ||
          action.type === 'check' ||
          action.type === 'call' ||
          ((action.type === 'bet' || action.type === 'raise') && isNum(action.to)));
      return isSeat(ev.seat) &&
        STREETS.includes(ev.street) &&
        actionOk &&
        isNum(ev.amountIn) &&
        typeof ev.allIn === 'boolean' &&
        typeof ev.full === 'boolean'
        ? null
        : 'malformed act';
    }
    case 'refund':
      return isSeat(ev.seat) && isNum(ev.amount) ? null : 'malformed refund';
    case 'street':
      return STREETS.includes(ev.street) && isCardArray(ev.cards) ? null : 'malformed street';
    case 'reveal':
      return Array.isArray(ev.seats) &&
        ev.seats.every(isSeat) &&
        (ev.reason === 'runout' || ev.reason === 'showdown')
        ? null
        : 'malformed reveal';
    case 'reshuffle':
      return isSafeInt(ev.decisionId) && isSafeInt(ev.undoIndex) ? null : 'malformed reshuffle';
    case 'award':
      return isSafeInt(ev.pot) &&
        Array.isArray(ev.seats) &&
        ev.seats.every(isSeat) &&
        Array.isArray(ev.amounts) &&
        ev.amounts.every(isNum)
        ? null
        : 'malformed award';
    default:
      return `unknown event "${String((ev as { e?: unknown }).e)}"`;
  }
}

function resultProblem(
  r: HandResult,
  n: number,
  isSeat: (x: unknown) => boolean,
  isSeatArray: (x: unknown) => boolean,
  isNum: (x: unknown) => boolean,
  isNumArray: (x: unknown) => boolean,
): string | null {
  if (typeof r !== 'object') return `must be null or an object, not ${String(r)}`;
  if (r.endedBy !== 'fold' && r.endedBy !== 'showdown') return `endedBy is ${String(r.endedBy)}`;
  if (!Array.isArray(r.pots)) return 'pots is not an array';
  for (const p of r.pots) {
    if (typeof p !== 'object' || p === null || !isNum(p.amount) || !isSeatArray(p.eligible)) {
      return 'malformed pot';
    }
  }
  if (!Array.isArray(r.potWinners) || r.potWinners.length !== r.pots.length) {
    return 'potWinners must have one list per pot';
  }
  if (!r.potWinners.every(isSeatArray)) return 'potWinners must list seats';
  if (!isNumArray(r.payouts) || r.payouts.length !== n) return `payouts must be ${n} numbers`;
  if (!isNumArray(r.net) || r.net.length !== n) return `net must be ${n} numbers`;
  if (!Array.isArray(r.shown)) return 'shown is not an array';
  for (const s of r.shown) {
    const ok =
      typeof s === 'object' &&
      s !== null &&
      isSeat(s.seat) &&
      isNum(s.score) &&
      typeof s.category === 'string' &&
      Array.isArray(s.best5) &&
      s.best5.every((c) => isCard(c));
    if (!ok) return 'malformed shown hand';
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// I1: chips are conserved. Before settlement chips never move between seats (a refund goes back
// to the seat that bet it), so each seat's stack + totalBet stays its start stack.

function checkChips(h: HandState, fail: Fail): void {
  const startSum = sum(h.startStacks);
  if (startSum !== h.startTotal) {
    fail('I1', `startTotal is ${h.startTotal} but the start stacks add up to ${startSum}`);
  }
  if (h.phase !== 'complete') {
    const total = sum(h.seats.map((s) => s.stack + s.totalBet));
    if (total !== h.startTotal) {
      fail('I1', `Σ(stack + totalBet) is ${total}, startTotal is ${h.startTotal}`);
    }
    h.seats.forEach((s, i) => {
      const start = h.startStacks[i];
      if (s.stack + s.totalBet !== start) {
        fail(
          'I1',
          `seat ${i}: stack ${s.stack} + totalBet ${s.totalBet} is not its start stack ${start}`,
        );
      }
    });
    return;
  }
  const stacks = sum(h.seats.map((s) => s.stack));
  if (stacks !== h.startTotal) {
    fail('I1', `hand complete: Σ stack is ${stacks}, startTotal is ${h.startTotal}`);
  }
  const r = h.result;
  if (r === null) return; // I14 reports it
  const bets = sum(h.seats.map((s) => s.totalBet));
  const paid = sum(r.payouts);
  if (paid !== bets) fail('I1', `Σ payouts is ${paid}, Σ totalBet is ${bets}`);
  const inPots = sum(r.pots.map((p) => p.amount));
  if (inPots !== bets) fail('I1', `Σ pots is ${inPots}, Σ totalBet is ${bets}`);
  h.seats.forEach((s, i) => {
    const payout = r.payouts[i] as number;
    const net = r.net[i] as number;
    const start = h.startStacks[i] as number;
    if (net !== payout - s.totalBet) {
      fail('I1', `seat ${i}: net ${net} is not payout ${payout} − totalBet ${s.totalBet}`);
    }
    if (s.stack !== start + net) {
      fail('I1', `seat ${i}: final stack ${s.stack} is not start ${start} + net ${net}`);
    }
  });
}

// ---------------------------------------------------------------------------------------------
// I2: every amount is a safe, non-negative integer (net may be negative: it is a difference).

function checkAmounts(h: HandState, fail: Fail): void {
  const amount = (x: number, where: string): void => {
    if (!(isSafeInt(x) && x >= 0)) fail('I2', `${where} is ${x}`);
  };
  h.seats.forEach((s, i) => {
    amount(s.stack, `seat ${i} stack`);
    amount(s.streetBet, `seat ${i} streetBet`);
    amount(s.totalBet, `seat ${i} totalBet`);
    if (s.lastActedAtBet !== null) amount(s.lastActedAtBet, `seat ${i} lastActedAtBet`);
  });
  amount(h.currentBet, 'currentBet');
  amount(h.minRaiseInc, 'minRaiseInc');
  amount(h.sb, 'sb');
  amount(h.bb, 'bb');
  amount(h.startTotal, 'startTotal');
  h.startStacks.forEach((x, i) => amount(x, `startStacks[${i}]`));
  h.log.forEach((ev, j) => {
    if (ev.e === 'post') amount(ev.amount, `log ${j} post amount`);
    if (ev.e === 'refund') amount(ev.amount, `log ${j} refund amount`);
    if (ev.e === 'award') ev.amounts.forEach((x) => amount(x, `log ${j} award amount`));
    if (ev.e === 'act') {
      amount(ev.amountIn, `log ${j} amountIn`);
      if (ev.action.type === 'bet' || ev.action.type === 'raise') {
        amount(ev.action.to, `log ${j} ${ev.action.type} to`);
      }
    }
  });
  const r = h.result;
  if (r === null) return;
  r.pots.forEach((p, i) => amount(p.amount, `pot ${i}`));
  r.payouts.forEach((x, i) => amount(x, `payout of seat ${i}`));
  r.net.forEach((x, i) => {
    if (!isSafeInt(x)) fail('I2', `net of seat ${i} is ${x}`);
  });
}

// ---------------------------------------------------------------------------------------------
// I3–I7

function checkStreetBets(h: HandState, fail: Fail): void {
  h.seats.forEach((s, i) => {
    if (!(s.streetBet >= 0 && s.streetBet <= s.totalBet)) {
      fail('I3', `seat ${i}: streetBet ${s.streetBet}, totalBet ${s.totalBet}`);
    }
  });
}

function checkCurrentBet(h: HandState, fail: Fail): void {
  if (h.phase !== 'betting') return;
  const floor = h.street === 'preflop' ? h.bb : 0;
  const expected = Math.max(floor, ...h.seats.map((s) => s.streetBet));
  if (h.currentBet !== expected) {
    fail('I4', `currentBet is ${h.currentBet}, expected ${expected} (the largest street bet)`);
  }
}

function checkMinRaise(h: HandState, fail: Fail): void {
  if (!(h.minRaiseInc >= h.bb)) fail('I5', `minRaiseInc ${h.minRaiseInc} < bb ${h.bb}`);
}

function checkUncalled(h: HandState, fail: Fail): void {
  // Uncalled chips are refunded when a round ends (§3.8); only 'betting' states can precede it.
  if (h.phase === 'betting') return;
  const maxAll = Math.max(...h.seats.map((s) => s.totalBet));
  const live = h.seats.filter(isLive);
  const maxLive = Math.max(...live.map((s) => s.totalBet));
  if (maxAll !== maxLive) {
    fail('I6', `a folded seat has ${maxAll} in, more than any live seat (${maxLive})`);
  }
}

function checkAllInFlags(h: HandState, fail: Fail): void {
  h.seats.forEach((s, i) => {
    const expected = s.dealtIn && !s.folded && s.stack === 0;
    if (s.allIn !== expected) {
      fail('I7', `seat ${i}: allIn is ${s.allIn} with stack ${s.stack}`);
    }
  });
}

// ---------------------------------------------------------------------------------------------
// I8, I9: the deck and the board.

function checkDeck(h: HandState, fail: Fail): void {
  const seen = new Array<boolean>(52).fill(false);
  let permutation = true;
  for (const c of h.deck) {
    if (!isCard(c) || seen[c] === true) permutation = false;
    else seen[c] = true;
  }
  if (!permutation) {
    fail('I8', 'deck is not a permutation of the 52 cards');
    return;
  }
  const order = dealOrder(h);
  const k = order.length;
  order.forEach((seat, j) => {
    const hole = h.seats[seat]?.hole ?? null;
    if (hole === null) return; // I13 reports it
    const expected: [Card, Card] = [h.deck[j] as Card, h.deck[k + j] as Card];
    if (hole[0] !== expected[0] || hole[1] !== expected[1]) {
      fail('I8', `seat ${seat} holds ${cards(hole)}, deck positions give ${cards(expected)}`);
    }
  });
  const positions = boardPositions(k);
  h.board.forEach((c, i) => {
    const expected = h.deck[positions[i] as number] as Card;
    if (c !== expected) {
      fail('I8', `board card ${i + 1} is ${cards([c])}, deck position gives ${cards([expected])}`);
    }
  });
  const expectedPos = 2 * k + DECK_POS_OFFSET[h.street];
  if (h.deckPos !== expectedPos) {
    fail('I8', `deckPos is ${h.deckPos}, expected ${expectedPos} on the ${h.street}`);
  }
  const shown: Card[] = [...h.board];
  for (const s of h.seats) if (s.hole !== null) shown.push(...s.hole);
  if (new Set(shown).size !== shown.length) fail('I8', 'a card is dealt twice');
}

function checkBoardSize(h: HandState, fail: Fail): void {
  const expected = BOARD_SIZE[h.street];
  if (h.board.length !== expected) {
    fail('I9', `${h.board.length} board cards on the ${h.street}, expected ${expected}`);
  }
}

// ---------------------------------------------------------------------------------------------
// I10: the seat to act. legalActions(h) is non-empty exactly when that seat is live, not all-in
// and faces toCall ≥ 0 (fold is legal when toCall > 0, check when toCall == 0; §3.5).

function checkToAct(h: HandState, fail: Fail): void {
  const betting = h.phase === 'betting';
  if (betting !== (h.toAct !== null)) {
    fail('I10', `phase is ${h.phase} but toAct is ${String(h.toAct)}`);
    return;
  }
  if (h.toAct === null) return;
  const seat = h.toAct;
  const s = h.seats[seat] as SeatState;
  if (!isLive(s)) fail('I10', `seat ${seat} is to act but is not live`);
  if (s.allIn) fail('I10', `seat ${seat} is to act but is all-in`);
  if (s.streetBet > h.currentBet) {
    fail(
      'I10',
      `seat ${seat} is to act with streetBet ${s.streetBet} > currentBet ${h.currentBet}`,
    );
  }
  if (s.lastActedAtBet !== null && s.streetBet === h.currentBet) {
    fail('I10', `seat ${seat} is to act but has already acted and matched ${h.currentBet}`);
  }
  if (h.seats.filter(isLive).length < 2) fail('I10', 'betting with fewer than two live seats');
  if (bettingRoundOver(h)) fail('I10', 'the betting round is over but the phase is still betting');
}

// ---------------------------------------------------------------------------------------------
// I11: a folded seat is never in a pot's eligible list, never wins, and is never revealed.

function checkFoldedSeats(h: HandState, fail: Fail): void {
  const live = (seat: number): boolean => isLive(h.seats[seat] as SeatState);
  if (new Set(h.revealed).size !== h.revealed.length) fail('I11', 'revealed lists a seat twice');
  for (const seat of h.revealed) {
    if (!live(seat)) fail('I11', `seat ${seat} is revealed but not live`);
  }
  if (h.phase === 'betting' && h.revealed.length > 0) {
    fail('I11', 'hole cards are revealed while there is still betting');
  }
  if (h.runout) {
    h.seats.forEach((s, i) => {
      if (isLive(s) && !h.revealed.includes(i)) fail('I11', `run-out but live seat ${i} is hidden`);
    });
  }
  const r = h.result;
  if (r === null) return;
  const winners = new Set<number>();
  r.pots.forEach((p, i) => {
    if (p.eligible.length === 0) fail('I11', `pot ${i} has no eligible seat`);
    for (const seat of p.eligible) {
      if (!live(seat)) fail('I11', `pot ${i} lists seat ${seat}, which is not live`);
    }
    const potWinners = r.potWinners[i] ?? [];
    if (potWinners.length === 0) fail('I11', `pot ${i} has no winner`);
    for (const seat of potWinners) {
      if (!p.eligible.includes(seat)) fail('I11', `pot ${i} is won by seat ${seat}, not eligible`);
      winners.add(seat);
    }
  });
  r.payouts.forEach((x, seat) => {
    if (x > 0 && !winners.has(seat)) fail('I11', `seat ${seat} is paid ${x} but won no pot`);
  });
  for (const s of r.shown) {
    if (!live(s.seat)) fail('I11', `seat ${s.seat} is shown but not live`);
  }
}

// ---------------------------------------------------------------------------------------------
// I13: seats not dealt in hold no cards, put in no chips and never act.

function checkNotDealtIn(h: HandState, fail: Fail): void {
  h.seats.forEach((s, i) => {
    const start = h.startStacks[i] as number;
    if (s.dealtIn !== start > 0) {
      fail('I13', `seat ${i}: dealtIn is ${s.dealtIn} with a start stack of ${start}`);
    }
    if (s.dealtIn) {
      if (s.hole === null) fail('I13', `seat ${i} is dealt in but has no hole cards`);
      return;
    }
    if (s.hole !== null) fail('I13', `seat ${i} is not dealt in but has hole cards`);
    if (s.totalBet !== 0 || s.streetBet !== 0) fail('I13', `seat ${i} is not dealt in but bet`);
    if (s.folded || s.lastActedAtBet !== null) {
      fail('I13', `seat ${i} is not dealt in but has acted`);
    }
  });
  h.log.forEach((ev, j) => {
    if ((ev.e === 'post' || ev.e === 'act') && h.seats[ev.seat]?.dealtIn !== true) {
      fail('I13', `log event ${j}: seat ${ev.seat} is not dealt in but ${ev.e}s`);
    }
  });
}

// ---------------------------------------------------------------------------------------------
// I14: the result exists exactly when the hand is complete, and says how it ended.

function checkResult(h: HandState, fail: Fail): void {
  const complete = h.phase === 'complete';
  if (complete !== (h.result !== null)) {
    fail('I14', `phase is ${h.phase} but result is ${h.result === null ? 'null' : 'set'}`);
    return;
  }
  const r = h.result;
  if (r === null) return;
  const live = h.seats.flatMap((s, i) => (isLive(s) ? [i] : []));
  if ((r.endedBy === 'fold') !== (live.length === 1)) {
    fail('I14', `endedBy is ${r.endedBy} but the live seats are ${seatList(live)}`);
  }
  if (r.endedBy === 'fold') {
    if (r.shown.length > 0 || h.revealed.length > 0) {
      fail('I14', 'a hand won by folds shows no cards (§3.7, §3.9)');
    }
    return;
  }
  if (h.street !== 'river') fail('I14', `showdown on the ${h.street}`);
  const shownSeats = r.shown.map((s) => s.seat);
  if (!sameSet(shownSeats, live)) {
    fail('I14', `showdown shows ${seatList(shownSeats)}, the live seats are ${seatList(live)}`);
  }
  if (!sameSet(h.revealed, live)) {
    fail('I14', `showdown reveals ${seatList(h.revealed)}, the live seats are ${seatList(live)}`);
  }
}

// ---------------------------------------------------------------------------------------------
// I15: the button and blinds sit on dealt-in seats as §3.3 places them. Heads-up the button is
// the small blind (Known pitfall 3).

function checkButtonAndBlinds(h: HandState, fail: Fail): void {
  const n = h.seats.length;
  const dealtIn = (seat: number): boolean => h.seats[seat]?.dealtIn === true;
  const k = h.seats.filter((s) => s.dealtIn).length;
  if (k < 2) {
    fail('I15', `${k} seat(s) dealt in; a hand needs two`);
    return;
  }
  for (const key of ['button', 'sbSeat', 'bbSeat'] as const) {
    if (!dealtIn(h[key])) fail('I15', `${key} (seat ${h[key]}) is not dealt in`);
  }
  const sb = k === 2 ? h.button : nextSeat(n, h.button, dealtIn);
  const bb = sb === null ? null : nextSeat(n, sb, dealtIn);
  if (h.sbSeat !== sb || h.bbSeat !== bb) {
    fail(
      'I15',
      `button ${h.button} puts the blinds on seats ${String(sb)}/${String(bb)}, ` +
        `not ${h.sbSeat}/${h.bbSeat}`,
    );
  }
}

// ---------------------------------------------------------------------------------------------
// I12: the log replays to the state. The replay rebuilds bets, folds, the street and board,
// reveals, reshuffles and payouts from the events alone, following §3.5–§3.8 and §4.3, and
// compares them with the state. (The input replay of a whole hand is the §4.7 replay test.)

function checkLogReplay(h: HandState, fail: Fail): void {
  const n = h.seats.length;
  const stack = [...h.startStacks]; // chips behind, before settlement
  const streetBet = new Array<number>(n).fill(0);
  const totalBet = new Array<number>(n).fill(0);
  const folded = new Array<boolean>(n).fill(false);
  const acted = new Array<number | null>(n).fill(null);
  const awarded = new Array<number>(n).fill(0);
  const board: Card[] = [];
  const undone: number[] = [];
  const potsAwarded = new Set<number>();
  let street: Street = 'preflop';
  let currentBet = h.bb;
  let minRaiseInc = h.bb;
  let lastAggressor: number | null = null;
  let preflopAggressor: number | null = null;
  let revealed: number[] = [];
  let runout = false;
  let reveals = 0;
  let posts = 0;

  const get = (xs: readonly number[], i: number): number => xs[i] as number;
  const put = (seat: number, x: number): void => {
    stack[seat] = get(stack, seat) - x;
    streetBet[seat] = get(streetBet, seat) + x;
    totalBet[seat] = get(totalBet, seat) + x;
  };

  h.log.forEach((ev, j) => {
    const at = `event ${j} (${ev.e})`;
    switch (ev.e) {
      case 'post': {
        const blind = posts === 0 ? 'sb' : 'bb';
        const seat = posts === 0 ? h.sbSeat : h.bbSeat;
        if (j !== posts || posts >= 2) {
          fail('I12', `${at}: the two blind posts must be the first events`);
        } else if (ev.blind !== blind || ev.seat !== seat) {
          fail('I12', `${at}: expected the ${blind} from seat ${seat}`);
        }
        const expected = Math.min(ev.blind === 'sb' ? h.sb : h.bb, get(stack, ev.seat));
        if (ev.amount !== expected) {
          fail('I12', `${at}: seat ${ev.seat} posts ${ev.amount}, expected ${expected}`);
        }
        put(ev.seat, ev.amount);
        if (ev.allIn !== (get(stack, ev.seat) === 0)) fail('I12', `${at}: wrong allIn flag`);
        posts++;
        break;
      }
      case 'act': {
        const s = ev.seat;
        if (posts < 2) fail('I12', `${at}: an action before the blinds`);
        if (ev.street !== street) fail('I12', `${at}: says ${ev.street} during the ${street}`);
        if (h.seats[s]?.dealtIn !== true || folded[s] === true || get(stack, s) === 0) {
          fail('I12', `${at}: seat ${s} cannot act (not dealt in, folded or all-in)`);
        }
        const toCall = currentBet - get(streetBet, s);
        const a = ev.action;
        let expectedIn = 0;
        let full = false;
        if (a.type === 'fold' && toCall <= 0) fail('I12', `${at}: fold when checking is free`);
        if (a.type === 'check' && toCall !== 0) fail('I12', `${at}: check facing ${toCall}`);
        if (a.type === 'call') {
          if (toCall <= 0) fail('I12', `${at}: call with nothing to call`);
          expectedIn = Math.min(Math.max(toCall, 0), get(stack, s));
        }
        if (a.type === 'bet' || a.type === 'raise') {
          if (a.type === 'bet' ? currentBet !== 0 : currentBet === 0) {
            fail('I12', `${at}: ${a.type} when currentBet is ${currentBet}`);
          }
          if (a.to <= currentBet) {
            fail('I4', `${at}: ${a.type} to ${a.to} does not raise currentBet ${currentBet}`);
          }
          expectedIn = a.to - get(streetBet, s);
          full = a.to - currentBet >= minRaiseInc;
        }
        if (ev.amountIn !== expectedIn) {
          fail('I12', `${at}: amountIn is ${ev.amountIn}, expected ${expectedIn}`);
        }
        if (ev.amountIn > get(stack, s)) {
          fail('I12', `${at}: puts in ${ev.amountIn} with ${get(stack, s)} behind`);
        }
        if (ev.full !== full) fail('I12', `${at}: full is ${ev.full}, expected ${full}`);
        if (a.type === 'fold') {
          folded[s] = true;
        } else {
          put(s, ev.amountIn);
          if (a.type === 'bet' || a.type === 'raise') {
            if (full) {
              minRaiseInc = a.to - currentBet;
              if (street === 'preflop') preflopAggressor = s;
            }
            currentBet = a.to;
            lastAggressor = s;
          }
          acted[s] = currentBet;
        }
        if (ev.allIn !== (get(stack, s) === 0)) fail('I12', `${at}: wrong allIn flag`);
        break;
      }
      case 'refund': {
        // §3.8: the largest street bet (folded seats included) minus the largest of the others.
        let top = 0;
        let topSeat = -1;
        let second = 0;
        streetBet.forEach((b, i) => {
          if (h.seats[i]?.dealtIn !== true) return;
          if (b > top) {
            second = top;
            top = b;
            topSeat = i;
          } else if (b > second) {
            second = b;
          }
        });
        if (ev.seat !== topSeat || ev.amount !== top - second || ev.amount <= 0) {
          fail(
            'I12',
            `${at}: refunds ${ev.amount} to seat ${ev.seat}; the uncalled part is ` +
              `${top - second} for seat ${topSeat}`,
          );
        }
        streetBet[ev.seat] = get(streetBet, ev.seat) - ev.amount;
        totalBet[ev.seat] = get(totalBet, ev.seat) - ev.amount;
        stack[ev.seat] = get(stack, ev.seat) + ev.amount;
        break;
      }
      case 'street': {
        const next = STREETS[STREETS.indexOf(street) + 1];
        if (ev.street !== next) fail('I12', `${at}: deals the ${ev.street} after the ${street}`);
        const size = ev.street === 'flop' ? 3 : 1;
        if (ev.cards.length !== size) fail('I12', `${at}: ${ev.cards.length} cards, not ${size}`);
        board.push(...ev.cards);
        street = ev.street;
        streetBet.fill(0);
        acted.fill(null);
        currentBet = 0;
        minRaiseInc = h.bb;
        lastAggressor = null;
        break;
      }
      case 'reveal':
        reveals++;
        if (reveals > 1) fail('I12', `${at}: a hand has at most one reveal`);
        revealed = [...ev.seats];
        if (ev.reason === 'runout') runout = true;
        break;
      case 'reshuffle':
        undone.push(ev.decisionId);
        break;
      case 'award': {
        const r = h.result;
        const pot = r?.pots[ev.pot];
        if (r === null || pot === undefined) {
          fail('I12', `${at}: there is no pot ${ev.pot}`);
          break;
        }
        if (potsAwarded.has(ev.pot)) fail('I12', `${at}: pot ${ev.pot} is awarded twice`);
        potsAwarded.add(ev.pot);
        if (!sameList(ev.seats, r.potWinners[ev.pot] ?? [])) {
          fail('I12', `${at}: winners ${seatList(ev.seats)} differ from the result`);
        }
        if (ev.amounts.length !== ev.seats.length || sum(ev.amounts) !== pot.amount) {
          fail('I12', `${at}: shares ${ev.amounts.join(' + ')} do not make pot ${pot.amount}`);
        }
        ev.seats.forEach((seat, i) => {
          awarded[seat] = get(awarded, seat) + (ev.amounts[i] ?? 0);
        });
        break;
      }
    }
  });

  if (posts !== 2) fail('I12', `the log has ${posts} blind posts, expected 2`);
  const complete = h.phase === 'complete';
  h.seats.forEach((s, i) => {
    const expectedStack = get(stack, i) + (complete ? get(awarded, i) : 0);
    if (s.stack !== expectedStack) fail('I12', `seat ${i}: stack ${s.stack}, log ${expectedStack}`);
    if (s.streetBet !== streetBet[i]) {
      fail('I12', `seat ${i}: streetBet ${s.streetBet}, log ${String(streetBet[i])}`);
    }
    if (s.totalBet !== totalBet[i]) {
      fail('I12', `seat ${i}: totalBet ${s.totalBet}, log ${String(totalBet[i])}`);
    }
    if (s.folded !== folded[i]) fail('I12', `seat ${i}: folded ${s.folded}, log ${folded[i]}`);
    if (s.lastActedAtBet !== acted[i]) {
      fail('I12', `seat ${i}: lastActedAtBet ${s.lastActedAtBet}, log ${String(acted[i])}`);
    }
  });
  const scalars: [string, unknown, unknown][] = [
    ['street', h.street, street],
    ['currentBet', h.currentBet, currentBet],
    ['minRaiseInc', h.minRaiseInc, minRaiseInc],
    ['lastAggressor', h.lastAggressor, lastAggressor],
    ['preflopAggressor', h.preflopAggressor, preflopAggressor],
    ['runout', h.runout, runout],
  ];
  for (const [name, actual, fromLog] of scalars) {
    if (actual !== fromLog) fail('I12', `${name} is ${String(actual)}, log ${String(fromLog)}`);
  }
  if (!sameList(h.board, board)) fail('I12', `board ${cards(h.board)}, log ${cards(board)}`);
  if (!sameList(h.revealed, revealed)) {
    fail('I12', `revealed ${seatList(h.revealed)}, log ${seatList(revealed)}`);
  }
  if (!sameList(h.undoneDecisions, undone)) {
    fail('I12', `undoneDecisions ${seatList(h.undoneDecisions)}, log ${seatList(undone)}`);
  }
  const r = h.result;
  if (r === null) {
    if (potsAwarded.size > 0) fail('I12', 'awards before the hand is complete');
    return;
  }
  if (potsAwarded.size !== r.pots.length) {
    fail('I12', `${potsAwarded.size} of ${r.pots.length} pots are awarded in the log`);
  }
  r.payouts.forEach((x, i) => {
    if (x !== awarded[i]) fail('I12', `seat ${i}: payout ${x}, log awards ${String(awarded[i])}`);
  });
}
