/**
 * The Telegram shell (PLAN §19.7; Stage 10 acceptance 12), through the real bridge to a stand-in
 * client (`TelegramWebviewProxy` records what it is told, `TelegramGameProxy_receiveEvent` is how
 * it answers) on the app's real store: what is said at start, per client version; the BackButton
 * follows the navigation and goes Back through the store; swipes, viewport, safe area, closing,
 * the invite; and the haptics port, from a store change through `app/device.ts` to the client.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { TableController, Timers } from '../../src/app/controller.ts';
import { installDevice, setHapticsPort } from '../../src/app/device.ts';
import { createAppStore, type AppState, type AppStore } from '../../src/app/store.ts';
import { createBridge } from '../../src/app/tg/bridge.ts';
import { createShell, type TgShell } from '../../src/app/tg/shell.ts';
import { startTelegram } from '../../src/app/tg/start.ts';
import { deriveSeed, type Seed128 } from '../../src/core/rng.ts';
import { startHand } from '../../src/engine/start.ts';
import { createTable, initialSlots } from '../../src/engine/table.ts';
import type { HandState, TableConfig } from '../../src/engine/types.ts';

type Receive = (type: string, data?: unknown) => void;

interface Post {
  type: string;
  data: unknown;
}

interface Client {
  win: Window;
  posts: Post[];
  vars: Map<string, string>;
  vibrations: unknown[];
  location: { href: string };
  /** The client sends an event. */
  send: Receive;
  /** The posts of one type, data only. */
  said: (type: string) => unknown[];
}

function client(options: { iframe?: boolean } = {}): Client {
  const posts: Post[] = [];
  const vars = new Map<string, string>();
  const vibrations: unknown[] = [];
  const location = { href: 'https://poker.romanbitca.com/' };
  const document = Object.assign(new EventTarget(), {
    visibilityState: 'visible',
    documentElement: {
      style: {
        setProperty: (name: string, value: string) => {
          vars.set(name, value);
        },
      },
    },
  });
  const page = Object.assign(new EventTarget(), {
    external: {},
    document,
    location,
    navigator: {
      vibrate: (pattern: unknown) => {
        vibrations.push(pattern);
        return true;
      },
    },
    TelegramWebviewProxy: {
      postEvent: (type: string, data: string) => {
        posts.push({ type, data: JSON.parse(data) as unknown });
      },
    },
    parent: null as unknown,
  });
  page.parent = options.iframe === true ? { postMessage: () => {} } : page;
  const win = page as unknown as Window;
  return {
    win,
    posts,
    vars,
    vibrations,
    location,
    send: (type, data) =>
      (
        win as unknown as { TelegramGameProxy_receiveEvent: Receive }
      ).TelegramGameProxy_receiveEvent(type, data),
    said: (type) => posts.filter((p) => p.type === type).map((p) => p.data),
  };
}

function fakeTimers(): Timers & { waiting: { fn: () => void; ms: number }[] } {
  const waiting: { fn: () => void; ms: number }[] = [];
  return {
    waiting,
    setTimeout: (fn, ms) => waiting.push({ fn, ms }),
    clearTimeout: () => {},
    now: () => 0,
  };
}

interface Setup extends Client {
  store: AppStore;
  timers: ReturnType<typeof fakeTimers>;
  shell: TgShell;
  dispatch: AppState['dispatch'];
}

function setup(version = '8.0', options: { iframe?: boolean } = {}): Setup {
  const c = client(options);
  const store = createAppStore();
  const timers = fakeTimers();
  const shell = createShell({
    win: c.win,
    store,
    bridge: createBridge(c.win, version),
    timers,
  });
  return { ...c, store, timers, shell, dispatch: store.getState().dispatch };
}

const names = (posts: readonly Post[]): string[] => posts.map((p) => p.type);

const BACK = 'web_app_setup_back_button';
const SWIPE = 'web_app_setup_swipe_behavior';
const CLOSING = 'web_app_setup_closing_behavior';
const HAPTIC = 'web_app_trigger_haptic_feedback';
const FELT = { color: '#0f1512' };

