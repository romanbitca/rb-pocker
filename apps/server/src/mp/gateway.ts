/**
 * The multiplayer socket (PLAN §19.3, §19.4, §19.9): `ws` on the HTTP server's `upgrade`, and the
 * only way to a table. Who you are comes only from a signed `initData` in the `hello` frame. A frame
 * is checked here (size, rate, shape, who sent it); whether it may happen is the room's to say.
 */
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  Inject,
  Injectable,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import {
  MP_MAX_INBOUND_BYTES,
  MP_PROTOCOL_VERSION,
  MP_WS_PATH,
  WS_CLOSE,
  decodeClientMsg,
  type ClientMsg,
  type MpErrorCode,
  type ServerMsg,
} from '../game/net/protocol.js';
import { TelegramConfig } from '../telegram/config.js';
import { checkInitData } from '../telegram/init-data.js';
import { CLOCK, realClock, type Clock, type TimerHandle } from './clock.js';
import { RoomRegistry, type Refusal } from './registry.js';
import { cleanName, type MpUser } from './seating.js';
import {
  HELLO_DEADLINE_MS,
  MAX_BAD_MESSAGES,
  MAX_DROPS,
  MAX_OUTBOUND_BYTES,
  MAX_SOCKETS,
  SHUTDOWN_GRACE_MS,
  SILENT_SOCKET_MS,
  TOKEN_BUCKET_REFILL_PER_S,
  TOKEN_BUCKET_SIZE,
} from './timing.js';

/** Close codes with the standard meaning that §19.4 uses. */
const CLOSE_POLICY = 1008;
const CLOSE_UNEXPECTED = 1011;
const CLOSE_RESTART = 1012;

type Hello = Extract<ClientMsg, { t: 'hello' }>;
type AtTableMsg = Extract<ClientMsg, { t: 'start' | 'act' | 'back' | 'reload' }>;

const STATUS_TEXT = {
  403: 'Forbidden',
  404: 'Not Found',
  503: 'Service Unavailable',
} as const;

interface Connection {
  readonly socket: WebSocket;
  /** Null until a good `hello`. */
  user: MpUser | null;
  tokens: number;
  refilledAt: number;
  drops: number;
  badMessages: number;
  lastMessageAt: number;
  helloTimer: TimerHandle | null;
  silenceTimer: TimerHandle | null;
}

/** §19.4: `Origin` present and not the request's own `Host` is another site's page. */
function isSameOrigin(req: IncomingMessage): boolean {
  const { origin, host } = req.headers;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === host?.toLowerCase();
  } catch {
    return false;
  }
}

function pathOf(req: IncomingMessage): string | null {
  try {
    return new URL(req.url ?? '', 'http://x').pathname;
  } catch {
    return null;
  }
}

