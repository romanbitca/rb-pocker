// @vitest-environment jsdom
/**
 * The page lifecycle (PLAN §12.1, §12.3, §12.13, pitfall 29): Android Back / browser back closes
 * the top overlay first and never exits the table; visibility closes and reopens the `hidden` gate;
 * the layout queries feed `ui.layout`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSimpleBrain } from '../../src/app/brain.ts';
import { createTableController, TIMING } from '../../src/app/controller.ts';
import {
  canGoBack,
  installBackHandler,
  installLayout,
  installVisibility,
  LAYOUT_QUERIES,
  layoutFor,
} from '../../src/app/lifecycle.ts';
import { createAppStore, type AppStore } from '../../src/app/store.ts';

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
      brain: createSimpleBrain(),
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
