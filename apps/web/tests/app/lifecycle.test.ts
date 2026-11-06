// @vitest-environment jsdom
/**
 * The page lifecycle (PLAN §12.1, §12.3, §12.13, pitfall 29): Android Back / browser back closes
 * the top overlay first and never exits the table; visibility closes and reopens the `hidden` gate;
 * the layout queries feed `ui.layout`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTableController, TIMING } from '../../src/app/controller.ts';
import {
  canGoBack,
  installBackHandler,
  installEnv,
  installLayout,
  installVisibility,
  isIos,
  LAYOUT_QUERIES,
  layoutFor,
} from '../../src/app/lifecycle.ts';
import { createAppStore, type AppStore } from '../../src/app/store.ts';
import { testBrain } from '../workers/fakeBrainWorker.ts';

let off: (() => void)[] = [];
afterEach(() => {
  for (const f of off) f();
  off = [];
  vi.useRealTimers();
});

/** A popstate as the browser fires it after Back: the entry below the guard has no guard state. */
const pressBack = (): void => {
  window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
};

describe('Back (§12.1): the top overlay first, never out of the table', () => {
  let store: AppStore;
  let pushes: number;
  beforeEach(() => {
    window.history.replaceState(null, ''); // each test starts on a plain entry
    store = createAppStore();
    pushes = 0;
    const push = window.history.pushState.bind(window.history);
    vi.spyOn(window.history, 'pushState').mockImplementation((...args) => {
      pushes++;
      push(...args);
    });
    off.push(() => vi.restoreAllMocks());
    off.push(installBackHandler(window, store));
  });

  it('puts one guard entry on top while something can be closed, and none at a root screen', () => {
    expect(pushes).toBe(0);
    store.getState().dispatch({ type: 'go', screen: 'home' });
    expect(pushes).toBe(0);
    store.getState().dispatch({ type: 'go', screen: 'table' });
    expect(pushes).toBe(1);
    store.getState().dispatch({ type: 'open', overlay: 'menu' });
    store.getState().dispatch({ type: 'open', overlay: 'rankings' });
    expect(pushes).toBe(1); // still one guard
    expect(window.history.state).toEqual({ pc: 'back-guard' });
  });

  it('Back with the sizing tray open closes the tray, then Home, then leaves the app (Stage 3 acceptance 8)', () => {
    store.getState().dispatch({ type: 'go', screen: 'home' });
    store.getState().dispatch({ type: 'go', screen: 'table' });
    store.getState().dispatch({ type: 'open', overlay: 'tray' });
    pressBack();
    expect(store.getState().ui).toMatchObject({ screen: 'table', overlays: [] });
    expect(pushes).toBe(2); // the guard is back: the table still has Home below it
    pressBack();
    expect(store.getState().ui.nav).toEqual({ screens: ['home'], overlays: [] });
    expect(pushes).toBe(2); // Home is a root: the next Back is the browser's own
  });

  it('closes the drawer before the menu (top-most first)', () => {
    store.getState().dispatch({ type: 'go', screen: 'table' });
    store.getState().dispatch({ type: 'open', overlay: 'menu' });
    store.getState().dispatch({ type: 'open', overlay: 'rankings' });
    pressBack();
    expect(store.getState().ui.overlays).toEqual(['menu']);
    pressBack();
    expect(store.getState().ui.overlays).toEqual([]);
    expect(store.getState().ui.screen).toBe('table');
  });

  it('a forward move onto a guard entry closes nothing', () => {
    store.getState().dispatch({ type: 'go', screen: 'table' });
    store.getState().dispatch({ type: 'open', overlay: 'menu' });
    window.dispatchEvent(new PopStateEvent('popstate', { state: { pc: 'back-guard' } }));
    expect(store.getState().ui.overlays).toEqual(['menu']);
  });

  it('canGoBack: an overlay, or a screen with one below it', () => {
    expect(canGoBack({ screens: ['home'], overlays: [] })).toBe(false);
    expect(canGoBack({ screens: ['home'], overlays: ['tray'] })).toBe(true);
    expect(canGoBack({ screens: ['home', 'table'], overlays: [] })).toBe(true);
  });
});

describe('visibility (§12.13)', () => {
  const setVisibility = (state: 'hidden' | 'visible'): void => {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  };

  it('hidden closes the gate at once; visible reopens it after 300 ms (the controller times it)', () => {
    vi.useFakeTimers();
    const store = createAppStore();
    const controller = createTableController({
      store,
      brain: testBrain(),
      heroName: 'You',
    });
    controller.boot();
    off.push(() => controller.dispose());
    off.push(installVisibility(window, store));
    setVisibility('hidden');
    expect(store.getState().ui.hidden).toBe(true);
    setVisibility('visible');
    vi.advanceTimersByTime(TIMING.resumeAfterVisibleMs - 1);
    expect(store.getState().ui.hidden).toBe(true);
    vi.advanceTimersByTime(1);
    expect(store.getState().ui.hidden).toBe(false);
  });

  it('pagehide is sent to the controller', () => {
    const store = createAppStore();
    const handler = vi.fn();
    store.setGameHandler(handler);
    off.push(installVisibility(window, store));
    window.dispatchEvent(new Event('pagehide'));
    expect(handler).toHaveBeenCalledWith({ type: 'pagehide' });
  });
});

