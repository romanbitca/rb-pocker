/**
 * `MpDriver` (PLAN §19.6, Stage 10 acceptance 11): when the socket opens, entering and leaving a
 * table, the commands, `rev` order, the clocks, reconnecting, the dialogs and the Back trap.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { realTimers } from '../../src/app/controller.ts';
import { createMpDriver, socketUrl } from '../../src/app/mp/driver.ts';
import { GIVE_UP_AFTER_MS } from '../../src/app/mp/socket.ts';
import {
  createAppStore,
  initialMp,
  selectConnection,
  selectMpProblem,
  selectMpView,
  selectRemote,
  selectSeatNotes,
  selectTurn,
  updateUi,
  type AppStore,
  type Command,
  type GameCommand,
} from '../../src/app/store.ts';
import { startHand } from '../../src/engine/start.ts';
import type { LegalActions, PlayerAction } from '../../src/engine/types.ts';
import {
  OFFLINE_TURN_MS,
  type Notice,
  type ServerMsg,
  type TableSettings,
  type TableView,
} from '../../src/net/protocol.ts';
import { createSafeStorage, STORAGE_KEYS, type StorageBackend } from '../../src/persist/storage.ts';
import { SEED } from '../engine/helpers.ts';
import { elapse, makeHarness, scriptedBrain } from './harness.ts';
import {
  CODE,
  OTHER_CODE,
  playedHand,
  remoteTable,
  seatInfo,
  seatsOf,
  SERVER_NOW,
  socketFactory,
  viewOfHand,
  waitingView,
  type FakeWebSocket,
  type SeatKind,
} from './mpFixtures.ts';

const INIT_DATA = 'user=INIT-SECRET&hash=abc';
const SETTINGS: TableSettings = { seats: 6, stakes: 'normal', turnSeconds: 30 };
const CHECK: PlayerAction = { type: 'check' };

const KINDS: SeatKind[] = ['in', 'in', 'in'];
const HAND = startHand(remoteTable(KINDS), SEED);
const TO_ACT = HAND.toAct as number;
const OTHER = (TO_ACT + 1) % 3;
const yourTurn = (patch: Partial<TableView> = {}): TableView =>
  viewOfHand(KINDS, HAND, TO_ACT, patch);
const theirTurn = (patch: Partial<TableView> = {}): TableView =>
  viewOfHand(KINDS, HAND, OTHER, patch);

const welcome = (code: string | null): ServerMsg => ({
  t: 'welcome',
  v: 1,
  name: 'Ann',
  now: 1,
  code,
});
const tableMsg = (view: TableView, notices: Notice[] = []): ServerMsg => ({
  t: 'table',
  view,
  notices,
});

interface RigOptions {
  startParam?: string | null;
  remembered?: string;
  /** The device's storage: pass another rig's for "a later launch on this device". */
  data?: Map<string, string>;
  /** The WebView's sessionStorage: pass another rig's for "the same launch, reloaded". */
  session?: Map<string, string>;
  /** The launch's `initData`: another value is a new launch (a new tap on a link). */
  initData?: string;
  store?: AppStore;
  controller?: { park(): void; unpark(): void };
  shareInvite?: (url: string, text: string) => void;
}

function rig(options: RigOptions = {}) {
  const store = options.store ?? createAppStore();
  if (options.store === undefined) store.getState().dispatch({ type: 'go', screen: 'home' });
  const factory = socketFactory();
  const data = options.data ?? new Map<string, string>();
  if (options.remembered !== undefined) data.set(STORAGE_KEYS.mpTable, options.remembered);
  const session = options.session ?? new Map<string, string>();
  const backendOf = (map: Map<string, string>): StorageBackend => ({
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  });
  const controller = options.controller ?? {
    park: vi.fn<() => void>(),
    unpark: vi.fn<() => void>(),
  };
  const game = vi.fn<(cmd: GameCommand) => void>();
  if (options.store === undefined) store.setGameHandler(game);
  const clock = { mono: 1000 };
  const closing: boolean[] = [];
  const driver = createMpDriver({
    store,
    controller,
    timers: realTimers,
    heroName: 'You',
    launch: { initData: options.initData ?? INIT_DATA, startParam: options.startParam ?? null },
    location: { protocol: 'https:', host: 'poker.test' },
    openSocket: factory.open,
    storage: createSafeStorage(() => backendOf(data)),
    session: createSafeStorage(() => backendOf(session)),
    monotonic: () => clock.mono,
    random: () => 0.5,
    confirmClosing: (need) => closing.push(need),
    ...(options.shareInvite !== undefined && { shareInvite: options.shareInvite }),
  });
  return {
    ...factory,
    store,
    driver,
    controller,
    game,
    data,
    session,
    clock,
    closing,
    state: () => store.getState(),
    dispatch: (cmd: Command) => store.getState().dispatch(cmd),
  };
}

type Rig = ReturnType<typeof rig>;

/** Launched with a remembered table and sitting at it. */
function seated(
  view: TableView = theirTurn(),
  options: RigOptions = {},
): Rig & { ws: FakeWebSocket } {
  const r = rig({ remembered: CODE, ...options });
  r.driver.launch();
  const ws = r.last();
  ws.open();
  ws.receive(welcome(CODE));
  ws.receive(tableMsg(view));
  return { ...r, ws };
}

const advance = (ms: number): void => {
  vi.advanceTimersByTime(ms);
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a player who only plays alone makes no connection (§19.6, privacy)', () => {
  it('a plain launch opens no socket, stores nothing and keeps no timer', () => {
    const r = rig();
    r.driver.launch();
    advance(3_600_000);
    expect(r.sockets).toEqual([]);
    expect(r.data.size).toBe(0);
    expect(r.state().mp).toEqual(initialMp());
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a whole solo session opens none: every screen but Play with friends, every command', () => {
    const r = rig();
    r.driver.launch();
    for (const screen of ['setup', 'table', 'settings', 'stats', 'learn', 'home'] as const) {
      r.dispatch({ type: 'go', screen });
    }
    r.dispatch({ type: 'play' });
    r.dispatch({ type: 'visibility', hidden: true });
    r.dispatch({ type: 'visibility', hidden: false });
    r.dispatch({ type: 'leaveTable' });
    advance(600_000);
    expect(r.sockets).toEqual([]);
    expect(r.game).toHaveBeenCalledWith({ type: 'play' });
    expect(r.game).toHaveBeenCalledWith({ type: 'leaveTable' });
  });

  it.each([null, '', 'hello', 'abcd2345', 'ABCD234', 'ABCD23450', 'OOOOOOOO'])(
    'a launch with startapp %j opens none',
    (startParam) => {
      const r = rig({ startParam });
      r.driver.launch();
      expect(r.sockets).toEqual([]);
    },
  );

  it.each(['', 'garbage', 'abcd2345'])(
    'a remembered value that is no code (%j) opens none',
    (v) => {
      const r = rig({ remembered: v });
      r.driver.launch();
      expect(r.sockets).toEqual([]);
    },
  );

  it('building the driver alone opens none', () => {
    expect(rig().sockets).toEqual([]);
  });
});

