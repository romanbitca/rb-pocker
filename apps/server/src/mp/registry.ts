/**
 * All the tables of this server (PLAN §19.3, §19.4): their codes, who sits where and the limits on
 * making and finding them. One seat per user (§19.9) is decided here. A `Room` knows only itself.
 */
import { randomInt } from 'node:crypto';
import type { Seed128 } from '../game/core/rng.js';
import type { EndReason, MpErrorCode, ServerMsg, TableSettings } from '../game/net/protocol.js';
import type { Clock } from './clock.js';
import { Room } from './room.js';
import type { MpUser } from './seating.js';
import {
  CREATE_LIMIT,
  CREATE_WINDOW_MS,
  FAILED_JOIN_LIMIT,
  FAILED_JOIN_WINDOW_MS,
  MAX_ROOMS,
} from './timing.js';

/** The 31 letters of `TABLE_CODE_RE`: no 0, O, 1, I, L. */
const CODE_LETTERS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 8;

function newTableCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_LETTERS[randomInt(CODE_LETTERS.length)];
  return code;
}

/** Events of one kind per user in a sliding window. */
class SlidingLimit {
  private readonly events = new Map<number, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** True when `user` has no events left in the window ending at `now`. */
  isFull(user: number, now: number): boolean {
    return this.recent(user, now).length >= this.limit;
  }

  add(user: number, now: number): void {
    this.events.set(user, [...this.recent(user, now), now]);
    // Each list is short, but the map must not grow with every user the server ever saw.
    if (this.events.size > 1_024) {
      for (const key of this.events.keys()) {
        if (this.recent(key, now).length === 0) this.events.delete(key);
      }
    }
  }

  private recent(user: number, now: number): number[] {
    return (this.events.get(user) ?? []).filter((at) => now - at < this.windowMs);
  }
}

/** A refusal for the gateway to send: `other` names the table of `already_seated`. */
export interface Refusal {
  readonly code: MpErrorCode;
  readonly other?: string;
}

export interface RegistryDeps {
  readonly clock: Clock;
  readonly newSeed: () => Seed128;
  /** The table's invite link: `TelegramConfig.invite`. */
  readonly inviteUrl: (code: string) => string;
}

export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();
  /** May be out of date for a seat the room emptied by itself: read it through `roomOf`. */
  private readonly seated = new Map<number, Room>();
  private readonly creates = new SlidingLimit(CREATE_LIMIT, CREATE_WINDOW_MS);
  private readonly failedJoins = new SlidingLimit(FAILED_JOIN_LIMIT, FAILED_JOIN_WINDOW_MS);
  private send: (userId: number, msg: ServerMsg) => void = () => {};

  constructor(private readonly deps: RegistryDeps) {}

  /** The gateway's way to reach a user; the rooms made afterwards and before all use it. */
  setSender(send: (userId: number, msg: ServerMsg) => void): void {
    this.send = send;
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  /** The table `userId` plays at. A `leaving` seat is not one: its player already got `left`. */
  roomOf(userId: number): Room | null {
    const room = this.seated.get(userId);
    if (room === undefined) return null;
    if (room.seatOf(userId) !== null) return room;
    this.seated.delete(userId);
    return null;
  }

  /** `TableLookup` of §19.8: which table the bot's inline mode invites to. */
  codeOfUser(userId: number): string | null {
    return this.roomOf(userId)?.code ?? null;
  }

  create(user: MpUser, settings: TableSettings): Refusal | null {
    const current = this.roomOf(user.id);
    if (current !== null) return { code: 'already_seated', other: current.code };
    if (this.rooms.size >= MAX_ROOMS) return { code: 'server_full' };
    const now = this.deps.clock.now();
    if (this.creates.isFull(user.id, now)) return { code: 'rate_limited' };
    this.creates.add(user.id, now);
    const code = this.unusedCode();
    const room = new Room(code, settings, {
      clock: this.deps.clock,
      newSeed: this.deps.newSeed,
      send: (userId, msg) => {
        this.send(userId, msg);
      },
      onClosed: (closed) => {
        this.forget(closed);
      },
      inviteUrl: this.deps.inviteUrl(code),
    });
    this.rooms.set(code, room);
    this.seated.set(user.id, room);
    room.create(user);
    return null;
  }

  join(user: MpUser, code: string): Refusal | null {
    const current = this.roomOf(user.id);
    if (current !== null && current.code !== code) {
      return { code: 'already_seated', other: current.code };
    }
    const now = this.deps.clock.now();
    // Before the lookup: a guesser who has used up the failures learns nothing more, right or wrong.
    if (current === null && this.failedJoins.isFull(user.id, now)) return { code: 'rate_limited' };
    const room = this.rooms.get(code);
    if (room === undefined) {
      this.failedJoins.add(user.id, now);
      return { code: 'not_found' };
    }
    const error = room.join(user);
    if (error !== null) return { code: error };
    this.seated.set(user.id, room);
    return null;
  }

  /** `leave`, for whoever has a table. */
  leave(userId: number): MpErrorCode | null {
    const room = this.roomOf(userId);
    if (room === null) return 'not_seated';
    this.seated.delete(userId);
    return room.leave(userId);
  }

  /** Every table ends (`SIGTERM`, §19.5). */
  endAll(reason: EndReason): void {
    for (const room of [...this.rooms.values()]) room.end(reason);
  }

  private unusedCode(): string {
    let code = newTableCode();
    while (this.rooms.has(code)) code = newTableCode();
    return code;
  }

  private forget(code: string): void {
    const room = this.rooms.get(code);
    this.rooms.delete(code);
    for (const [userId, seatedAt] of this.seated) {
      if (seatedAt === room) this.seated.delete(userId);
    }
  }
}