describe('layout (§12.3)', () => {
  it('wide first, then landscape, else portrait', () => {
    const only = (q: string) => (query: string) => query === q;
    expect(layoutFor(only(LAYOUT_QUERIES.wide))).toBe('wide');
    expect(layoutFor(() => true)).toBe('wide');
    expect(layoutFor(only(LAYOUT_QUERIES.landscape))).toBe('landscape');
    expect(layoutFor(() => false)).toBe('portrait');
  });

  it('follows matchMedia changes into ui.layout', () => {
    const matches = new Set<string>();
    const listeners: (() => void)[] = [];
    const win = {
      matchMedia: (query: string) => ({
        get matches() {
          return matches.has(query);
        },
        addEventListener: (_: string, f: () => void) => listeners.push(f),
        removeEventListener: () => {},
      }),
    } as unknown as Window;
    const store = createAppStore();
    off.push(installLayout(win, store));
    expect(store.getState().ui.layout).toBe('portrait');
    matches.add(LAYOUT_QUERIES.landscape);
    for (const f of listeners) f();
    expect(store.getState().ui.layout).toBe('landscape');
    matches.add(LAYOUT_QUERIES.wide);
    for (const f of listeners) f();
    expect(store.getState().ui.layout).toBe('wide');
  });

  it('does nothing without matchMedia', () => {
    const store = createAppStore();
    off.push(installLayout({} as Window, store));
    expect(store.getState().ui.layout).toBe('portrait');
  });
});

describe('installing (§12.13, chunk 8.4)', () => {
  /** A page with an event target, a navigator and a secure flag. */
  function page(navigator: Partial<Navigator>, secure = true) {
    const target = new EventTarget();
    const win = Object.assign(target, { navigator, isSecureContext: secure }) as unknown as Window;
    return win;
  }

  /** Chrome's `beforeinstallprompt`, answered with `outcome`. */
  function offer(outcome: 'accepted' | 'dismissed', refuse = false) {
    const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: string }>;
      prompted: number;
    };
    e.prompted = 0;
    e.prompt = () => {
      e.prompted++;
      return refuse ? Promise.reject(new DOMException('no', 'NotAllowedError')) : Promise.resolve();
    };
    e.userChoice = Promise.resolve({ outcome });
    return e;
  }

  it('iOS and iPadOS: by the user agent, iPadOS by a Mac with touch', () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15';
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
    expect(isIos(page({ userAgent: iphone, maxTouchPoints: 5 }))).toBe(true);
    expect(isIos(page({ userAgent: mac, maxTouchPoints: 5 }))).toBe(true);
    expect(isIos(page({ userAgent: mac, maxTouchPoints: 0 }))).toBe(false);
    expect(isIos(page({ userAgent: 'Mozilla/5.0 (Linux; Android 15)', maxTouchPoints: 5 }))).toBe(
      false,
    );
    expect(isIos({} as Window)).toBe(false); // no navigator: never throws
  });

  it('keeps Chrome`s offer for the Install tap; the dialog opens once, and says whether it installed', async () => {
    const win = page({ userAgent: 'Android', maxTouchPoints: 5 });
    const env = installEnv(win);
    const changes = vi.fn();
    env.listen(changes);
    expect(env).toMatchObject({ ios: false, secure: true });
    expect(env.ready()).toBe(false);
    expect(env.prompt()).toBeNull();
    const e = offer('accepted');
    win.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true); // the browser's own mini banner waits for our tile
    expect(env.ready()).toBe(true);
    expect(changes).toHaveBeenCalledTimes(1);
    const asked = env.prompt();
    expect(e.prompted).toBe(1);
    expect(env.ready()).toBe(false); // used once
    expect(await asked).toBe(true);
    expect(env.prompt()).toBeNull();
  });

  it('a dismissed or refused dialog is "not installed"; appinstalled ends the offer', async () => {
    const win = page({ userAgent: 'Android', maxTouchPoints: 5 }, false);
    const env = installEnv(win);
    expect(env.secure).toBe(false);
    win.dispatchEvent(offer('dismissed'));
    expect(await env.prompt()).toBe(false);
    win.dispatchEvent(offer('accepted', true));
    expect(await env.prompt()).toBe(false);
    win.dispatchEvent(offer('accepted'));
    win.dispatchEvent(new Event('appinstalled'));
    expect(env.ready()).toBe(false);
  });
});
