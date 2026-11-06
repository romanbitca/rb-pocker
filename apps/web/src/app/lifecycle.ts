/**
 * The page around the game (PLAN §12.1, §12.3, §12.13): it turns browser events into commands.
 * No timers here (§0.3): the controller owns the 300 ms "resume after visible" wait.
 *
 * - Visibility: `visibilitychange` → `{ type: 'visibility' }` (the controller closes the `hidden`
 *   gate at once and reopens it 300 ms after the page is visible); `pagehide` → `{ type: 'pagehide' }`.
 * - Back (§12.1, pitfall 29): Android's back gesture, the browser's back button and iOS's edge
 *   swipe all arrive as `popstate`. While anything can be closed (an overlay, or a screen above a
 *   root screen) one extra history entry, the guard, sits on top of ours; Back pops it, and we
 *   dispatch `{ type: 'back' }`: the store closes the top-most overlay (the sizing tray too), else
 *   goes back one screen. The guard comes back while more can be closed. So Back never exits the
 *   table while an overlay is open, and never leaves the app from a screen that has one below it.
 *   The URL never changes. Closing an overlay from the UI (✕, scrim, Esc) does not touch history:
 *   the guard stays, and a later Back with nothing left to close does nothing once.
 * - Layout (§12.3): the three media queries → `{ type: 'layout' }` (`ui.layout` mirrors the CSS).
 */
import { historyDepth, type Nav } from './navigation.ts';
import type { AppStore, Layout } from './store.ts';

/** §12.3 layout queries; the first match wins, `portrait` is everything else. */
export const LAYOUT_QUERIES = {
  wide: '(min-width: 900px) and (min-height: 560px)',
  landscape: '(orientation: landscape) and (max-height: 559px)',
} as const;

/** The layout for a `matches(query)` function (e.g. `(q) => matchMedia(q).matches`). */
export function layoutFor(matches: (query: string) => boolean): Layout {
  if (matches(LAYOUT_QUERIES.wide)) return 'wide';
  if (matches(LAYOUT_QUERIES.landscape)) return 'landscape';
  return 'portrait';
}

/** Something that Back can undo: an overlay, or a screen with one below it (app/navigation.ts). */
export function canGoBack(nav: Nav): boolean {
  return historyDepth(nav) > 0;
}

/** The history state of the guard entry. */
const GUARD = { pc: 'back-guard' } as const;

const isGuard = (state: unknown): boolean =>
  typeof state === 'object' && state !== null && (state as { pc?: unknown }).pc === GUARD.pc;

/** Android Back / browser back → `{ type: 'back' }` (see the module comment). Returns an uninstall. */
export function installBackHandler(win: Window, store: AppStore): () => void {
  let guarded = isGuard(win.history.state);
  const sync = (): void => {
    if (guarded || !canGoBack(store.getState().ui.nav)) return;
    win.history.pushState(GUARD, '');
    guarded = true;
  };
  const onPopState = (event: PopStateEvent): void => {
    if (isGuard(event.state)) {
      // Forward onto a guard entry: nothing to close.
      guarded = true;
      return;
    }
    guarded = false;
    store.getState().dispatch({ type: 'back' });
    sync();
  };
  win.addEventListener('popstate', onPopState);
  const unsubscribe = store.subscribe((s, prev) => {
    if (s.ui.nav !== prev.ui.nav) sync();
  });
  sync();
  return () => {
    win.removeEventListener('popstate', onPopState);
    unsubscribe();
  };
}

/** `visibilitychange` and `pagehide` → commands. Returns an uninstall. */
export function installVisibility(win: Window, store: AppStore): () => void {
  const doc = win.document;
  const onVisibility = (): void =>
    store.getState().dispatch({ type: 'visibility', hidden: doc.visibilityState === 'hidden' });
  const onPageHide = (): void => store.getState().dispatch({ type: 'pagehide' });
  doc.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('pagehide', onPageHide);
  // Opened in a background tab: the gate starts closed.
  if (doc.visibilityState === 'hidden') onVisibility();
  return () => {
    doc.removeEventListener('visibilitychange', onVisibility);
    win.removeEventListener('pagehide', onPageHide);
  };
}

