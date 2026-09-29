/**
 * Selectors from engine state to the table's view models (PLAN §2.5 "State"): the shapes of
 * `ui/views.ts` (`SeatView`, `CardView`, `PotView`, `HeroHandView`), plus the hero strip, the
 * action bar's input, the top bar, the hand-end banner and Home's session line. `app` may not import
 * `ui`, not even its types (§2.1), so the objects here are structurally equal to the `ui/views.ts`
 * ones (a type test in tests/app/tableViews.test.ts keeps them assignable). The UI reaches them
 * through `app/store.ts`, which re-exports this module.
 *
 * ⚠️ Hidden information never enters a view (pitfall 13, Stage 3 acceptance 7): a bot's hole cards
 * are `{ kind: 'hidden' }` (no card values) unless its seat is in `hand.revealed`, which the engine
 * fills only at a run-out or a showdown (§4.3). Folded cards are mucked (`none`).
 *
 * Every selector is memoized on the store fields it reads, so a component subscribed to it
 * re-renders only when its view changes; a seat whose view did not change keeps the same object
 * (its `React.memo` pod skips the render, pitfall 37).
 */
import type { Card } from '../core/cards.ts';
import { describe, type HandInfo } from '../eval/describe.ts';
import type { HandCategory } from '../eval/evaluate.ts';
import { sidePots } from '../engine/settle.ts';
import type {
  HandState,
  LegalActions,
  PersonalityId,
  SeatState,
  Street,
  TableState,
} from '../engine/types.ts';
import type { AppState } from './store.ts';

const HERO = 0;

// ---------------------------------------------------------------------------------------------
// The shapes (structurally equal to ui/views.ts)

/** `CardView`: `card: null` = face down; `highlight` per §6.1. */
export interface CardViewData {
  readonly card: Card | null;
  readonly highlight?: 'core' | 'kicker' | 'off';
}

export type SeatCardsData =
  | { readonly kind: 'none' }
  | { readonly kind: 'hidden' }
  | { readonly kind: 'revealed'; readonly cards: readonly [CardViewData, CardViewData] };

/** `SeatView`: one opponent's pod (§12.4). */
export interface SeatViewData {
  readonly seat: number;
  readonly name: string;
  readonly personality: PersonalityId | null;
  readonly stack: number;
  readonly bet: number;
  readonly dealer: boolean;
  readonly blind: 'sb' | 'bb' | null;
  readonly folded: boolean;
  readonly allIn: boolean;
  readonly toAct: boolean;
  readonly lastAction: 'check' | 'call' | 'bet' | 'raise' | null;
  readonly cards: SeatCardsData;
  readonly winner: boolean;
}

/** `PotView` (§12.3). */
export interface PotViewData {
  readonly total: number;
  readonly pots: readonly number[];
}

/** `HeroHandView`: the hero's hand for the rankings panel (§13.3). */
export interface HeroHandViewData {
  readonly handSeq: number;
  readonly category: HandCategory;
  readonly best5: readonly Card[];
  readonly kickers: readonly Card[];
  readonly hole: readonly [Card, Card];
  readonly folded: boolean;
}

/** The hero strip (§12.3): cards with highlights, chips, and `describe()`'s label (main thread). */
export interface HeroView {
  readonly handSeq: number;
  /** The hero's hole cards, highlighted per §6.1 while the hero is in the hand. */
  readonly hole: readonly [CardViewData, CardViewData];
  readonly stack: number;
  readonly bet: number;
  readonly dealer: boolean;
  readonly blind: 'sb' | 'bb' | null;
  readonly folded: boolean;
  readonly allIn: boolean;
  /** It is the hero's turn (the action bar is live). */
  readonly toAct: boolean;
  /** `describe(hole, board)`: `name` is the label ("Pair of Kings"), `subLabel` the line under it. */
  readonly label: string;
  readonly subLabel: string | null;
  readonly category: HandCategory;
  /** "AKs" before the flop, else null. */
  readonly preflopClass: string | null;
}

