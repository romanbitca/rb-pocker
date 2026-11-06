/**
 * Keep the screen on while a hand runs (PLAN §12.13 "Wake lock", §12.14; chunk 9.1), on a stand-in
 * `navigator.wakeLock` and document: asked for at the Table while a hand runs and the page is
 * visible, released on Home, at the out-of-chips dialog and with the setting off; asked again
 * after the page was hidden; skipped where the API is missing (plain http); a refusal is shown
 * nowhere and not asked again at every store change. The last test runs the real controller.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadDevice } from '../../src/app/lifecycle.ts';
import { createAppStore, type AppStore, type ControllerMode } from '../../src/app/store.ts';
import {
  installWakeLock,
  wakeLockOf,
  wantsWakeLock,
  type WakeLockSentinelLike,
} from '../../src/app/wakeLock.ts';
import { flush, makeHarness, tick } from './harness.ts';

class FakeSentinel extends EventTarget implements WakeLockSentinelLike {
  released = false;
  releases = 0;
  release(): Promise<void> {
    this.releases++;
    if (!this.released) {
      this.released = true;
      this.dispatchEvent(new Event('release'));
    }
    return Promise.resolve();
  }
  /** The browser lets it go (the page was hidden). */
  drop(): void {
    this.released = true;
    this.dispatchEvent(new Event('release'));
  }
}

interface FakeLock {
  request: (type: 'screen') => Promise<WakeLockSentinelLike>;
  asked: string[];
  sentinels: FakeSentinel[];
  /** How the next requests answer. */
  mode: 'grant' | 'refuse' | 'hold' | 'throw';
  /** The requests held by 'hold', answered by the test. */
  held: ((s: FakeSentinel) => void)[];
}

function fakeLock(): FakeLock {
  const lock: FakeLock = {
    asked: [],
    sentinels: [],
    mode: 'grant',
    held: [],
    request(type) {
      lock.asked.push(type);
      if (lock.mode === 'throw') throw new TypeError('not allowed here');
      if (lock.mode === 'refuse') return Promise.reject(new Error('NotAllowedError'));
      const sentinel = new FakeSentinel();
      lock.sentinels.push(sentinel);
      if (lock.mode === 'hold') return new Promise((resolve) => lock.held.push(resolve));
      return Promise.resolve(sentinel);
    },
  };
  return lock;
}

interface FakePage {
  win: Window;
  doc: EventTarget & { visibilityState: 'visible' | 'hidden' };
  setVisible(visible: boolean): void;
}

function fakePage(navigator: unknown): FakePage {
  const doc = Object.assign(new EventTarget(), {
    visibilityState: 'visible' as const,
  }) as FakePage['doc'];
  const win = { navigator, document: doc } as unknown as Window;
  return {
    win,
    doc,
    setVisible(visible) {
      doc.visibilityState = visible ? 'visible' : 'hidden';
      doc.dispatchEvent(new Event('visibilitychange'));
    },
  };
}

/** The store at `screen` with the controller in `mode`. */
function put(store: AppStore, screen: 'home' | 'table' | 'settings', mode: ControllerMode): void {
  store.getState().dispatch({ type: 'go', screen });
  store.setState((s) => ({ game: { ...s.game, mode } }));
}

const held = (lock: FakeLock): FakeSentinel[] => lock.sentinels.filter((s) => !s.released);

describe('wantsWakeLock (§12.13)', () => {
  it('the setting on, the Table on screen and a hand running', () => {
    const store = createAppStore();
    const wants = (screen: 'home' | 'table' | 'settings' | 'review', mode: ControllerMode) => {
      store.getState().dispatch({ type: 'go', screen });
      store.setState((s) => ({ game: { ...s.game, mode } }));
      return wantsWakeLock(store.getState());
    };
    for (const mode of [
      'botTurn',
      'heroTurn',
      'grading',
      'feedback',
      'advancing',
      'handEnd',
    ] as const) {
      expect(wants('table', mode), mode).toBe(true);
    }
    expect(wants('table', 'idle')).toBe(false); // no hand: the out-of-chips dialog
    expect(wants('table', 'booting')).toBe(false);
    expect(wants('home', 'heroTurn')).toBe(false);
    expect(wants('settings', 'heroTurn')).toBe(false);
    expect(wants('review', 'handEnd')).toBe(false);
    wants('table', 'heroTurn');
    store.setState((s) => ({ settings: { ...s.settings, keepAwake: false } }));
    expect(wantsWakeLock(store.getState())).toBe(false);
  });

  it('wakeLockOf: only an object with request(); never throws', () => {
    const lock = { request: () => Promise.reject(new Error('x')) };
    expect(wakeLockOf({ wakeLock: lock })).toBe(lock);
    expect(wakeLockOf({})).toBeNull();
    expect(wakeLockOf(undefined)).toBeNull();
    expect(wakeLockOf({ wakeLock: {} })).toBeNull();
    expect(
      wakeLockOf(
        Object.defineProperty({}, 'wakeLock', {
          get() {
            throw new Error('insecure');
          },
        }),
      ),
    ).toBeNull();
  });
});