describe('at start (§19.7)', () => {
  it('ready and expand first, the felt`s colour, the buttons, then the questions', () => {
    const { posts } = setup('8.0');
    expect(posts).toEqual([
      { type: 'web_app_ready', data: '' },
      { type: 'web_app_expand', data: '' },
      { type: 'web_app_set_header_color', data: FELT },
      { type: 'web_app_set_background_color', data: FELT },
      { type: 'web_app_set_bottom_bar_color', data: FELT },
      { type: BACK, data: { is_visible: false } },
      { type: SWIPE, data: { allow_vertical_swipe: true } },
      { type: 'web_app_request_viewport', data: '' },
      { type: 'web_app_request_safe_area', data: '' },
      { type: 'web_app_request_content_safe_area', data: '' },
    ]);
  });

  it('never asks for fullscreen, nor applies Telegram`s theme', () => {
    const { posts } = setup('10.3');
    expect(names(posts).filter((n) => n.includes('fullscreen') || n.includes('theme'))).toEqual([]);
  });
});

describe('version gates (§19.2): never an event the client does not know', () => {
  const READY = ['web_app_ready', 'web_app_expand'];
  const HEADER = 'web_app_set_header_color';
  const BG = 'web_app_set_background_color';
  const BOTTOM = 'web_app_set_bottom_bar_color';
  const VIEWPORT = 'web_app_request_viewport';
  const SAFE = ['web_app_request_safe_area', 'web_app_request_content_safe_area'];

  it.each<[string, string[]]>([
    ['6.0', [...READY, VIEWPORT]],
    ['6.1', [...READY, BG, BACK, VIEWPORT]],
    ['6.8', [...READY, BG, BACK, VIEWPORT]], // a header colour of our own needs 6.9
    ['6.9', [...READY, HEADER, BG, BACK, VIEWPORT]],
    ['7.6', [...READY, HEADER, BG, BACK, VIEWPORT]],
    ['7.7', [...READY, HEADER, BG, BACK, SWIPE, VIEWPORT]],
    ['7.9', [...READY, HEADER, BG, BACK, SWIPE, VIEWPORT]], // 7.9 is before 7.10
    ['7.10', [...READY, HEADER, BG, BOTTOM, BACK, SWIPE, VIEWPORT]],
    ['7.12', [...READY, HEADER, BG, BOTTOM, BACK, SWIPE, VIEWPORT]],
    ['8.0', [...READY, HEADER, BG, BOTTOM, BACK, SWIPE, VIEWPORT, ...SAFE]],
    ['10.3', [...READY, HEADER, BG, BOTTOM, BACK, SWIPE, VIEWPORT, ...SAFE]],
  ])('client %s', (version, expected) => {
    expect(names(setup(version).posts)).toEqual(expected);
  });

  it('later changes respect the same gates', () => {
    const { posts, dispatch } = setup('6.0');
    const before = posts.length;
    dispatch({ type: 'go', screen: 'table' });
    expect(posts).toHaveLength(before);
  });

  it('closing confirmation needs 6.2', () => {
    const old = setup('6.1');
    old.shell.confirmClosing(true);
    expect(old.said(CLOSING)).toEqual([]);
    const known = setup('6.2');
    known.shell.confirmClosing(true);
    expect(known.said(CLOSING)).toEqual([{ need_confirmation: true }]);
  });
});

describe('the BackButton follows the navigation (§19.7)', () => {
  it('shows whenever Back can undo something, and is said only on a change', () => {
    const { said, dispatch } = setup();
    expect(said(BACK)).toEqual([{ is_visible: false }]); // Welcome: nothing below it
    dispatch({ type: 'go', screen: 'settings' });
    expect(said(BACK)).toEqual([{ is_visible: false }, { is_visible: true }]);
    dispatch({ type: 'open', overlay: 'shortcuts' });
    dispatch({ type: 'back' }); // the overlay; the screen is still above the root
    expect(said(BACK)).toHaveLength(2);
    dispatch({ type: 'back' });
    expect(said(BACK)).toEqual([
      { is_visible: false },
      { is_visible: true },
      { is_visible: false },
    ]);
  });

  it('shows for an overlay over a root screen', () => {
    const { said, dispatch } = setup();
    dispatch({ type: 'open', overlay: 'shortcuts' });
    expect(said(BACK).at(-1)).toEqual({ is_visible: true });
    dispatch({ type: 'close' });
    expect(said(BACK).at(-1)).toEqual({ is_visible: false });
  });

  it('a change that leaves the navigation alone says nothing', () => {
    const { posts, store, dispatch } = setup();
    const before = posts.length;
    dispatch({ type: 'layout', layout: 'wide' });
    store.setState({ stats: null, history: [] });
    expect(posts).toHaveLength(before);
  });

  it('its press is the app`s Back: the top overlay first, then the screen', () => {
    const { store, send, dispatch, said } = setup();
    dispatch({ type: 'go', screen: 'table' });
    dispatch({ type: 'open', overlay: 'menu' });
    expect(said(BACK).at(-1)).toEqual({ is_visible: true });
    send('back_button_pressed');
    expect(store.getState().ui.overlays).toEqual([]);
    expect(store.getState().ui.screen).toBe('table');
    expect(said(BACK).at(-1)).toEqual({ is_visible: true });
    send('back_button_pressed');
    expect(store.getState().ui.screen).toBe('home');
    expect(said(BACK).at(-1)).toEqual({ is_visible: false });
  });

  it('follows Back`s own rule: the out-of-chips dialog leaves with its screen (§3.1)', () => {
    const { store, send, dispatch } = setup();
    dispatch({ type: 'go', screen: 'table' });
    dispatch({ type: 'open', overlay: 'outOfChips' });
    send('back_button_pressed');
    expect(store.getState().ui.nav).toEqual({ screens: ['home'], overlays: [] });
  });
});