/** What `actionBarView()` (ui/actionBar.ts, chunk 3.5) takes: its `ActionBarInput`. */
export interface ActionBarInputData {
  readonly legal: LegalActions | null;
  readonly street: Street;
  readonly currentBet: number;
  readonly sb: number;
  readonly bb: number;
  readonly seats: readonly SeatState[];
  readonly amounts: 'chips' | 'bb';
}

/** The top bar (§12.3): "Blinds 10/20 · Hand 12", and the seat count for `tableGeometry()`. */
export interface TableInfo {
  readonly sb: number;
  readonly bb: number;
  /** The hand on the table: the table's `handsDealt + 1` (Appendix A.3). */
  readonly handNumber: number;
  /** Seats, you included (2..9). */
  readonly players: number;
  /** Bots: `tableGeometry(layout, size, opponents)`. */
  readonly opponents: number;
  readonly startingStack: number;
}

/** The hand-end banner (§12.9). Names and hand names are ready to print. */
export interface HandEndView {
  readonly handSeq: number;
  readonly endedBy: 'fold' | 'showdown';
  /** Per winning seat, its payout (summed over the pots it won), in seat order. */
  readonly winners: readonly { seat: number; name: string; amount: number }[];
  /** Hands shown at the showdown, in reveal order, with `describe()`'s name ("Two Pair, …"). */
  readonly shown: readonly {
    seat: number;
    name: string;
    handName: string;
    category: HandCategory;
    best5: readonly Card[];
  }[];
  /** The hero's net result this hand (payout − chips put in). */
  readonly heroNet: number;
}

/** Home's line under Play (§12.1, F.10): "Hand 23 · 6 players · You have 2,340 chips · …". */
export interface SessionLine {
  readonly hand: number;
  readonly players: number;
  readonly chips: number;
  readonly botLevel: AppState['settings']['botLevel'];
  readonly coachLevel: AppState['settings']['coachLevel'];
}

// ---------------------------------------------------------------------------------------------
// Builders (pure)

const infoCache = new WeakMap<HandState, HandInfo | null>();

/** `describe()` of the hero's hand (cached per state; null when the hero has no cards). */
export function heroInfo(hand: HandState): HandInfo | null {
  if (infoCache.has(hand)) return infoCache.get(hand) ?? null;
  const hole = hand.seats[HERO]?.hole ?? null;
  const info = hole === null ? null : describe(hole, hand.board);
  infoCache.set(hand, info);
  return info;
}

/** §6.1 highlight of a card for the hero's best five (none preflop or once the hero folded). */
function highlightOf(info: HandInfo | null, card: Card, board: boolean): CardViewData {
  if (info === null || info.best5.length === 0) return { card };
  if (info.core.includes(card)) return { card, highlight: 'core' };
  if (info.kickers.includes(card)) return { card, highlight: 'kicker' };
  return board ? { card, highlight: 'off' } : { card };
}

const blindOf = (hand: HandState, seat: number): 'sb' | 'bb' | null =>
  seat === hand.sbSeat ? 'sb' : seat === hand.bbSeat ? 'bb' : null;

/** Chips in front of the seat: this street's bet until the street ends (§12.4 "Bets"). */
const betOf = (hand: HandState, s: SeatState): number =>
  hand.phase === 'betting' || hand.phase === 'roundComplete' ? s.streetBet : 0;

function lastActionOf(hand: HandState, seat: number): SeatViewData['lastAction'] {
  for (let i = hand.log.length - 1; i >= 0; i--) {
    const e = hand.log[i];
    if (e === undefined || e.e === 'street') return null; // nothing yet on this street
    if (e.e === 'act' && e.seat === seat) return e.action.type === 'fold' ? null : e.action.type;
  }
  return null;
}