/** The §12.3 media queries → `ui.layout`. Returns an uninstall (a no-op without `matchMedia`). */
export function installLayout(win: Window, store: AppStore): () => void {
  if (typeof win.matchMedia !== 'function') return () => {};
  const lists = Object.values(LAYOUT_QUERIES).map((q) => win.matchMedia(q));
  const update = (): void =>
    store.getState().dispatch({
      type: 'layout',
      layout: layoutFor((q) => win.matchMedia(q).matches),
    });
  for (const list of lists) list.addEventListener('change', update);
  update();
  return () => {
    for (const list of lists) list.removeEventListener('change', update);
  };
}

/**
 * Launched from the Home Screen (§12.13 "Installed"): `display-mode: standalone`, or iOS's
 * `navigator.standalone`. Never throws.
 */
export function isStandalone(win: Window): boolean {
  try {
    if (win.matchMedia?.('(display-mode: standalone)').matches === true) return true;
    return (win.navigator as { standalone?: unknown }).standalone === true;
  } catch {
    return false;
  }
}

/**
 * `navigator.storage` where it can `persist()` (secure pages only, §12.14), else null. Never
 * throws (some private modes throw on `navigator.storage`). The same test as `app/secure.ts`
 * `persistentStorage`, kept here: boot importing `secure.ts` splits the entry chunk (pitfall 47).
 */
export function storageManagerOf(
  win: Window,
): Pick<StorageManager, 'persist' | 'persisted'> | null {
  try {
    const storage = win.navigator.storage as StorageManager | undefined;
    return typeof storage?.persist === 'function' && typeof storage.persisted === 'function'
      ? storage
      : null;
  } catch {
    return null;
  }
}

/** Chrome's `beforeinstallprompt` event (not in the DOM types). */
interface InstallOffer extends Event {
  prompt(): Promise<unknown>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** What the controller needs to offer installing (§12.13 "Install", chunk 8.4). */
export interface InstallEnv {
  /** iOS or iPadOS: no install prompt there; the one-time Share tip instead. */
  readonly ios: boolean;
  /** https or http://localhost: installing needs it (never a plain-http LAN address, §12.14). */
  readonly secure: boolean;
  /** The browser offers installing now (it fired `beforeinstallprompt`). */
  ready(): boolean;
  /** `onChange` runs when `ready()` changes. */
  listen(onChange: () => void): void;
  /**
   * The browser's install dialog. Call it inside the tap (a user activation). Resolves true when
   * the app was installed; null when the browser does not offer it (an offer is used once).
   */
  prompt(): Promise<boolean> | null;
}

/**
 * iPhone, iPod or iPad (iPadOS says "Macintosh", with touch). Never throws. The Share tip is the
 * only way to install there (§12.13).
 */
export function isIos(win: Window): boolean {
  try {
    const nav = win.navigator;
    return (
      /iPhone|iPad|iPod/.test(nav.userAgent) ||
      (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1)
    );
  } catch {
    return false;
  }
}

/**
 * Keeps the browser's install offer (§12.13): Chrome fires `beforeinstallprompt` when the app can
 * be installed (secure pages with the manifest and the service worker only); the default mini
 * banner is held back and the offer waits for "Install app". `appinstalled` ends it.
 */
export function installEnv(win: Window): InstallEnv {
  let offer: InstallOffer | null = null;
  let changed = (): void => {};
  const set = (next: InstallOffer | null): void => {
    offer = next;
    changed();
  };
  win.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    set(e as InstallOffer);
  });
  win.addEventListener('appinstalled', () => set(null));
  return {
    ios: isIos(win),
    secure: win.isSecureContext === true,
    ready: () => offer !== null,
    listen: (onChange) => {
      changed = onChange;
    },
    prompt: () => {
      const e = offer;
      if (e === null) return null;
      set(null);
      // `prompt()` rejects when the browser refuses (no user activation, used twice): not installed.
      try {
        return e.prompt().then(
          () => e.userChoice.then((choice) => choice.outcome === 'accepted'),
          () => false,
        );
      } catch {
        return Promise.resolve(false);
      }
    },
  };
}

/** Everything above; returns one uninstall. */
export function installLifecycle(win: Window, store: AppStore): () => void {
  const off = [
    installVisibility(win, store),
    installBackHandler(win, store),
    installLayout(win, store),
  ];
  return () => {
    for (const f of off) f();
  };
}
