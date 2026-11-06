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
 * - Sounds, vibration and the screen wake lock (§12.8, §12.13): `app/device.ts`, a lazy chunk
 *   asked for at boot (`loadDevice`), so the initial bundle does not carry them (§15.3).
 * - New versions (§15.1, chunk 9.5): `updateMayReload` says when a waiting version may reload the
 *   page (the controller decides; the service worker itself is `app/swUpdate.ts`, a lazy chunk),
 *   and `serviceWorkerOf` whether the page has service workers at all. `watchStaleChunks`: a lazy
 *   chunk gone from the server after a redeploy (§15.1 "Redeploys") is a new version too.
 */
import { historyDepth, type Nav, type Overlay, type Screen } from './navigation.ts';
import type { AppStore, Layout, TabMode } from './store.ts';

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

/**
 * Sounds, vibration and the screen wake lock (§12.8, §12.13, chunk 9.1): `app/device.ts` is a
 * lazy chunk, asked for here at boot. It arrives in a few milliseconds, long before a person can
 * tap Play, and none of it is needed before the Table. If it cannot load (the network went away
 * before the service worker cached it), the game plays on without them. Returns an uninstall.
 */
export function loadDevice(win: Window, store: AppStore): () => void {
  let off: (() => void) | null = null;
  let live = true;
  import('./device.ts').then(
    (device) => {
      if (live) off = device.installDevice(win, store);
    },
    () => {},
  );
  return () => {
    live = false;
    off?.();
    off = null;
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

/**
 * `navigator.serviceWorker`, or null: an insecure page (a phone on a plain-http LAN address,
 * §12.14), an old browser, or a getter that throws. Kept here, not in the lazy `swUpdate.ts`,
 * because boot asks before it loads that chunk.
 */
export function serviceWorkerOf(win: Window): ServiceWorkerContainer | null {
  try {
    const container = (win.navigator as { serviceWorker?: unknown }).serviceWorker;
    return typeof container === 'object' &&
      container !== null &&
      typeof (container as { register?: unknown }).register === 'function'
      ? (container as ServiceWorkerContainer)
      : null;
  } catch {
    return null;
  }
}

/** sessionStorage: the chunk a reload was last asked for, and when (`watchStaleChunks`). */
export const STALE_RELOAD_KEY = 'pc.staleReload';
/** No second stale reload within this time of the note, whatever chunk fails (§15.1): no loop. */
export const STALE_RELOAD_GUARD_MS = 600_000;

/**
 * §15.1 "Redeploys": a new container no longer has the old hashed chunks, so a page that runs the
 * old version (no service worker: an insecure page or a first visit; or one whose worker another
 * tab replaced) cannot load a lazy chunk it has not loaded yet. Vite's import wrapper then fires
 * `vite:preloadError` (the import still fails, so the screen shows its "could not be loaded" line
 * and Try again). `onStale` tells the controller, which reloads the page into the new version at
 * the next safe moment, as for a new version (never mid-hand: `updateMayReload`, or before the next
 * hand is dealt, with `resumeAfterUpdate`).
 *
 * Once: the failed chunk (the error's text, which names its URL except in WebKit) and the time go
 * to sessionStorage first, and no chunk failing within 10 minutes of that note asks for a second
 * reload, whichever it is: the reloaded page may still miss chunks (a bad deploy, a 404 kept by a
 * cache), and at boot several chunks load, whose errors name different chunks (a note per chunk
 * would let two of them reload the page in turns). No reload without that note (no
 * sessionStorage), nor offline (`navigator.onLine` false: the chunk is only out of reach, and a
 * reload would show the browser's error page); the controller asks again right before the reload
 * (`UpdatePort.online`).
 */
export function watchStaleChunks(win: Window, onStale: () => void): void {
  win.addEventListener('vite:preloadError', (event) => {
    const chunk = String((event as Event & { payload?: unknown }).payload);
    try {
      if (win.navigator.onLine === false) return;
      const store = win.sessionStorage;
      const last = JSON.parse(store.getItem(STALE_RELOAD_KEY) ?? '{}') as { at?: unknown };
      if (Date.now() - Number(last.at) < STALE_RELOAD_GUARD_MS) return;
      store.setItem(STALE_RELOAD_KEY, JSON.stringify({ chunk, at: Date.now() }));
    } catch {
      return; // no sessionStorage: nothing would stop a loop
    }
    onStale();
  });
}

/** What `updateMayReload` looks at. */
export interface UpdateMoment {
  /** One writer at a time (§14.7): only the tab with the game lets a waiting version in. */
  tab: TabMode;
  /** A hand is unfinished, its commit waits for a grade (§14.3), or the app is still booting. */
  busy: boolean;
  screen: Screen;
  overlays: readonly Overlay[];
  /** Toasts on show (Leave table's session line, …): a reload would take them away unread. */
  toasts: number;
  /** The page is in the background (`ui.hidden`). */
  hidden: boolean;
  /** `ready`: a new version waits; `activated`: it controls the page already (another tab let it in). */
  update: 'ready' | 'activated';
}

/**
 * §15.1: may a new version reload the page right now? Only where nothing is lost and nobody is
 * interrupted: no hand unfinished, Welcome or Home on show with nothing open over it and no toast
 * (the toasts close by themselves within 4 s). (Before the next hand is dealt is the other moment:
 * the controller's `startHandAt`.) A tab without the game never lets a waiting version in: the tab
 * that has the game may be mid-hand. And it reloads only while it is in front: a background tab
 * reloading together with the tab that has the game would race it for the game (§14.7), and the
 * lock goes to whichever new page asks first.
 */
export function updateMayReload(m: UpdateMoment): boolean {
  if (m.busy || m.tab === 'pending' || m.toasts > 0) return false;
  if (m.tab !== 'writer' && (m.update === 'ready' || m.hidden)) return false;
  return (m.screen === 'welcome' || m.screen === 'home') && m.overlays.length === 0;
}

/** Everything above; returns one uninstall. */
export function installLifecycle(win: Window, store: AppStore): () => void {
  const off = [
    installVisibility(win, store),
    installBackHandler(win, store),
    installLayout(win, store),
    loadDevice(win, store),
  ];
  return () => {
    for (const f of off) f();
  };
}