function isWinner(hand: HandState, seat: number): boolean {
  return hand.result !== null && hand.result.potWinners.some((w) => w.includes(seat));
}

function cardsOf(hand: HandState, seat: number): SeatCardsData {
  const s = hand.seats[seat] as SeatState;
  if (!s.dealtIn || s.folded || s.hole === null) return { kind: 'none' };
  if (!hand.revealed.includes(seat)) return { kind: 'hidden' };
  const shown = hand.result?.shown.find((x) => x.seat === seat);
  const best5 = shown !== undefined && isWinner(hand, seat) ? shown.best5 : null;
  const face = (card: Card): CardViewData =>
    best5 === null ? { card } : { card, highlight: best5.includes(card) ? 'core' : 'off' };
  return { kind: 'revealed', cards: [face(s.hole[0]), face(s.hole[1])] };
}

/** One opponent's pod from the hand and the table it was dealt from. */
export function seatView(hand: HandState, table: TableState, seat: number): SeatViewData {
  const s = hand.seats[seat] as SeatState;
  const slot = table.slots[seat];
  const level = table.config.seatLevels[seat] ?? table.config.botLevel;
  const visible = level === 'easy' || level === 'medium';
  return {
    seat,
    name: slot?.name ?? '',
    personality: visible ? (slot?.personality ?? null) : null,
    stack: s.stack,
    bet: betOf(hand, s),
    dealer: hand.button === seat,
    blind: blindOf(hand, seat),
    folded: s.dealtIn && s.folded,
    allIn: s.allIn,
    toAct: hand.phase === 'betting' && hand.toAct === seat,
    lastAction: lastActionOf(hand, seat),
    cards: cardsOf(hand, seat),
    winner: isWinner(hand, seat),
  };
}

function sameCard(a: CardViewData, b: CardViewData): boolean {
  return a.card === b.card && a.highlight === b.highlight;
}

function sameCards(a: SeatCardsData, b: SeatCardsData): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind !== 'revealed' || b.kind !== 'revealed') return true;
  return sameCard(a.cards[0], b.cards[0]) && sameCard(a.cards[1], b.cards[1]);
}

/** Field-by-field: two views that show the same pod. */
export function sameSeatView(a: SeatViewData, b: SeatViewData): boolean {
  return (
    a.seat === b.seat &&
    a.name === b.name &&
    a.personality === b.personality &&
    a.stack === b.stack &&
    a.bet === b.bet &&
    a.dealer === b.dealer &&
    a.blind === b.blind &&
    a.folded === b.folded &&
    a.allIn === b.allIn &&
    a.toAct === b.toAct &&
    a.lastAction === b.lastAction &&
    a.winner === b.winner &&
    sameCards(a.cards, b.cards)
  );
}

export function potView(hand: HandState): PotViewData {
  const total = hand.seats.reduce((a, s) => a + s.totalBet, 0);
  if (hand.result !== null) return { total, pots: hand.result.pots.map((p) => p.amount) };
  const anyAllIn = hand.seats.some((s) => s.dealtIn && !s.folded && s.allIn);
  return { total, pots: anyAllIn ? sidePots(hand).map((p) => p.amount) : [total] };
}

export function heroHandViewOf(hand: HandState): HeroHandViewData | null {
  const s = hand.seats[HERO];
  const info = heroInfo(hand);
  if (s === undefined || s.hole === null || info === null) return null;
  return {
    handSeq: hand.handSeq,
    category: info.category,
    best5: info.best5,
    kickers: info.kickers,
    hole: [s.hole[0], s.hole[1]],
    folded: s.folded,
  };
}

