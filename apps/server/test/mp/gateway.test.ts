import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MP_PROTOCOL_VERSION,
  type ServerMsg,
  type TableSettings,
} from '../../src/game/net/protocol.js';
import { TABLE_LOOKUP, type TableLookup } from '../../src/bot/bot.service.js';
import { RoomRegistry } from '../../src/mp/registry.js';
import { OFFLINE_TURN_MS } from '../../src/mp/timing.js';
import {
  connectAs,
  foldAction,
  initDataOf,
  passiveAction,
  rawUpgrade,
  SETTINGS,
  SOCKET_TEST_TIMEOUT_MS,
  SocketTable,
  startMpApp,
  TestSocket,
  USER_ID,
  type MpApp,
} from '../helpers/mp-app.js';
import { signInitData, TEST_BOT_TOKEN } from '../helpers/sign-init-data.js';

vi.setConfig({ testTimeout: SOCKET_TEST_TIMEOUT_MS, hookTimeout: SOCKET_TEST_TIMEOUT_MS });

const isWelcome = (m: ServerMsg): m is Extract<ServerMsg, { t: 'welcome' }> => m.t === 'welcome';
const isPong = (m: ServerMsg): m is Extract<ServerMsg, { t: 'pong' }> => m.t === 'pong';
const isLeft = (m: ServerMsg): m is Extract<ServerMsg, { t: 'left' }> => m.t === 'left';
const isEnded = (m: ServerMsg): m is Extract<ServerMsg, { t: 'ended' }> => m.t === 'ended';

