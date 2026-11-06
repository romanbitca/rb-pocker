/**
 * Loads the About screen (`screens/About.tsx`: PLAN §12.1, Appendix G; chunk 9.2c), a lazy chunk
 * of its own (§15.3), the way `screensModule.ts` loads the screens after the first tap: one
 * `import()`, then `useAboutModule()` gives the module from the first render on once it is there.
 * No `React.lazy` and no Suspense (React 19 shows a Suspense boundary's content at the earliest
 * 300 ms after its fallback).
 *
 * Only `screensEntry.tsx` imports this file, so it travels in the screens chunk and the initial
 * bundle pays nothing for About. The service worker precaches the About chunk, so it opens offline.
 */
import { useEffect, useState } from 'react';

export type AboutModule = typeof import('./screens/About.tsx');

let loaded: AboutModule | null = null;
let loading: Promise<AboutModule> | null = null;

/** Loads the chunk once (a later call asks again after a failure). */
export function loadAbout(): Promise<AboutModule> {
  loading ??= import('./screens/About.tsx').then(
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

export interface AboutChunk {
  /** The chunk, or null while it loads or after it failed. */
  mod: AboutModule | null;
  /** It could not be loaded (no connection and not cached yet): a reload is the sure retry. */
  failed: boolean;
}

/** The About chunk for the screen that shows it. */
export function useAboutModule(): AboutChunk {
  const [state, setState] = useState<AboutChunk>(() => ({ mod: loaded, failed: false }));
  useEffect(() => {
    if (state.mod !== null || state.failed) return;
    let live = true;
    loadAbout().then(
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
