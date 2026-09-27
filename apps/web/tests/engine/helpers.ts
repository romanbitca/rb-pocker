/**
 * Helpers for engine tests that start from the real `createTable` + `startHand` (Appendix B:
 * "Each vector is a unit test that builds the state with createTable + startHand (seeded or with
 * a fixed deck when cards matter)").
 *
 * - `tableWith` builds a table with given stacks and, optionally, the seat that gets the next
 *   button; `deal` starts the hand and checks every invariant, the log replay included.
 * - `rigDeck` gives chosen seats chosen hole cards and fixes the board, for vectors where cards
 *   matter.
 * - `finishByFolds` and `finishAllIn` end a started hand without `step`/`settle` (they do not
 *   exist yet), so `nextTable` can be tested over many hands. Both produce states whose log
 *   replays (I12).
 */
import { parseCards, type Card } from '../../src/core/cards.ts';
import { seedWords, type Seed128 } from '../../src/core/rng.ts';
import { categoryOf, score7 } from '../../src/eval/evaluate.ts';
import { checkInvariants } from '../../src/engine/invariants.ts';
import { startHand } from '../../src/engine/start.ts';
import { createTable } from '../../src/engine/table.ts';
import type {
  BotLevel,
  HandState,
  PlayerSlot,
  SeatState,
  TableConfig,
  TableState,
} from '../../src/engine/types.ts';
import { testSeed } from '../helpers/seed.ts';
import {
  SEED,
  best5,
  betTo,
  callBy,
  checkBy,
  clone,
  dealNextStreet,
  foldBy,
  refundUncalled,
} from './fixtures.ts';

export { SEED };

/** A table seed for tests (not the C.4 hand seed). */
export const TABLE_SEED: Seed128 = 'fedcba9876543210fedcba9876543210';

/**
 * The fast-check seed of the engine property tests: fixed, so CI is deterministic;
 * `TEST_SEED=random` or `TEST_SEED=<32 hex>` changes it (PLAN "Testing strategy", Rules).
 */
export const FC_SEED = (seedWords(testSeed('20260928000000000000000000002200'))[0] as number) | 0;

/** Checks every invariant including the log replay (I12); returns `h` for chaining. */
export function checked(h: HandState): HandState {
  checkInvariants(h, { replayLog: true });
  return h;
}

const seatOf = (h: HandState, seat: number): SeatState => h.seats[seat] as SeatState;
const isActive = (s: SeatState): boolean => s.dealtIn && !s.folded && !s.allIn;

export interface TableSpec {
  sb?: number;
  bb?: number;
  startingStack?: number;
  botLevel?: BotLevel;
  seatLevels?: (BotLevel | null)[];
  tableSeed?: Seed128;
  /** The seat that gets the button in the next `startHand` (default: the table seed's draw). */
  button?: number;
  nextHandSeq?: number;
}

/** A config for `stacks.length` seats: 50/100 and 10,000 chips unless the spec says otherwise. */
export function configFor(seatCount: number, spec: TableSpec = {}): TableConfig {
  return {
    seatCount,
    sb: spec.sb ?? 50,
    bb: spec.bb ?? 100,
    startingStack: spec.startingStack ?? 10000,
    botLevel: spec.botLevel ?? 'easy',
    seatLevels: spec.seatLevels ?? new Array<BotLevel | null>(seatCount).fill(null),
  };
}

/** The hero in seat 0 and one bot per other seat, with the given stacks. */
export function slotsFor(stacks: readonly number[]): PlayerSlot[] {
  return stacks.map((stack, seat) =>
    seat === 0
      ? { playerId: 'hero', name: 'You', kind: 'hero', personality: null, stack }
      : { playerId: `bot-${seat - 1}`, name: `P${seat}`, kind: 'bot', personality: 'tag', stack },
  );
}

/**
 * `createTable` with these stacks. With `spec.button`, the table's last button is set to the
 * dealt-in seat before it, so the next hand's moving button lands on `spec.button` (§3.3).
 */
export function tableWith(stacks: readonly number[], spec: TableSpec = {}): TableState {
  const table = createTable(
    configFor(stacks.length, spec),
    slotsFor(stacks),
    spec.tableSeed ?? TABLE_SEED,
  );
  if (spec.nextHandSeq !== undefined) table.nextHandSeq = spec.nextHandSeq;
  if (spec.button !== undefined) {
    const n = stacks.length;
    let prev = spec.button;
    do prev = (prev - 1 + n) % n;
    while ((stacks[prev] ?? 0) <= 0);
    table.button = prev;
  }
  return table;
}

