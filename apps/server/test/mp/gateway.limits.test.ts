import type { Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket as ServerSocket } from 'ws';
import {
  MP_MAX_INBOUND_BYTES,
  MP_PROTOCOL_VERSION,
  type ServerMsg,
} from '../../src/game/net/protocol.js';
import { RoomRegistry } from '../../src/mp/registry.js';
import {
  CREATE_LIMIT,
  CREATE_WINDOW_MS,
  FAILED_JOIN_LIMIT,
  FAILED_JOIN_WINDOW_MS,
  HELLO_DEADLINE_MS,
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
  initDataOf,
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

  it('Hello deadline: no hello in 5 s closes 4004', async () => {
    expect(HELLO_DEADLINE_MS).toBe(5_000);
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
      try {
        // In batches: a thousand connects at once overflow the listen queue.
        while (held.length < MAX_SOCKETS) {
          const batch = Math.min(40, MAX_SOCKETS - held.length);
          const opened = await Promise.all(
            Array.from({ length: batch }, () => rawUpgrade(mp.port, '/api/mp/ws')),
          );
          for (const { status, socket } of opened) {
            expect(status).toBe(101);
            held.push(socket as Socket);
          }
        }
        expect((await rawUpgrade(mp.port, '/api/mp/ws')).status).toBe(503);
        (held.pop() as Socket).destroy();
        await new Promise((resolve) => setTimeout(resolve, 200));
        const last = await rawUpgrade(mp.port, '/api/mp/ws');
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
});
