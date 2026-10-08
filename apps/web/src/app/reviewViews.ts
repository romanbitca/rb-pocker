/**
 * Review's view model (PLAN §4.7, §12.10): one finished hand as a list of frames to step through.
 *
 * `replayStates(record)` rebuilds the hand from its seed, table and inputs (never from bot code),
 * and every state becomes a frame: frame 0 is the deal, frame `i` the table after input `i - 1`,
 * the last frame the result. A frame holds the same view models the live Table draws (`seatView`,
 * `boardViewOf`, `heroViewOf`, `potView` from `app/tableViews.ts`), so Review shows exactly what
 * the Table showed, and hidden information is kept out by the same code.
 *
 * ⚠️ Hidden information never enters a frame (pitfall 13, §3.9, §4.8): a bot's hole cards are
 * `{ kind: 'hidden' }` unless its seat is in that state's `revealed` (set by the engine at a
 * run-out or a showdown, at the step where the cards turned face up), and a folded hand is never
 * shown, not even at the end. The engine states, which hold the deck and every hole card, stay
 * inside `buildReview`; what it returns is plain data.
 *
 * ⚠️ Keep it small: it is part of the initial bundle (§15.3). A separate `import()` for it would
 * split the shared chunks (the React runtime, the Table's view builders) and cost more than it saves.
 */
import type { Card } from '../core/cards.ts';
import { replayStates } from '../engine/replay.ts';
import {
  ENGINE_VERSION,
  type HandState,
  type LogEvent,
  type PlayerAction,
  type Street,
  type TableState,
} from '../engine/types.ts';
import type { ReviewHand } from './review.ts';
import {
  boardViewOf,
  handEndViewOf,
  heroViewOf,
  potView,
  seatView,
  type CardViewData,
  type HandEndView,
  type HeroView,
  type PotViewData,
  type SeatViewData,
} from './tableViews.ts';

const HERO = 0;

/** Who did something: the hero is shown as "You" (the table's slot name). */
export interface ReviewActor {
  readonly seat: number;
  readonly name: string;
  readonly hero: boolean;
}

/** What one step added to the hand's public log, as data; `ui/review.ts` words it. */
export type ReviewEvent =
  | {
      readonly kind: 'blind';
      readonly who: ReviewActor;
      readonly blind: 'sb' | 'bb';
      readonly amount: number;
    }
  | {
      readonly kind: 'act';
      readonly who: ReviewActor;
      readonly action: PlayerAction['type'];
      /** The "to" amount of a bet or raise, else 0. */
      readonly to: number;
      /** Chips this action put in. */
      readonly amountIn: number;
      readonly allIn: boolean;
    }
  | {
      readonly kind: 'street';
      readonly street: Exclude<Street, 'preflop'>;
      readonly cards: readonly Card[];
    }
  | {
      readonly kind: 'reveal';
      readonly who: readonly ReviewActor[];
      readonly reason: 'runout' | 'showdown';
    }
  | { readonly kind: 'refund'; readonly who: ReviewActor; readonly amount: number }
  | { readonly kind: 'reshuffle' };

/** The table at one step of the hand. */
export interface ReviewFrame {
  /** 0 = the deal; the last frame is the result. */
  readonly index: number;
  readonly street: Street;
  /** The opponents' pods, seat 1 first (as `selectSeatViews`); nobody is "thinking" in a replay. */
  readonly seats: readonly SeatViewData[];
  readonly hero: HeroView | null;
  readonly board: readonly CardViewData[];
  readonly pot: PotViewData;
  /** What happened to get here, in order (the blinds on frame 0). */
  readonly events: readonly ReviewEvent[];
}

export interface ReviewReplay {
  readonly replayable: true;
  readonly handSeq: number;
  /** "Hand 12": the table's hand number. */
  readonly handNumber: number;
  readonly sb: number;
  readonly bb: number;
  readonly opponents: number;
  readonly frames: readonly ReviewFrame[];
  /** The result, shown on the last frame (§12.9). */
  readonly end: HandEndView;
}

/** A hand that cannot be replayed: its result only (§4.7 "Review shows the stored summary only"). */
export interface ReviewSummary {
  readonly replayable: false;
  readonly reason: 'version' | 'broken';
  readonly handSeq: number;
  readonly handNumber: number;
  readonly end: HandEndView;
}

export type ReviewView = ReviewReplay | ReviewSummary;

/** "0.1.0" → 0; NaN for anything else. */
const majorOf = (version: string): number => Number.parseInt(version.split('.')[0] ?? '', 10);

const actorOf = (table: TableState, seat: number): ReviewActor => ({
  seat,
  name: table.slots[seat]?.name ?? '',
  hero: seat === HERO,
});

function eventsOf(log: readonly LogEvent[], table: TableState): ReviewEvent[] {
  const events: ReviewEvent[] = [];
  for (const e of log) {
    switch (e.e) {
      case 'post':
        events.push({
          kind: 'blind',
          who: actorOf(table, e.seat),
          blind: e.blind,
          amount: e.amount,
        });
        break;
      case 'act':
        events.push({
          kind: 'act',
          who: actorOf(table, e.seat),
          action: e.action.type,
          to: e.action.type === 'bet' || e.action.type === 'raise' ? e.action.to : 0,
          amountIn: e.amountIn,
          allIn: e.allIn,
        });
        break;
      case 'street':
        if (e.street !== 'preflop')
          events.push({ kind: 'street', street: e.street, cards: [...e.cards] });
        break;
      case 'reveal':
        events.push({
          kind: 'reveal',
          who: e.seats.map((seat) => actorOf(table, seat)),
          reason: e.reason,
        });
        break;
      case 'refund':
        events.push({ kind: 'refund', who: actorOf(table, e.seat), amount: e.amount });
        break;
      case 'reshuffle':
        events.push({ kind: 'reshuffle' });
        break;
      case 'award':
        break; // the result (`end`) says who won what, with the hand names
    }
  }
  return events;
}

function frameOf(
  h: HandState,
  previous: HandState | null,
  index: number,
  table: TableState,
): ReviewFrame {
  const seats: SeatViewData[] = [];
  for (let seat = 1; seat < h.seats.length; seat++) {
    seats.push({ ...seatView(h, table, seat), toAct: false });
  }
  return {
    index,
    street: h.street,
    seats,
    hero: heroViewOf(h, null),
    board: boardViewOf(h),
    pot: potView(h),
    events: eventsOf(h.log.slice(previous?.log.length ?? 0), table),
  };
}

/**
 * The frames of a finished hand. A record from another major engine version, or one that does not
 * replay to a finished hand, gives the summary only (never throws).
 */
export function buildReview(hand: ReviewHand): ReviewView {
  const { record } = hand;
  const table = record.table;
  const summary = (reason: ReviewSummary['reason']): ReviewSummary => ({
    replayable: false,
    reason,
    handSeq: hand.handSeq,
    handNumber: table.handsDealt + 1,
    end: hand.end,
  });
  if (majorOf(record.engineVersion) !== majorOf(ENGINE_VERSION)) return summary('version');

  let states: HandState[];
  try {
    states = replayStates(record);
  } catch {
    return summary('broken');
  }
  const last = states[states.length - 1] as HandState;
  const end = handEndViewOf(last, table);
  if (last.phase !== 'complete' || last.result === null || end === null) return summary('broken');

  return {
    replayable: true,
    handSeq: hand.handSeq,
    handNumber: table.handsDealt + 1,
    sb: last.sb,
    bb: last.bb,
    opponents: table.config.seatCount - 1,
    frames: states.map((h, i) => frameOf(h, states[i - 1] ?? null, i, table)),
    end,
  };
}
