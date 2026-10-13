/**
 * The hands kept for Review (PLAN §12.10, Appendix A.7): the last finished hands of this launch,
 * newest first, in memory. Stage 8 stores them (`pc.v1.hands`, §14.3) and Stats → History feeds the
 * same Review screen from there; until then "Review (from memory)" is all there is.
 *
 * Only the controller adds hands (`app/controller.ts` when a hand is complete). The Review screen
 * reads them through the store, and `app/reviewViews.ts` turns one into the frames it steps through.
 *
 * ⚠️ A `ReviewHand` holds the hand's seed (the whole deck follows from it, §2.4) and its table: it is
 * for building views, never for components. What the UI gets of the list is `ReviewListItem`, which
 * has no record, and what it gets of one hand is a `ReviewView` (hidden cards never enter it).
 */
import type { Card } from '../core/cards.ts';
import type { ReplayRecord } from '../engine/types.ts';
import type { HandEndView } from './tableViews.ts';

/** How many finished hands are kept: Stats → History keeps the last 100 (§14.4). */
export const REVIEW_KEEP = 100;

/** One finished hand, as kept in memory. Field names follow `HandRecord` (A.7) where they overlap. */
export interface ReviewHand {
  handSeq: number;
  /** ISO UTC, when the hand ended. */
  at: string;
  /** What `replay()` needs (§4.7): the table as at hand start, the seed and every input. */
  record: ReplayRecord;
  /** The hero's own hole cards (null when the hero was not dealt in). */
  heroHole: [Card, Card] | null;
  /** The result as the hand-end banner shows it (§12.9); `shown` holds only hands that were shown. */
  end: HandEndView;
}

/** Newest first. `selected` is the hand the Review screen shows (`handSeq`); null = the list. */
export interface ReviewSlice {
  hands: readonly ReviewHand[];
  selected: number | null;
}

/** `{ type: 'review' }`: show the Review screen, on a hand (`handSeq`) or on the list (null). */
export interface ReviewCommand {
  type: 'review';
  handSeq: number | null;
}

export const initialReview = (): ReviewSlice => ({ hands: [], selected: null });

/** The slice with `hand` first. A hand with the same `handSeq` is replaced; the oldest fall off. */
export function addHand(slice: ReviewSlice, hand: ReviewHand): ReviewSlice {
  const rest = slice.hands.filter((h) => h.handSeq !== hand.handSeq);
  return { ...slice, hands: [hand, ...rest].slice(0, REVIEW_KEEP) };
}

/** The slice showing `handSeq` (null = the list); a hand that is not kept shows the list. */
export function selectHandSeq(slice: ReviewSlice, handSeq: number | null): ReviewSlice {
  const selected = slice.hands.some((h) => h.handSeq === handSeq) ? handSeq : null;
  return selected === slice.selected ? slice : { ...slice, selected };
}

/** A row of the list of recent hands: no record, no seed (see the module note). */
export interface ReviewListItem {
  readonly handSeq: number;
  /** "Hand 12", the number the table's top bar showed. */
  readonly handNumber: number;
  readonly heroHole: readonly [Card, Card] | null;
  readonly end: HandEndView;
}

export function listItemOf(hand: ReviewHand): ReviewListItem {
  return {
    handSeq: hand.handSeq,
    handNumber: hand.record.table.handsDealt + 1,
    heroHole: hand.heroHole,
    end: hand.end,
  };
}
