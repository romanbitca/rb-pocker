/**
 * The bot card of a tapped seat (PLAN §9.3, Appendix F.6): what its sheet shows. `app` may not
 * import `ui`, so `BotCardData` is structurally equal to `ui/views.ts`'s `BotCardView` (a type test
 * in tests/app/botCardViews.test.ts keeps them assignable); the UI reaches this module through
 * `app/store.ts`, which re-exports it.
 *
 * ⚠️ Like a pod, a card carries no hidden information: the name, the stack and, at Easy and Medium
 * only (§9.2 "Personality label visible"), the personality. At Hard and Expert `personality` is
 * null and the card says "Style: unknown." (the observed stats come with Stage 7). A hole card is
 * never in it.
 */
import type { HandState, PersonalityId, TableState } from '../engine/types.ts';
import type { AppState } from './store.ts';
import { labelVisible, seatLevelOf } from './tableViews.ts';

/** `BotCardView`: one bot's card. */
export interface BotCardData {
  /** Engine seat index, 1..8. */
  readonly seat: number;
  readonly name: string;
  /** The personality, or null when the seat's level hides it (Hard and Expert, §9.2). */
  readonly personality: PersonalityId | null;
  /** Chips behind, as on the pod. */
  readonly stack: number;
}

/**
 * The card for `seat` in `hand`, dealt from `table`. Null for the hero (seat 0, drawn by the hero
 * strip) and for a seat that does not exist.
 */
export function botCardOf(hand: HandState, table: TableState, seat: number): BotCardData | null {
  const slot = table.slots[seat];
  const state = hand.seats[seat];
  if (seat < 1 || slot === undefined || state === undefined || slot.kind !== 'bot') return null;
  return {
    seat,
    name: slot.name,
    personality: labelVisible(seatLevelOf(table, seat)) ? slot.personality : null,
    stack: state.stack,
  };
}

const sameCard = (a: BotCardData, b: BotCardData): boolean =>
  a.seat === b.seat && a.name === b.name && a.personality === b.personality && a.stack === b.stack;

let last: BotCardData | null = null;

/**
 * The open card's data, or null when no card is open (or its seat is gone). An unchanged card keeps
 * its object, so a sheet subscribed to it renders again only when what it shows changes.
 */
export const selectBotCard = (s: AppState): BotCardData | null => {
  const seat = s.ui.botCardSeat;
  const { hand, table } = s.game;
  const next =
    seat === null || hand === null || table === null ? null : botCardOf(hand, table, seat);
  if (next === null || last === null || !sameCard(last, next)) last = next;
  return last;
};
