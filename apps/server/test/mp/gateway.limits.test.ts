import type { Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket as ServerSocket } from 'ws';
import {
  MP_MAX_INBOUND_BYTES,
  MP_PROTOCOL_VERSION,
  MP_WS_PATH,
  type ServerMsg,
} from '../../src/game/net/protocol.js';
import { clientAddress, MpGateway } from '../../src/mp/gateway.js';
import { RoomRegistry } from '../../src/mp/registry.js';
import {
  CREATE_LIMIT,
  CREATE_WINDOW_MS,
  FAILED_JOIN_LIMIT,
  FAILED_JOIN_WINDOW_MS,
  HELLO_DEADLINE_MS,
  HELLO_LIMIT,
  HELLO_WINDOW_MS,
  MAX_ANONYMOUS_PER_IP,
  MAX_DROPS,
  MAX_OUTBOUND_BYTES,
  MAX_ROOMS,
  MAX_SOCKETS,
  SILENT_SOCKET_MS,
  TOKEN_BUCKET_REFILL_PER_S,
  TOKEN_BUCKET_SIZE,
} from '../../src/mp/timing.js';
import {
  connectAs,
  eventually,
  initDataOf,
  maskedFrame,
  openConnections,
  rawClient,
  rawUpgrade,
  SETTINGS,
  SOCKET_TEST_TIMEOUT_MS,
  SocketTable,
  startMpApp,
  TestSocket,
  type MpApp,
} from '../helpers/mp-app.js';

vi.setConfig({ testTimeout: SOCKET_TEST_TIMEOUT_MS, hookTimeout: SOCKET_TEST_TIMEOUT_MS });

const isPong = (m: ServerMsg): m is Extract<ServerMsg, { t: 'pong' }> => m.t === 'pong';