describe('vertical swipes (§19.7)', () => {
  it('off while the Table is on screen, on otherwise, said only on a change', () => {
    const { said, dispatch } = setup();
    expect(said(SWIPE)).toEqual([{ allow_vertical_swipe: true }]);
    dispatch({ type: 'go', screen: 'table' });
    expect(said(SWIPE)).toEqual([{ allow_vertical_swipe: true }, { allow_vertical_swipe: false }]);
    dispatch({ type: 'open', overlay: 'menu' }); // the Table is still under it
    dispatch({ type: 'close' });
    expect(said(SWIPE)).toHaveLength(2);
    dispatch({ type: 'go', screen: 'home' });
    expect(said(SWIPE).at(-1)).toEqual({ allow_vertical_swipe: true });
  });

  it('a Table already on screen when the shell starts turns them off at once', () => {
    const c = client();
    const store = createAppStore();
    store.getState().dispatch({ type: 'go', screen: 'table' });
    createShell({ win: c.win, store, bridge: createBridge(c.win, '8.0'), timers: fakeTimers() });
    expect(c.said(SWIPE)).toEqual([{ allow_vertical_swipe: false }]);
    expect(c.said(BACK)).toEqual([{ is_visible: true }]);
  });
});

describe('the viewport and the safe area as CSS variables (§19.7)', () => {
  const STABLE = '--tg-viewport-stable-height';

  it('keeps the height of a stable viewport only', () => {
    const { send, vars } = setup();
    send('viewport_changed', { height: 700.5, is_expanded: true, is_state_stable: false });
    expect(vars.has(STABLE)).toBe(false);
    send('viewport_changed', { height: 812, is_expanded: true, is_state_stable: true });
    expect(vars.get(STABLE)).toBe('812px');
    send('viewport_changed', { height: 400, is_expanded: true, is_state_stable: false });
    expect(vars.get(STABLE)).toBe('812px');
  });

  it('ignores a viewport that makes no sense', () => {
    const { send, vars } = setup();
    for (const data of [
      undefined,
      null,
      7,
      {},
      { height: '812', is_state_stable: true },
      { height: 0, is_state_stable: true },
      { height: -5, is_state_stable: true },
      { height: Number.NaN, is_state_stable: true },
      { height: 812, is_state_stable: 'yes' },
    ]) {
      expect(() => send('viewport_changed', data)).not.toThrow();
    }
    expect(vars.size).toBe(0);
  });

  it('the device`s insets become --tg-safe-*', () => {
    const { send, vars } = setup();
    send('safe_area_changed', { top: 47, bottom: 34, left: 0, right: 12 });
    expect(Object.fromEntries(vars)).toEqual({
      '--tg-safe-top': '47px',
      '--tg-safe-bottom': '34px',
      '--tg-safe-left': '0px',
      '--tg-safe-right': '12px',
    });
  });

  it('Telegram`s own (content) insets add to them; each kind is replaced by its next event', () => {
    const { send, vars } = setup();
    send('safe_area_changed', { top: 47, bottom: 34, left: 0, right: 0 });
    send('content_safe_area_changed', { top: 46, bottom: 0, left: 0, right: 0 });
    expect(vars.get('--tg-safe-top')).toBe('93px');
    expect(vars.get('--tg-safe-bottom')).toBe('34px');
    send('safe_area_changed', { top: 0, bottom: 20, left: 0, right: 0 });
    expect(vars.get('--tg-safe-top')).toBe('46px');
    expect(vars.get('--tg-safe-bottom')).toBe('20px');
  });

  it('a bad side counts as 0; an event with no object changes nothing', () => {
    const { send, vars } = setup();
    send('safe_area_changed', { top: 10, bottom: 20, left: 30, right: 40 });
    send('safe_area_changed', null);
    send('safe_area_changed', undefined);
    send('safe_area_changed', 'nonsense');
    expect(vars.get('--tg-safe-bottom')).toBe('20px');
    send('safe_area_changed', { top: '10', bottom: -3, left: Number.POSITIVE_INFINITY, right: 5 });
    expect(Object.fromEntries(vars)).toEqual({
      '--tg-safe-top': '0px',
      '--tg-safe-bottom': '0px',
      '--tg-safe-left': '0px',
      '--tg-safe-right': '5px',
    });
  });
});