describe('when the socket opens (§19.6)', () => {
  it('Play with friends tapped before the chunk had loaded: `launch` opens it', () => {
    const store = createAppStore();
    store.getState().dispatch({ type: 'go', screen: 'mpCreate' });
    const r = rig({ store });
    r.driver.launch();
    expect(r.sockets).toHaveLength(1);
  });

  it('a table code in startapp: "Joining the table…" at once, then hello, then join', () => {
    const r = rig({ startParam: CODE });
    r.driver.launch();
    expect(r.state().ui.screen).toBe('mpRoom');
    expect(r.sockets).toHaveLength(1);
    expect(r.last().url).toBe('wss://poker.test/api/mp/ws');
    expect(r.state().mp.view).toBeNull();
    r.last().open();
    expect(r.last().kinds()).toEqual(['hello']);
    r.last().receive(welcome(null));
    expect(r.last().sent[1]).toEqual({ t: 'join', code: CODE });
  });

  it('opening Play with friends (the Create screen) opens it, and hello goes', () => {
    const r = rig();
    r.driver.launch();
    r.dispatch({ type: 'go', screen: 'mpCreate' });
    expect(r.sockets).toHaveLength(1);
    r.last().open();
    expect(r.last().sent).toEqual([{ t: 'hello', v: 1, initData: INIT_DATA }]);
  });

  it('it stays open on the Create screen, and "Create table" uses it', () => {
    const r = rig();
    r.dispatch({ type: 'go', screen: 'mpCreate' });
    r.last().open();
    r.last().receive(welcome(null));
    expect(r.last().closedWith).toBeNull();
    r.dispatch({ type: 'mpCreateTable', settings: SETTINGS });
    expect(r.sockets).toHaveLength(1);
    expect(r.last().sent[1]).toEqual({ t: 'create', settings: SETTINGS });
  });

  it('a server restart with no table on says nothing and connects again', () => {
    const r = rig();
    r.dispatch({ type: 'go', screen: 'mpCreate' });
    const first = r.last();
    first.open();
    first.receive(welcome(null));
    first.drop(1012);
    expect(r.state().mp.problem).toBeNull();
    expect(r.state().ui.overlays).toEqual([]);
    expect(r.last()).not.toBe(first);
    expect(r.state().ui.screen).toBe('mpCreate');
  });

  it('a restart while joining keeps the join for the new server', () => {
    const r = rig({ startParam: CODE });
    r.driver.launch();
    const first = r.last();
    first.open();
    first.drop(1012);
    expect(r.state().mp.problem).toBeNull();
    const second = r.last();
    expect(second).not.toBe(first);
    second.open();
    second.receive(welcome(null));
    expect(second.kinds()).toEqual(['hello', 'join']);
  });

  it('Back from the Create screen closes it', () => {
    const r = rig();
    r.dispatch({ type: 'go', screen: 'mpCreate' });
    r.last().open();
    r.last().receive(welcome(null));
    r.dispatch({ type: 'back' });
    expect(r.state().ui.screen).toBe('home');
    expect(r.last().closedWith).toBe(1000);
    expect(selectConnection(r.state())).toBe('idle');
  });

  it('Back while joining closes it and asks for nothing more', () => {
    const r = rig({ startParam: CODE });
    r.driver.launch();
    r.last().open();
    r.dispatch({ type: 'back' });
    expect(r.last().closedWith).toBe(1000);
    r.last().receive(welcome(null));
    expect(r.last().kinds()).toEqual(['hello']);
  });

  it('"Create table" tapped before welcome waits for it, and goes once', () => {
    const r = rig();
    r.dispatch({ type: 'go', screen: 'mpCreate' });
    r.dispatch({ type: 'mpCreateTable', settings: SETTINGS });
    r.dispatch({ type: 'mpCreateTable', settings: SETTINGS });
    r.last().open();
    r.last().receive(welcome(null));
    expect(r.last().kinds()).toEqual(['hello', 'create']);
  });

  it('"Create table" opens a socket again if it has closed', () => {
    const r = rig();
    r.dispatch({ type: 'go', screen: 'mpCreate' });
    r.last().open();
    r.last().drop(4001); // refused for good: no retry by itself
    expect(r.sockets).toHaveLength(1);
    r.dispatch({ type: 'mpDismiss' });
    r.dispatch({ type: 'go', screen: 'mpCreate' });
    r.dispatch({ type: 'mpCreateTable', settings: SETTINGS });
    expect(r.sockets).toHaveLength(2);
  });

  it('a remembered table: hello at launch, and the table if the player still sits there', () => {
    const r = rig({ remembered: CODE });
    r.driver.launch();
    expect(r.sockets).toHaveLength(1);
    r.last().open();
    r.last().receive(welcome(CODE));
    r.last().receive(tableMsg(theirTurn()));
    expect(r.state().ui.screen).toBe('table');
    expect(selectRemote(r.state())).toBe(true);
  });

  it('a remembered table that is gone: forgotten, closed, and not a word to the player', () => {
    const r = rig({ remembered: CODE });
    r.driver.launch();
    r.last().open();
    r.last().receive(welcome(null));
    expect(r.last().closedWith).toBe(1000);
    expect(r.data.has(STORAGE_KEYS.mpTable)).toBe(false);
    expect(r.state().ui).toMatchObject({ screen: 'home', overlays: [] });
    expect(selectMpProblem(r.state())).toBeNull();
    const later = rig({ data: r.data });
    later.driver.launch();
    expect(later.sockets).toEqual([]); // the next launch on this device connects to nothing
  });

  it('a remembered table is only checked: two minutes without the server, then quiet', () => {
    const r = rig({ remembered: CODE });
    r.driver.launch();
    for (let i = 0; i < 200 && selectConnection(r.state()) !== 'idle'; i++) {
      r.last().drop(1006);
      advance(10_000);
    }
    expect(selectConnection(r.state())).toBe('idle');
    expect(selectMpProblem(r.state())).toBeNull();
    expect(r.data.get(STORAGE_KEYS.mpTable)).toBe(CODE);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a refused login while only checking says nothing', () => {
    const r = rig({ remembered: CODE });
    r.driver.launch();
    r.last().open();
    r.last().receive({ t: 'error', code: 'auth_failed', re: null });
    r.last().drop(4001);
    expect(selectMpProblem(r.state())).toBeNull();
    expect(r.state().ui.overlays).toEqual([]);
  });

  it('startapp=new opens the Create screen, which opens the socket', () => {
    const r = rig({ startParam: 'new' });
    r.driver.launch();
    expect(r.state().ui.screen).toBe('mpCreate');
    expect(r.sockets).toHaveLength(1);
  });

  it('startapp=new with a remembered table: seated goes to the table', () => {
    const r = rig({ startParam: 'new', remembered: CODE });
    r.driver.launch();
    expect(r.state().ui.screen).toBe('home');
    r.last().open();
    r.last().receive(welcome(CODE));
    r.last().receive(tableMsg(waitingView()));
    expect(r.state().ui.screen).toBe('mpRoom');
  });

  it('startapp=new with a remembered table that is gone: the Create screen, connected', () => {
    const r = rig({ startParam: 'new', remembered: CODE });
    r.driver.launch();
    r.last().open();
    r.last().receive(welcome(null));
    expect(r.state().ui.screen).toBe('mpCreate');
    expect(r.sockets).toHaveLength(1);
    expect(r.last().closedWith).toBeNull();
  });

  it('seated wins over a table code in startapp', () => {
    const r = rig({ startParam: OTHER_CODE });
    r.driver.launch();
    r.last().open();
    r.last().receive(welcome(CODE));
    expect(r.last().kinds()).toEqual(['hello']);
  });

  it('initData goes only in the hello frame', () => {
    const { ws, last, dispatch } = seated(yourTurn());
    dispatch({ type: 'act', action: CHECK });
    advance(20_000);
    expect(last()).toBe(ws);
    const withSecret = ws.frames.filter((f) => f.includes('INIT-SECRET'));
    expect(withSecret).toHaveLength(1);
    expect(JSON.parse(withSecret[0] as string)).toMatchObject({ t: 'hello' });
  });

  it('wss on https, ws on a plain-http test page, always the page`s own host', () => {
    expect(socketUrl({ protocol: 'https:', host: 'poker.romanbitca.com' })).toBe(
      'wss://poker.romanbitca.com/api/mp/ws',
    );
    expect(socketUrl({ protocol: 'http:', host: 'localhost:3000' })).toBe(
      'ws://localhost:3000/api/mp/ws',
    );
  });
});

describe('a start code is used once per launch (§19.6)', () => {
  /** Launched from an invite, with `welcome` answered; `join` has gone. */
  function invited(options: RigOptions = {}): Rig & { ws: FakeWebSocket } {
    const r = rig({ startParam: CODE, ...options });
    r.driver.launch();
    const ws = r.last();
    ws.open();
    ws.receive(welcome(null));
    expect(ws.kinds()).toEqual(['hello', 'join']);
    return { ...r, ws };
  }

  /** The same launch again: the page reloaded, so the device and the session are the same. */
  const reloaded = (r: Rig): Rig => {
    const next = rig({ startParam: CODE, data: r.data, session: r.session });
    next.driver.launch();
    return next;
  };

  it('a reload after leaving a table joined by invite does not join again', () => {
    const r = invited();
    r.ws.receive(tableMsg(waitingView()));
    r.dispatch({ type: 'leaveTable' });
    r.ws.receive({ t: 'left' });
    expect(r.state().ui.screen).toBe('home');

    const next = reloaded(r);
    expect(next.sockets).toEqual([]);
    expect(next.state().ui.screen).toBe('home');
  });

  it('a new tap on the same link joins again: a new launch has another signature', () => {
    const r = invited();
    r.ws.receive(tableMsg(waitingView()));
    r.dispatch({ type: 'leaveTable' });
    r.ws.receive({ t: 'left' });

    const next = rig({
      startParam: CODE,
      data: r.data,
      session: r.session,
      initData: 'user=INIT-SECRET&hash=another-launch',
    });
    next.driver.launch();
    expect(next.state().ui.screen).toBe('mpRoom');
    const ws = next.last();
    ws.open();
    ws.receive(welcome(null));
    expect(ws.kinds()).toEqual(['hello', 'join']);
  });

  it('a reload while seated goes back through the remembered table, with no join', () => {
    const r = invited();
    r.ws.receive(tableMsg(waitingView()));

    const next = reloaded(r);
    const ws = next.last();
    ws.open();
    ws.receive(welcome(CODE));
    ws.receive(tableMsg(waitingView()));
    expect(ws.kinds()).toEqual(['hello']);
    expect(next.state().ui.screen).toBe('mpRoom');
  });

  it('a join the server refused is not asked again by a reload', () => {
    const r = invited();
    r.ws.receive({ t: 'error', code: 'not_found', re: 'join' });
    r.dispatch({ type: 'mpDismiss' });
    expect(r.state().ui.screen).toBe('home');

    expect(reloaded(r).sockets).toEqual([]);
  });

  it('Back from "Joining the table…" is not asked again by a reload', () => {
    const r = rig({ startParam: CODE });
    r.driver.launch();
    r.dispatch({ type: 'back' });
    expect(r.state().ui.screen).toBe('home');

    expect(reloaded(r).sockets).toEqual([]);
  });

  it('a reload before anything came back still joins', () => {
    const r = rig({ startParam: CODE });
    r.driver.launch();

    const next = reloaded(r);
    expect(next.state().ui.screen).toBe('mpRoom');
    const ws = next.last();
    ws.open();
    ws.receive(welcome(null));
    expect(ws.kinds()).toEqual(['hello', 'join']);
  });

  it('startapp=new is used once too: Back, then a reload, stays Home', () => {
    const r = rig({ startParam: 'new' });
    r.driver.launch();
    expect(r.state().ui.screen).toBe('mpCreate');
    r.dispatch({ type: 'back' });

    const next = rig({ startParam: 'new', data: r.data, session: r.session });
    next.driver.launch();
    expect(next.state().ui.screen).toBe('home');
    expect(next.sockets).toEqual([]);
  });

  it('a launch with no start code writes nothing to the session', () => {
    const r = rig();
    r.driver.launch();
    r.dispatch({ type: 'go', screen: 'mpCreate' });
    r.dispatch({ type: 'back' });
    expect([...r.session.keys()]).toEqual([]);
  });
});

