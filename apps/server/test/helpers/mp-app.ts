import { request as httpRequest, type Server } from 'node:http';
import { connect, type AddressInfo, type Socket } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { vi } from 'vitest';
import type { LegalActions, PlayerAction } from '../../src/game/engine/types.js';
import {
  MP_PROTOCOL_VERSION,
  MP_WS_PATH,
  type ServerMsg,
  type TableSettings,
  type TableView,
} from '../../src/game/net/protocol.js';
import { AppModule } from '../../src/app.module.js';
import { BotApi } from '../../src/bot/bot-api.js';
import { CLOCK } from '../../src/mp/clock.js';
import { configureApp } from '../../src/setup.js';
import { stubTelegram } from './bot-env.js';
import { FakeBotApi } from './fake-bot-api.js';
import { FakeClock } from './fake-clock.js';
import { signInitData } from './sign-init-data.js';

/** Long, because this Mac is often busy (the sockets are real). */
export const SOCKET_TEST_TIMEOUT_MS = 60_000;
const WAIT_MS = 20_000;

/** Telegram-like ids and the fields a Telegram user has besides the first name. */
export const USER_ID = (i: number): number => 8_000_000_000 + 17 * i;
export const FIRST_NAMES = ['Ann', 'Bob', 'Cid', 'Dee', 'Eve', 'Fay', 'Gus', 'Hal', 'Ivy'];
export const USERNAME = (i: number): string => `secret_username_${i}`;
export const PHOTO_URL = (i: number): string => `https://t.me/i/userpic/320/secret_${i}.jpg`;
export const LAST_NAME = (i: number): string => `Secretlast${i}`;

export interface MpApp {
  readonly app: NestExpressApplication;
  readonly clock: FakeClock;
  readonly port: number;
  readonly url: string;
  readonly bot: FakeBotApi;
}

/**
 * The real `AppModule` on a real port, with the fake clock and no way to reach Telegram. Telegram is
 * on or off through the environment, as in production: `on: true` is a test token that signs
 * `initData`, and nothing else gets in.
 */
export async function startMpApp(options?: { on?: boolean; clock?: FakeClock }): Promise<MpApp> {
  stubTelegram(options?.on ?? true);
  const clock = options?.clock ?? new FakeClock(Date.now());
  const bot = new FakeBotApi();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CLOCK)
    .useValue(clock)
    .overrideProvider(BotApi)
    .useValue(bot)
    .compile();
  vi.unstubAllEnvs(); // The config is read: nothing else in this process should see it.
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app, 'development');
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, clock, port, url: `ws://127.0.0.1:${port}${MP_WS_PATH}`, bot };
}

export interface UpgradeAnswer {
  readonly status: number;
  /** Set when the server said 101. */
  readonly socket?: Socket;
  readonly body: string;
}

/** A hand-made upgrade request, for the answers a `WebSocket` object does not show. */
export function rawUpgrade(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<UpgradeAnswer> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1',
      port,
      path,
      agent: false,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        ...headers,
      },
    });
    req.on('upgrade', (res, socket) => {
      resolve({ status: res.statusCode ?? 0, socket: socket as Socket, body: '' });
    });
    req.on('response', (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/** A client that speaks WebSocket by hand, so it can stop reading or ignore a close. */
export interface RawClient {
  readonly socket: Socket;
  readonly status: number;
  /** Everything received after the response to the upgrade. */
  received(): Buffer;
}

/** Opens a socket that never sends its FIN (`allowHalfOpen`) and asks for an upgrade. */
export function rawClient(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<RawClient> {
  return new Promise((resolve, reject) => {
    const socket = connect({ port, host: '127.0.0.1', allowHalfOpen: true });
    socket.on('error', reject);
    socket.write(
      [
        `GET ${path} HTTP/1.1`,
        'Host: 127.0.0.1',
        'Connection: Upgrade',
        'Upgrade: websocket',
        'Sec-WebSocket-Version: 13',
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
        '',
        '',
      ].join('\r\n'),
    );
    let buffer = Buffer.alloc(0);
    let answered = false;
    socket.on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);
      if (answered) return;
      const end = buffer.indexOf('\r\n\r\n');
      if (end === -1) return;
      answered = true;
      const status = Number(buffer.subarray(9, 12).toString('latin1'));
      buffer = buffer.subarray(end + 4);
      resolve({ socket, status, received: () => buffer });
    });
  });
}

const FRAME_MASK = [1, 2, 3, 4] as const;

/** One masked client frame of up to 65,535 bytes. */
export function maskedFrame(opcode: number, payload: string): Buffer {
  const data = Buffer.from(payload);
  const head =
    data.length < 126
      ? [0x80 | opcode, 0x80 | data.length]
      : [0x80 | opcode, 0x80 | 126, data.length >> 8, data.length & 0xff];
  const body = data.map((byte, i) => byte ^ (FRAME_MASK[i % 4] as number));
  return Buffer.concat([Buffer.from(head), Buffer.from(FRAME_MASK), body]);
}