describe('closing and the invite (§19.7)', () => {
  it('asks before closing only on request, and says each change once', () => {
    const { shell, said } = setup();
    expect(said(CLOSING)).toEqual([]); // Telegram's default: no question
    shell.confirmClosing(false);
    expect(said(CLOSING)).toEqual([]);
    shell.confirmClosing(true);
    shell.confirmClosing(true);
    expect(said(CLOSING)).toEqual([{ need_confirmation: true }]);
    shell.confirmClosing(false);
    expect(said(CLOSING)).toEqual([{ need_confirmation: true }, { need_confirmation: false }]);
  });

  const INVITE = 'https://t.me/our_bot/poker?startapp=Ab3_x-9Z';
  const WORDS = 'Join my poker table! Play money & friends';
  const PATH =
    '/share/url?url=https%3A%2F%2Ft.me%2Four_bot%2Fpoker%3Fstartapp%3DAb3_x-9Z' +
    '&text=Join%20my%20poker%20table!%20Play%20money%20%26%20friends';

  it('opens Telegram`s own share list, the link and the words encoded', () => {
    const { shell, said, location } = setup('6.1');
    shell.shareInvite(INVITE, WORDS);
    expect(said('web_app_open_tg_link')).toEqual([{ path_full: PATH }]);
    expect(location.href).toBe('https://poker.romanbitca.com/');
  });

  it('a client too old for the event opens the link itself, as the script does', () => {
    const { shell, said, location } = setup('6.0');
    shell.shareInvite(INVITE, WORDS);
    expect(said('web_app_open_tg_link')).toEqual([]);
    expect(location.href).toBe(`https://t.me${PATH}`);
  });

  it('in an iframe the event goes at any version, as the script does', () => {
    const { shell, said, location } = setup('6.0', { iframe: true });
    shell.shareInvite(INVITE, WORDS);
    expect(said('web_app_open_tg_link')).toEqual([{ path_full: PATH }]);
    expect(location.href).toBe('https://poker.romanbitca.com/');
  });
});

const SEED: Seed128 = 'c0ffee00c0ffee00c0ffee00c0ffee00';
const CONFIG: TableConfig = {
  seatCount: 3,
  sb: 10,
  bb: 20,
  startingStack: 2000,
  botLevel: 'easy',
  seatLevels: [null, null, null],
};

/** A hand just dealt (only the two blinds in its log). */
function dealt(): HandState {
  const table = createTable(CONFIG, initialSlots(CONFIG, SEED, 'You'), SEED);
  return startHand({ ...table, nextHandSeq: 1 }, deriveSeed(SEED, 'hand', 1));
}

/** The same hand, over: the hero won chips. */
const won = (h: HandState): HandState => ({
  ...h,
  phase: 'complete',
  toAct: null,
  result: {
    endedBy: 'fold',
    pots: [],
    potWinners: [],
    payouts: [0, 0, 0],
    net: [50, -50, 0],
    shown: [],
  },
});

/** The store at a hero decision on a Table on show, sound off so no synth loads. */
function heroTurn(store: AppStore, hand: HandState): void {
  store.getState().dispatch({ type: 'go', screen: 'table' });
  store.setState((s) => ({ game: { ...s.game, hand, mode: 'heroTurn' } }));
}

function silent(store: AppStore, haptics = true): void {
  store.setState((s) => ({ settings: { ...s.settings, sound: false, haptics } }));
}

const TURN = { type: 'impact', impact_style: 'light' };
const WIN = { type: 'notification', notification_type: 'success' };