describe('entering a table (the first `table`)', () => {
  it('parks the controller, holds offTable, sets the trap and shows the Table', () => {
    const r = seated();
    expect(r.controller.park).toHaveBeenCalledTimes(1);
    expect(r.state().ui.holds).toContainEqual({ gate: 'offTable', owner: 'mp' });
    expect(r.state().ui.gates).toContain('offTable');
    expect(r.state().ui.backTrap).toBe('mpLeave');
    expect(r.state().ui.nav.screens).toEqual(['home', 'table']);
    expect(r.closing).toEqual([true]);
    expect(selectRemote(r.state())).toBe(true);
  });

  it('writes the game slice through localView', () => {
    const view = theirTurn();
    const r = seated(view);
    const { game } = r.state();
    expect(game.coachLevel).toBe('exam');
    expect(game.mode).toBe('botTurn');
    expect(game.table?.slots[0]?.name).toBe('You');
    expect(game.table?.slots[0]?.playerId).toBe(`s${OTHER}`);
    expect(game.hand?.handSeq).toBe(HAND.handSeq);
    expect(selectMpView(r.state())).toEqual(view);
  });

  it('keeps the counters the controller wrote', () => {
    const r = rig({ remembered: CODE });
    const diag = { engineErrors: 2, botFallbacks: 1, voidedHands: 0 };
    r.store.setState((s) => ({ game: { ...s.game, diag } }));
    r.driver.launch();
    r.last().open();
    r.last().receive(welcome(CODE));
    r.last().receive(tableMsg(theirTurn()));
    expect(r.state().game.diag).toBe(diag);
  });

  it('later views do not enter again', () => {
    const r = seated();
    r.ws.receive(tableMsg(theirTurn({ rev: 2 })));
    expect(r.controller.park).toHaveBeenCalledTimes(1);
    expect(r.closing).toEqual([true]);
  });

  it('remembers the table on this device', () => {
    const r = rig({ startParam: CODE });
    r.driver.launch();
    r.last().open();
    r.last().receive(welcome(null));
    expect(r.data.has(STORAGE_KEYS.mpTable)).toBe(false);
    r.last().receive(tableMsg(waitingView()));
    expect(r.data.get(STORAGE_KEYS.mpTable)).toBe(CODE);
  });

  it('a first view of a waiting table shows the waiting room', () => {
    const r = rig({ startParam: CODE });
    r.driver.launch();
    r.last().open();
    r.last().receive(welcome(null));
    r.last().receive(tableMsg(waitingView()));
    expect(r.state().ui.nav.screens).toEqual(['home', 'mpRoom']);
    expect(r.state().game.mode).toBe('idle');
  });

  it('from the Create screen, the screen is replaced: Back would not return to it', () => {
    const r = rig();
    r.dispatch({ type: 'go', screen: 'mpCreate' });
    r.last().open();
    r.last().receive(welcome(null));
    r.dispatch({ type: 'mpCreateTable', settings: SETTINGS });
    r.last().receive(tableMsg(waitingView()));
    expect(r.state().ui.nav.screens).toEqual(['home', 'mpRoom']);
    expect(r.last().closedWith).toBeNull(); // leaving Create for the table keeps it open
  });
});

describe('leaving a table (`left`)', () => {
  function left(): Rig & { ws: FakeWebSocket } {
    const r = seated();
    r.dispatch({ type: 'leaveTable' });
    r.ws.receive({ t: 'left' });
    return r;
  }

  it('undoes everything of entering, and goes Home', () => {
    const r = left();
    expect(r.controller.unpark).toHaveBeenCalledTimes(1);
    expect(r.state().ui.holds).toEqual([]);
    expect(r.state().ui.backTrap).toBeNull();
    expect(r.state().ui.nav).toEqual({ screens: ['home'], overlays: [] });
    expect(r.closing).toEqual([true, false]);
    expect(r.state().mp).toEqual(initialMp());
  });

  it('closes the socket and forgets the table', () => {
    const r = left();
    expect(r.ws.closedWith).toBe(1000);
    expect(r.data.has(STORAGE_KEYS.mpTable)).toBe(false);
  });

  it('is Home before the controller comes back: the local game cannot move on a Table screen', () => {
    const seen: string[] = [];
    const controller = {
      park: () => {},
      unpark: () => seen.push(store.getState().ui.screen),
    };
    const store = createAppStore();
    store.getState().dispatch({ type: 'go', screen: 'home' });
    const r = rig({ remembered: CODE, store, controller });
    r.driver.launch();
    r.last().open();
    r.last().receive(welcome(CODE));
    r.last().receive(tableMsg(theirTurn()));
    r.dispatch({ type: 'leaveTable' });
    r.last().receive({ t: 'left' });
    expect(seen).toEqual(['home']);
  });

  it('after it, game commands reach the controller again', () => {
    const r = left();
    r.dispatch({ type: 'nextHand' });
    expect(r.game).toHaveBeenCalledWith({ type: 'nextHand' });
  });

  it('after it, Back works as always', () => {
    const r = left();
    r.dispatch({ type: 'go', screen: 'table' });
    r.dispatch({ type: 'back' });
    expect(r.state().ui.nav).toEqual({ screens: ['home'], overlays: [] });
  });

  it('a later launch on this device opens no socket', () => {
    const r = left();
    r.driver.dispose();
    const later = rig({ data: r.data });
    later.driver.launch();
    expect(later.sockets).toEqual([]);
  });

  it('a page that dies at a table comes back by itself at the next launch', () => {
    const r = seated();
    expect(r.data.get(STORAGE_KEYS.mpTable)).toBe(CODE); // nothing cleaned it up
    const later = rig({ data: r.data });
    later.driver.launch();
    expect(later.sockets).toHaveLength(1);
  });

  it('dispose gives everything back too', () => {
    const r = seated();
    r.driver.dispose();
    expect(r.controller.unpark).toHaveBeenCalledTimes(1);
    expect(r.ws.closedWith).toBe(1000);
    expect(r.state().ui.holds).toEqual([]);
    r.dispatch({ type: 'nextHand' });
    expect(r.game).toHaveBeenCalledWith({ type: 'nextHand' });
  });
});