describe('installWakeLock (§12.13)', () => {
  let store: AppStore;
  let lock: FakeLock;
  let page: FakePage;
  let off: () => void;
  beforeEach(() => {
    store = createAppStore();
    lock = fakeLock();
    page = fakePage({ wakeLock: lock });
    put(store, 'home', 'idle');
    off = installWakeLock(page.win, store);
  });
  afterEach(() => off());

  it('asked for when a hand runs at the Table, once; released on Home; asked again back at the Table', async () => {
    expect(lock.asked).toEqual([]);
    put(store, 'table', 'heroTurn');
    expect(lock.asked).toEqual(['screen']);
    await flush();
    store.setState((s) => ({ game: { ...s.game, mode: 'botTurn' } }));
    store.setState((s) => ({ game: { ...s.game, mode: 'advancing' } }));
    expect(lock.asked).toHaveLength(1);
    expect(held(lock)).toHaveLength(1);

    put(store, 'home', 'heroTurn');
    expect(held(lock)).toHaveLength(0);
    expect(lock.sentinels[0]?.releases).toBe(1);

    put(store, 'table', 'heroTurn');
    await flush();
    expect(lock.asked).toHaveLength(2);
    expect(held(lock)).toHaveLength(1);
  });

  it('released at the out-of-chips dialog (no hand runs) and on another screen (Settings)', async () => {
    put(store, 'table', 'handEnd');
    await flush();
    expect(held(lock)).toHaveLength(1);
    store.setState((s) => ({ game: { ...s.game, mode: 'idle' } }));
    expect(held(lock)).toHaveLength(0);
    store.setState((s) => ({ game: { ...s.game, mode: 'botTurn' } }));
    await flush();
    expect(held(lock)).toHaveLength(1);
    put(store, 'settings', 'botTurn');
    expect(held(lock)).toHaveLength(0);
  });

  it('follows the setting', async () => {
    put(store, 'table', 'botTurn');
    await flush();
    store.setState((s) => ({ settings: { ...s.settings, keepAwake: false } }));
    expect(held(lock)).toHaveLength(0);
    store.setState((s) => ({ settings: { ...s.settings, keepAwake: true } }));
    await flush();
    expect(held(lock)).toHaveLength(1);
    expect(lock.asked).toHaveLength(2);
  });

  it('hidden: the browser lets it go; visible: asked again (not while hidden)', async () => {
    put(store, 'table', 'heroTurn');
    await flush();
    lock.sentinels[0]?.drop();
    page.setVisible(false);
    store.setState((s) => ({ game: { ...s.game, mode: 'botTurn' } }));
    expect(lock.asked).toHaveLength(1);
    page.setVisible(true);
    expect(lock.asked).toHaveLength(2);
    await flush();
    expect(held(lock)).toHaveLength(1);
  });

  it('a lock that comes after the hand left the Table is let go at once', async () => {
    lock.mode = 'hold';
    put(store, 'table', 'heroTurn');
    put(store, 'home', 'heroTurn');
    lock.held[0]?.(lock.sentinels[0] as FakeSentinel);
    await flush();
    expect(lock.sentinels[0]?.releases).toBe(1);
    expect(held(lock)).toHaveLength(0);
  });

  it('a lock that comes already released (hidden meanwhile) is asked again when visible', async () => {
    lock.mode = 'hold';
    put(store, 'table', 'heroTurn');
    (lock.sentinels[0] as FakeSentinel).released = true;
    lock.held[0]?.(lock.sentinels[0] as FakeSentinel);
    await flush();
    lock.mode = 'grant';
    page.setVisible(true);
    await flush();
    expect(lock.asked).toHaveLength(2);
    expect(held(lock)).toHaveLength(1);
  });

  it('refused: shown nowhere, not asked at every change, asked again after a change of page or wish', async () => {
    lock.mode = 'refuse';
    put(store, 'table', 'heroTurn');
    await flush();
    for (const mode of ['botTurn', 'advancing', 'heroTurn'] as const) {
      store.setState((s) => ({ game: { ...s.game, mode } }));
    }
    expect(lock.asked).toHaveLength(1);
    lock.mode = 'grant';
    page.setVisible(false);
    page.setVisible(true);
    await flush();
    expect(lock.asked).toHaveLength(2);
    expect(held(lock)).toHaveLength(1);
  });

  it('a request that throws counts as refused', async () => {
    lock.mode = 'throw';
    expect(() => put(store, 'table', 'heroTurn')).not.toThrow();
    store.setState((s) => ({ game: { ...s.game, mode: 'botTurn' } }));
    expect(lock.asked).toHaveLength(1);
    lock.mode = 'grant';
    put(store, 'home', 'idle');
    put(store, 'table', 'heroTurn');
    await flush();
    expect(held(lock)).toHaveLength(1);
  });

  it('uninstall releases it and asks for nothing more', async () => {
    put(store, 'table', 'heroTurn');
    await flush();
    off();
    expect(held(lock)).toHaveLength(0);
    store.setState((s) => ({ game: { ...s.game, mode: 'botTurn' } }));
    page.setVisible(true);
    expect(lock.asked).toHaveLength(1);
    off = () => {};
  });
});