describe('haptics (§19.7): the port in app/device.ts', () => {
  afterEach(() => setHapticsPort(null));

  it('the port is null on a client without haptics, and says each cue`s feedback', () => {
    expect(setup('6.0').shell.haptics).toBeNull();
    const { shell, said } = setup('6.1');
    shell.haptics?.pulse('turn', 0);
    shell.haptics?.pulse('win', 0);
    expect(said(HAPTIC)).toEqual([TURN, WIN]);
  });

  it('a later start waits on the injected timers', () => {
    const { shell, said, timers } = setup();
    shell.haptics?.pulse('turn', 210);
    expect(said(HAPTIC)).toEqual([]);
    expect(timers.waiting.map((t) => t.ms)).toEqual([210]);
    timers.waiting[0]?.fn();
    expect(said(HAPTIC)).toEqual([TURN]);
  });

  it('a cue with no haptic says nothing', () => {
    const { shell, said, timers } = setup();
    shell.haptics?.pulse('deal', 40);
    shell.haptics?.pulse('chip', 0);
    expect(said(HAPTIC)).toEqual([]);
    expect(timers.waiting).toEqual([]);
  });

  it('inside Telegram a store change reaches the client, in place of navigator.vibrate', () => {
    const t = setup();
    silent(t.store);
    const off = installDevice(t.win, t.store);
    setHapticsPort(t.shell.haptics);
    const hand = dealt();
    heroTurn(t.store, hand);
    // After the deal's two sounds: the same moment the vibration's pattern would start.
    expect(t.timers.waiting.map((w) => w.ms)).toEqual([210]);
    t.timers.waiting[0]?.fn();
    expect(t.said(HAPTIC)).toEqual([TURN]);
    t.store.setState((s) => ({ game: { ...s.game, hand: won(hand), mode: 'handEnd' } }));
    expect(t.said(HAPTIC)).toEqual([TURN, WIN]);
    expect(t.vibrations).toEqual([]);
    off();
  });

  it('the port may arrive before the device chunk (two lazy chunks)', () => {
    const t = setup();
    silent(t.store);
    setHapticsPort(t.shell.haptics);
    const off = installDevice(t.win, t.store);
    heroTurn(t.store, dealt());
    expect(t.timers.waiting.map((w) => w.ms)).toEqual([210]);
    expect(t.vibrations).toEqual([]);
    off();
  });

  it('the Vibration setting still rules', () => {
    const t = setup();
    silent(t.store, false);
    const off = installDevice(t.win, t.store);
    setHapticsPort(t.shell.haptics);
    heroTurn(t.store, dealt());
    expect(t.timers.waiting).toEqual([]);
    expect(t.said(HAPTIC)).toEqual([]);
    expect(t.vibrations).toEqual([]);
    off();
  });

  it('without the port navigator.vibrate works as before', () => {
    const t = setup();
    silent(t.store);
    const off = installDevice(t.win, t.store);
    heroTurn(t.store, dealt());
    expect(t.vibrations).toEqual([[0, 210, 10]]);
    expect(t.said(HAPTIC)).toEqual([]);
    off();
  });
});

describe('startTelegram (§19.7)', () => {
  afterEach(() => setHapticsPort(null));

  const LAUNCH = { initData: 'a=1', platform: 'ios', startParam: null };

  function start(version: string) {
    const c = client();
    const store = createAppStore();
    silent(store);
    const timers = fakeTimers();
    const shell = startTelegram({
      win: c.win,
      store,
      controller: {} as TableController,
      launch: { ...LAUNCH, version },
      timers,
    });
    return { ...c, store, shell, timers };
  }

  it('connects to the client at the launch`s version and returns the shell', () => {
    const { posts, send, store, shell } = start('8.0');
    expect(names(posts).slice(0, 2)).toEqual(['web_app_ready', 'web_app_expand']);
    expect(names(posts)).toContain('web_app_request_safe_area');
    store.getState().dispatch({ type: 'go', screen: 'settings' });
    send('back_button_pressed');
    expect(store.getState().ui.screen).toBe('welcome');
    expect(typeof shell.shareInvite).toBe('function');
  });

  it('gives the cues Telegram`s haptics', () => {
    const t = start('8.0');
    const off = installDevice(t.win, t.store);
    heroTurn(t.store, dealt());
    t.timers.waiting[0]?.fn();
    expect(t.said(HAPTIC)).toEqual([TURN]);
    expect(t.vibrations).toEqual([]);
    off();
  });

  it('a client without haptics keeps navigator.vibrate', () => {
    const t = start('6.0');
    const off = installDevice(t.win, t.store);
    heroTurn(t.store, dealt());
    expect(t.said(HAPTIC)).toEqual([]);
    expect(t.vibrations).toEqual([[0, 210, 10]]);
    off();
  });
});