describe('the commands at a table', () => {
  it('act: sent with the decision`s seq, and the bar locks at once', () => {
    const view = yourTurn();
    const r = seated(view);
    expect(r.state().game.legal).toEqual({ ...view.legal, seat: 0 });
    r.dispatch({ type: 'act', action: CHECK });
    expect(r.ws.sent[r.ws.sent.length - 1]).toEqual({
      t: 'act',
      seq: view.decision?.seq,
      action: CHECK,
    });
    expect(r.state().game.legal).toBeNull();
    expect(r.game).not.toHaveBeenCalled();
  });

  it('a second tap sends nothing more', () => {
    const r = seated(yourTurn());
    r.dispatch({ type: 'act', action: CHECK });
    const sent = r.ws.sent.length;
    r.dispatch({ type: 'act', action: CHECK });
    expect(r.ws.sent).toHaveLength(sent);
  });

  it('not this player`s turn: nothing is sent', () => {
    const r = seated(theirTurn());
    const sent = r.ws.sent.length;
    r.dispatch({ type: 'act', action: CHECK });
    expect(r.ws.sent).toHaveLength(sent);
  });

  it('a refused action shows the last view again', () => {
    const view = yourTurn();
    const r = seated(view);
    r.dispatch({ type: 'act', action: CHECK });
    r.ws.receive({ t: 'error', code: 'illegal_action', re: 'act' });
    expect(r.state().game.legal).toEqual({ ...view.legal, seat: 0 });
    r.dispatch({ type: 'act', action: CHECK });
    expect(r.ws.kinds().filter((k) => k === 'act')).toHaveLength(2);
  });

  it.each(['stale_action', 'not_your_turn'] as const)(
    '%s is ignored: the next view says what happened',
    (code) => {
      const r = seated(yourTurn());
      r.dispatch({ type: 'act', action: CHECK });
      r.ws.receive({ t: 'error', code, re: 'act' });
      expect(r.state().game.legal).toBeNull();
      expect(selectMpProblem(r.state())).toBeNull();
      const next = yourTurn({
        rev: 2,
        decision: { seat: TO_ACT, seq: 8, deadlineAt: SERVER_NOW + 30_000 },
      });
      r.ws.receive(tableMsg(next));
      expect(r.state().game.legal).toEqual({ ...next.legal, seat: 0 });
    },
  );

  it('a rate-limited act shows the last view again', () => {
    const view = yourTurn();
    const r = seated(view);
    r.dispatch({ type: 'act', action: CHECK });
    r.ws.receive({ t: 'error', code: 'rate_limited', re: 'act' });
    expect(r.state().game.legal).not.toBeNull();
  });

  it('reload goes to the socket', () => {
    const r = seated();
    r.dispatch({ type: 'reload' });
    expect(r.ws.kinds()).toContain('reload');
    expect(r.game).not.toHaveBeenCalled();
  });

  it.each(['leaveTable', 'changeTable'] as const)('%s goes to the socket as leave', (type) => {
    const r = seated();
    r.dispatch({ type });
    expect(r.ws.kinds()).toContain('leave');
    expect(r.game).not.toHaveBeenCalled();
    expect(selectRemote(r.state())).toBe(true); // until `left`
  });

  it.each(['nextHand', 'skipHand', 'topUp', 'undo', 'keepMove'] as const)(
    '%s is swallowed',
    (type) => {
      const r = seated();
      const sent = r.ws.sent.length;
      r.dispatch({ type });
      expect(r.ws.sent).toHaveLength(sent);
      expect(r.game).not.toHaveBeenCalled();
    },
  );

  it.each<GameCommand>([
    { type: 'settings', patch: { sound: false } },
    { type: 'exportStats' },
    { type: 'visibility', hidden: true },
    { type: 'pagehide' },
  ])('$type is not the driver`s', (cmd) => {
    const r = seated();
    r.dispatch(cmd);
    expect(r.game).toHaveBeenCalledWith(cmd);
  });

  it('"Start game" and "I`m back" go to the socket', () => {
    const r = seated(waitingView());
    r.dispatch({ type: 'mpStartGame' });
    r.dispatch({ type: 'mpImBack' });
    expect(r.ws.kinds()).toEqual(expect.arrayContaining(['start', 'back']));
    expect(r.game).not.toHaveBeenCalled();
  });

  it('"Invite friends" goes to Telegram, with the view`s link and the screen`s words', () => {
    const shared: [string, string][] = [];
    const r = seated(waitingView(), { shareInvite: (url, text) => shared.push([url, text]) });
    r.dispatch({ type: 'mpShareInvite', text: 'Come and play' });
    expect(shared).toEqual([[waitingView().invite, 'Come and play']]);
    expect(r.ws.kinds()).toEqual(['hello']);
    expect(r.game).not.toHaveBeenCalled();
  });

  it('"Invite friends" with no table does nothing', () => {
    const shared: [string, string][] = [];
    const r = rig({ shareInvite: (url, text) => shared.push([url, text]) });
    r.driver.launch();
    r.dispatch({ type: 'mpShareInvite', text: 'Come and play' });
    expect(shared).toEqual([]);
    expect(r.game).not.toHaveBeenCalled();
  });

  it('without a table, every command but the mp ones is the controller`s', () => {
    const r = rig();
    r.driver.launch();
    for (const type of ['nextHand', 'topUp', 'undo', 'leaveTable', 'reload'] as const) {
      r.dispatch({ type });
      expect(r.game).toHaveBeenLastCalledWith({ type });
    }
    r.game.mockClear();
    r.dispatch({ type: 'mpStartGame' });
    r.dispatch({ type: 'mpImBack' });
    r.dispatch({ type: 'mpDismiss' });
    expect(r.game).not.toHaveBeenCalled();
  });
});

describe('`rev` order (§19.4)', () => {
  it('drops a view that is older or the same, applies a newer one', () => {
    const r = seated(theirTurn({ rev: 10 }));
    const shown = selectMpView(r.state());
    r.ws.receive(tableMsg(theirTurn({ rev: 9, handsPlayed: 99 })));
    expect(selectMpView(r.state())).toBe(shown);
    r.ws.receive(tableMsg(theirTurn({ rev: 10, handsPlayed: 99 })));
    expect(selectMpView(r.state())).toBe(shown);
    r.ws.receive(tableMsg(theirTurn({ rev: 11, handsPlayed: 5 })));
    expect(selectMpView(r.state())?.handsPlayed).toBe(5);
  });

  it('a dropped view says nothing either', () => {
    const r = seated(theirTurn({ rev: 10 }));
    r.ws.receive(tableMsg(theirTurn({ rev: 9 }), [{ n: 'joined', name: 'Bo' }]));
    expect(r.state().ui.toasts).toEqual([]);
  });

  it('`rev` counts within one table', () => {
    const r = seated(theirTurn({ rev: 10 }));
    r.ws.receive(tableMsg(theirTurn({ rev: 1, code: OTHER_CODE })));
    expect(selectMpView(r.state())?.code).toBe(OTHER_CODE);
    expect(r.data.get(STORAGE_KEYS.mpTable)).toBe(OTHER_CODE);
  });
});

describe('which screen a view shows', () => {
  it('waiting is the room, playing is the Table, both ways', () => {
    const r = seated(waitingView());
    expect(r.state().ui.nav.screens).toEqual(['home', 'mpRoom']);
    r.ws.receive(tableMsg(theirTurn({ rev: 2 })));
    expect(r.state().ui.nav.screens).toEqual(['home', 'table']);
    r.ws.receive(tableMsg(waitingView({ rev: 3 })));
    expect(r.state().ui.nav.screens).toEqual(['home', 'mpRoom']);
  });

  it('a view of the same status leaves open overlays alone', () => {
    const r = seated();
    r.dispatch({ type: 'open', overlay: 'rankings' });
    r.ws.receive(tableMsg(theirTurn({ rev: 2 })));
    expect(r.state().ui.overlays).toEqual(['rankings']);
  });
});

describe('the clocks (§19.6: the phone`s own clock does not matter)', () => {
  it('turnEndsAt is the time left at the server, from the moment the view came', () => {
    const r = seated(
      theirTurn({
        now: SERVER_NOW,
        decision: { seat: TO_ACT, seq: 7, deadlineAt: SERVER_NOW + 12_345 },
      }),
    );
    expect(r.state().mp.turnEndsAt).toBe(1000 + 12_345);
    expect(r.state().mp.nextHandEndsAt).toBeNull();
  });

  it('a later view of the same decision keeps it', () => {
    const decision = { seat: TO_ACT, seq: 7, deadlineAt: SERVER_NOW + 30_000 };
    const r = seated(theirTurn({ decision }));
    const before = r.state().mp.turnEndsAt;
    r.clock.mono = 5000;
    r.ws.receive(tableMsg(theirTurn({ rev: 2, now: SERVER_NOW + 3990, decision })));
    expect(r.state().mp.turnEndsAt).toBe(before);
  });

  it('a new decision, or a moved deadline, sets it again', () => {
    const r = seated(theirTurn());
    r.clock.mono = 5000;
    const moved = { seat: TO_ACT, seq: 7, deadlineAt: SERVER_NOW + 15_000 };
    r.ws.receive(tableMsg(theirTurn({ rev: 2, decision: moved })));
    expect(r.state().mp.turnEndsAt).toBe(5000 + 15_000);
    const next = { seat: OTHER, seq: 8, deadlineAt: SERVER_NOW + 20_000 };
    r.ws.receive(tableMsg(theirTurn({ rev: 3, decision: next })));
    expect(r.state().mp.turnEndsAt).toBe(5000 + 20_000);
  });

  it('no decision, no turn clock; a hand on show has the next hand`s clock', () => {
    const last = playedHand(remoteTable(KINDS)).at(-1);
    expect(last?.phase).toBe('complete');
    const r = seated(viewOfHand(KINDS, last as typeof HAND, 0));
    expect(r.state().mp.turnEndsAt).toBeNull();
    expect(r.state().mp.nextHandEndsAt).toBe(1000 + 4000);
    expect(r.state().game.mode).toBe('handEnd');
  });
});