/** `startHand` plus every invariant check (the log replay included). */
export function deal(table: TableState, handSeed: Seed128 = SEED): HandState {
  return checked(startHand(table, handSeed));
}

/** Dealt-in seats in dealing order (§3.4), for tests. */
export function dealOrderOf(h: HandState): number[] {
  const n = h.seats.length;
  const order: number[] = [];
  for (let d = 1; d <= n; d++) {
    const seat = (h.button + d) % n;
    if (seatOf(h, seat).dealtIn) order.push(seat);
  }
  return order;
}

/**
 * A freshly started hand with its deck rearranged so that each seat in `holes` gets those hole
 * cards ("Ah Kd": first card, second card) and the board is `board` (up to five cards, in order:
 * flop, turn, river). Every other card keeps its relative order. Only for a hand that has dealt
 * nothing but hole cards (the state `startHand` returns).
 */
export function rigDeck(
  h: HandState,
  cards: { holes?: Record<number, string>; board?: string },
): HandState {
  if (h.board.length > 0) throw new Error('rigDeck: only before the flop');
  const order = dealOrderOf(h);
  const k = order.length;
  const wanted = new Map<number, Card>(); // deck position → card
  for (const [seatText, text] of Object.entries(cards.holes ?? {})) {
    const seat = Number(seatText);
    const j = order.indexOf(seat);
    if (j < 0) throw new Error(`rigDeck: seat ${seat} is not dealt in`);
    const [first, second] = parseCards(text);
    if (first === undefined || second === undefined) throw new Error(`rigDeck: "${text}"`);
    wanted.set(j, first);
    wanted.set(k + j, second);
  }
  const positions = [2 * k + 1, 2 * k + 2, 2 * k + 3, 2 * k + 5, 2 * k + 7];
  parseCards(cards.board ?? '').forEach((c, i) => wanted.set(positions[i] as number, c));
  const fixed = new Set(wanted.values());
  if (fixed.size !== wanted.size) throw new Error('rigDeck: a card is used twice');
  const rest = h.deck.filter((c) => !fixed.has(c));
  const deck = h.deck.map((_, pos) => wanted.get(pos) ?? (rest.shift() as Card));
  const c = clone(h);
  c.deck = deck;
  order.forEach((seat, j) => {
    seatOf(c, seat).hole = [deck[j] as Card, deck[k + j] as Card];
  });
  return checked(c);
}

/**
 * Ends a started hand the quick way: every live seat but the big blind folds, the uncalled part
 * is refunded, and the big blind wins the pot (a fold win, §3.7). Needs every seat but the big
 * blind to be able to fold, so not when the small blind is all-in; returns null then.
 */
export function finishByFolds(h: HandState): HandState | null {
  if (h.phase !== 'betting' || h.street !== 'preflop') return null;
  const folders = h.seats.flatMap((s, i) => (s.dealtIn && i !== h.bbSeat ? [i] : []));
  if (folders.some((i) => seatOf(h, i).allIn)) return null;
  const c = clone(h);
  for (const i of folders) foldBy(c, i);
  refundUncalled(c);
  c.toAct = null;
  const pot = c.seats.reduce((a, s) => a + s.totalBet, 0);
  const payouts = c.seats.map((_, i) => (i === c.bbSeat ? pot : 0));
  seatOf(c, c.bbSeat).stack += pot;
  for (const s of c.seats) s.allIn = s.dealtIn && !s.folded && s.stack === 0;
  c.result = {
    endedBy: 'fold',
    pots: [{ amount: pot, eligible: [c.bbSeat] }],
    potWinners: [[c.bbSeat]],
    payouts,
    net: c.seats.map((s, i) => (payouts[i] as number) - s.totalBet),
    shown: [],
  };
  c.log.push({ e: 'award', pot: 0, seats: [c.bbSeat], amounts: [pot] });
  c.phase = 'complete';
  return checked(c);
}

/**
 * §3.8 settlement at showdown, for the finisher below: side pots by contribution level (folded
 * chips included, only live seats eligible; pots with the same eligible seats merge), the best
 * score wins each pot, ties split with the odd chips going one by one clockwise from the seat left
 * of the button. Mutates `c` to 'complete'.
 */