/** Answers an upgrade that will not happen, in plain HTTP, and hangs up. */
function refuseUpgrade(socket: Duplex, status: keyof typeof STATUS_TEXT): void {
  // Nothing else listens on this socket yet, and a reset here must not become an uncaught error.
  socket.on('error', () => {});
  socket.end(
    `HTTP/1.1 ${status} ${STATUS_TEXT[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}

function decodeFrame(data: RawData, isBinary: boolean): ClientMsg | null {
  if (isBinary) return null;
  try {
    return decodeClientMsg(JSON.parse((data as Buffer).toString('utf8')));
  } catch {
    return null;
  }
}

@Injectable()
export class MpGateway implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly wss = new WebSocketServer({
    noServer: true,
    maxPayload: MP_MAX_INBOUND_BYTES,
    perMessageDeflate: false,
  });
  private readonly connections = new Set<Connection>();
  /** One socket per user (§19.9). */
  private readonly byUser = new Map<number, Connection>();
  private shuttingDown = false;

  constructor(
    private readonly config: TelegramConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly registry: RoomRegistry,
    private readonly adapterHost: HttpAdapterHost,
  ) {
    registry.setSender((userId, msg) => {
      const conn = this.byUser.get(userId);
      if (conn !== undefined) this.send(conn, msg);
    });
  }

  /** §19.3: no listener without the Telegram config, and Node answers the upgrade as a plain GET. */
  onApplicationBootstrap(): void {
    // No adapter: this module was booted on its own (a bare application context), with no server.
    const server = this.adapterHost.httpAdapter?.getHttpServer() as Server | undefined;
    if (!this.config.enabled || server === undefined) return;
    server.on('upgrade', (req, socket, head) => {
      this.onUpgrade(req, socket, head);
    });
  }

  private onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (pathOf(req) !== MP_WS_PATH) {
      refuseUpgrade(socket, 404);
    } else if (!isSameOrigin(req)) {
      refuseUpgrade(socket, 403);
    } else if (this.shuttingDown || this.connections.size >= MAX_SOCKETS) {
      refuseUpgrade(socket, 503);
    } else {
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.onOpen(ws);
      });
    }
  }

  private onOpen(socket: WebSocket): void {
    const now = this.clock.now();
    const conn: Connection = {
      socket,
      user: null,
      tokens: TOKEN_BUCKET_SIZE,
      refilledAt: now,
      drops: 0,
      badMessages: 0,
      lastMessageAt: now,
      helloTimer: null,
      silenceTimer: null,
    };
    this.connections.add(conn);
    conn.helloTimer = this.clock.setTimeout(() => {
      socket.close(WS_CLOSE.authTimeout);
    }, HELLO_DEADLINE_MS);
    this.watchSilence(conn);
    socket.on('message', (data, isBinary) => {
      this.onMessage(conn, data, isBinary);
    });
    socket.on('close', () => {
      this.onClose(conn);
    });
    // `ws` closes the socket by itself (1009 for an oversized frame); this only keeps it handled.
    socket.on('error', () => {});
  }

  private onMessage(conn: Connection, data: RawData, isBinary: boolean): void {
    if (conn.socket.readyState !== WebSocket.OPEN) return;
    conn.lastMessageAt = this.clock.now();
    try {
      this.onFrame(conn, data, isBinary);
    } catch {
      // A bug must not take the whole server down with one message. The client reconnects.
      conn.socket.close(CLOSE_UNEXPECTED);
    }
  }

  private onFrame(conn: Connection, data: RawData, isBinary: boolean): void {
    if (!this.takeToken(conn)) {
      conn.drops++;
      this.send(conn, { t: 'error', code: 'rate_limited', re: null });
      if (conn.drops >= MAX_DROPS) conn.socket.close(WS_CLOSE.rateLimited);
      return;
    }
    const msg = decodeFrame(data, isBinary);
    if (msg === null) {
      conn.badMessages++;
      this.send(conn, { t: 'error', code: 'bad_message', re: null });
      if (conn.badMessages >= MAX_BAD_MESSAGES) conn.socket.close(WS_CLOSE.badMessage);
    } else if (msg.t === 'hello') {
      this.onHello(conn, msg);
    } else if (conn.user === null) {
      this.refuse(conn, msg.t, 'not_authed');
    } else {
      this.dispatch(conn, conn.user, msg);
    }
  }

  private onHello(conn: Connection, msg: Hello): void {
    if (conn.user !== null) {
      this.refuse(conn, 'hello', 'bad_message');
      return;
    }
    if (msg.v !== MP_PROTOCOL_VERSION) {
      this.refuse(conn, 'hello', 'outdated');
      conn.socket.close(WS_CLOSE.outdated);
      return;
    }
    const check = checkInitData(
      msg.initData,
      this.config.botToken,
      Math.floor(this.clock.now() / 1000),
    );
    if (!check.ok) {
      this.refuse(conn, 'hello', 'auth_failed');
      conn.socket.close(WS_CLOSE.authFailed);
      return;
    }
    if (conn.helloTimer !== null) this.clock.clearTimeout(conn.helloTimer);
    conn.helloTimer = null;
    const user: MpUser = { id: check.user.id, name: cleanName(check.user.firstName) };
    conn.user = user;
    this.takeOver(conn, user.id);
    const room = this.registry.roomOf(user.id);
    this.send(conn, {
      t: 'welcome',
      v: MP_PROTOCOL_VERSION,
      name: user.name === '' ? 'Player' : user.name,
      now: this.clock.now(),
      code: room?.code ?? null,
    });
    room?.connected(user.id);
  }

  /** One socket per user: an older one of this user is told and closed (§19.4). */
  private takeOver(conn: Connection, userId: number): void {
    const old = this.byUser.get(userId);
    this.byUser.set(userId, conn);
    if (old === undefined) return;
    this.send(old, { t: 'error', code: 'replaced', re: null });
    old.socket.close(WS_CLOSE.replaced);
  }

  private dispatch(conn: Connection, user: MpUser, msg: Exclude<ClientMsg, Hello>): void {
    switch (msg.t) {
      case 'ping':
        this.send(conn, { t: 'pong', n: msg.n, now: this.clock.now() });
        return;
      case 'create':
        this.refuseIf(conn, msg.t, this.registry.create(user, msg.settings));
        return;
      case 'join':
        this.refuseIf(conn, msg.t, this.registry.join(user, msg.code));
        return;
      case 'leave':
        this.refuseIf(conn, msg.t, this.codeOnly(this.registry.leave(user.id)));
        return;
      default:
        this.refuseIf(conn, msg.t, this.codeOnly(this.atTable(user.id, msg)));
    }
  }

  /** The messages for the table you sit at: whether they may happen is the room's to say. */
  private atTable(userId: number, msg: AtTableMsg): MpErrorCode | null {
    const room = this.registry.roomOf(userId);
    if (room === null) return 'not_seated';
    switch (msg.t) {
      case 'start':
        return room.start(userId);
      case 'back':
        return room.back(userId);
      case 'reload':
        return room.reload(userId);
      case 'act':
        return room.act(userId, msg.seq, msg.action);
    }
  }

  private codeOnly(code: MpErrorCode | null): Refusal | null {
    return code === null ? null : { code };
  }

  private refuseIf(conn: Connection, re: ClientMsg['t'], refusal: Refusal | null): void {
    if (refusal === null) return;
    const { code, other } = refusal;
    this.send(conn, { t: 'error', code, re, ...(other === undefined ? {} : { other }) });
  }

  private refuse(conn: Connection, re: ClientMsg['t'], code: MpErrorCode): void {
    this.send(conn, { t: 'error', code, re });
  }

  /** §19.4: 20 tokens, 5 more each second. */
  private takeToken(conn: Connection): boolean {
    const now = this.clock.now();
    const refill = ((now - conn.refilledAt) / 1000) * TOKEN_BUCKET_REFILL_PER_S;
    conn.tokens = Math.min(TOKEN_BUCKET_SIZE, conn.tokens + refill);
    conn.refilledAt = now;
    if (conn.tokens < 1) return false;
    conn.tokens -= 1;
    return true;
  }

  /** One timer per socket that looks again when it fires, not one per message. */
  private watchSilence(conn: Connection): void {
    const wait = conn.lastMessageAt + SILENT_SOCKET_MS - this.clock.now();
    conn.silenceTimer = this.clock.setTimeout(() => {
      if (this.clock.now() - conn.lastMessageAt >= SILENT_SOCKET_MS) {
        conn.socket.close(WS_CLOSE.silent);
      } else {
        this.watchSilence(conn);
      }
    }, wait);
  }

  /** Never throws: a socket's trouble is not the table's. */
  private send(conn: Connection, msg: ServerMsg): void {
    const { socket } = conn;
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > MAX_OUTBOUND_BYTES) {
      // The client reconnects and gets a fresh view (§19.4).
      socket.close(CLOSE_POLICY);
      return;
    }
    try {
      socket.send(JSON.stringify(msg));
    } catch {
      socket.terminate();
    }
  }

  private onClose(conn: Connection): void {
    if (conn.helloTimer !== null) this.clock.clearTimeout(conn.helloTimer);
    if (conn.silenceTimer !== null) this.clock.clearTimeout(conn.silenceTimer);
    this.connections.delete(conn);
    const { user } = conn;
    if (user === null || this.byUser.get(user.id) !== conn) return;
    this.byUser.delete(user.id);
    this.registry.roomOf(user.id)?.disconnected(user.id);
  }

  /**
   * §19.5 Server restart. Here, not in `onApplicationShutdown`: Nest closes the HTTP server first,
   * and that waits for every open socket, upgraded ones included.
   */
  async beforeApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    this.registry.endAll('server_restart');
    const closed = [...this.connections].map(
      (conn) =>
        new Promise<void>((done) => {
          conn.socket.once('close', () => {
            done();
          });
          conn.socket.close(CLOSE_RESTART);
        }),
    );
    // Real time on purpose: a client that does not answer must not hold up the shutdown.
    await Promise.race([
      Promise.all(closed),
      new Promise((done) => realClock.setTimeout(done as () => void, SHUTDOWN_GRACE_MS)),
    ]);
    for (const conn of this.connections) conn.socket.terminate();
  }
}