describe('§19.4 limits', () => {
  let mp: MpApp;
  const open: TestSocket[] = [];

  const helloed = async (i: number): Promise<TestSocket> => {
    const socket = await connectAs(mp, i);
    open.push(socket);
    return socket;
  };

  beforeEach(async () => {
    mp = await startMpApp();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await mp.app.close();
    for (const socket of open.splice(0)) socket.terminate();
  });

  it('Inbound frame: 16 KiB is a frame like any other, one byte more closes 1009', async () => {
    expect(MP_MAX_INBOUND_BYTES).toBe(16_384);
    const fine = await helloed(0);
    fine.sendText('x'.repeat(MP_MAX_INBOUND_BYTES));
    expect(await fine.error()).toEqual({ t: 'error', code: 'bad_message', re: null });

    const big = await helloed(1);
    big.sendText('x'.repeat(MP_MAX_INBOUND_BYTES + 1));
    expect(await big.closed()).toBe(1009);
  });

  it('Messages per socket: 20 tokens, 5 refilled per second; the 21st is rate_limited and dropped', async () => {
    expect(TOKEN_BUCKET_SIZE).toBe(20);
    expect(TOKEN_BUCKET_REFILL_PER_S).toBe(5);
    const socket = await helloed(0);
    // The hello took one token.
    for (let n = 1; n < TOKEN_BUCKET_SIZE; n++) {
      socket.send({ t: 'ping', n });
      expect(await socket.until(isPong)).toMatchObject({ n });
    }
    socket.send({ t: 'ping', n: 99 });
    expect(await socket.error()).toEqual({ t: 'error', code: 'rate_limited', re: null });
    expect(socket.frames.filter(isPong).some((m) => m.n === 99)).toBe(false);

    mp.clock.advance(1_000 / TOKEN_BUCKET_REFILL_PER_S); // one token
    socket.send({ t: 'ping', n: 100 });
    expect(await socket.until(isPong)).toMatchObject({ n: 100 });
    socket.send({ t: 'ping', n: 101 });
    expect(await socket.error()).toEqual({ t: 'error', code: 'rate_limited', re: null });
  });

  it('Messages per socket: 50 drops close 4008', async () => {
    expect(MAX_DROPS).toBe(50);
    const socket = await helloed(0);
    for (let n = 0; n < TOKEN_BUCKET_SIZE - 1; n++) socket.send({ t: 'ping', n });
    for (let drop = 0; drop < MAX_DROPS; drop++) socket.send({ t: 'ping', n: 1_000 + drop });
    expect(await socket.closed()).toBe(4008);
    const drops = socket.frames.filter((m) => m.t === 'error' && m.code === 'rate_limited');
    expect(drops).toHaveLength(MAX_DROPS);
  });

  it('Hello deadline: no hello in 3 s closes 4004', async () => {
    expect(HELLO_DEADLINE_MS).toBe(3_000);
    const socket = await TestSocket.open(mp.url);
    open.push(socket);
    mp.clock.advance(HELLO_DEADLINE_MS - 1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(socket.closeCode).toBeNull();
    mp.clock.advance(1);
    expect(await socket.closed()).toBe(4004);
  });

  it('Hello deadline: a good hello in time stops it', async () => {
    const socket = await helloed(0);
    mp.clock.advance(HELLO_DEADLINE_MS);
    socket.send({ t: 'ping', n: 1 });
    expect(await socket.until(isPong)).toMatchObject({ n: 1 });
  });

  it('Silent socket: no message in 45 s closes 4009, and any message starts the time again', async () => {
    expect(SILENT_SOCKET_MS).toBe(45_000);
    const socket = await helloed(0);
    mp.clock.advance(SILENT_SOCKET_MS - 1_000);
    socket.send({ t: 'ping', n: 1 });
    await socket.until(isPong);
    mp.clock.advance(SILENT_SOCKET_MS - 1_000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(socket.closeCode).toBeNull();
    mp.clock.advance(1_000);
    expect(await socket.closed()).toBe(4009);
  });

  it('Outbound buffer: over 256 KiB closes 1008, and the client comes back to a fresh view', async () => {
    expect(MAX_OUTBOUND_BYTES).toBe(262_144);
    const table = await SocketTable.seat(mp, 2);
    open.push(...table.sockets);
    const a = table.socket(0);
    const b = table.socket(1);

    // A real socket whose write buffer reads as full, without having to fill a kernel buffer.
    const buffered = vi
      .spyOn(ServerSocket.prototype, 'bufferedAmount', 'get')
      .mockReturnValue(MAX_OUTBOUND_BYTES + 1);
    a.send({ t: 'start' });
    expect(await a.closed()).toBe(1008);
    expect(await b.closed()).toBe(1008);
    buffered.mockRestore();

    const again = await helloed(0);
    expect((await again.table()).view.status).toBe('playing');
  });

  it('Outbound buffer: exactly 256 KiB is still fine', async () => {
    const a = await helloed(0);
    vi.spyOn(ServerSocket.prototype, 'bufferedAmount', 'get').mockReturnValue(MAX_OUTBOUND_BYTES);
    a.send({ t: 'ping', n: 1 });
    expect(await a.until(isPong)).toMatchObject({ n: 1 });
    vi.restoreAllMocks();
  });

  it(
    'Open sockets: 1,000, and one more upgrade is refused with 503',
    async () => {
      expect(MAX_SOCKETS).toBe(1_000);
      const held: Socket[] = [];
      /** One client per address, or the per-address cap would answer first. */
      let addresses = 0;
      const fromAnywhere = (): Record<string, string> => {
        addresses++;
        return { 'CF-Connecting-IP': `198.18.${addresses >> 8}.${addresses & 255}` };
      };
      try {
        // In batches: a thousand connects at once overflow the listen queue.
        while (held.length < MAX_SOCKETS) {
          const batch = Math.min(40, MAX_SOCKETS - held.length);
          const opened = await Promise.all(
            Array.from({ length: batch }, () => rawUpgrade(mp.port, '/api/mp/ws', fromAnywhere())),
          );
          for (const { status, socket } of opened) {
            expect(status).toBe(101);
            held.push(socket as Socket);
          }
        }
        expect((await rawUpgrade(mp.port, '/api/mp/ws', fromAnywhere())).status).toBe(503);
        (held.pop() as Socket).destroy();
        await new Promise((resolve) => setTimeout(resolve, 200));
        const last = await rawUpgrade(mp.port, '/api/mp/ws', fromAnywhere());
        expect(last.status).toBe(101);
        if (last.socket !== undefined) held.push(last.socket);
      } finally {
        for (const socket of held) socket.destroy();
      }
    },
    5 * SOCKET_TEST_TIMEOUT_MS,
  );

  it('Rooms: the 201st table is server_full, for a real socket too', async () => {
    expect(MAX_ROOMS).toBe(200);
    const registry = mp.app.get(RoomRegistry, { strict: false });
    for (let i = 0; i < MAX_ROOMS; i++) {
      expect(registry.create({ id: 9_000_000 + i, name: 'x' }, SETTINGS)).toBeNull();
    }
    const socket = await helloed(0);
    socket.send({ t: 'create', settings: SETTINGS });
    expect(await socket.error()).toEqual({ t: 'error', code: 'server_full', re: 'create' });
  });

  it('create per user: 5 per 10 minutes, then rate_limited', async () => {
    expect(CREATE_LIMIT).toBe(5);
    expect(CREATE_WINDOW_MS).toBe(600_000);
    const socket = await helloed(0);
    for (let i = 0; i < CREATE_LIMIT; i++) {
      socket.send({ t: 'create', settings: SETTINGS });
      await socket.table();
      socket.send({ t: 'leave' });
      await socket.until((m): m is Extract<ServerMsg, { t: 'left' }> => m.t === 'left');
    }
    socket.send({ t: 'create', settings: SETTINGS });
    expect(await socket.error()).toEqual({ t: 'error', code: 'rate_limited', re: 'create' });

    mp.clock.advance(CREATE_WINDOW_MS);
    const later = await TestSocket.open(mp.url);
    open.push(later);
    later.send({ t: 'hello', v: MP_PROTOCOL_VERSION, initData: initDataOf(0, mp.clock) });
    later.send({ t: 'create', settings: SETTINGS });
    expect((await later.table()).view.status).toBe('waiting');
  });

  it('Failed join per user: 10 per 5 minutes, then rate_limited, so codes cannot be guessed', async () => {
    expect(FAILED_JOIN_LIMIT).toBe(10);
    expect(FAILED_JOIN_WINDOW_MS).toBe(300_000);
    const socket = await helloed(0);
    for (let i = 0; i < FAILED_JOIN_LIMIT; i++) {
      socket.send({ t: 'join', code: 'ZZZZZZZZ' });
      expect(await socket.error()).toEqual({ t: 'error', code: 'not_found', re: 'join' });
    }
    socket.send({ t: 'join', code: 'ZZZZZZZZ' });
    expect(await socket.error()).toEqual({ t: 'error', code: 'rate_limited', re: 'join' });
  });

  describe('a client that does not play by the rules', () => {
    const PING_OPCODE = 0x9;
    const TEXT_OPCODE = 0x1;
    /** About 1 MB. */
    const PINGS_PER_CHUNK = 8_000;
    /** More than the kernel's socket buffers take, so a pong queue would show. */
    const CHUNKS = 12;
    const held: Socket[] = [];

    const serverSockets = (): ServerSocket[] =>
      [
        ...(
          mp.app.get(MpGateway, { strict: false }) as unknown as {
            connections: Set<{ socket: ServerSocket }>;
          }
        ).connections,
      ].map((conn) => conn.socket);
    const isFree = async (): Promise<boolean> => (await openConnections(mp)) === 0;
    const hold = (...sockets: (Socket | undefined)[]): void => {
      for (const socket of sockets) if (socket !== undefined) held.push(socket);
    };

    afterEach(() => {
      for (const socket of held.splice(0)) socket.destroy();
    });

    it('A flood of protocol pings queues nothing: no pong goes out, and the protocol heartbeat still works', async () => {
      const raw = await rawClient(mp.port, MP_WS_PATH);
      hold(raw.socket);
      raw.socket.pause(); // reads nothing from now on
      const [server] = serverSockets();
      let pings = 0;
      server?.on('ping', () => {
        pings++;
      });
      const ping = maskedFrame(PING_OPCODE, 'x'.repeat(125));
      const chunk = Buffer.concat(Array.from({ length: PINGS_PER_CHUNK }, () => ping));
      for (let i = 0; i < CHUNKS; i++) {
        if (!raw.socket.write(chunk)) {
          await new Promise((done) => raw.socket.once('drain', done));
        }
      }
      await eventually(() => pings === CHUNKS * PINGS_PER_CHUNK, 'the server read it', 30_000);
      expect(server?.bufferedAmount).toBe(0);

      const socket = await helloed(0);
      socket.send({ t: 'ping', n: 5 });
      expect(await socket.until(isPong)).toMatchObject({ n: 5 });
    });

    it('Hello deadline: a client that never answers the close is cut off on time, and its slot is free at once', async () => {
      const raw = await rawClient(mp.port, MP_WS_PATH);
      hold(raw.socket);
      raw.socket.resume();
      expect(await openConnections(mp)).toBe(1);
      mp.clock.advance(HELLO_DEADLINE_MS);
      await eventually(isFree, 'the slot is free');
    });

    it('A refused hello does not keep its slot either', async () => {
      const raw = await rawClient(mp.port, MP_WS_PATH);
      hold(raw.socket);
      raw.socket.write(
        maskedFrame(
          TEXT_OPCODE,
          JSON.stringify({ t: 'hello', v: MP_PROTOCOL_VERSION, initData: 'user=1&hash=00' }),
        ),
      );
      await eventually(() => raw.received().includes('auth_failed'), 'the refusal');
      await eventually(isFree, 'the slot is free');
    });

    it('Silent socket: a client that never answers the close is cut off on time, and its slot is free at once', async () => {
      const raw = await rawClient(mp.port, MP_WS_PATH);
      hold(raw.socket);
      raw.socket.write(
        maskedFrame(
          TEXT_OPCODE,
          JSON.stringify({ t: 'hello', v: MP_PROTOCOL_VERSION, initData: initDataOf(0, mp.clock) }),
        ),
      );
      await eventually(() => raw.received().includes('welcome'), 'the welcome');
      mp.clock.advance(SILENT_SOCKET_MS);
      await eventually(isFree, 'the slot is free');
    });

    it('Anonymous sockets per address: 16 at most, one more is 503, another address has its own count', async () => {
      expect(MAX_ANONYMOUS_PER_IP).toBe(16);
      for (let i = 0; i < MAX_ANONYMOUS_PER_IP; i++) {
        const { status, socket } = await rawUpgrade(mp.port, MP_WS_PATH);
        expect(status).toBe(101);
        hold(socket);
      }
      expect((await rawUpgrade(mp.port, MP_WS_PATH)).status).toBe(503);

      const other = await rawUpgrade(mp.port, MP_WS_PATH, { 'CF-Connecting-IP': '203.0.113.9' });
      expect(other.status).toBe(101);
      hold(other.socket);
    });

    it('Anonymous sockets per address: one that says hello or goes away frees its place', async () => {
      for (let i = 0; i < MAX_ANONYMOUS_PER_IP - 1; i++) {
        const { socket } = await rawUpgrade(mp.port, MP_WS_PATH);
        hold(socket);
      }
      await helloed(0); // Was the 16th, and stopped counting when it said hello.
      const last = await rawUpgrade(mp.port, MP_WS_PATH);
      expect(last.status).toBe(101);
      hold(last.socket);
      expect((await rawUpgrade(mp.port, MP_WS_PATH)).status).toBe(503);

      last.socket?.destroy();
      await eventually(async () => {
        const again = await rawUpgrade(mp.port, MP_WS_PATH);
        hold(again.socket);
        return again.status === 101;
      }, 'a place is free again');
    });

    it('hello per user: 12 a minute, then rate_limited and 4008, and the open socket is left alone', async () => {
      expect(HELLO_LIMIT).toBe(12);
      expect(HELLO_WINDOW_MS).toBe(60_000);
      let last = await helloed(0);
      for (let i = 1; i < HELLO_LIMIT; i++) last = await helloed(0);

      const refused = await TestSocket.open(mp.url);
      open.push(refused);
      refused.send({ t: 'hello', v: MP_PROTOCOL_VERSION, initData: initDataOf(0, mp.clock) });
      expect(await refused.error()).toEqual({ t: 'error', code: 'rate_limited', re: 'hello' });
      expect(await refused.closed()).toBe(4008);

      last.send({ t: 'ping', n: 1 });
      expect(await last.until(isPong)).toMatchObject({ n: 1 });

      const someoneElse = await helloed(1);
      someoneElse.send({ t: 'ping', n: 2 });
      expect(await someoneElse.until(isPong)).toMatchObject({ n: 2 });

      mp.clock.advance(HELLO_WINDOW_MS);
      const later = await helloed(0);
      later.send({ t: 'ping', n: 3 });
      expect(await later.until(isPong)).toMatchObject({ n: 3 });
    });

    it('A reconnect while the seat is online sends the others nothing', async () => {
      const table = await SocketTable.seat(mp, 3);
      open.push(...table.sockets);
      const other = table.socket(0);
      const before = other.tables().length;
      const { rev } = other.view();

      for (let k = 0; k < 5; k++) {
        const again = await helloed(2);
        expect((await again.table()).view.rev).toBe(rev);
      }

      other.send({ t: 'ping', n: 1 });
      await other.until(isPong);
      expect(other.tables()).toHaveLength(before);
    });

    it.each([
      ['404, another path', '/api/mp/other', {}, 404],
      ['403, another site', MP_WS_PATH, { Origin: 'https://evil.example' }, 403],
    ] as const)(
      'A refused upgrade (%s) is hung up even if the client never closes its side',
      async (_what, path, headers, status) => {
        const raw = await rawClient(mp.port, path, headers);
        hold(raw.socket);
        raw.socket.resume();
        expect(raw.status).toBe(status);
        await eventually(isFree, 'the connection is gone');
      },
    );

    it('A refused upgrade (503) is hung up too', async () => {
      for (let i = 0; i < MAX_ANONYMOUS_PER_IP; i++) {
        hold((await rawUpgrade(mp.port, MP_WS_PATH)).socket);
      }
      const before = await openConnections(mp);
      const raw = await rawClient(mp.port, MP_WS_PATH);
      hold(raw.socket);
      raw.socket.resume();
      expect(raw.status).toBe(503);
      await eventually(
        async () => (await openConnections(mp)) === before,
        'the refused connection is gone',
      );
    });
  });

  describe('§19.9 the address of a client', () => {
    const request = (peer: string | undefined, header?: string) => ({
      headers: header === undefined ? {} : { 'cf-connecting-ip': header },
      socket: { remoteAddress: peer },
    });

    it.each([
      ['Cloudflare, through a proxy in the container network', '172.18.0.5', '198.51.100.7'],
      ['through the other private ranges', '10.0.0.2', '198.51.100.7'],
      ['through a proxy on this machine', '127.0.0.1', '198.51.100.7'],
      ['through a proxy, with an IPv4-mapped peer', '::ffff:10.0.0.2', '198.51.100.7'],
    ])('CF-Connecting-IP is used: %s', (_what, peer, header) => {
      expect(clientAddress(request(peer, header))).toBe('198.51.100.7');
    });

    it('a public peer is the client itself: its header is not believed', () => {
      expect(clientAddress(request('8.8.8.8', '198.51.100.7'))).toBe('8.8.8.8');
    });

    it('no header, or one that is not an address, leaves the socket address', () => {
      expect(clientAddress(request('10.0.0.2'))).toBe('10.0.0.2');
      expect(clientAddress(request('10.0.0.2', 'not an address'))).toBe('10.0.0.2');
      expect(clientAddress(request('::ffff:127.0.0.1'))).toBe('127.0.0.1');
    });

    it('one IPv6 network is one client: the key is the /64', () => {
      const a = clientAddress(request('10.0.0.2', '2001:db8:1:2:aaaa::1'));
      const b = clientAddress(request('10.0.0.2', '2001:db8:1:2:bbbb::2'));
      const c = clientAddress(request('10.0.0.2', '2001:db8:1:3::1'));
      expect(a).toBe('2001:db8:1:2');
      expect(b).toBe(a);
      expect(c).toBe('2001:db8:1:3');
      expect(clientAddress(request('10.0.0.2', '2001:db8::1'))).toBe('2001:db8:0:0');
    });

    it('a socket with no address yet still has a key', () => {
      expect(clientAddress(request(undefined))).toBe('unknown');
    });
  });
});
