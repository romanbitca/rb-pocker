/**
 * The one WebSocket of Play with friends (PLAN §19.4): connect, `hello`, heartbeat, backoff. It
 * knows nothing about tables: `MpDriver` (§19.6) says when to open and close it and reads what
 * comes in. The WebSocket and the clock are injected, so every path runs on a fake clock, and the
 * controller's `Timers` keep §0.3 true (`tests/app/timers.test.ts`).
 *
 * `hello` carries `initData`, the player's Telegram identity. ⚠️ It goes in that frame and nowhere
 * else, and only when the driver opens the socket: a player who only plays alone never gets here.
 *
 * Every socket and timer belongs to one `gen`; a new try or a stop raises it, so a late event or a
 * timer that could not be cleared does nothing (pitfall 22).
 */
import { randomSeed, rngFromSeed } from '../../core/rng.ts';
import {
  MP_PING_EVERY_MS,
  MP_PONG_WAIT_MS,
  MP_PROTOCOL_VERSION,
  WS_CLOSE,
  type ClientMsg,
  type ServerMsg,
} from '../../net/protocol.ts';
import type { Timers } from '../controller.ts';
import type { MpConnection } from '../store.ts';

/** The waits between tries (§19.4), each ±20%; the last one repeats. */
export const RECONNECT_MS: readonly number[] = [500, 1000, 2000, 4000, 8000];
export const RECONNECT_JITTER = 0.2;
/** After this long without a working socket the client stops and offers "Try again" (§19.4). */
export const GIVE_UP_AFTER_MS = 120_000;
/** Close code 4008 (rate limit): the next try waits this long (§19.4). */
export const RATE_LIMIT_WAIT_MS = 10_000;
/** No `welcome` this long after dialling: the try failed (the server's own deadline is 5 s). */
export const WELCOME_WAIT_MS = 15_000;

/** Close codes that must not be retried (§19.4); every other code is. */
const NO_RETRY: ReadonlySet<number> = new Set<number>([
  1009,
  1012,
  WS_CLOSE.authFailed,
  WS_CLOSE.replaced,
  WS_CLOSE.outdated,
  WS_CLOSE.badMessage,
]);

/** The part of the browser's `WebSocket` this file uses (a fake in tests). */
export type WebSocketLike = Pick<
  WebSocket,
  'onopen' | 'onmessage' | 'onclose' | 'onerror' | 'send' | 'close'
>;

export interface MpSocketOptions {
  url: string;
  initData: string;
  timers: Timers;
  open(url: string): WebSocketLike;
  onStatus(status: MpConnection): void;
  /** Every server message but `pong`. */
  onMessage(msg: ServerMsg): void;
  /** The socket closed with a code that is not retried (§19.4): it will not come back. */
  onStopped(code: number): void;
  /** A number in [0, 1) for the ±20% (tests fix it). Default: a stream of `core/rng.ts`. */
  random?: () => number;
}

function defaultRandom(): () => number {
  const rng = rngFromSeed(randomSeed());
  return () => rng.next() / 0x1_0000_0000;
}

export class MpSocket {
  private readonly o: MpSocketOptions;
  private readonly random: () => number;
  private ws: WebSocketLike | null = null;
  private gen = 0;
  private status: MpConnection = 'idle';
  private welcomed = false;
  /** True after `close`, a code that is not retried, or two minutes of failures. */
  private stopped = true;
  private hidden = false;
  /** A try was due while the page was hidden: it happens when the page is visible again. */
  private waitsForVisible = false;
  private tries = 0;
  private failingSince: number | null = null;
  private retryTimer: unknown = null;
  private welcomeTimer: unknown = null;
  private pingTimer: unknown = null;
  private pongTimer: unknown = null;
  private pingSeq = 0;
  private awaitedPong: number | null = null;

  constructor(options: MpSocketOptions) {
    this.o = options;
    this.random = options.random ?? defaultRandom();
  }

  /** `hello` has been answered: `send` works. */
  get online(): boolean {
    return this.welcomed;
  }

  connect(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.tries = 0;
    this.failingSince = null;
    this.setStatus('connecting');
    this.dial();
  }

  /** Sends now, or returns false (no socket, or `hello` not answered yet). Never queues. */
  send(msg: ClientMsg): boolean {
    return this.welcomed && this.sendNow(msg);
  }

  /** "Try again", or any new reason to connect: a try now, with the backoff started over. */
  retry(): void {
    if (this.ws !== null) return;
    this.stopped = false;
    this.waitsForVisible = false;
    this.tries = 0;
    this.failingSince = null;
    this.setStatus('reconnecting');
    this.dial();
  }

