/**
 * Loads the screens after the first tap (`screensEntry.tsx`: the Table, Setup, Settings, the
 * Menu and the §3.1 dialogs), a lazy chunk (PLAN §15.3), the way `coachModule.ts` loads the coach.
 *
 * - `usePreloadScreens()` (App) asks for the chunk once the first screen is painted. It arrives
 *   long before a person can tap, so Play deals at once (§12.1) and no screen waits on a fetch.
 * - `useScreens()` is what a screen or overlay from the chunk reads: the module once it is there
 *   (from the first render on, if it already is), else null and it renders again when it
 *   arrives. No `React.lazy` and no Suspense: React shows a Suspense boundary's content at the
 *   earliest 300 ms after its fallback (React 19), which a screen that is already loaded must
 *   never wait for.
 */
import { useEffect, useState } from 'react';

export type ScreensModule = typeof import('./screensEntry.tsx');

let loaded: ScreensModule | null = null;
let loading: Promise<ScreensModule> | null = null;

/** Loads the chunk once (a later call asks again after a failure). */
export function loadScreens(): Promise<ScreensModule> {
  loading ??= import('./screensEntry.tsx').then(
    (m) => {
      loaded = m;
      return m;
    },
    (e: unknown) => {
      loading = null;
      throw e;
    },
  );
  return loading;
}

/** Asks for the chunk once the first screen has been painted (App, once). */
export function usePreloadScreens(): void {
  useEffect(() => {
    // An animation frame runs just before the browser paints, and the chunk arrives in a later
    // task, so loading it never delays the first paint. A failure is shown by the screen that
    // needs the chunk, which tries again.
    const frame = requestAnimationFrame(() => {
      loadScreens().catch(() => {});
    });
    return () => cancelAnimationFrame(frame);
  }, []);
}

export interface Screens {
  /** The chunk, or null while it loads or after it failed. */
  mod: ScreensModule | null;
  /**
   * It could not be loaded (no connection and not cached yet). Only a reload tries again: a
   * browser keeps a module that failed to load as failed for the rest of the page's life.
   */
  failed: boolean;
}

/** The chunk for a screen or overlay that comes from it (see the module note). */
export function useScreens(): Screens {
  const [state, setState] = useState<Screens>(() => ({ mod: loaded, failed: false }));
  useEffect(() => {
    if (state.mod !== null || state.failed) return;
    let live = true;
    loadScreens().then(
      (mod) => {
        if (live) setState({ mod, failed: false });
      },
      () => {
        if (live) setState({ mod: null, failed: true });
      },
    );
    return () => {
      live = false;
    };
  }, [state]);
  return state;
}