/** Open TCP connections of the app, upgraded ones included. */
export function openConnections(mp: MpApp): Promise<number> {
  return new Promise((resolve, reject) => {
    (mp.app.getHttpServer() as Server).getConnections((err, count) => {
      if (err) reject(err);
      else resolve(count);
    });
  });
}

/** Polls `check` until it holds. `ms` is real time, far more than a busy Mac needs. */
export async function eventually(
  check: () => boolean | Promise<boolean>,
  what: string,
  ms = 10_000,
): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`it never happened: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** A real browser-style WebSocket that keeps every frame it gets. */
export class TestSocket {
  readonly frames: ServerMsg[] = [];
  closeCode: number | null = null;
  private cursor = 0;
  private wake: () => void = () => {};

  private constructor(readonly ws: WebSocket) {
    ws.addEventListener('message', (event) => {
      this.frames.push(JSON.parse(event.data as string) as ServerMsg);
      this.wake();
    });
    ws.addEventListener('close', (event) => {
      this.closeCode = event.code;
      this.wake();
    });
  }

  static async open(url: string): Promise<TestSocket> {
    const ws = new WebSocket(url);
    const socket = new TestSocket(ws);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => {
        resolve();
      });
      ws.addEventListener('error', () => {
        reject(new Error('the socket did not open'));
      });
    });
    return socket;
  }

  send(msg: unknown): void {
    this.ws.send(JSON.stringify(msg));
  }

  sendText(text: string): void {
    this.ws.send(text);
  }

  /** Waits for a condition on the frames, giving the event loop time until it holds. */
  private async waitFor<T>(find: () => T | undefined, what: string): Promise<T> {
    const deadline = Date.now() + WAIT_MS;
    for (;;) {
      const found = find();
      if (found !== undefined) return found;
      const left = deadline - Date.now();
      if (left <= 0) {
        const tail = JSON.stringify(this.frames.slice(-5)).slice(0, 2_000);
        throw new Error(`timed out waiting for ${what}; closeCode ${this.closeCode}; last ${tail}`);
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
  }

  /** The next frame after those already consumed that matches; consumes through it. */
  async until<T extends ServerMsg>(match: (m: ServerMsg) => m is T, what = 'a frame'): Promise<T> {
    return this.waitFor(() => {
      for (let i = this.cursor; i < this.frames.length; i++) {
        const frame = this.frames[i] as ServerMsg;
        if (match(frame)) {
          this.cursor = i + 1;
          return frame;
        }
      }
      return undefined;
    }, what);
  }

  table(): Promise<Extract<ServerMsg, { t: 'table' }>> {
    return this.until((m): m is Extract<ServerMsg, { t: 'table' }> => m.t === 'table', 'a table');
  }

  /** The next `table` whose `rev` is at least `rev`. */
  tableAt(rev: number): Promise<Extract<ServerMsg, { t: 'table' }>> {
    return this.until(
      (m): m is Extract<ServerMsg, { t: 'table' }> => m.t === 'table' && m.view.rev >= rev,
      `a table with rev ≥ ${rev}`,
    );
  }

  /** Waits until this socket has a view with `rev` at least `rev`, read or not. Consumes nothing. */
  hasRev(rev: number): Promise<TableView> {
    return this.waitFor(
      () => this.tables().find((t) => t.view.rev >= rev)?.view,
      `a view with rev ≥ ${rev}`,
    );
  }

  error(): Promise<Extract<ServerMsg, { t: 'error' }>> {
    return this.until((m): m is Extract<ServerMsg, { t: 'error' }> => m.t === 'error', 'an error');
  }

  closed(): Promise<number> {
    return this.waitFor(() => this.closeCode ?? undefined, 'the close');
  }

  /** Every frame so far of the kind `table`, oldest first. */
  tables(): Extract<ServerMsg, { t: 'table' }>[] {
    return this.frames.filter((m): m is Extract<ServerMsg, { t: 'table' }> => m.t === 'table');
  }

  /** The newest view this socket got. */
  view(): TableView {
    const last = this.tables().at(-1);
    if (last === undefined) throw new Error('no table yet');
    return last.view;
  }

  terminate(): void {
    this.ws.close();
  }
}

/** A correctly signed `initData` of user `i`, with every field a real one has. */
export function initDataOf(i: number, clock: FakeClock): string {
  return signInitData({
    user: {
      id: USER_ID(i),
      first_name: FIRST_NAMES[i] ?? `U${i}`,
      last_name: LAST_NAME(i),
      username: USERNAME(i),
      language_code: 'en',
      photo_url: PHOTO_URL(i),
    },
    authDate: Math.floor(clock.now() / 1000),
  });
}

/** Opens a socket and says `hello` as user `i`, up to the `welcome`. */
export async function connectAs(mp: MpApp, i: number): Promise<TestSocket> {
  const socket = await TestSocket.open(mp.url);
  socket.send({ t: 'hello', v: MP_PROTOCOL_VERSION, initData: initDataOf(i, mp.clock) });
  await socket.until(
    (m): m is Extract<ServerMsg, { t: 'welcome' }> => m.t === 'welcome',
    'welcome',
  );
  return socket;
}

export const SETTINGS: TableSettings = { seats: 6, stakes: 'normal', turnSeconds: 30 };

export const passiveAction = (legal: LegalActions): PlayerAction =>
  legal.canCheck ? { type: 'check' } : { type: 'call' };
export const foldAction = (legal: LegalActions): PlayerAction =>
  legal.canFold ? { type: 'fold' } : { type: 'check' };
export const allInAction = (legal: LegalActions): PlayerAction => {
  if (legal.raise !== null) return { type: 'raise', to: legal.raise.max };
  if (legal.bet !== null) return { type: 'bet', to: legal.bet.max };
  return passiveAction(legal);
};

/** A table of real sockets: user i at seat i, each socket following along. */
export class SocketTable {
  constructor(
    readonly mp: MpApp,
    readonly sockets: TestSocket[],
  ) {}

  /** `n` users: the first makes the table and the others join, up to everyone's view of it. */
  static async seat(
    mp: MpApp,
    n: number,
    settings: TableSettings = SETTINGS,
  ): Promise<SocketTable> {
    const sockets: TestSocket[] = [];
    for (let i = 0; i < n; i++) sockets.push(await connectAs(mp, i));
    const first = sockets[0] as TestSocket;
    first.send({ t: 'create', settings });
    const { code } = (await first.table()).view;
    for (let i = 1; i < n; i++) {
      const socket = sockets[i] as TestSocket;
      socket.send({ t: 'join', code });
      await socket.table();
    }
    const table = new SocketTable(mp, sockets);
    await table.sync();
    return table;
  }

  static async deal(mp: MpApp, n: number, settings?: TableSettings): Promise<SocketTable> {
    const table = await SocketTable.seat(mp, n, settings);
    await table.change(() => {
      (table.sockets[0] as TestSocket).send({ t: 'start' });
    });
    return table;
  }

  socket(i: number): TestSocket {
    return this.sockets[i] as TestSocket;
  }

  /** The newest view of the first socket that still follows the table. */
  view(): TableView {
    const open = this.openSockets();
    const newest = open
      .map((s) => s.view())
      .reduce((best, view) => (view.rev > best.rev ? view : best));
    return newest;
  }

  private openSockets(): TestSocket[] {
    return this.sockets.filter((s) => s.closeCode === null && s.tables().length > 0);
  }

  /** Waits until every open socket has seen the newest view any of them has. */
  async sync(): Promise<void> {
    const { rev } = this.view();
    await Promise.all(this.openSockets().map((s) => s.hasRev(rev)));
  }

  /** Runs `fn`, then waits until every open socket has a view newer than the one before it. */
  async change(fn: () => void): Promise<TableView> {
    const { rev } = this.view();
    fn();
    await Promise.all(this.openSockets().map((s) => s.hasRev(rev + 1)));
    return this.view();
  }

  /** Lets the fake clock run `ms`, with the sockets pinging as a real client's would. */
  async advance(ms: number): Promise<void> {
    await this.keepAlive();
    const { rev } = this.view();
    this.mp.clock.advance(ms);
    await this.settleAt(rev);
  }

  /** Fires the next fake timer of the table and waits for what it sent. */
  async tick(): Promise<void> {
    await this.keepAlive();
    const { rev } = this.view();
    this.mp.clock.next();
    await this.settleAt(rev);
  }

  private async settleAt(rev: number): Promise<void> {
    // A timer that changed nothing leaves `rev` where it was, so give up on it soon.
    await Promise.race([
      Promise.all(this.openSockets().map((s) => s.hasRev(rev + 1))),
      new Promise((resolve) => setTimeout(resolve, 300)),
    ]);
  }

  /** A real client pings every 20 s; the fake clock would otherwise close every quiet socket. */
  private async keepAlive(): Promise<void> {
    await Promise.all(
      this.openSockets().map(async (s) => {
        const n = s.frames.length;
        s.send({ t: 'ping', n });
        await s.until((m): m is Extract<ServerMsg, { t: 'pong' }> => m.t === 'pong' && m.n === n);
      }),
    );
  }

  /** Plays the open decision with `pick`, through the player's own socket. */
  async play(pick: (legal: LegalActions) => PlayerAction): Promise<void> {
    const decision = this.view().decision;
    if (decision === null) throw new Error('no decision');
    const socket = this.socket(decision.seat);
    const { legal } = socket.view();
    if (legal === null) throw new Error(`seat ${decision.seat} sees no legal actions`);
    await this.change(() => {
      socket.send({ t: 'act', seq: decision.seq, action: pick(legal) });
    });
  }

  /** Plays the hand to its end with `pick`. */
  async playHand(pick: (legal: LegalActions) => PlayerAction): Promise<void> {
    for (let guard = 0; guard < 400; guard++) {
      const view = this.view();
      if (view.hand === null) throw new Error('no hand to play');
      if (view.hand.phase === 'complete') return;
      if (view.decision !== null) await this.play(pick);
      else await this.tick();
    }
    throw new Error('the hand did not end');
  }
}