describe('a dropped connection', () => {
  it('the bar locks while it is away', () => {
    const r = seated(yourTurn());
    expect(r.state().game.legal).not.toBeNull();
    r.ws.drop(1006);
    expect(selectConnection(r.state())).toBe('reconnecting');
    expect(r.state().game.legal).toBeNull();
    expect(selectRemote(r.state())).toBe(true);
  });

  it('back online, the bar waits for the next view, which may repeat the rev', () => {
    const view = yourTurn({ rev: 5 });
    const r = seated(view);
    r.ws.drop(1006);
    advance(500);
    const next = r.last();
    next.open();
    next.receive(welcome(CODE));
    expect(selectConnection(r.state())).toBe('online');
    expect(r.state().game.legal).toBeNull();
    next.receive(tableMsg(yourTurn({ rev: 5 })));
    expect(r.state().game.legal).toEqual({ ...view.legal, seat: 0 });
  });

  it('only the first view on a new socket may repeat the rev', () => {
    const r = seated(theirTurn({ rev: 5 }));
    r.ws.drop(1006);
    advance(500);
    const next = r.last();
    next.open();
    next.receive(welcome(CODE));
    next.receive(tableMsg(theirTurn({ rev: 5 })));
    next.receive(tableMsg(theirTurn({ rev: 5, handsPlayed: 42 })));
    expect(selectMpView(r.state())?.handsPlayed).not.toBe(42);
  });

  it('it says hello again with the same initData', () => {
    const r = seated();
    r.ws.drop(1006);
    advance(500);
    r.last().open();
    expect(r.last().sent[0]).toEqual({ t: 'hello', v: 1, initData: INIT_DATA });
  });

  it('a hidden page waits, and tries at once when visible again', () => {
    const r = seated();
    updateUi(r.store, (ui) => ({ ...ui, hidden: true }));
    r.ws.drop(1006);
    advance(600_000);
    expect(r.sockets).toHaveLength(1);
    updateUi(r.store, (ui) => ({ ...ui, hidden: false }));
    expect(r.sockets).toHaveLength(2);
  });

  describe('the clocks while it is away (§19.10): only what is known', () => {
    const drop = (r: ReturnType<typeof seated>, at: number): void => {
      r.clock.mono = at;
      r.ws.drop(1006);
    };

    it('your turn: at most the time the server allows a player who is offline', () => {
      const r = seated(yourTurn()); // 30 s from 1000
      drop(r, 4000);
      expect(selectTurn(r.state())).toEqual({ kind: 'youOffline', endsAt: 4000 + OFFLINE_TURN_MS });
    });

    it('less than that left: the deadline it had', () => {
      const r = seated(
        yourTurn({ decision: { seat: TO_ACT, seq: 7, deadlineAt: SERVER_NOW + 6000 } }),
      );
      drop(r, 2000);
      expect(selectTurn(r.state())).toEqual({ kind: 'youOffline', endsAt: 1000 + 6000 });
    });

    it('the loss is counted from the first moment, whatever the tries that follow say', () => {
      const r = seated(yourTurn());
      drop(r, 4000);
      r.clock.mono = 9000;
      advance(500);
      r.last().drop(1006);
      expect(selectTurn(r.state())).toEqual({ kind: 'youOffline', endsAt: 4000 + OFFLINE_TURN_MS });
    });

    it("someone else's turn and the next hand: nothing can be known", () => {
      const r = seated(theirTurn());
      r.ws.drop(1006);
      expect(selectTurn(r.state())).toBeNull();
      const last = playedHand(remoteTable(KINDS)).at(-1) as typeof HAND;
      const s = seated(viewOfHand(KINDS, last, 0));
      s.ws.drop(1006);
      expect(selectTurn(s.state())).toBeNull();
    });

    it('not dealt in: that does not depend on the connection', () => {
      const kinds: SeatKind[] = ['in', 'out', 'in'];
      const r = seated(viewOfHand(kinds, startHand(remoteTable(kinds), SEED), 1));
      r.ws.drop(1006);
      expect(selectTurn(r.state())).toEqual({ kind: 'notDealtIn' });
    });

    it('`welcome` alone says nothing about the clock: the view does', () => {
      const r = seated(yourTurn({ rev: 5 }));
      drop(r, 4000);
      r.clock.mono = 5000;
      advance(500);
      const next = r.last();
      next.open();
      next.receive(welcome(CODE));
      expect(selectConnection(r.state())).toBe('online');
      expect(selectTurn(r.state())).toEqual({ kind: 'youOffline', endsAt: 4000 + OFFLINE_TURN_MS });
    });

    it('back with the deadline the server moved: what is really left', () => {
      const r = seated(yourTurn({ rev: 5 }));
      drop(r, 4000);
      r.clock.mono = 10_000;
      advance(500);
      const next = r.last();
      next.open();
      next.receive(welcome(CODE));
      const decision = { seat: TO_ACT, seq: 7, deadlineAt: SERVER_NOW + 9000 };
      next.receive(tableMsg(yourTurn({ rev: 6, decision })));
      expect(selectTurn(r.state())).toEqual({ kind: 'you', endsAt: 10_000 + 9000 });
    });

    it('back, and the server had not noticed: the deadline it always had', () => {
      const r = seated(yourTurn({ rev: 5 }));
      const before = r.state().mp.turnEndsAt as number;
      drop(r, 4000);
      r.clock.mono = 5000;
      advance(500);
      const next = r.last();
      next.open();
      next.receive(welcome(CODE));
      next.receive(tableMsg(yourTurn({ rev: 5 })));
      expect(selectTurn(r.state())).toEqual({ kind: 'you', endsAt: before });
    });
  });

  it('`welcome` with no table while at one: the table is gone', () => {
    const r = seated();
    r.ws.drop(1006);
    advance(500);
    r.last().open();
    r.last().receive(welcome(null));
    expect(selectMpProblem(r.state())).toEqual({ kind: 'ended', reason: 'gone' });
    expect(r.state().ui.overlays).toContain('mpProblem');
    expect(r.data.has(STORAGE_KEYS.mpTable)).toBe(false);
  });

  it('a leave sent into the gap goes after the reconnect', () => {
    const r = seated();
    r.ws.drop(1006);
    r.dispatch({ type: 'leaveTable' });
    expect(selectRemote(r.state())).toBe(true);
    advance(500);
    r.last().open();
    r.last().receive(welcome(CODE));
    expect(r.last().kinds()).toContain('leave');
    r.last().receive({ t: 'left' });
    expect(selectRemote(r.state())).toBe(false);
  });

  it('if the table is gone by then, the leave is done, with no dialog', () => {
    const r = seated();
    r.ws.drop(1006);
    r.dispatch({ type: 'leaveTable' });
    advance(500);
    r.last().open();
    r.last().receive(welcome(null));
    expect(selectMpProblem(r.state())).toBeNull();
    expect(selectRemote(r.state())).toBe(false);
    expect(r.state().ui.screen).toBe('home');
  });

  function lost(r: Rig): void {
    for (let i = 0; i < 200 && selectConnection(r.state()) !== 'lost'; i++) {
      r.last().drop(1006);
      if (selectConnection(r.state()) !== 'lost') advance(10_000);
    }
    expect(selectConnection(r.state())).toBe('lost');
  }

  it('two minutes: lost, and the table stays on show', () => {
    const r = seated(yourTurn());
    const start = Date.now();
    lost(r);
    expect(Date.now() - start).toBeGreaterThanOrEqual(GIVE_UP_AFTER_MS);
    expect(selectRemote(r.state())).toBe(true);
    expect(r.state().game.legal).toBeNull();
  });

  it('"Try again" dials at once', () => {
    const r = seated();
    lost(r);
    const count = r.sockets.length;
    r.dispatch({ type: 'mpTryAgain' });
    expect(r.sockets).toHaveLength(count + 1);
    expect(selectConnection(r.state())).toBe('reconnecting');
  });

  it('"Leave table" once lost leaves without the server', () => {
    const r = seated();
    lost(r);
    r.dispatch({ type: 'leaveTable' });
    expect(selectRemote(r.state())).toBe(false);
    expect(r.state().ui.screen).toBe('home');
    expect(r.controller.unpark).toHaveBeenCalledTimes(1);
    expect(r.data.has(STORAGE_KEYS.mpTable)).toBe(false);
  });
});

