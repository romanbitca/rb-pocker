/**
 * The contract between the game and the server (PLAN §19.4): types, constants and the one decoder
 * of what a client may send. No run-time imports (the §2.1 `net` row). The server reads a generated
 * copy (apps/server/src/game/net/protocol.ts, scripts/sync-game.mjs): one file, two readers.
 *
 * Messages are JSON text frames, `t` names the message. Times are ms since the epoch on the
 * server's clock. Seats are the server's real seats, 0..seats-1; the client maps them to its own
 * order (app/mp/localView.ts).
 */
import type { LegalActions, PlayerAction, PublicHand } from '../engine/types.ts';

export const MP_PROTOCOL_VERSION = 1;
export const MP_WS_PATH = '/api/mp/ws';
/** Largest frame a client may send: bigger closes the socket with 1009. */
export const MP_MAX_INBOUND_BYTES = 16_384;
/** The client pings this often; no pong within MP_PONG_WAIT_MS means the socket is dead. */
export const MP_PING_EVERY_MS = 20_000;
export const MP_PONG_WAIT_MS = 10_000;
/** At most this long on a turn for a player who is offline (§19.5). The strip shows it (§19.10). */
export const OFFLINE_TURN_MS = 15_000;

/** A table code: 8 characters without 0, O, 1, I, L. It is also the invite's `startapp` value. */
export const TABLE_CODE_RE = /^[2-9A-HJKMNP-Z]{8}$/;
/** `startapp=new` (the bot's /new) opens the Create screen. */
export const START_NEW = 'new';

export type StakesId = 'quick' | 'normal' | 'long';
/** The three games of the Create screen; §3.2 holds for each (10..500 big blinds). */
export const STAKES: Readonly<Record<StakesId, { sb: number; bb: number; stack: number }>> = {
  quick: { sb: 25, bb: 50, stack: 1000 },
  normal: { sb: 10, bb: 20, stack: 2000 },
  long: { sb: 10, bb: 20, stack: 5000 },
};
export const TURN_SECONDS = [15, 30, 60] as const;
export type TurnSeconds = (typeof TURN_SECONDS)[number];
export const MIN_SEATS = 2;
export const MAX_SEATS = 9;

/** What the host chooses. The server turns `stakes` into numbers; a client never sends chips. */
export interface TableSettings {
  seats: number;
  stakes: StakesId;
  turnSeconds: TurnSeconds;
}

/** Client → server. Every message except `hello` needs a `hello` before it on the socket. */
export type ClientMsg =
  | { t: 'hello'; v: number; initData: string }
  | { t: 'create'; settings: TableSettings }
  | { t: 'join'; code: string }
  | { t: 'leave' }
  | { t: 'start' }
  | { t: 'act'; seq: number; action: PlayerAction }
  | { t: 'back' }
  | { t: 'reload' }
  | { t: 'ping'; n: number };

export type SeatStatus = 'playing' | 'nextHand' | 'sittingOut' | 'busted' | 'leaving';

/** One taken seat. Never the player's Telegram id, username or photo (§19.9 L5). */
export interface SeatInfo {
  /** The first name, cleaned (§19.9). Not unique. */
  name: string;
  host: boolean;
  status: SeatStatus;
  /** Chips behind right now (for a seat dealt in, the same number as `hand.seats[i].stack`). */
  stack: number;
  online: boolean;
}

/** Whose turn it is. `seq` must come back in `act`; `deadlineAt` is the server's clock. */
export interface Decision {
  seat: number;
  seq: number;
  deadlineAt: number;
}

/** One table as one seated player sees it. Sent whole after every change. */
export interface TableView {
  /** Grows by one with every change at the table; a client drops a view with an older `rev`. */
  rev: number;
  /** The server's clock when this view was sent. */
  now: number;
  code: string;
  /** `https://t.me/<bot>/<app>?startapp=<code>` */
  invite: string;
  settings: {
    seats: number;
    sb: number;
    bb: number;
    stack: number;
    turnSeconds: TurnSeconds;
  };
  status: 'waiting' | 'playing';
  /** True once the host has started the table: it then goes on by itself (§19.5). */
  started: boolean;
  /** This player's real seat. */
  you: number;
  /** Index = real seat; null = empty. */
  seats: (SeatInfo | null)[];
  /** Finished hands at this table: the top bar shows "Hand {handsPlayed + 1}". */
  handsPlayed: number;
  /** The hand in play or the one just finished; built only by engine/project.ts. */
  hand: PublicHand | null;
  decision: Decision | null;
  /** Non-null only when `decision.seat === you`. */
  legal: LegalActions | null;
  /** While a finished hand is on show: when the next one is dealt. */
  nextHandAt: number | null;
}