  /** §19.4: a hidden page waits, and tries at once when it is visible again. */
  setHidden(hidden: boolean): void {
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    if (this.stopped) return;
    if (hidden) {
      if (this.retryTimer !== null) {
        this.clear('retryTimer');
        this.gen++;
        this.waitsForVisible = true;
      }
      return;
    }
    if (!this.waitsForVisible) return;
    this.waitsForVisible = false;
    this.tries = 0;
    this.failingSince = this.o.timers.now();
    this.dial();
  }

  close(): void {
    this.stopped = true;
    this.waitsForVisible = false;
    this.drop();
    this.setStatus('idle');
  }

  private setStatus(status: MpConnection): void {
    if (status === this.status) return;
    this.status = status;
    this.o.onStatus(status);
  }

  private clear(timer: 'retryTimer' | 'welcomeTimer' | 'pingTimer' | 'pongTimer'): void {
    if (this[timer] !== null) this.o.timers.clearTimeout(this[timer]);
    this[timer] = null;
  }

  /** Forgets the socket and its timers; a socket still open is closed, its events ignored. */
  private drop(): void {
    this.gen++;
    this.clear('retryTimer');
    this.clear('welcomeTimer');
    this.clear('pingTimer');
    this.clear('pongTimer');
    this.welcomed = false;
    this.awaitedPong = null;
    const ws = this.ws;
    this.ws = null;
    if (ws === null) return;
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
    try {
      ws.close(1000);
    } catch {
      // Already closing: nothing more to do.
    }
  }

  private dial(): void {
    this.drop();
    const gen = this.gen;
    let ws: WebSocketLike;
    try {
      ws = this.o.open(this.o.url);
    } catch {
      this.retryLater(null);
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (gen !== this.gen) return;
      this.sendNow({ t: 'hello', v: MP_PROTOCOL_VERSION, initData: this.o.initData });
    };
    ws.onmessage = (event: MessageEvent<unknown>) => {
      if (gen === this.gen) this.receive(event.data);
    };
    ws.onclose = (event: CloseEvent) => {
      if (gen === this.gen) this.closed(event.code);
    };
    this.welcomeTimer = this.o.timers.setTimeout(() => {
      if (gen === this.gen) this.closed(1006);
    }, WELCOME_WAIT_MS);
  }

  private sendNow(msg: ClientMsg): boolean {
    try {
      this.ws?.send(JSON.stringify(msg));
      return this.ws !== null;
    } catch {
      return false;
    }
  }

  /** A frame in. Our own server sends these, so only the shape that routes them is checked. */
  private receive(data: unknown): void {
    if (typeof data !== 'string') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || !('t' in parsed)) return;
    const msg = parsed as ServerMsg;
    if (msg.t === 'pong') {
      if (msg.n === this.awaitedPong) {
        this.awaitedPong = null;
        this.clear('pongTimer');
      }
      return;
    }
    if (msg.t === 'welcome') this.welcome();
    this.o.onMessage(msg);
  }

  private welcome(): void {
    this.welcomed = true;
    this.tries = 0;
    this.failingSince = null;
    this.clear('welcomeTimer');
    this.setStatus('online');
    this.armPing(this.gen);
  }

  private armPing(gen: number): void {
    this.pingTimer = this.o.timers.setTimeout(() => {
      if (gen === this.gen) this.ping(gen);
    }, MP_PING_EVERY_MS);
  }

  private ping(gen: number): void {
    const n = ++this.pingSeq;
    this.awaitedPong = n;
    this.sendNow({ t: 'ping', n });
    this.armPing(gen);
    this.clear('pongTimer');
    this.pongTimer = this.o.timers.setTimeout(() => {
      // No pong in time means the socket is dead (§19.4): the same as a drop.
      if (gen === this.gen && this.awaitedPong === n) this.closed(1006);
    }, MP_PONG_WAIT_MS);
  }

  private closed(code: number): void {
    this.drop();
    if (NO_RETRY.has(code)) {
      this.stopped = true;
      this.setStatus('idle');
      this.o.onStopped(code);
      return;
    }
    this.retryLater(code === WS_CLOSE.rateLimited ? RATE_LIMIT_WAIT_MS : null);
  }

  private retryLater(fixedMs: number | null): void {
    this.setStatus('reconnecting');
    const now = this.o.timers.now();
    this.failingSince ??= now;
    if (this.hidden) {
      this.waitsForVisible = true;
      return;
    }
    if (now - this.failingSince >= GIVE_UP_AFTER_MS) {
      this.stopped = true;
      this.setStatus('lost');
      return;
    }
    const step = RECONNECT_MS[Math.min(this.tries, RECONNECT_MS.length - 1)] as number;
    this.tries++;
    const jitter = 1 - RECONNECT_JITTER + this.random() * 2 * RECONNECT_JITTER;
    const gen = this.gen;
    this.retryTimer = this.o.timers.setTimeout(
      () => {
        if (gen === this.gen) this.dial();
      },
      fixedMs ?? Math.round(step * jitter),
    );
  }
}