describe('the table ended', () => {
  it.each(['server_restart', 'idle', 'error'] as const)(
    '%s: a dialog over the table, and only OK goes Home',
    (reason) => {
      const r = seated(yourTurn());
      r.ws.receive({ t: 'ended', code: CODE, reason });
      expect(selectMpProblem(r.state())).toEqual({ kind: 'ended', reason });
      expect(r.state().ui.overlays).toContain('mpProblem');
      expect(r.state().ui.screen).toBe('table');
      expect(r.state().game.legal).toBeNull();
      expect(r.ws.closedWith).toBe(1000);

      r.dispatch({ type: 'back' });
      expect(r.state().ui.overlays).toContain('mpProblem');
      expect(r.state().ui.screen).toBe('table');

      r.dispatch({ type: 'mpDismiss' });
      expect(r.state().ui.nav).toEqual({ screens: ['home'], overlays: [] });
      expect(r.controller.unpark).toHaveBeenCalledTimes(1);
      expect(r.state().mp).toEqual(initialMp());
      expect(r.state().ui.backTrap).toBeNull();
      expect(r.state().ui.holds).toEqual([]);
    },
  );

  it('forgets the table at once', () => {
    const r = seated();
    r.ws.receive({ t: 'ended', code: CODE, reason: 'idle' });
    expect(r.data.has(STORAGE_KEYS.mpTable)).toBe(false);
  });

  it('`ended` for another table changes nothing', () => {
    const r = seated();
    r.ws.receive({ t: 'ended', code: OTHER_CODE, reason: 'idle' });
    expect(selectMpProblem(r.state())).toBeNull();
    expect(selectRemote(r.state())).toBe(true);
  });

  it('close 1012 without `ended` says the same as `ended`', () => {
    const r = seated();
    r.ws.drop(1012);
    expect(selectMpProblem(r.state())).toEqual({ kind: 'ended', reason: 'server_restart' });
  });

  it.each([1009, 4005])('close %i (a bug) ends the table with the error words', (code) => {
    const r = seated();
    r.ws.drop(code);
    expect(selectMpProblem(r.state())).toEqual({ kind: 'ended', reason: 'error' });
  });
});

describe('the socket stopped by the server', () => {
  it.each([
    ['auth_failed', 4001, 'login'],
    ['outdated', 4003, 'outdated'],
    ['replaced', 4002, 'replaced'],
  ] as const)('%s and close %i: one dialog; OK leaves', (code, closeCode, kind) => {
    const r = seated();
    r.ws.receive({ t: 'error', code, re: null });
    r.ws.drop(closeCode);
    expect(selectMpProblem(r.state())).toEqual({ kind });
    expect(r.state().ui.overlays.filter((o) => o === 'mpProblem')).toHaveLength(1);
    r.dispatch({ type: 'mpDismiss' });
    expect(r.state().ui.screen).toBe('home');
    expect(selectRemote(r.state())).toBe(false);
    expect(r.data.has(STORAGE_KEYS.mpTable)).toBe(false);
  });

  it.each([
    [4001, 'login'],
    [4003, 'outdated'],
    [4002, 'replaced'],
  ] as const)('close %i alone says the same', (code, kind) => {
    const r = seated();
    r.ws.drop(code);
    expect(selectMpProblem(r.state())).toEqual({ kind });
  });
});

describe('joining failed', () => {
  function joining(): Rig {
    const r = rig({ startParam: CODE });
    r.driver.launch();
    r.last().open();
    r.last().receive(welcome(null));
    return r;
  }

  it.each([
    ['not_found', 'joinGone'],
    ['full', 'joinFull'],
    ['server_full', 'tooManyTables'],
    ['rate_limited', 'tooManyTables'],
  ] as const)('%s: the dialog; OK goes Home and closes the socket', (code, kind) => {
    const r = joining();
    r.last().receive({ t: 'error', code, re: 'join' });
    expect(selectMpProblem(r.state())).toEqual({ kind });
    expect(r.state().ui.overlays).toContain('mpProblem');
    expect(r.controller.park).not.toHaveBeenCalled();
    r.dispatch({ type: 'back' });
    expect(r.state().ui.overlays).toContain('mpProblem');
    r.dispatch({ type: 'mpDismiss' });
    expect(r.state().ui.nav).toEqual({ screens: ['home'], overlays: [] });
    expect(r.last().closedWith).toBe(1000);
    expect(r.state().mp).toEqual(initialMp());
  });

  it('a table that cannot be created stays on the Create screen', () => {
    const r = rig();
    r.dispatch({ type: 'go', screen: 'mpCreate' });
    r.last().open();
    r.last().receive(welcome(null));
    r.dispatch({ type: 'mpCreateTable', settings: SETTINGS });
    r.last().receive({ t: 'error', code: 'server_full', re: 'create' });
    expect(selectMpProblem(r.state())).toEqual({ kind: 'tooManyTables' });
    r.dispatch({ type: 'mpDismiss' });
    expect(r.state().ui).toMatchObject({ screen: 'mpCreate', overlays: [] });
    expect(r.last().closedWith).toBeNull();
    r.dispatch({ type: 'mpCreateTable', settings: SETTINGS });
    expect(
      r
        .last()
        .kinds()
        .filter((k) => k === 'create'),
    ).toHaveLength(2);
  });

  describe('an invite to another table while seated (§19.10): the tap is not lost', () => {
    /** At table CODE, launched from an invite to `invite`. */
    function invited(invite = OTHER_CODE, view = theirTurn({ rev: 1 })) {
      const r = rig({ startParam: invite, remembered: CODE });
      r.driver.launch();
      const ws = r.last();
      ws.open();
      ws.receive(welcome(CODE));
      ws.receive(tableMsg(view));
      return { ...r, ws };
    }
    const dialogs = (r: Rig): string[] => r.state().ui.overlays.filter((o) => o === 'mpProblem');

    it('the seat`s table comes up with the question over it, and the server is asked nothing', () => {
      const r = invited();
      expect(selectRemote(r.state())).toBe(true);
      expect(selectMpView(r.state())?.code).toBe(CODE);
      expect(r.state().ui.screen).toBe('table');
      expect(selectMpProblem(r.state())).toEqual({ kind: 'alreadySeated', other: CODE });
      expect(dialogs(r)).toEqual(['mpProblem']);
      expect(r.ws.kinds()).toEqual(['hello']);
    });

    it('Back cannot close it', () => {
      const r = invited();
      expect(r.state().ui.backTrap).toBe('mpProblem');
      r.dispatch({ type: 'back' });
      expect(dialogs(r)).toEqual(['mpProblem']);
    });

    it('an invite to the table you sit at asks nothing', () => {
      const r = invited(CODE);
      expect(selectMpProblem(r.state())).toBeNull();
      expect(r.ws.kinds()).toEqual(['hello']);
    });

    it('asks once, and the views of the table go on behind it', () => {
      const r = invited();
      r.ws.receive(tableMsg(theirTurn({ rev: 2, handsPlayed: 7 })));
      expect(dialogs(r)).toEqual(['mpProblem']);
      expect(selectMpView(r.state())?.handsPlayed).toBe(7);
    });

    it('"Stay at my table": it closes, the server hears nothing, and it does not ask again', () => {
      const r = invited();
      r.dispatch({ type: 'mpGoToMyTable' });
      expect(selectMpProblem(r.state())).toBeNull();
      expect(r.state().ui.overlays).toEqual([]);
      expect(r.state().ui.backTrap).toBe('mpLeave');
      expect(r.ws.kinds()).toEqual(['hello']);
      r.ws.receive(tableMsg(theirTurn({ rev: 2 })));
      expect(selectMpProblem(r.state())).toBeNull();
      expect(selectMpView(r.state())?.code).toBe(CODE);
    });

    it('"Leave and join the new table": leaves, says "Joining…", joins, and lands there', () => {
      const r = invited();
      r.dispatch({ type: 'mpLeaveAndJoin' });
      expect(r.ws.kinds()).toEqual(['hello', 'leave']);
      expect(selectMpView(r.state())?.code).toBe(CODE); // until the server says so

      r.ws.receive({ t: 'left' });
      expect(selectMpView(r.state())).toBeNull();
      expect(r.state().ui.screen).toBe('mpRoom');
      expect(r.ws.sent.at(-1)).toEqual({ t: 'join', code: OTHER_CODE });
      expect(r.data.has(STORAGE_KEYS.mpTable)).toBe(false);

      r.ws.receive(tableMsg(theirTurn({ rev: 1, code: OTHER_CODE })));
      expect(selectMpView(r.state())?.code).toBe(OTHER_CODE);
      expect(r.state().ui.screen).toBe('table');
      expect(r.data.get(STORAGE_KEYS.mpTable)).toBe(OTHER_CODE);
      expect(selectMpProblem(r.state())).toBeNull();
    });

    it('a busted seat`s dialog goes with its table', () => {
      const seats = [seatInfo('Ann', { status: 'busted', stack: 0 }), seatInfo('Ben'), null];
      const r = invited(OTHER_CODE, waitingView({ status: 'playing', seats }));
      expect(r.state().ui.overlays).toEqual(['outOfChips', 'mpProblem']);
      r.dispatch({ type: 'mpLeaveAndJoin' });
      r.ws.receive({ t: 'left' });
      expect(r.state().ui.overlays).toEqual([]);
    });

    it('the new table is gone after all: says so, and OK goes Home', () => {
      const r = invited();
      r.dispatch({ type: 'mpLeaveAndJoin' });
      r.ws.receive({ t: 'left' });
      r.ws.receive({ t: 'error', code: 'not_found', re: 'join' });
      expect(selectMpProblem(r.state())).toEqual({ kind: 'joinGone' });
      r.dispatch({ type: 'mpDismiss' });
      expect(r.state().ui.screen).toBe('home');
      expect(selectRemote(r.state())).toBe(false);
      expect(r.controller.unpark).toHaveBeenCalledOnce();
    });

    it('a drop before `left`: `welcome` with no table goes on to the new one', () => {
      const r = invited();
      r.dispatch({ type: 'mpLeaveAndJoin' });
      r.ws.drop(1006);
      advance(500);
      const next = r.last();
      next.open();
      next.receive(welcome(null));
      expect(selectMpProblem(r.state())).toBeNull();
      expect(next.sent.at(-1)).toEqual({ t: 'join', code: OTHER_CODE });
    });

    it('a drop before the server heard it: the `leave` goes after the reconnect', () => {
      const r = invited();
      r.dispatch({ type: 'mpLeaveAndJoin' });
      r.ws.drop(1006);
      advance(500);
      const next = r.last();
      next.open();
      next.receive(welcome(CODE));
      expect(next.sent.at(-1)).toEqual({ t: 'leave' });
    });

    it('the invite is used once: the same launch reloaded does not ask again', () => {
      const r = invited();
      const again = rig({
        startParam: OTHER_CODE,
        remembered: CODE,
        session: r.session,
        data: r.data,
      });
      again.driver.launch();
      const ws = again.last();
      ws.open();
      ws.receive(welcome(CODE));
      ws.receive(tableMsg(theirTurn({ rev: 1 })));
      expect(selectMpProblem(again.state())).toBeNull();
    });
  });

  describe('already at another table', () => {
    function seatedElsewhere(): Rig {
      const r = joining();
      r.last().receive({ t: 'error', code: 'already_seated', re: 'join', other: OTHER_CODE });
      return r;
    }

    it('asks, and Back does not close it', () => {
      const r = seatedElsewhere();
      expect(selectMpProblem(r.state())).toEqual({ kind: 'alreadySeated', other: OTHER_CODE });
      r.dispatch({ type: 'back' });
      expect(r.state().ui.overlays).toContain('mpProblem');
    });

    it('"Go to my table" joins that one', () => {
      const r = seatedElsewhere();
      r.dispatch({ type: 'mpGoToMyTable' });
      expect(r.last().sent[r.last().sent.length - 1]).toEqual({ t: 'join', code: OTHER_CODE });
      expect(selectMpProblem(r.state())).toBeNull();
      expect(r.state().ui.overlays).toEqual([]);
      r.last().receive(tableMsg(theirTurn({ code: OTHER_CODE })));
      expect(selectRemote(r.state())).toBe(true);
    });

    it('"Leave it and join this one" leaves first, then joins', () => {
      const r = seatedElsewhere();
      r.dispatch({ type: 'mpLeaveAndJoin' });
      expect(r.last().kinds().slice(-1)).toEqual(['leave']);
      r.last().receive({ t: 'left' });
      expect(r.last().sent[r.last().sent.length - 1]).toEqual({ t: 'join', code: CODE });
      expect(r.state().ui.screen).toBe('mpRoom');
    });

    it('the two buttons do nothing without that dialog', () => {
      const r = seated();
      const sent = r.ws.sent.length;
      r.dispatch({ type: 'mpGoToMyTable' });
      r.dispatch({ type: 'mpLeaveAndJoin' });
      expect(r.ws.sent).toHaveLength(sent);
    });
  });

  it('`not_seated` for a leave means it is done', () => {
    const r = seated();
    r.dispatch({ type: 'leaveTable' });
    r.ws.receive({ t: 'error', code: 'not_seated', re: 'leave' });
    expect(selectRemote(r.state())).toBe(false);
  });

  it.each(['not_host', 'not_busted', 'not_enough_players', 'already_started'] as const)(
    '%s changes nothing: the view is right',
    (code) => {
      const r = seated();
      r.ws.receive({ t: 'error', code, re: null });
      expect(selectMpProblem(r.state())).toBeNull();
      expect(selectRemote(r.state())).toBe(true);
    },
  );
});

