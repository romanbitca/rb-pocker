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