export function heroViewOf(hand: HandState, legal: LegalActions | null): HeroView | null {
  const s = hand.seats[HERO];
  const info = heroInfo(hand);
  if (s === undefined || s.hole === null || info === null) return null;
  const live = s.folded ? null : info;
  return {
    handSeq: hand.handSeq,
    hole: [highlightOf(live, s.hole[0], false), highlightOf(live, s.hole[1], false)],
    stack: s.stack,
    bet: betOf(hand, s),
    dealer: hand.button === HERO,
    blind: blindOf(hand, HERO),
    folded: s.folded,
    allIn: s.allIn,
    toAct: legal !== null,
    label: info.name,
    subLabel: info.subLabel,
    category: info.category,
    preflopClass: info.preflopClass,
  };
}

/**
 * The board with §6.1 highlights for the hero's best five (none once the hero folded). After a
 * showdown that a bot won (the main pot), its winning five instead (§12.9 "winning five
 * highlighted"); its cards are face up by then (`hand.revealed`), so nothing hidden shows.
 */
export function boardViewOf(hand: HandState): CardViewData[] {
  const result = hand.result;
  const winner = result?.endedBy === 'showdown' ? result.potWinners[0]?.[0] : undefined;
  const winnerHole = winner === undefined ? null : (hand.seats[winner]?.hole ?? null);
  if (winner !== undefined && winner !== HERO && winnerHole !== null) {
    if (hand.revealed.includes(winner)) {
      const info = describe(winnerHole, hand.board);
      return hand.board.map((card) => highlightOf(info, card, true));
    }
  }
  const hero = hand.seats[HERO];
  const info = hero === undefined || hero.folded ? null : heroInfo(hand);
  return hand.board.map((card) => highlightOf(info, card, true));
}

export function handEndViewOf(hand: HandState, table: TableState): HandEndView | null {
  const result = hand.result;
  if (result === null) return null;
  const nameOf = (seat: number): string => table.slots[seat]?.name ?? '';
  const winners = result.payouts.flatMap((amount, seat) =>
    amount > 0 && isWinner(hand, seat) ? [{ seat, name: nameOf(seat), amount }] : [],
  );
  const shown = result.shown.map((x) => {
    const hole = hand.seats[x.seat]?.hole as [Card, Card];
    return {
      seat: x.seat,
      name: nameOf(x.seat),
      handName: describe(hole, hand.board).name,
      category: x.category,
      best5: x.best5,
    };
  });
  return {
    handSeq: hand.handSeq,
    endedBy: result.endedBy,
    winners,
    shown,
    heroNet: result.net[HERO] ?? 0,
  };
}

// ---------------------------------------------------------------------------------------------
// Memoized selectors

/** A one-slot cache: the last result for the same inputs (compared with `===`). */
function memo<A extends readonly unknown[], R>(f: (...args: A) => R): (...args: A) => R {
  let last: { args: A; result: R } | null = null;
  return (...args: A): R => {
    if (last !== null && last.args.every((x, i) => x === args[i])) return last.result;
    const result = f(...args);
    last = { args, result };
    return result;
  };
}

let lastSeats: readonly SeatViewData[] = [];
const seatViewsMemo = memo(
  (hand: HandState | null, table: TableState | null): readonly SeatViewData[] => {
    if (hand === null || table === null) {
      lastSeats = [];
      return lastSeats;
    }
    const views: SeatViewData[] = [];
    for (let seat = 1; seat < hand.seats.length; seat++) {
      const view = seatView(hand, table, seat);
      const old = lastSeats[seat - 1];
      views.push(old !== undefined && sameSeatView(old, view) ? old : view);
    }
    const same = views.length === lastSeats.length && views.every((v, i) => v === lastSeats[i]);
    if (!same) lastSeats = views;
    return lastSeats;
  },
);

/**
 * The opponents' pods, seat 1 first (index `i` = seat `i + 1`, as `tableGeometry().pods`). A
 * pod whose view did not change keeps its object; the array itself changes only when a pod did.
 */
export const selectSeatViews = (s: AppState): readonly SeatViewData[] =>
  seatViewsMemo(s.game.hand, s.game.table);