function settleShowdown(c: HandState): void {
  const n = c.seats.length;
  const live = c.seats.flatMap((s, i) => (s.dealtIn && !s.folded ? [i] : []));
  const scores = new Map<number, number>();
  for (const i of live) {
    scores.set(i, score7([...(seatOf(c, i).hole as [Card, Card]), ...c.board], 7));
  }
  const levels = [...new Set(live.map((i) => seatOf(c, i).totalBet))].sort((a, b) => a - b);
  const pots: { amount: number; eligible: number[] }[] = [];
  let prev = 0;
  for (const level of levels) {
    const amount = c.seats.reduce(
      (a, s) => a + Math.min(s.totalBet, level) - Math.min(s.totalBet, prev),
      0,
    );
    const eligible = live.filter((i) => seatOf(c, i).totalBet >= level);
    const last = pots[pots.length - 1];
    if (amount > 0) {
      if (last !== undefined && last.eligible.join() === eligible.join()) last.amount += amount;
      else pots.push({ amount, eligible });
    }
    prev = level;
  }
  const clockwise = (seats: number[]): number[] =>
    [...seats].sort((a, b) => ((a - c.button - 1 + n) % n) - ((b - c.button - 1 + n) % n));
  const payouts = new Array<number>(n).fill(0);
  const potWinners = pots.map((p) => {
    const best = Math.max(...p.eligible.map((i) => scores.get(i) as number));
    return clockwise(p.eligible.filter((i) => scores.get(i) === best));
  });
  pots.forEach((p, i) => {
    const winners = potWinners[i] as number[];
    const share = Math.floor(p.amount / winners.length);
    const rem = p.amount % winners.length;
    const amounts = winners.map((_, j) => share + (j < rem ? 1 : 0));
    winners.forEach((seat, j) => {
      payouts[seat] = (payouts[seat] as number) + (amounts[j] as number);
    });
    c.log.push({ e: 'award', pot: i, seats: winners, amounts });
  });
  c.seats.forEach((s, i) => {
    s.stack += payouts[i] as number;
    s.allIn = s.dealtIn && !s.folded && s.stack === 0;
  });
  c.result = {
    endedBy: 'showdown',
    pots,
    potWinners,
    payouts,
    net: c.seats.map((s, i) => (payouts[i] as number) - s.totalBet),
    shown: c.revealed.map((seat) => {
      const seven = [...(seatOf(c, seat).hole as [Card, Card]), ...c.board];
      const score = scores.get(seat) as number;
      return { seat, score, category: categoryOf(score), best5: best5(seven) };
    }),
  };
  c.phase = 'complete';
}

/**
 * Ends a started hand with everyone all-in preflop: going round once from the seat to act, each
 * active seat raises all-in when it has more than the current bet and someone could still answer,
 * and otherwise calls (or checks). Then the uncalled part is refunded, the board runs out with all
 * hands face up (§3.7), and the pots are settled by the cards. Seats that win nothing bust, which
 * exercises `nextTable`'s bot replacement.
 */
export function finishAllIn(h: HandState): HandState {
  const c = clone(h);
  const n = c.seats.length;
  if (c.phase === 'betting') {
    const first = c.toAct as number;
    for (let d = 0; d < n; d++) {
      const seat = (first + d) % n;
      const s = seatOf(c, seat);
      if (!isActive(s)) continue;
      const allInTo = s.streetBet + s.stack;
      const answer = c.seats.some((q, i) => i !== seat && isActive(q));
      if (allInTo > c.currentBet && answer) betTo(c, seat, allInTo);
      else if (c.currentBet > s.streetBet) callBy(c, seat);
      else checkBy(c, seat);
    }
    refundUncalled(c);
    c.toAct = null;
    c.phase = 'roundComplete';
  }
  // The run-out: every live hand face up (first live seat left of the button, then clockwise).
  const revealed: number[] = [];
  for (let d = 1; d <= n; d++) {
    const seat = (c.button + d) % n;
    const s = seatOf(c, seat);
    if (s.dealtIn && !s.folded) revealed.push(seat);
  }
  c.runout = true;
  c.revealed = revealed;
  c.log.push({ e: 'reveal', seats: revealed, reason: 'runout' });
  while (c.street !== 'river') dealNextStreet(c);
  c.phase = 'showdown';
  settleShowdown(c);
  return checked(c);
}