describe('missing wake lock (§12.14: plain http, older browsers)', () => {
  it('is skipped: nothing asked, nothing thrown', () => {
    const store = createAppStore();
    const page = fakePage({});
    const off = installWakeLock(page.win, store);
    expect(() => put(store, 'table', 'heroTurn')).not.toThrow();
    off();
  });
});

describe('loadDevice (app/lifecycle.ts): the lazy device chunk', () => {
  it('installs the wake lock (and the cues) once the chunk is loaded; uninstall stops it', async () => {
    const store = createAppStore();
    const lock = fakeLock();
    const page = fakePage({ wakeLock: lock });
    Object.assign(page.win, { addEventListener: () => {}, removeEventListener: () => {} });
    const off = loadDevice(page.win, store);
    await vi.dynamicImportSettled();
    put(store, 'table', 'heroTurn');
    expect(lock.asked).toEqual(['screen']);
    await flush();
    off();
    expect(held(lock)).toHaveLength(0);
  });

  it('an uninstall before the chunk arrives installs nothing', async () => {
    const store = createAppStore();
    const lock = fakeLock();
    const page = fakePage({ wakeLock: lock });
    Object.assign(page.win, { addEventListener: () => {}, removeEventListener: () => {} });
    loadDevice(page.win, store)();
    await vi.dynamicImportSettled();
    put(store, 'table', 'heroTurn');
    expect(lock.asked).toEqual([]);
  });
});

describe('with the real controller', () => {
  it('held through hands at the table, released on Leave table', async () => {
    vi.useFakeTimers();
    const h = makeHarness({ settings: { players: 3, speed: 'fast', autoNext: true } });
    const lock = fakeLock();
    const page = fakePage({ wakeLock: lock });
    const off = installWakeLock(page.win, h.store);
    try {
      h.dispatch({ type: 'go', screen: 'home' });
      h.dispatch({ type: 'play' });
      await flush();
      expect(held(lock)).toHaveLength(1);
      // Two hands go by (the hero checks or calls): the one lock stays.
      for (let i = 0; i < 400 && (h.state().game.hand?.handSeq ?? 0) < 3; i++) {
        const s = h.state();
        if (s.game.mode === 'heroTurn' && s.game.legal !== null) {
          const action = s.game.legal.canCheck ? 'check' : 'call';
          h.dispatch({ type: 'act', action: { type: action } });
        } else {
          await tick();
        }
      }
      expect(h.state().game.hand?.handSeq).toBe(3);
      expect(lock.asked).toHaveLength(1);
      expect(held(lock)).toHaveLength(1);
      h.dispatch({ type: 'leaveTable' });
      expect(h.state().ui.screen).toBe('home');
      expect(held(lock)).toHaveLength(0);
    } finally {
      off();
      h.controller.dispose();
      vi.useRealTimers();
    }
  });
});