/** Things to say once, as toasts. Sent with the view of the change, never again. */
export type Notice =
  | { n: 'joined' | 'left' | 'hostChanged'; name: string }
  | { n: 'timedOut'; action: 'check' | 'fold' }
  | { n: 'sittingOut' }
  | { n: 'handVoided' };

export type EndReason = 'server_restart' | 'idle' | 'error';

export type MpErrorCode =
  | 'bad_message'
  | 'not_authed'
  | 'auth_failed'
  | 'outdated'
  | 'replaced'
  | 'rate_limited'
  | 'server_full'
  | 'not_found'
  | 'full'
  | 'already_seated'
  | 'not_seated'
  | 'not_host'
  | 'not_enough_players'
  | 'already_started'
  | 'stale_action'
  | 'not_your_turn'
  | 'illegal_action'
  | 'not_busted';

/** Server → client. */
export type ServerMsg =
  /** After a good `hello`. `code`: the table this player sits at, or null; a `table` follows. */
  | { t: 'welcome'; v: number; name: string; now: number; code: string | null }
  | { t: 'table'; view: TableView; notices: Notice[] }
  /** The `leave` went through; the view stops. */
  | { t: 'left' }
  | { t: 'ended'; code: string; reason: EndReason }
  /** `re`: the kind of message refused, null when none. `other`: the table of `already_seated`. */
  | { t: 'error'; code: MpErrorCode; re: ClientMsg['t'] | null; other?: string }
  | { t: 'pong'; n: number; now: number };

/** WebSocket close codes of the protocol (1000–1015 keep their standard meaning). */
export const WS_CLOSE = {
  authFailed: 4001,
  replaced: 4002,
  outdated: 4003,
  authTimeout: 4004,
  badMessage: 4005,
  rateLimited: 4008,
  silent: 4009,
} as const;

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

function decodeAction(x: unknown): PlayerAction | null {
  if (!isObject(x)) return null;
  switch (x.type) {
    case 'fold':
      return { type: 'fold' };
    case 'check':
      return { type: 'check' };
    case 'call':
      return { type: 'call' };
    case 'bet':
    case 'raise': {
      const to = x.to;
      if (typeof to !== 'number' || !Number.isSafeInteger(to) || to <= 0) return null;
      return x.type === 'bet' ? { type: 'bet', to } : { type: 'raise', to };
    }
    default:
      return null;
  }
}

function decodeSettings(x: unknown): TableSettings | null {
  if (!isObject(x)) return null;
  const { seats, stakes, turnSeconds } = x;
  if (typeof seats !== 'number' || !Number.isInteger(seats)) return null;
  if (seats < MIN_SEATS || seats > MAX_SEATS) return null;
  if (stakes !== 'quick' && stakes !== 'normal' && stakes !== 'long') return null;
  if (turnSeconds !== 15 && turnSeconds !== 30 && turnSeconds !== 60) return null;
  return { seats, stakes, turnSeconds };
}

/**
 * The one check of what a client sends: a fresh object with only the known fields, or null. Pure:
 * chips, seats and turns are the room's to judge. Never throws, whatever `JSON.parse` gave.
 */
export function decodeClientMsg(x: unknown): ClientMsg | null {
  if (!isObject(x)) return null;
  switch (x.t) {
    case 'hello': {
      const { v, initData } = x;
      if (typeof v !== 'number' || !Number.isSafeInteger(v)) return null;
      if (typeof initData !== 'string' || initData.length === 0 || initData.length > 8192) {
        return null;
      }
      return { t: 'hello', v, initData };
    }
    case 'create': {
      const settings = decodeSettings(x.settings);
      return settings === null ? null : { t: 'create', settings };
    }
    case 'join': {
      const { code } = x;
      return typeof code === 'string' && TABLE_CODE_RE.test(code) ? { t: 'join', code } : null;
    }
    case 'act': {
      const { seq } = x;
      const action = decodeAction(x.action);
      if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0) return null;
      return action === null ? null : { t: 'act', seq, action };
    }
    case 'ping': {
      const { n } = x;
      return typeof n === 'number' && Number.isSafeInteger(n) ? { t: 'ping', n } : null;
    }
    case 'leave':
      return { t: 'leave' };
    case 'start':
      return { t: 'start' };
    case 'back':
      return { t: 'back' };
    case 'reload':
      return { t: 'reload' };
    default:
      return null;
  }
}