describe('the Back trap at a table', () => {
  it('Back asks "Leave this table?", Back again closes the question', () => {
    const r = seated();
    r.dispatch({ type: 'back' });
    expect(r.state().ui.nav).toEqual({ screens: ['home', 'table'], overlays: ['mpLeave'] });
    r.dispatch({ type: 'back' });
    expect(r.state().ui.nav).toEqual({ screens: ['home', 'table'], overlays: [] });
    expect(selectRemote(r.state())).toBe(true);
  });

  it('Back in the waiting room asks too', () => {
    const r = seated(waitingView());
    r.dispatch({ type: 'back' });
    expect(r.state().ui.nav).toEqual({ screens: ['home', 'mpRoom'], overlays: ['mpLeave'] });
  });

  it('"Leave table" in the question goes to the socket and ends with Home', () => {
    const r = seated();
    r.dispatch({ type: 'back' });
    r.dispatch({ type: 'leaveTable' });
    expect(r.ws.kinds()).toContain('leave');
    r.ws.receive({ t: 'left' });
    expect(r.state().ui.nav).toEqual({ screens: ['home'], overlays: [] });
  });

  it('after a dialog that does not end the table, the question comes back', () => {
    const r = seated();
    expect(r.state().ui.backTrap).toBe('mpLeave');
    r.ws.receive({ t: 'error', code: 'already_seated', re: 'join', other: OTHER_CODE });
    expect(r.state().ui.backTrap).toBe('mpProblem');
    r.dispatch({ type: 'mpGoToMyTable' });
    expect(r.state().ui.backTrap).toBe('mpLeave');
  });
});

describe('out of chips', () => {
  const busted = (rev: number): TableView =>
    waitingView({
      rev,
      status: 'playing',
      seats: [seatInfo('Ann', { status: 'busted', stack: 0 }), seatInfo('Ben'), null],
    });

  it('the dialog opens with the bust, and closes when the seat has chips again', () => {
    const r = seated(theirTurn({ rev: 1 }));
    expect(r.state().ui.overlays).not.toContain('outOfChips');
    r.ws.receive(tableMsg(busted(2)));
    expect(r.state().game.heroBust).toBe(true);
    expect(r.state().ui.overlays).toContain('outOfChips');
    r.dispatch({ type: 'reload' });
    expect(r.ws.kinds()).toContain('reload');
    r.ws.receive(tableMsg(theirTurn({ rev: 3 })));
    expect(r.state().game.heroBust).toBe(false);
    expect(r.state().ui.overlays).not.toContain('outOfChips');
  });

  it('a player who comes back busted sees it from the first view', () => {
    const r = seated(busted(1));
    expect(r.state().ui.overlays).toContain('outOfChips');
  });

  it('stays open under the next views, and survives a change of screen', () => {
    const r = seated(busted(1));
    r.ws.receive(tableMsg(busted(2)));
    expect(r.state().ui.overlays.filter((o) => o === 'outOfChips')).toHaveLength(1);
    r.ws.receive(tableMsg({ ...busted(3), status: 'waiting' }));
    expect(r.state().ui.screen).toBe('mpRoom');
    expect(r.state().ui.overlays).toContain('outOfChips');
  });

  it('Back asks to leave, above the dialog', () => {
    const r = seated(busted(1));
    r.dispatch({ type: 'back' });
    expect(r.state().ui.overlays).toEqual(['outOfChips', 'mpLeave']);
  });

  describe('the result comes first (§19.10)', () => {
    const played = playedHand(remoteTable(KINDS));
    const ended = played[played.length - 1] as typeof HAND;
    const withBust = (view: TableView): TableView => ({
      ...view,
      seats: view.seats.map((seat, i) =>
        i === view.you && seat ? { ...seat, status: 'busted', stack: 0 } : seat,
      ),
    });
    const atHandEnd = (rev: number): TableView =>
      withBust(viewOfHand(KINDS, ended, 0, { rev, seats: seatsOf(KINDS, ended) }));
    /** The next hand, dealt to the other two. */
    const OUT: SeatKind[] = ['out', 'in', 'in'];
    const dealt = startHand(remoteTable(OUT), SEED);
    const nextDeal = (rev: number): TableView => withBust(viewOfHand(OUT, dealt, 0, { rev }));

    it('nothing covers the hand that took the last chips', () => {
      const r = seated(theirTurn({ rev: 1 }));
      r.ws.receive(tableMsg(atHandEnd(2)));
      expect(r.state().game.heroBust).toBe(true);
      expect(r.state().game.mode).toBe('handEnd');
      expect(r.state().ui.overlays).not.toContain('outOfChips');
    });

    it('the next deal opens the dialog: no timer, the view that comes anyway', () => {
      const r = seated(theirTurn({ rev: 1 }));
      r.ws.receive(tableMsg(atHandEnd(2)));
      advance(15_000); // the longest a hand end lasts, and more; the socket's ping is at 20 s
      expect(r.state().ui.overlays).not.toContain('outOfChips');
      r.ws.receive(tableMsg(nextDeal(3)));
      expect(r.state().ui.overlays).toContain('outOfChips');
    });

    it('nobody left to play with: the waiting room opens it', () => {
      const r = seated(theirTurn({ rev: 1 }));
      r.ws.receive(tableMsg(atHandEnd(2)));
      r.ws.receive(tableMsg({ ...busted(3), status: 'waiting' }));
      expect(r.state().ui.screen).toBe('mpRoom');
      expect(r.state().ui.overlays).toContain('outOfChips');
    });

    it('a later hand end leaves an open dialog alone: that seat was not dealt in', () => {
      const r = seated(theirTurn({ rev: 1 }));
      r.ws.receive(tableMsg(nextDeal(2)));
      expect(r.state().ui.overlays).toContain('outOfChips');
      const finished = playedHand(remoteTable(OUT)).at(-1) as typeof HAND;
      r.ws.receive(tableMsg(withBust(viewOfHand(OUT, finished, 0, { rev: 3 }))));
      expect(r.state().game.mode).toBe('handEnd');
      expect(r.state().ui.overlays).toContain('outOfChips');
    });

    it('someone who comes back during that hand end waits for the deal too', () => {
      const r = seated(atHandEnd(1));
      expect(r.state().ui.overlays).not.toContain('outOfChips');
    });
  });
});

