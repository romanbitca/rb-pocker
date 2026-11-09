/**
 * Test doubles for Play with friends (PLAN §19.6): a scripted WebSocket and `TableView`s built from
 * real engine hands, through the same `publicHand` the server uses.
 */
import type { WebSocketLike } from '../../src/app/mp/socket.ts';
import { rngFromSeed, type Seed128 } from '../../src/core/rng.ts';
import { legalActions } from '../../src/engine/legal.ts';
import { publicHand } from '../../src/engine/project.ts';
import { startHand } from '../../src/engine/start.ts';
import { step } from '../../src/engine/step.ts';
import { createTable } from '../../src/engine/table.ts';
import type { HandState, PlayerSlot, TableState } from '../../src/engine/types.ts';
import type { ClientMsg, SeatInfo, ServerMsg, TableView } from '../../src/net/protocol.ts';
import { configFor, SEED, TABLE_SEED } from '../engine/helpers.ts';
import { randomInput } from '../engine/play.ts';

export const CODE = 'ABCD2345';
export const OTHER_CODE = 'WXYZ6789';
/** The server's clock in `viewOfHand`. It is years from any phone's clock, on purpose. */
export const SERVER_NOW = 5_000_000;

/** A WebSocket a test drives by hand. */
export class FakeWebSocket {
  readonly url: string;
  readonly sent: ClientMsg[] = [];
  /** The raw frames, for what must not appear in them. */
  readonly frames: string[] = [];
  /** The code the client closed it with; null while it has not. */
  closedWith: number | null = null;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
  }

  send(data: string): void {
    this.frames.push(data);
    this.sent.push(JSON.parse(data) as ClientMsg);
  }

  close(code = 1000): void {
    this.closedWith = code;
  }

  /** The connection is up. */
  open(): void {
    this.onopen?.({});
  }

  receive(msg: ServerMsg): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  receiveRaw(data: unknown): void {
    this.onmessage?.({ data });
  }

  /** The other side, or the network, closed it. */
  drop(code: number): void {
    this.onclose?.({ code });
  }

  /** The kinds of message the client sent, in order. */
  kinds(): string[] {
    return this.sent.map((m) => m.t);
  }
}

/** An `open` that records every socket it makes. */
export function socketFactory(): {
  sockets: FakeWebSocket[];
  open: (url: string) => WebSocketLike;
  last: () => FakeWebSocket;
} {
  const sockets: FakeWebSocket[] = [];
  return {
    sockets,
    open: (url) => {
      const ws = new FakeWebSocket(url);
      sockets.push(ws);
      return ws as unknown as WebSocketLike;
    },
    last: () => {
      const ws = sockets[sockets.length - 1];
      if (ws === undefined) throw new Error('no socket was opened');
      return ws;
    },
  };
}

export function seatInfo(name: string, patch: Partial<SeatInfo> = {}): SeatInfo {
  return { name, host: false, status: 'playing', stack: 2000, online: true, ...patch };
}

/** One real seat: dealt in, taken but not dealt in (it joined mid-hand), or empty. */
export type SeatKind = 'in' | 'out' | 'empty';

const stackOf = (seat: number): number => 1000 + 100 * seat;
/** What a seat that is not dealt in holds (the engine's slot says 0 for it, §19.3). */
export const OUT_STACK = 3333;

/** The engine table the server would build for these seats (§19.3). */
export function remoteTable(kinds: readonly SeatKind[]): TableState {
  const slots = kinds.map((kind, seat): PlayerSlot => ({
    playerId: `s${seat}`,
    name: `s${seat}`,
    kind: 'remote',
    personality: null,
    stack: kind === 'in' ? stackOf(seat) : 0,
  }));
  return createTable(configFor(kinds.length), slots, TABLE_SEED);
}

/** The seat infos of `kinds` for hand `h`. */
export function seatsOf(kinds: readonly SeatKind[], h: HandState | null): (SeatInfo | null)[] {
  return kinds.map((kind, seat) => {
    if (kind === 'empty') return null;
    const stack = kind === 'in' ? (h?.seats[seat]?.stack ?? stackOf(seat)) : OUT_STACK;
    return seatInfo(`P${seat}`, { status: kind === 'in' ? 'playing' : 'nextHand', stack });
  });
}

/** The view the player at real seat `you` gets of hand `h`. */
export function viewOfHand(
  kinds: readonly SeatKind[],
  h: HandState,
  you: number,
  patch: Partial<TableView> = {},
): TableView {
  const open = h.phase === 'betting' && h.toAct !== null;
  return {
    rev: 1,
    now: SERVER_NOW,
    code: CODE,
    invite: `https://t.me/bot/app?startapp=${CODE}`,
    settings: { seats: kinds.length, sb: h.sb, bb: h.bb, stack: 2000, turnSeconds: 30 },
    status: 'playing',
    started: true,
    you,
    seats: seatsOf(kinds, h),
    handsPlayed: h.handSeq - 1,
    hand: publicHand(h, you),
    decision: open ? { seat: h.toAct as number, seq: 7, deadlineAt: SERVER_NOW + 30_000 } : null,
    legal: open && h.toAct === you ? legalActions(h) : null,
    nextHandAt: h.phase === 'complete' ? SERVER_NOW + 4000 : null,
    ...patch,
  };
}

/** A table with no hand: the waiting room. */
export function waitingView(patch: Partial<TableView> = {}): TableView {
  return {
    rev: 1,
    now: SERVER_NOW,
    code: CODE,
    invite: `https://t.me/bot/app?startapp=${CODE}`,
    settings: { seats: 3, sb: 10, bb: 20, stack: 2000, turnSeconds: 30 },
    status: 'waiting',
    started: false,
    you: 0,
    seats: [
      seatInfo('Ann', { host: true, status: 'nextHand' }),
      seatInfo('Ben', { status: 'nextHand' }),
      null,
    ],
    handsPlayed: 0,
    hand: null,
    decision: null,
    legal: null,
    nextHandAt: null,
    ...patch,
  };
}

/** Every state of a hand played to its end with seeded random legal moves, the first included. */
export function playedHand(table: TableState, seed: Seed128 = SEED): HandState[] {
  const rng = rngFromSeed(seed);
  const states = [startHand(table, seed)];
  for (let i = 0; i < 400; i++) {
    const h = states[states.length - 1] as HandState;
    if (h.phase === 'complete') break;
    states.push(step(h, randomInput(h, rng)));
  }
  return states;
}
