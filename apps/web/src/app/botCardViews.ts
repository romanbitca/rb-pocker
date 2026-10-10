/**
 * The bot card of a tapped seat (PLAN §9.3, Appendix F.6): what its sheet shows. `app` may not
 * import `ui`, so `BotCardData` is structurally equal to `ui/views.ts`'s `BotCardView` (a type test
 * in tests/app/botCardViews.test.ts keeps them assignable); the UI reaches this module through
 * `app/store.ts`, which re-exports it.
 *
 * ⚠️ Like a pod, a card carries no hidden information: the name, the stack and, at Easy and Medium
 * only (§9.2 "Personality label visible"), the personality. At Hard and Expert `personality` is
 * null and the card says "Style: unknown." with what the player has seen the bot do (chunk 7.1):
 * the share of hands it played and raised and how often it bets after the flop, from the table's
 * §9.5 seat statistics (public: every player saw the same actions). A hole card is never in it.
 */
import type { BotLevel, HandState, PersonalityId, SeatStats, TableState } from '../engine/types.ts';
import { labelVisible, nextLevels, seatLevelOf } from './levels.ts';
import type { AppState } from './store.ts';

/** How often a bot bets or raises after the flop, from what was seen (§9.3 "Bets often"). */
export type SeenAggression = 'betsOften' | 'betsSometimes' | 'mostlyCalls';

/** What the player has seen a Hard or Expert bot do (§9.3): plain numbers for plain words. */
export interface SeenPlay {
  /** Hands in which it made a decision before the flop (the §9.5 VPIP opportunities). */
  readonly hands: number;
  /** Whole percentage of those hands it played (called or raised before the flop, VPIP). */
  readonly plays: number;
  /** Whole percentage of those hands it raised before the flop (PFR). */
  readonly raises: number;
  /** From its bets and raises against its calls after the flop; null before any of them. */
  readonly aggression: SeenAggression | null;
}

/**
 * A seat's level from the next hand on (§9.3 per-seat override, chunk 7.2): what the card's level
 * picker shows. Not the level of the hand in play: the card's label and statistics follow that one.
 */
export interface SeatLevelChoice {
  /** The seat's own level; null = the table's level. */
  readonly own: BotLevel | null;
  /** The table's level from the next hand: what "Same as table" means. */
  readonly table: BotLevel;
}

/** `BotCardView`: one bot's card. */
export interface BotCardData {
  /** Engine seat index, 1..8. */
  readonly seat: number;
  readonly name: string;
  /** The personality, or null when the seat's level hides it (Hard and Expert, §9.2). */
  readonly personality: PersonalityId | null;
  /** Chips behind, as on the pod. */
  readonly stack: number;
  /**
   * Hard and Expert (the personality hidden): what the player has seen it do; null when it has not
   * made a decision before the flop yet. Always null when the personality shows.
   */
  readonly seen: SeenPlay | null;
  /** The level picker's value: this seat's level from the next hand on. */
  readonly nextLevel: SeatLevelChoice;
}

/** "Bets often" from an AF of 2 (TAG 2.5, LAG 3.5, Maniac 5), "Mostly calls" below 1 (Station 0.7). */
export const BETS_OFTEN_AF = 2;
export const MOSTLY_CALLS_AF = 1;

/** The words for a seat's postflop aggression (AF = bets and raises / calls), or null. */
export function seenAggression(stats: SeatStats): SeenAggression | null {
  const { aggActions: agg, passiveActions: passive } = stats;
  if (agg + passive === 0) return null;
  if (passive === 0 || agg / passive >= BETS_OFTEN_AF) return 'betsOften';
  return agg / passive >= MOSTLY_CALLS_AF ? 'betsSometimes' : 'mostlyCalls';
}

/** What `stats` show (null when the seat has not made a preflop decision yet). */
export function seenPlay(stats: SeatStats | null): SeenPlay | null {
  if (stats === null || stats.vpip[1] === 0) return null;
  const pct = ([x, n]: readonly [number, number]): number =>
    n === 0 ? 0 : Math.round((100 * x) / n);
  return {
    hands: stats.vpip[1],
    plays: pct(stats.vpip),
    raises: pct(stats.pfr),
    aggression: seenAggression(stats),
  };
}

/**
 * The card for `seat` in `hand`, dealt from `table`, with the table's seat statistics by
 * `playerId` (`GameSlice.seatStats`). `next` is the seat's level from the next hand on (the
 * settings', §9.3); without it the card shows the levels of `table` itself. Null for the hero
 * (seat 0, drawn by the hero strip) and for a seat that does not exist.
 */
export function botCardOf(
  hand: HandState,
  table: TableState,
  seat: number,
  stats: Readonly<Record<string, SeatStats>> = {},
  next?: SeatLevelChoice,
): BotCardData | null {
  const slot = table.slots[seat];
  const state = hand.seats[seat];
  if (seat < 1 || slot === undefined || state === undefined || slot.kind !== 'bot') return null;
  const visible = labelVisible(seatLevelOf(table, seat));
  return {
    seat,
    name: slot.name,
    personality: visible ? slot.personality : null,
    stack: state.stack,
    seen: visible ? null : seenPlay(stats[slot.playerId] ?? null),
    nextLevel: next ?? { own: table.config.seatLevels[seat] ?? null, table: table.config.botLevel },
  };
}

const sameSeen = (a: SeenPlay | null, b: SeenPlay | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.hands === b.hands &&
    a.plays === b.plays &&
    a.raises === b.raises &&
    a.aggression === b.aggression);

const sameCard = (a: BotCardData, b: BotCardData): boolean =>
  a.seat === b.seat &&
  a.name === b.name &&
  a.personality === b.personality &&
  a.stack === b.stack &&
  sameSeen(a.seen, b.seen) &&
  a.nextLevel.own === b.nextLevel.own &&
  a.nextLevel.table === b.nextLevel.table;

let last: BotCardData | null = null;

/**
 * The open card's data, or null when no card is open (or its seat is gone). An unchanged card keeps
 * its object, so a sheet subscribed to it renders again only when what it shows changes. The
 * label, the statistics and the stack are the hand in play's; the level picker shows the settings'
 * levels, which the table follows from the next hand (§9.3).
 */
export const selectBotCard = (s: AppState): BotCardData | null => {
  const seat = s.ui.botCardSeat;
  const { hand, table, seatStats } = s.game;
  let next: BotCardData | null = null;
  if (seat !== null && hand !== null && table !== null) {
    const levels = nextLevels(s.settings, table);
    next = botCardOf(hand, table, seat, seatStats, {
      own: levels.seatLevels[seat] ?? null,
      table: levels.botLevel,
    });
  }
  if (next === null || last === null || !sameCard(last, next)) last = next;
  return last;
};
