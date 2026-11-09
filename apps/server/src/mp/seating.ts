/**
 * The pure rules of who sits where (PLAN §19.3, §19.5, §19.9): names, who can be dealt in, who is
 * the next host, and the table the engine gets. No state and no time here.
 */
import type { LegalActions, PlayerAction, PlayerSlot, TableConfig } from '../game/engine/types.js';
import {
  STAKES,
  type SeatStatus,
  type TableSettings,
  type TurnSeconds,
} from '../game/net/protocol.js';

/** A person, as the server keeps them (§19.9). `name`: `cleanName` of the Telegram first name. */
export interface MpUser {
  readonly id: number;
  readonly name: string;
}

/** One taken seat, as the room keeps it. Between hands the chips live in `stack` (§19.5). */
export interface RoomSeat {
  readonly userId: number;
  readonly name: string;
  status: SeatStatus;
  stack: number;
  online: boolean;
  /** When `online` went false; null while online. */
  offlineSince: number | null;
  /** Turns timed out in a row. */
  timeouts: number;
}

/** A table's settings in numbers: a client never sends chips (§19.4). */
export interface RoomSettings {
  readonly seats: number;
  readonly sb: number;
  readonly bb: number;
  readonly stack: number;
  readonly turnSeconds: TurnSeconds;
}

export function roomSettings(settings: TableSettings): RoomSettings {
  const { sb, bb, stack } = STAKES[settings.stakes];
  return { seats: settings.seats, sb, bb, stack, turnSeconds: settings.turnSeconds };
}

const MAX_NAME_CODE_POINTS = 24;

/**
 * §19.9: NFC, no control or format characters (so no right-to-left overrides), trimmed, at most 24
 * code points. May come back empty; the seat's name is then `seatName`'s.
 */
export function cleanName(firstName: string): string {
  const cleaned = firstName.normalize('NFC').replace(/\p{C}/gu, '').trim();
  return [...cleaned].slice(0, MAX_NAME_CODE_POINTS).join('').trim();
}

/** The name a seat shows: the cleaned first name, or "Player {seat + 1}" when that is empty. */
export function seatName(user: MpUser, seat: number): string {
  return user.name === '' ? `Player ${seat + 1}` : user.name;
}

/** A seat that takes cards at the next deal, if it has chips. */
export function canBeDealtIn(seat: RoomSeat): boolean {
  return (seat.status === 'nextHand' || seat.status === 'playing') && seat.stack > 0;
}

/** How many seats could take cards at the next deal. */
export function countReady(seats: readonly (RoomSeat | null)[]): number {
  return seats.filter((seat) => seat !== null && canBeDealtIn(seat)).length;
}

/** The next taken, not `leaving` seat clockwise after `from` (§19.5, The host); null when none. */
export function nextHost(seats: readonly (RoomSeat | null)[], from: number): number | null {
  const n = seats.length;
  for (let d = 1; d <= n; d++) {
    const seat = (from + d) % n;
    const row = seats[seat];
    if (row !== null && row !== undefined && row.status !== 'leaving') return seat;
  }
  return null;
}

/** §19.3: `botLevel` and `seatLevels` are only what `checkConfig` needs; nothing reads them. */
export function engineConfig(settings: RoomSettings): TableConfig {
  return {
    seatCount: settings.seats,
    sb: settings.sb,
    bb: settings.bb,
    startingStack: settings.stack,
    botLevel: 'easy',
    seatLevels: new Array<null>(settings.seats).fill(null),
  };
}

/**
 * §19.3: one slot per seat with an internal name (real names are not unique, pitfall 52). A seat is
 * dealt in exactly when its slot has chips: `playing` with chips, everything else 0.
 */
export function engineSlots(seats: readonly (RoomSeat | null)[]): PlayerSlot[] {
  return seats.map((seat, i) => ({
    playerId: `s${i}`,
    name: `s${i}`,
    kind: 'remote',
    personality: null,
    stack: seat !== null && seat.status === 'playing' ? seat.stack : 0,
  }));
}

/** What the server plays for a seat that did not: check if that is free, fold otherwise (§19.5). */
export function safestAction(
  legal: LegalActions,
): Extract<PlayerAction, { type: 'check' | 'fold' }> {
  return legal.canCheck ? { type: 'check' } : { type: 'fold' };
}
