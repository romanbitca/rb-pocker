/**
 * The bot level of each seat from the next hand on (PLAN §9.3, §10; chunk 7.2). Pure; no timers,
 * no store.
 *
 * Per-seat overrides. A seat's level is its own override in `TableConfig.seatLevels`, else the
 * table's `botLevel` (`seatLevelOf`, with `labelVisible`, the pods' rule, in `tableViews.ts`). The
 * table a hand is dealt from is never changed while the hand is played; a new level reaches the
 * table through `withLevels` when the next hand is dealt, and the levels it takes are `nextLevels`:
 * the settings' table level and the settings' per-seat overrides (the same way a new table level
 * has always reached the table, §10). The bot card, the observation the brain gets and the
 * controller all read these functions, so they cannot disagree.
 *
 * The coach levels (what each coach level shows and does, chunk 6.4) are another module,
 * `levels.ts`.
 */
import type { BotLevel, TableState } from '../engine/types.ts';
import type { Settings } from '../persist/schema.ts';
import { seatLevelOf } from './tableViews.ts';

/**
 * The level of every seat of `table`, index = seat (the hero's entry is the table level and is
 * never used). These are the levels in force for a hand dealt from `table`, so the table a hand
 * records (§14.3, `ReplayRecord.table`) holds them per seat.
 */
export function levelsOf(table: TableState): BotLevel[] {
  return table.slots.map((_, seat) => seatLevelOf(table, seat));
}

/** A table level and the per-seat overrides that go with it (`TableConfig`'s two level fields). */
export interface TableLevels {
  botLevel: BotLevel;
  /** Index = seat; null = the table's level; [0] (the hero) is always null. */
  seatLevels: (BotLevel | null)[];
}

/**
 * The levels the next hand at `table` is dealt at (§9.3, §10): the settings' table level and the
 * settings' per-seat overrides, so a level picked on a bot's card, in Settings or in Setup is
 * saved with the settings and followed by the table from the next hand.
 *
 * The settings' overrides are one per seat of the table they were made for (`Settings.players`,
 * A.7). Should they belong to another seat count (a profile that does not match the saved table),
 * the table keeps its own overrides rather than take some that belong to other seats.
 */
export function nextLevels(
  settings: Pick<Settings, 'botLevel' | 'players' | 'seatLevels'>,
  table: TableState,
): TableLevels {
  const seats = table.config.seatCount;
  const own = settings.players === seats ? settings.seatLevels : table.config.seatLevels;
  return {
    botLevel: settings.botLevel,
    seatLevels: Array.from({ length: seats }, (_, seat) =>
      seat === 0 ? null : (own[seat] ?? null),
    ),
  };
}

/** Two lists of overrides are the same. */
export function sameSeatLevels(
  a: readonly (BotLevel | null)[],
  b: readonly (BotLevel | null)[],
): boolean {
  return a.length === b.length && a.every((level, seat) => level === b[seat]);
}