const potMemo = memo((hand: HandState | null): PotViewData | null =>
  hand === null ? null : potView(hand),
);
export const selectPotView = (s: AppState): PotViewData | null => potMemo(s.game.hand);

const boardMemo = memo((hand: HandState | null): readonly CardViewData[] =>
  hand === null ? [] : boardViewOf(hand),
);
/** The board cards (0–5) with the hero's highlights. */
export const selectBoardView = (s: AppState): readonly CardViewData[] => boardMemo(s.game.hand);

const heroHandMemo = memo((hand: HandState | null): HeroHandViewData | null =>
  hand === null ? null : heroHandViewOf(hand),
);
/** The rankings panel's `hero` prop (`HeroHandView`); null with no hand dealt. */
export const selectHeroHandView = (s: AppState): HeroHandViewData | null =>
  heroHandMemo(s.game.hand);

const heroMemo = memo((hand: HandState | null, legal: LegalActions | null): HeroView | null =>
  hand === null ? null : heroViewOf(hand, legal),
);
/** The hero strip; null with no hand dealt. */
export const selectHeroView = (s: AppState): HeroView | null => heroMemo(s.game.hand, s.game.legal);

const actionBarMemo = memo(
  (
    hand: HandState | null,
    legal: LegalActions | null,
    amounts: 'chips' | 'bb',
  ): ActionBarInputData | null =>
    hand === null
      ? null
      : {
          legal,
          street: hand.street,
          currentBet: hand.currentBet,
          sb: hand.sb,
          bb: hand.bb,
          seats: hand.seats,
          amounts,
        },
);
/** `actionBarView()`'s input (chunk 3.5): `legal` is non-null only on the hero's turn. */
export const selectActionBarInput = (s: AppState): ActionBarInputData | null =>
  actionBarMemo(s.game.hand, s.game.legal, s.settings.amounts);

/** The table the top bar describes: the hand's while one is shown, else the next hand's. */
const shownTable = (s: AppState): TableState | null =>
  s.game.hand !== null ? s.game.table : (s.game.next ?? s.game.table);

const tableInfoMemo = memo((table: TableState | null): TableInfo | null =>
  table === null
    ? null
    : {
        sb: table.config.sb,
        bb: table.config.bb,
        handNumber: table.handsDealt + 1,
        players: table.config.seatCount,
        opponents: table.config.seatCount - 1,
        startingStack: table.config.startingStack,
      },
);
export const selectTableInfo = (s: AppState): TableInfo | null => tableInfoMemo(shownTable(s));

const handEndMemo = memo((hand: HandState | null, table: TableState | null): HandEndView | null =>
  hand === null || table === null ? null : handEndViewOf(hand, table),
);
/** The banner's data once the hand is complete (§12.9); null before. */
export const selectHandEnd = (s: AppState): HandEndView | null =>
  handEndMemo(s.game.hand, s.game.table);

const sessionLineMemo = memo(
  (
    hand: HandState | null,
    shown: TableState | null,
    botLevel: SessionLine['botLevel'],
    coachLevel: SessionLine['coachLevel'],
  ): SessionLine | null => {
    if (shown === null) return null;
    const live = hand !== null && hand.phase !== 'complete';
    return {
      hand: shown.handsDealt + 1,
      players: shown.config.seatCount,
      chips: live ? (hand.startStacks[HERO] ?? 0) : (shown.slots[HERO]?.stack ?? 0),
      botLevel,
      coachLevel,
    };
  },
);
/**
 * Home's line under Play (§12.1): null when there is no table to continue. Between hands it
 * describes the next hand; mid-hand, the hand on the table (chips as at its start).
 */
export const selectSessionLine = (s: AppState): SessionLine | null => {
  const hand = s.game.hand;
  const shown = hand !== null && hand.phase === 'complete' ? s.game.next : shownTable(s);
  return sessionLineMemo(hand, shown, s.settings.botLevel, s.settings.coachLevel);
};