describe('MpGateway', () => {
  let mp: MpApp;
  const open: TestSocket[] = [];

  /** A socket that is closed at the end of the test, whatever the test does. */
  const socketFor = async (): Promise<TestSocket> => {
    const socket = await TestSocket.open(mp.url);
    open.push(socket);
    return socket;
  };
  const helloed = async (i: number): Promise<TestSocket> => {
    const socket = await connectAs(mp, i);
    open.push(socket);
    return socket;
  };

  beforeEach(async () => {
    mp = await startMpApp();
  });

  afterEach(async () => {
    await mp.app.close();
    for (const socket of open.splice(0)) socket.terminate();
  });

  describe('§19.4 hello', () => {
    it('hello must come first: anything else is not_authed, changes nothing, and the socket stays', async () => {
      const socket = await socketFor();
      socket.send({ t: 'create', settings: SETTINGS });
      expect(await socket.error()).toEqual({ t: 'error', code: 'not_authed', re: 'create' });
      socket.send({ t: 'hello', v: MP_PROTOCOL_VERSION, initData: initDataOf(0, mp.clock) });
      expect(await socket.until(isWelcome)).toMatchObject({ code: null });
    });

    it('welcome: the version, the first name, the server clock and no table', async () => {
      const socket = await socketFor();
      socket.send({ t: 'hello', v: MP_PROTOCOL_VERSION, initData: initDataOf(1, mp.clock) });
      expect(await socket.until(isWelcome)).toEqual({
        t: 'welcome',
        v: MP_PROTOCOL_VERSION,
        name: 'Bob',
        now: mp.clock.now(),
        code: null,
      });
    });

    it('a wrong version is outdated and closes 4003', async () => {
      const socket = await socketFor();
      socket.send({ t: 'hello', v: MP_PROTOCOL_VERSION + 1, initData: initDataOf(0, mp.clock) });
      expect(await socket.error()).toEqual({ t: 'error', code: 'outdated', re: 'hello' });
      expect(await socket.closed()).toBe(4003);
    });

    it.each([
      [
        'a wrong token',
        (now: number) =>
          signInitData({
            user: { id: 1, first_name: 'X' },
            authDate: now,
            token: '999:not-this-bots-token',
          }),
      ],
      ['nonsense', () => 'user=%7B%22id%22%3A1%7D&hash=00'],
      [
        'more than a day old',
        (now: number) =>
          signInitData({
            user: { id: 1, first_name: 'X' },
            authDate: now - 86_401,
            token: TEST_BOT_TOKEN,
          }),
      ],
    ])('bad initData (%s) is auth_failed and closes 4001', async (_what, makeInitData) => {
      const socket = await socketFor();
      const now = Math.floor(mp.clock.now() / 1000);
      socket.send({ t: 'hello', v: MP_PROTOCOL_VERSION, initData: makeInitData(now) });
      expect(await socket.error()).toEqual({ t: 'error', code: 'auth_failed', re: 'hello' });
      expect(await socket.closed()).toBe(4001);
    });

    it('a second hello on one socket is bad_message, and the socket stays', async () => {
      const socket = await helloed(0);
      socket.send({ t: 'hello', v: MP_PROTOCOL_VERSION, initData: initDataOf(0, mp.clock) });
      expect(await socket.error()).toEqual({ t: 'error', code: 'bad_message', re: 'hello' });
      socket.send({ t: 'ping', n: 7 });
      expect(await socket.until(isPong)).toMatchObject({ n: 7 });
    });

    it('anything undecodable is bad_message; three on one socket close 4005', async () => {
      const socket = await helloed(0);
      socket.sendText('this is not json');
      expect(await socket.error()).toEqual({ t: 'error', code: 'bad_message', re: null });
      socket.send({ t: 'act', seq: -1, action: { type: 'fold' } });
      expect(await socket.error()).toEqual({ t: 'error', code: 'bad_message', re: null });
      socket.ws.send(new Uint8Array([1, 2, 3]));
      expect(await socket.error()).toEqual({ t: 'error', code: 'bad_message', re: null });
      expect(await socket.closed()).toBe(4005);
    });

    it('ping: pong with the same n and the server clock', async () => {
      const socket = await helloed(0);
      socket.send({ t: 'ping', n: 123 });
      expect(await socket.until(isPong)).toEqual({ t: 'pong', n: 123, now: mp.clock.now() });
    });
  });

  describe('§19.4 messages', () => {
    it('create: a table, you are the host, status waiting; a second one is already_seated', async () => {
      const socket = await helloed(0);
      socket.send({ t: 'create', settings: SETTINGS });
      const { view } = await socket.table();
      expect(view).toMatchObject({
        status: 'waiting',
        started: false,
        you: 0,
        invite: `https://t.me/rb_poker_test_bot/play?startapp=${view.code}`,
      });
      expect(view.seats[0]).toMatchObject({ name: 'Ann', host: true });
      socket.send({ t: 'create', settings: SETTINGS });
      expect(await socket.error()).toEqual({
        t: 'error',
        code: 'already_seated',
        re: 'create',
        other: view.code,
      });
    });

    it('join: a table to the joiner, and the others get a table with the notice joined', async () => {
      const a = await helloed(0);
      const b = await helloed(1);
      a.send({ t: 'create', settings: SETTINGS });
      const { code } = (await a.table()).view;
      b.send({ t: 'join', code });
      expect((await b.table()).view.you).toBe(1);
      const seen = await a.table();
      expect(seen.notices).toEqual([{ n: 'joined', name: 'Bob' }]);
      expect(seen.view.seats[1]?.name).toBe('Bob');
    });

    it('join: not_found, full, and already_seated with the other table', async () => {
      const a = await helloed(0);
      const b = await helloed(1);
      const c = await helloed(2);
      const twoSeats: TableSettings = { seats: 2, stakes: 'normal', turnSeconds: 30 };
      a.send({ t: 'create', settings: twoSeats });
      const { code } = (await a.table()).view;
      c.send({ t: 'join', code: 'ZZZZZZZZ' });
      expect(await c.error()).toEqual({ t: 'error', code: 'not_found', re: 'join' });
      b.send({ t: 'join', code });
      await b.table();
      c.send({ t: 'join', code });
      expect(await c.error()).toEqual({ t: 'error', code: 'full', re: 'join' });
      c.send({ t: 'create', settings: SETTINGS });
      const other = (await c.table()).view.code;
      c.send({ t: 'join', code });
      expect(await c.error()).toEqual({ t: 'error', code: 'already_seated', re: 'join', other });
    });

    it('leave: left, and the socket stays open for a new create or join', async () => {
      const socket = await helloed(0);
      socket.send({ t: 'leave' });
      expect(await socket.error()).toEqual({ t: 'error', code: 'not_seated', re: 'leave' });
      socket.send({ t: 'create', settings: SETTINGS });
      await socket.table();
      socket.send({ t: 'leave' });
      await socket.until(isLeft);
      socket.send({ t: 'create', settings: SETTINGS });
      expect((await socket.table()).view.status).toBe('waiting');
      expect(socket.closeCode).toBeNull();
    });

    it('start: not_seated, not_host, not_enough_players, then the first hand for everyone, then already_started', async () => {
      const a = await helloed(0);
      const b = await helloed(1);
      b.send({ t: 'start' });
      expect(await b.error()).toEqual({ t: 'error', code: 'not_seated', re: 'start' });
      a.send({ t: 'create', settings: SETTINGS });
      const { code } = (await a.table()).view;
      a.send({ t: 'start' });
      expect(await a.error()).toEqual({ t: 'error', code: 'not_enough_players', re: 'start' });
      b.send({ t: 'join', code });
      await b.table();
      await a.table();
      b.send({ t: 'start' });
      expect(await b.error()).toEqual({ t: 'error', code: 'not_host', re: 'start' });
      a.send({ t: 'start' });
      expect((await a.table()).view.status).toBe('playing');
      expect((await b.table()).view.hand?.handSeq).toBe(1);
      a.send({ t: 'start' });
      expect(await a.error()).toEqual({ t: 'error', code: 'already_started', re: 'start' });
    });

    it('act: a stale or doubled message changes nothing: the same rev, the same hand, stale_action', async () => {
      const table = await SocketTable.deal(mp, 3);
      open.push(...table.sockets);
      const decision = table.view().decision;
      const socket = table.socket(decision?.seat as number);
      await table.change(() => {
        socket.send({ t: 'act', seq: decision?.seq, action: { type: 'call' } });
      });
      const before = table.view();
      socket.send({ t: 'act', seq: decision?.seq, action: { type: 'call' } });
      expect(await socket.error()).toEqual({ t: 'error', code: 'stale_action', re: 'act' });
      socket.send({ t: 'ping', n: 1 });
      await socket.until(isPong);
      expect(table.view().rev).toBe(before.rev);
      expect(table.view().hand).toEqual(before.hand);
    });

    it('act: not_your_turn, illegal_action and not_seated', async () => {
      const table = await SocketTable.deal(mp, 3);
      open.push(...table.sockets);
      const decision = table.view().decision as { seat: number; seq: number };
      const { rev } = table.view();
      const other = table.socket((decision.seat + 1) % 3);
      other.send({ t: 'act', seq: decision.seq, action: { type: 'fold' } });
      expect(await other.error()).toEqual({ t: 'error', code: 'not_your_turn', re: 'act' });
      const actor = table.socket(decision.seat);
      actor.send({ t: 'act', seq: decision.seq, action: { type: 'check' } });
      expect(await actor.error()).toEqual({ t: 'error', code: 'illegal_action', re: 'act' });
      const stranger = await helloed(8);
      stranger.send({ t: 'act', seq: decision.seq, action: { type: 'fold' } });
      expect(await stranger.error()).toEqual({ t: 'error', code: 'not_seated', re: 'act' });
      expect(table.view().rev).toBe(rev);
    });

    it('back and reload: not_seated without a table, and a reload is not_busted unless busted', async () => {
      const table = await SocketTable.deal(mp, 2);
      open.push(...table.sockets);
      const stranger = await helloed(8);
      stranger.send({ t: 'back' });
      expect(await stranger.error()).toEqual({ t: 'error', code: 'not_seated', re: 'back' });
      stranger.send({ t: 'reload' });
      expect(await stranger.error()).toEqual({ t: 'error', code: 'not_seated', re: 'reload' });
      table.socket(0).send({ t: 'reload' });
      expect(await table.socket(0).error()).toEqual({
        t: 'error',
        code: 'not_busted',
        re: 'reload',
      });
    });

    it('a whole hand over real sockets: each sees only their own cards, and the next hand comes by itself', async () => {
      const table = await SocketTable.deal(mp, 3);
      open.push(...table.sockets);
      table.sockets.forEach((socket, seat) => {
        const hand = socket.view().hand;
        expect(hand?.seats[seat]?.hole).not.toBeNull();
        expect(hand?.seats.filter((s) => s.hole !== null)).toHaveLength(1);
      });
      await table.playHand(passiveAction);
      const end = table.view();
      expect(end.hand?.result?.endedBy).toBe('showdown');
      expect(end.hand?.revealed).toHaveLength(3);
      expect(end.handsPlayed).toBe(1);
      await table.tick();
      expect(table.view().hand?.handSeq).toBe(2);
    });
  });

  describe('§19.4 reconnect and one seat', () => {
    it('a socket dropped mid-hand and back before the deadline gets its seat, the current decision and can act', async () => {
      const table = await SocketTable.deal(mp, 3);
      open.push(...table.sockets);
      const decision = table.view().decision as { seat: number; seq: number; deadlineAt: number };
      const seat = decision.seat;
      const others = [0, 1, 2].filter((i) => i !== seat).map((i) => table.socket(i));
      const { rev } = table.view();
      table.socket(seat).terminate();
      await Promise.all(others.map((s) => s.tableAt(rev + 1)));
      expect(others[0]?.view().seats[seat]?.online).toBe(false);
      // The drop moved the deadline to the offline clock (§19.5); coming back does not move it.
      const movedTo = mp.clock.now() + OFFLINE_TURN_MS;
      expect(others[0]?.view().decision).toEqual({ ...decision, deadlineAt: movedTo });

      mp.clock.advance(2_000);
      const again = await TestSocket.open(mp.url);
      open.push(again);
      again.send({ t: 'hello', v: MP_PROTOCOL_VERSION, initData: initDataOf(seat, mp.clock) });
      const welcome = await again.until(isWelcome);
      expect(welcome.code).toBe(table.view().code);
      const { view } = await again.table();
      expect(view.you).toBe(seat);
      expect(view.decision).toEqual({ ...decision, deadlineAt: movedTo });
      expect(view.seats[seat]?.online).toBe(true);
      expect(view.hand?.seats[seat]?.hole).not.toBeNull();
      expect(view.legal).not.toBeNull();

      again.send({ t: 'act', seq: decision.seq, action: { type: 'call' } });
      expect((await again.table()).view.decision?.seat).not.toBe(seat);
    });

    it('welcome.code names the table after a reconnect', async () => {
      const a = await helloed(0);
      a.send({ t: 'create', settings: SETTINGS });
      const { code } = (await a.table()).view;
      a.terminate();
      await a.closed();
      const again = await helloed(0);
      expect(again.frames[0]).toMatchObject({ t: 'welcome', code });
      expect((await again.table()).view.code).toBe(code);
    });

    it('welcome.code is null after a server restart', async () => {
      const a = await helloed(0);
      a.send({ t: 'create', settings: SETTINGS });
      await a.table();
      await mp.app.close();
      mp = await startMpApp({ clock: mp.clock });
      const again = await helloed(0);
      expect(again.frames[0]).toMatchObject({ t: 'welcome', code: null });
    });

    it('a second hello of the same user closes the first socket with 4002, and the new socket takes over', async () => {
      const first = await helloed(0);
      first.send({ t: 'create', settings: SETTINGS });
      const { code } = (await first.table()).view;

      const second = await TestSocket.open(mp.url);
      open.push(second);
      second.send({ t: 'hello', v: MP_PROTOCOL_VERSION, initData: initDataOf(0, mp.clock) });
      expect(await second.until(isWelcome)).toMatchObject({ code });
      expect(await first.error()).toEqual({ t: 'error', code: 'replaced', re: null });
      expect(await first.closed()).toBe(4002);
      const { view } = await second.table();
      expect(view.seats[0]?.online).toBe(true);

      // The old socket going away did not put the seat offline.
      second.send({ t: 'ping', n: 2 });
      await second.until(isPong);
      expect(second.view().seats[0]?.online).toBe(true);
    });

    it('a socket that closes while its user is at a table only puts the seat offline', async () => {
      const table = await SocketTable.seat(mp, 2);
      open.push(...table.sockets);
      const { rev } = table.view();
      table.socket(1).terminate();
      const { view } = await table.socket(0).tableAt(rev + 1);
      expect(view.seats[1]).toMatchObject({ online: false, name: 'Bob' });
    });
  });

  describe('§19.5 server restart', () => {
    it('app.close(): every socket at a table gets ended with server_restart, then every socket closes with 1012', async () => {
      const table = await SocketTable.deal(mp, 2);
      open.push(...table.sockets);
      const { code } = table.view();
      const idle = await helloed(5);

      await mp.app.close();

      for (const socket of table.sockets) {
        expect(await socket.until(isEnded)).toEqual({
          t: 'ended',
          code,
          reason: 'server_restart',
        });
        expect(await socket.closed()).toBe(1012);
      }
      expect(await idle.closed()).toBe(1012);
      expect(idle.frames.filter(isEnded)).toEqual([]);
    });
  });

  describe('§19.4 the upgrade', () => {
    it('any path but the socket path is a 404', async () => {
      expect((await rawUpgrade(mp.port, '/api/mp/other')).status).toBe(404);
      expect((await rawUpgrade(mp.port, '/')).status).toBe(404);
    });

    it('another site as Origin is a 403', async () => {
      const refused = await rawUpgrade(mp.port, '/api/mp/ws', {
        Origin: 'https://evil.example',
      });
      expect(refused.status).toBe(403);
    });

    it('the same site as Origin, or no Origin at all, gets the socket', async () => {
      const own = await rawUpgrade(mp.port, '/api/mp/ws', {
        Origin: `http://127.0.0.1:${mp.port}`,
      });
      expect(own.status).toBe(101);
      own.socket?.destroy();
      const none = await rawUpgrade(mp.port, '/api/mp/ws');
      expect(none.status).toBe(101);
      none.socket?.destroy();
    });

    it('a query string on the socket path does not change it (and carries nothing)', async () => {
      const upgraded = await rawUpgrade(mp.port, '/api/mp/ws?x=1');
      expect(upgraded.status).toBe(101);
      upgraded.socket?.destroy();
    });
  });

  describe('the rest of the server', () => {
    it('TABLE_LOOKUP is the registry: the bot knows which table a user is at (§19.8)', async () => {
      const tables = mp.app.get<TableLookup>(TABLE_LOOKUP, { strict: false });
      const socket = await helloed(0);
      expect(tables.codeOfUser(USER_ID(0))).toBeNull();
      socket.send({ t: 'create', settings: SETTINGS });
      const { code } = (await socket.table()).view;
      expect(tables.codeOfUser(USER_ID(0))).toBe(code);
    });

    it('a bug behind one message closes that socket with 1011, and the server goes on', async () => {
      const registry = mp.app.get(RoomRegistry, { strict: false });
      const create = vi.spyOn(registry, 'create').mockImplementation(() => {
        throw new Error('a bug');
      });
      const socket = await helloed(0);
      socket.send({ t: 'create', settings: SETTINGS });
      expect(await socket.closed()).toBe(1011);
      create.mockRestore();

      const other = await helloed(1);
      other.send({ t: 'create', settings: SETTINGS });
      expect((await other.table()).view.status).toBe('waiting');
    });
  });

  it('frames can leave a table for good: a fold, then the leaver stops getting views', async () => {
    const table = await SocketTable.deal(mp, 3);
    open.push(...table.sockets);
    const seat = (table.view().decision?.seat as number) + 1;
    const leaver = table.socket(seat % 3);
    const { rev } = table.view();
    leaver.send({ t: 'leave' });
    await leaver.until(isLeft);
    const stayed = table.sockets.filter((s) => s !== leaver);
    await Promise.all(stayed.map((s) => s.tableAt(rev + 1)));
    const count = leaver.tables().length;
    const next = table.socket(table.view().decision?.seat as number);
    next.send({
      t: 'act',
      seq: table.view().decision?.seq,
      action: foldAction(next.view().legal as never),
    });
    await Promise.all(stayed.map((s) => s.tableAt(rev + 2)));
    expect(leaver.tables()).toHaveLength(count);
  });
});
