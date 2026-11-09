import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MP_PROTOCOL_VERSION,
  type ServerMsg,
  type TableView,
} from '../../src/game/net/protocol.js';
import { leakProblems, type LeakRules } from '../helpers/leak-check.js';
import {
  allInAction,
  FIRST_NAMES,
  foldAction,
  initDataOf,
  LAST_NAME,
  passiveAction,
  PHOTO_URL,
  SOCKET_TEST_TIMEOUT_MS,
  SocketTable,
  startMpApp,
  TestSocket,
  USER_ID,
  USERNAME,
  type MpApp,
} from '../helpers/mp-app.js';

vi.setConfig({ testTimeout: SOCKET_TEST_TIMEOUT_MS, hookTimeout: SOCKET_TEST_TIMEOUT_MS });

const RULES: LeakRules = {
  ids: FIRST_NAMES.map((_, i) => USER_ID(i)),
  secrets: FIRST_NAMES.flatMap((_, i) => [USERNAME(i), PHOTO_URL(i), LAST_NAME(i)]),
  names: new Set(FIRST_NAMES),
};

/** L2–L6 on every frame every socket of this test ever got, and whose eyes each view is for. */
function expectNoLeak(sockets: readonly TestSocket[]): void {
  expect(sockets.length).toBeGreaterThan(0);
  let frames = 0;
  sockets.forEach((socket) => {
    for (const frame of socket.frames) {
      frames++;
      expect(leakProblems(frame, RULES)).toEqual([]);
    }
  });
  expect(frames).toBeGreaterThan(0);
}

/** The seat's own cards and nothing else while nothing is revealed. */
function expectOwnCardsOnly(view: TableView): void {
  const { hand } = view;
  if (hand === null) return;
  hand.seats.forEach((seat, i) => {
    if (i === view.you || hand.revealed.includes(i)) return;
    expect(seat.hole).toBeNull();
  });
}

describe('§19.9 L1–L6 on the real frames of real sockets', () => {
  let mp: MpApp;
  const open: TestSocket[] = [];

  const closeAll = async (): Promise<void> => {
    await mp.app.close();
    for (const socket of open.splice(0)) socket.terminate();
  };

  beforeEach(async () => {
    mp = await startMpApp();
  });

  afterEach(closeAll);

  it('a hand ended by folds, and the next hand', async () => {
    const table = await SocketTable.deal(mp, 3);
    open.push(...table.sockets);
    await table.playHand(foldAction);
    await table.tick();
    for (const socket of table.sockets) socket.tables().forEach((t) => expectOwnCardsOnly(t.view));
    expectNoLeak(table.sockets);
    expect(table.view().handsPlayed).toBe(1);
  });

  it('a showdown', async () => {
    const table = await SocketTable.deal(mp, 3);
    open.push(...table.sockets);
    const folder = table.view().decision?.seat as number;
    await table.play(foldAction);
    await table.playHand(passiveAction);
    expectNoLeak(table.sockets);
    const seen = table.socket((folder + 1) % 3).view().hand;
    expect(seen?.result?.endedBy).toBe('showdown');
    expect(seen?.revealed).toHaveLength(2);
    // §3.9: a folded hand is never shown.
    expect(seen?.seats[folder]?.hole).toBeNull();
  });

  it('an all-in run-out', async () => {
    const table = await SocketTable.deal(mp, 3);
    open.push(...table.sockets);
    await table.playHand(allInAction);
    expect(table.view().hand?.runout).toBe(true);
    expectNoLeak(table.sockets);
  });

  it('a bust and a reload', async () => {
    const table = await SocketTable.deal(mp, 2, { seats: 2, stakes: 'normal', turnSeconds: 30 });
    open.push(...table.sockets);
    let busted = -1;
    for (let tries = 0; tries < 40 && busted === -1; tries++) {
      await table.playHand(allInAction);
      busted = table.view().seats.findIndex((seat) => seat?.status === 'busted');
      if (busted === -1) await table.tick();
    }
    expect(busted).not.toBe(-1);
    await table.change(() => {
      table.socket(busted).send({ t: 'reload' });
    });
    expect(table.view().seats[busted]).toMatchObject({ status: 'nextHand', stack: 2000 });
    await table.tick();
    await table.playHand(foldAction);
    expectNoLeak(table.sockets);
  });

  it('a reconnect', async () => {
    const table = await SocketTable.deal(mp, 3);
    open.push(...table.sockets);
    const seat = ((table.view().decision?.seat as number) + 1) % 3;
    const { rev } = table.view();
    table.socket(seat).terminate();
    const others = table.sockets.filter((_, i) => i !== seat);
    await Promise.all(others.map((s) => s.tableAt(rev + 1)));
    const after = table.view().rev;

    const again = await TestSocket.open(mp.url);
    open.push(again);
    again.send({ t: 'hello', v: MP_PROTOCOL_VERSION, initData: initDataOf(seat, mp.clock) });
    await again.until((m): m is Extract<ServerMsg, { t: 'welcome' }> => m.t === 'welcome');
    await again.tableAt(after + 1);
    await Promise.all(others.map((s) => s.tableAt(after + 1)));

    table.sockets[seat] = again;
    expect(again.view().hand?.seats[seat]?.hole).not.toBeNull();
    expectOwnCardsOnly(again.view());
    await table.playHand(passiveAction);
    expectNoLeak([...table.sockets, ...open]);
  });

  it("welcome holds the player's own cleaned name and nothing else about anyone", async () => {
    const table = await SocketTable.seat(mp, 2);
    open.push(...table.sockets);
    table.sockets.forEach((socket, i) => {
      expect(socket.frames[0]).toMatchObject({ t: 'welcome', name: FIRST_NAMES[i] });
    });
    expectNoLeak(table.sockets);
  });

  it('the end of a table carries nothing but its code and reason', async () => {
    const table = await SocketTable.deal(mp, 2);
    open.push(...table.sockets);
    await mp.app.close();
    await table.socket(0).closed();
    expectNoLeak(table.sockets);
    mp = await startMpApp({ clock: mp.clock });
  });
});
