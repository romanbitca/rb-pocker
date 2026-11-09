/**
 * Play with friends in the UI tests (PLAN §19.6, §19.10): the real `App`, the real store, the real
 * `MpDriver` over a fake WebSocket, on the fake clock of `tableHarness.ts`, so a test taps what a
 * player taps and reads what the server was told.
 */
import { act } from '@testing-library/react';
import { realTimers } from '../../src/app/controller.ts';
import { createMpDriver } from '../../src/app/mp/driver.ts';
import { appStore, initialMp, type AppState, type Command } from '../../src/app/store.ts';
import { startHand } from '../../src/engine/start.ts';
import type { Notice, ServerMsg, TableView } from '../../src/net/protocol.ts';
import { createSafeStorage, type StorageBackend } from '../../src/persist/storage.ts';
import { loadMp } from '../../src/ui/mpModule.ts';
import { loadScreens } from '../../src/ui/screensModule.ts';
import {
  remoteTable,
  socketFactory,
  viewOfHand,
  type FakeWebSocket,
  type SeatKind,
} from '../app/mpFixtures.ts';
import { SEED } from '../engine/helpers.ts';
import { startTableHarness, type TableHarness } from './tableHarness.ts';

/** The screens chunk and this feature's own chunk, as the app has them by the first tap. */
export async function loadMpChunks(): Promise<void> {
  await loadScreens();
  await loadMp();
}

export interface MpHarness extends TableHarness {
  sockets: FakeWebSocket[];
  /** The newest socket. */
  ws: () => FakeWebSocket;
  /** What went to Telegram's share list: `[link, words]`. */
  shared: (readonly [string, string])[];
  /** The socket came up and the server said hello; `code`: the table it says you sit at. */
  connect: (code?: string | null) => FakeWebSocket;
  /** A `table` frame, applied inside `act`. */
  table: (view: TableView, notices?: Notice[]) => void;
  /** Any frame, inside `act`. */
  receive: (msg: ServerMsg) => void;
  dispatch: (cmd: Command) => void;
  state: () => AppState;
}

let rev = 0;
/** The next `rev`, for views in a test that do not care about it. */
export const nextRev = (): number => ++rev;

/**
 * A fresh app inside Telegram with its driver; `launch()` is called. Dispose at the test's end
 * (`dispose` also clears the store's `mp` and `tg`, which the table harness does not know).
 */
export function startMp(options: { startParam?: string | null; inside?: boolean } = {}): MpHarness {
  const h = startTableHarness();
  appStore.setState({ tg: { inside: options.inside ?? true } });
  const factory = socketFactory();
  const shared: (readonly [string, string])[] = [];
  const data = new Map<string, string>();
  const backend: StorageBackend = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
  const driver = createMpDriver({
    store: appStore,
    controller: h.controller,
    timers: realTimers,
    heroName: 'You',
    launch: { initData: 'user=A&hash=B', startParam: options.startParam ?? null },
    location: { protocol: 'https:', host: 'poker.test' },
    openSocket: factory.open,
    storage: createSafeStorage(() => backend),
    random: () => 0.5,
    shareInvite: (url, text) => shared.push([url, text]),
  });
  act(() => driver.launch());
  const ws = (): FakeWebSocket => factory.last();
  const receive = (msg: ServerMsg): void => act(() => ws().receive(msg));
  return {
    ...h,
    sockets: factory.sockets,
    ws,
    shared,
    receive,
    connect(code = null) {
      const socket = ws();
      act(() => {
        socket.open();
        socket.receive({ t: 'welcome', v: 1, name: 'Ann', now: 1, code });
      });
      return socket;
    },
    table(view, notices = []) {
      receive({ t: 'table', view, notices });
    },
    dispatch: (cmd) => act(() => appStore.getState().dispatch(cmd)),
    state: () => appStore.getState(),
    dispose() {
      driver.dispose();
      h.dispose();
      appStore.setState({ mp: initialMp(), tg: { inside: false } });
    },
  };
}

export const KINDS: SeatKind[] = ['in', 'in', 'in'];
export const HAND = startHand(remoteTable(KINDS), SEED);
export const TO_ACT = HAND.toAct as number;
/** A real seat that is not on turn. */
export const OTHER = (TO_ACT + 1) % 3;

/** Seated at a table of three (`viewOfHand`), the viewer at real seat `you`. */
export function playingView(you: number, patch: Partial<TableView> = {}): TableView {
  return viewOfHand(KINDS, HAND, you, { rev: nextRev(), ...patch });
}
