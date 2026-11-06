/**
 * Keep the screen on while a hand runs (PLAN §12.13 "Wake lock", §12.14), with the Screen Wake
 * Lock API. This file is part of the lazy `app/device.ts` chunk.
 *
 * - Wanted while the setting is on (`keepAwake`, default on), the Table is on screen, a hand runs
 *   (any controller mode but 'booting' and 'idle': from the deal to the hand-end banner, which the
 *   next hand follows) and the page is visible.
 * - Released when that stops: Home or any other screen (Settings, Review), the out-of-chips
 *   dialog, the setting turned off. The browser releases it itself when the page is hidden; it is
 *   asked for again when the page is visible.
 * - Feature-detected (`navigator.wakeLock.request`): it needs a secure context, so on the plain
 *   http LAN address (§17.4) it is skipped. Nothing is shown when it is missing or refused
 *   (battery saver, a permission policy); a refusal is not asked again until the wish or the
 *   page's visibility changes, so a refusing browser is not asked at every store change.
 */
import type { AppState, AppStore, ControllerMode } from './store.ts';

/** What `navigator.wakeLock.request('screen')` gives (the parts used here). */
export interface WakeLockSentinelLike {
  readonly released?: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

/** `navigator.wakeLock` (the part used here). */
export interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

/** The controller modes in which a hand runs at the table (Appendix A.8). */
const HAND_RUNS: ReadonlySet<ControllerMode> = new Set<ControllerMode>([
  'botTurn',
  'heroTurn',
  'grading',
  'feedback',
  'advancing',
  'handEnd',
]);

/** The setting is on, the Table is on screen and a hand runs (the page's visibility aside). */
export function wantsWakeLock(s: AppState): boolean {
  return s.settings.keepAwake && s.ui.screen === 'table' && HAND_RUNS.has(s.game.mode);
}

/** `navigator.wakeLock` when it can be asked, else null. Never throws (a getter may). */
export function wakeLockOf(nav: unknown): WakeLockLike | null {
  try {
    const lock = (nav as { wakeLock?: unknown } | null | undefined)?.wakeLock;
    return lock !== null &&
      typeof lock === 'object' &&
      typeof (lock as { request?: unknown }).request === 'function'
      ? (lock as WakeLockLike)
      : null;
  } catch {
    return null;
  }
}

/** Lets go of `sentinel`; a refusal or an already released one is fine. */
function release(sentinel: WakeLockSentinelLike): void {
  try {
    sentinel.release().catch(() => {});
  } catch {
    // Already released.
  }
}

/** Holds the wake lock as the module note says. Returns an uninstall (which releases it). */
export function installWakeLock(win: Window, store: AppStore): () => void {
  const api = wakeLockOf(win.navigator);
  if (api === null) return () => {};
  const doc = win.document;
  let held: WakeLockSentinelLike | null = null;
  let asking = false;
  let refused = false;
  let wanted = false;
  let disposed = false;

  const sync = (): void => {
    const want = !disposed && wantsWakeLock(store.getState()) && doc.visibilityState === 'visible';
    if (want !== wanted) {
      wanted = want;
      refused = false;
    }
    if (!want) {
      if (held !== null) {
        const sentinel = held;
        held = null;
        release(sentinel);
      }
      return;
    }
    if (held !== null || asking || refused) return;
    asking = true;
    let request: Promise<WakeLockSentinelLike>;
    try {
      request = api.request('screen');
    } catch {
      asking = false;
      refused = true;
      return;
    }
    request.then(
      (sentinel) => {
        asking = false;
        // No longer wanted by the time it came (Home, the setting off): let it go at once.
        if (!wanted) {
          release(sentinel);
          return;
        }
        if (sentinel.released === true) {
          // Released already (the page was hidden meanwhile): asked again when visible.
          return;
        }
        held = sentinel;
        sentinel.addEventListener('release', () => {
          if (held === sentinel) held = null;
        });
      },
      () => {
        asking = false;
        refused = true;
      },
    );
  };

  const onVisibility = (): void => {
    refused = false;
    sync();
  };
  doc.addEventListener('visibilitychange', onVisibility);
  const unsubscribe = store.subscribe(sync);
  sync();
  return () => {
    disposed = true;
    unsubscribe();
    doc.removeEventListener('visibilitychange', onVisibility);
    sync();
  };
}
