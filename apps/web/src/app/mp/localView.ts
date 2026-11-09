/**
 * The seam of PLAN §19.6: a `TableView` from the server as the fields of the store's `game` slice,
 * so the one Table shows a table of the server's without knowing it. Pure.
 *
 * Local seat `i` is the real seat `order[i]` (`seatOrder`): the viewer is seat 0 and an empty seat
 * does not exist. ⚠️ The `HandState` built here never goes to `step`, `checkInvariants`, a worker
 * or `persist`: it has no deck, no seed and other players' cards are null until they are revealed.
 *
 * `coachLevel: 'exam'`: `LEVEL_RULES.exam` shows no win badge, price chip, "By river", tips, Undo
 * or grade chips (§10.2), so the Table's coach places go quiet from the data they already read.
 */
import { ZERO_SEED } from '../../core/rng.ts';
import type {
  HandResult,
  HandState,
  LegalActions,
  LogEvent,
  PublicHand,
  SeatState,
  TableState,
} from '../../engine/types.ts';
import type { SeatInfo, TableView } from '../../net/protocol.ts';
import { NO_SEAT_STATS, seatOrder, type ControllerMode, type GameSlice } from '../store.ts';

/** Everything of the `game` slice but the controller's own diagnostics counters. */
export type LocalGame = Omit<GameSlice, 'diag'>;

const NO_DECISIONS: GameSlice['decisions'] = Object.freeze([]);

/** Real seat → local seat. Every seat of a hand exists in `view.seats` (§19.5). */
type ToLocal = (real: number) => number;

function localEvent(e: LogEvent, seat: ToLocal): LogEvent {
  switch (e.e) {
    case 'post':
    case 'act':
    case 'refund':
      return { ...e, seat: seat(e.seat) };
    case 'reveal':
    case 'award':
      return { ...e, seats: e.seats.map(seat) };
    case 'street':
    case 'reshuffle':
      return e;
  }
}

function localResult(
  result: HandResult,
  seat: ToLocal,
  pick: <T>(perSeat: readonly T[]) => T[],
): HandResult {
  return {
    endedBy: result.endedBy,
    pots: result.pots.map((p) => ({ amount: p.amount, eligible: p.eligible.map(seat) })),
    potWinners: result.potWinners.map((winners) => winners.map(seat)),
    payouts: pick(result.payouts),
    net: pick(result.net),
    shown: result.shown.map((x) => ({ ...x, seat: seat(x.seat) })),
  };
}

function localHand(
  view: TableView,
  hand: PublicHand,
  order: readonly number[],
  seat: ToLocal,
): HandState {
  const pick = <T>(perSeat: readonly T[]): T[] => order.map((real) => perSeat[real] as T);
  const seats = pick(hand.seats).map((s, local): SeatState => {
    // The engine's slot says 0 for a seat that is not dealt in: its chips are in the seat info.
    const info = view.seats[order[local] as number] as SeatInfo;
    return { ...s, stack: s.dealtIn ? s.stack : info.stack, lastActedAtBet: null };
  });
  const startStacks = pick(hand.startStacks);
  return {
    schema: 1,
    engineVersion: '',
    handSeq: hand.handSeq,
    seed: ZERO_SEED,
    sb: hand.sb,
    bb: hand.bb,
    seats,
    button: seat(hand.button),
    sbSeat: seat(hand.sbSeat),
    bbSeat: seat(hand.bbSeat),
    street: hand.street,
    phase: hand.phase,
    board: hand.board,
    deck: [],
    deckPos: 0,
    currentBet: hand.currentBet,
    minRaiseInc: hand.minRaiseInc,
    lastAggressor: null,
    preflopAggressor: null,
    toAct: hand.toAct === null ? null : seat(hand.toAct),
    runout: hand.runout,
    revealed: hand.revealed.map(seat),
    undoneDecisions: [],
    startTotal: startStacks.reduce((a, b) => a + b, 0),
    startStacks,
    log: hand.log.map((e) => localEvent(e, seat)),
    result: hand.result === null ? null : localResult(hand.result, seat, pick),
  };
}

function localTable(
  view: TableView,
  heroName: string,
  order: readonly number[],
  seat: ToLocal,
): TableState {
  return {
    schema: 1,
    engineVersion: '',
    tableId: view.code,
    tableSeed: ZERO_SEED,
    config: {
      seatCount: order.length,
      sb: view.settings.sb,
      bb: view.settings.bb,
      startingStack: view.settings.stack,
      botLevel: 'easy',
      seatLevels: order.map(() => null),
    },
    slots: order.map((real, local) => {
      const info = view.seats[real] as SeatInfo;
      return {
        playerId: `s${real}`,
        name: local === 0 ? heroName : info.name,
        kind: local === 0 ? 'hero' : 'remote',
        personality: null,
        stack: info.stack,
      };
    }),
    button: view.hand === null ? -1 : seat(view.hand.button),
    prevBB: null,
    nextHandSeq: (view.hand?.handSeq ?? view.handsPlayed) + 1,
    handsDealt: view.hand === null ? view.handsPlayed : view.hand.handSeq - 1,
    personalityCursor: 0,
    nameCursor: 0,
    reloads: 0,
  };
}

function modeOf(hand: PublicHand | null, legal: LegalActions | null): ControllerMode {
  if (hand === null) return 'idle';
  if (hand.phase === 'complete') return 'handEnd';
  if (legal !== null) return 'heroTurn';
  return hand.phase === 'betting' ? 'botTurn' : 'advancing'; // botTurn: someone else's turn
}

/** One view as the `game` slice's fields. `heroName` is the viewer's own name on the Table. */
export function localView(view: TableView, heroName: string): LocalGame {
  const order = seatOrder(view);
  const toLocal = new Map(order.map((real, local) => [real, local]));
  const seat: ToLocal = (real) => toLocal.get(real) as number;
  // The bar and the price chip read `legal.seat` against the local seats: it is the viewer's.
  const legal = view.legal === null ? null : { ...view.legal, seat: 0 };
  return {
    mode: modeOf(view.hand, legal),
    table: localTable(view, heroName, order, seat),
    hand: view.hand === null ? null : localHand(view, view.hand, order, seat),
    next: null,
    legal,
    heroBust: view.seats[view.you]?.status === 'busted',
    seatStats: NO_SEAT_STATS,
    canUndo: false,
    feedback: null,
    decisions: NO_DECISIONS,
    coachLevel: 'exam',
    summary: null,
  };
}
