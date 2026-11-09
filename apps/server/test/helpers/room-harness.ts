import { deriveSeed, ZERO_SEED, type Seed128 } from '../../src/game/core/rng.js';
import type { LegalActions, PlayerAction, PublicHand } from '../../src/game/engine/types.js';
import type { Notice, ServerMsg, TableSettings, TableView } from '../../src/game/net/protocol.js';
import { Room } from '../../src/mp/room.js';
import type { MpUser, RoomSeat } from '../../src/mp/seating.js';
import { FakeClock } from './fake-clock.js';

export interface Sent {
  userId: number;
  msg: ServerMsg;
}

/** Telegram-like ids: large, so a leak of one is unmistakable (§19.9 L5). */
export const userId = (i: number): number => 7_000_000_000 + 13 * i;

const NAMES = ['Ann', 'Bob', 'Cid', 'Dee', 'Eve', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jon', 'Kim', 'Lou'];

export const DEFAULT_SETTINGS: TableSettings = { seats: 6, stakes: 'normal', turnSeconds: 30 };

/** Check when free, otherwise call: a hand that reaches the showdown. */
export const passive = (legal: LegalActions): PlayerAction =>
  legal.canCheck ? { type: 'check' } : { type: 'call' };

/** All in if that is allowed, otherwise call or check. */
export const shove = (legal: LegalActions): PlayerAction => {
  if (legal.raise !== null) return { type: 'raise', to: legal.raise.max };
  if (legal.bet !== null) return { type: 'bet', to: legal.bet.max };
  return passive(legal);
};

export const foldOrCheck = (legal: LegalActions): PlayerAction =>
  legal.canFold ? { type: 'fold' } : { type: 'check' };

/** One `Room` on a fake clock, with everything it sends recorded. Users sit in index order. */
export class Harness {
  readonly clock: FakeClock;
  readonly sent: Sent[] = [];
  readonly closed: string[] = [];
  readonly seeds: Seed128[] = [];
  readonly room: Room;

  constructor(
    settings: Partial<TableSettings> = {},
    clock: FakeClock = new FakeClock(),
    seedLabel = 'room',
  ) {
    this.clock = clock;
    this.room = new Room(
      'ABCD2345',
      { ...DEFAULT_SETTINGS, ...settings },
      {
        clock,
        newSeed: () => {
          const seed = deriveSeed(ZERO_SEED, seedLabel, this.seeds.length);
          this.seeds.push(seed);
          return seed;
        },
        send: (id, msg) => {
          this.sent.push({ userId: id, msg });
        },
        onClosed: (code) => {
          this.closed.push(code);
        },
        inviteUrl: 'https://t.me/test_bot/app?startapp=ABCD2345',
      },
    );
  }

  user(i: number, name?: string): MpUser {
    return { id: userId(i), name: name ?? (NAMES[i] as string) };
  }

  /** `n` players: user 0 makes the table and the others join, so user i is in seat i. */
  sit(n: number): this {
    this.room.create(this.user(0));
    for (let i = 1; i < n; i++) this.room.join(this.user(i));
    return this;
  }

  /** `n` players seated and the first hand dealt. */
  deal(n: number): this {
    this.sit(n);
    this.room.start(userId(0));
    return this;
  }

  /** Every message `i` got, oldest first. */
  messagesTo(i: number): ServerMsg[] {
    const id = userId(i);
    return this.sent.filter((s) => s.userId === id).map((s) => s.msg);
  }

  /** Every `table` `i` got, oldest first. */
  tablesTo(i: number): Extract<ServerMsg, { t: 'table' }>[] {
    return this.messagesTo(i).filter(
      (m): m is Extract<ServerMsg, { t: 'table' }> => m.t === 'table',
    );
  }

  /** The newest view of `i`. Throws when there is none. */
  view(i: number): TableView {
    const tables = this.tablesTo(i);
    const last = tables[tables.length - 1];
    if (last === undefined) throw new Error(`user ${i} has no view`);
    return last.view;
  }

  /** The notices of `i`'s newest `table`. */
  notices(i: number): Notice[] {
    const tables = this.tablesTo(i);
    return tables[tables.length - 1]?.notices ?? [];
  }

  /** Every notice `i` was ever sent. */
  allNotices(i: number): Notice[] {
    return this.tablesTo(i).flatMap((t) => t.notices);
  }

  /** The newest view anyone got. */
  latest(): TableView {
    for (let k = this.sent.length - 1; k >= 0; k--) {
      const msg = this.sent[k]?.msg;
      if (msg?.t === 'table') return msg.view;
    }
    throw new Error('no view yet');
  }

  /** The newest view's hand. Throws when there is none. */
  hand(): PublicHand {
    const hand = this.latest().hand;
    if (hand === null) throw new Error('no hand');
    return hand;
  }

  /** The seat whose turn it is. Throws when nobody's. */
  toAct(): number {
    const decision = this.latest().decision;
    if (decision === null) throw new Error('no decision');
    return decision.seat;
  }

  /** Plays the open decision for its seat, whose user is `seat`: the action `pick` gives. */
  play(pick: (legal: LegalActions) => PlayerAction = passive): PlayerAction {
    const seat = this.toAct();
    const view = this.view(seat);
    const legal = view.legal;
    const decision = view.decision;
    if (legal === null || decision === null) throw new Error(`seat ${seat} has no legal actions`);
    const action = pick(legal);
    const refused = this.room.act(userId(seat), decision.seq, action);
    if (refused !== null) throw new Error(`refused: ${refused}`);
    return action;
  }

  /** ms until the open decision's deadline. */
  msToDeadline(): number {
    const decision = this.latest().decision;
    if (decision === null) throw new Error('no decision');
    return decision.deadlineAt - this.clock.now();
  }

  /** Lets the open decision run out. */
  timeOut(): void {
    this.clock.advance(this.msToDeadline());
  }

  /**
   * One move of the game: plays the open decision with `pick` when its player can see it, and
   * otherwise lets the next timer fire (an offline or leaving seat gets no views to play from).
   */
  move(pick: (legal: LegalActions) => PlayerAction = passive): void {
    const { decision, seats } = this.latest();
    if (decision !== null && seats[decision.seat]?.online === true) this.play(pick);
    else this.clock.next();
  }

  /** Plays with `pick` until the hand is over (`phase: complete`). */
  playHand(pick: (legal: LegalActions) => PlayerAction = passive): void {
    for (let guard = 0; guard < 500; guard++) {
      const view = this.latest();
      if (view.hand === null) throw new Error('no hand to play');
      if (view.hand.phase === 'complete') return;
      this.move(pick);
    }
    throw new Error('the hand did not end');
  }

  /** The users (by index) the room counts as seated now. */
  latestSeats(): number[] {
    const seated: number[] = [];
    for (let i = 0; i < 12; i++) if (this.room.seatOf(userId(i)) !== null) seated.push(i);
    return seated;
  }

  /** The room's seat list, for the few tests that must put a seat in a state no message can. */
  rawSeats(): (RoomSeat | null)[] {
    return (this.room as unknown as { seats: (RoomSeat | null)[] }).seats;
  }
}