describe('notices', () => {
  it('each is a toast, gone after 4 s', () => {
    const r = seated(theirTurn({ rev: 1 }));
    r.ws.receive(
      tableMsg(theirTurn({ rev: 2 }), [
        { n: 'joined', name: 'Bo' },
        { n: 'timedOut', action: 'fold' },
      ]),
    );
    expect(r.state().ui.toasts.map((t) => (t.kind === 'mpNotice' ? t.notice : t.kind))).toEqual([
      { n: 'joined', name: 'Bo' },
      { n: 'timedOut', action: 'fold' },
    ]);
    advance(4000);
    expect(r.state().ui.toasts).toEqual([]);
  });

  it('a host who leaves: the toast that stays on the Table says who left, not who is host now', () => {
    const r = seated(theirTurn({ rev: 1 }));
    r.ws.receive(
      tableMsg(theirTurn({ rev: 2 }), [
        { n: 'left', name: 'Bo' },
        { n: 'hostChanged', name: 'Cy' },
      ]),
    );
    const toasts = r.state().ui.toasts.map((t) => (t.kind === 'mpNotice' ? t.notice.n : t.kind));
    expect(toasts).toEqual(['hostChanged', 'left']);
  });

  it('a voided hand is the same toast as at any table', () => {
    const r = seated(theirTurn({ rev: 1 }));
    r.ws.receive(tableMsg(theirTurn({ rev: 2 }), [{ n: 'handVoided' }]));
    expect(r.state().ui.toasts[0]?.kind).toBe('handVoided');
  });

  it('ids never collide with the controller`s, and dispose stops the timers', () => {
    const r = seated(theirTurn({ rev: 1 }));
    r.ws.receive(tableMsg(theirTurn({ rev: 2 }), [{ n: 'sittingOut' }]));
    expect(r.state().ui.toasts[0]?.id).toBeGreaterThan(1_000_000);
    r.driver.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('selectTurn', () => {
  it('your turn', () => {
    const r = seated(yourTurn());
    expect(selectTurn(r.state())).toEqual({ kind: 'you', endsAt: 31_000 });
  });

  it('someone else`s turn, by name', () => {
    const r = seated(theirTurn());
    expect(selectTurn(r.state())).toEqual({
      kind: 'other',
      name: `P${TO_ACT}`,
      endsAt: 31_000,
    });
  });

  it('a hand on show: the next hand', () => {
    const last = playedHand(remoteTable(KINDS)).at(-1) as typeof HAND;
    const r = seated(viewOfHand(KINDS, last, 0));
    expect(selectTurn(r.state())).toEqual({ kind: 'nextHand', endsAt: 5000 });
  });

  it('not dealt in: the next hand brings cards', () => {
    const kinds: SeatKind[] = ['in', 'out', 'in'];
    const r = seated(viewOfHand(kinds, startHand(remoteTable(kinds), SEED), 1));
    expect(selectTurn(r.state())).toEqual({ kind: 'notDealtIn' });
  });

  it('sitting out or busted: no promise of cards, whose turn it is instead', () => {
    const kinds: SeatKind[] = ['in', 'out', 'in'];
    for (const status of ['sittingOut', 'busted'] as const) {
      const hand = startHand(remoteTable(kinds), SEED);
      const view = viewOfHand(kinds, hand, 1);
      const seats = view.seats.map((seat, i) => (i === 1 && seat ? { ...seat, status } : seat));
      const r = seated({ ...view, seats });
      expect(selectTurn(r.state())).toMatchObject({ kind: 'other' });
      r.driver.dispose();
    }
  });

  it('the waiting room says nothing', () => {
    expect(selectTurn(seated(waitingView()).state())).toBeNull();
  });

  it('is the same object until the slice changes', () => {
    const r = seated(yourTurn());
    expect(selectTurn(r.state())).toBe(selectTurn(r.state()));
  });

  it('nothing with no table', () => {
    expect(selectTurn(rig().state())).toBeNull();
  });
});

describe('selectSeatNotes', () => {
  it('per local seat, first match: Offline, Out, Next', () => {
    const r = seated(
      waitingView({
        you: 1,
        seats: [
          seatInfo('A', { status: 'nextHand', online: false }),
          seatInfo('B', { status: 'playing' }),
          null,
          seatInfo('C', { status: 'sittingOut' }),
          seatInfo('D', { status: 'busted' }),
          seatInfo('E', { status: 'leaving' }),
          seatInfo('F', { status: 'nextHand' }),
        ],
      }),
    );
    expect(selectSeatNotes(r.state())).toEqual([null, 'out', 'out', 'out', 'next', 'offline']);
  });

  it('is the same array until the view changes; empty with no table', () => {
    const r = seated();
    expect(selectSeatNotes(r.state())).toBe(selectSeatNotes(r.state()));
    expect(selectSeatNotes(rig().state())).toEqual([]);
  });
});

describe('with the real controller', () => {
  const passive = (legal: LegalActions): PlayerAction =>
    legal.canCheck ? { type: 'check' } : { type: 'call' };

  async function localHandInProgress() {
    const h = makeHarness({
      brain: scriptedBrain({ thinkMs: 300, choose: (obs) => passive(obs.legal) }),
      settings: { players: 3, speed: 'normal' },
    });
    h.dispatch({ type: 'play' });
    for (let i = 0; i < 400 && h.state().game.mode !== 'heroTurn'; i++) await elapse(100);
    expect(h.state().game.mode).toBe('heroTurn');
    h.dispatch({ type: 'leaveTable' }); // Home, where Play with friends is
    return h;
  }

  it('a local hand stands still behind a table, and comes back unchanged', async () => {
    const h = await localHandInProgress();
    const local = h.state().game;
    const inputs = h.controller.snapshot().inputs.length;

    const r = rig({ remembered: CODE, store: h.store, controller: h.controller });
    r.driver.launch();
    r.last().open();
    r.last().receive(welcome(CODE));
    r.last().receive(tableMsg(theirTurn()));
    expect(h.state().ui.screen).toBe('table');
    expect(h.state().game.hand).not.toBe(local.hand);
    expect(h.state().game.coachLevel).toBe('exam');

    await elapse(120_000);
    expect(h.controller.snapshot().inputs).toHaveLength(inputs);

    // A game command at the table does not reach the local game.
    h.dispatch({ type: 'nextHand' });
    expect(h.controller.snapshot().inputs).toHaveLength(inputs);

    h.dispatch({ type: 'leaveTable' });
    r.last().receive({ t: 'left' });
    expect(h.state().ui.screen).toBe('home');
    expect(h.state().game.hand).toBe(local.hand);
    expect(h.state().game.table).toBe(local.table);
    expect(h.state().game.mode).toBe(local.mode);
    expect(h.controller.snapshot().inputs).toHaveLength(inputs);
    h.controller.dispose();
    r.driver.dispose();
  });
});
