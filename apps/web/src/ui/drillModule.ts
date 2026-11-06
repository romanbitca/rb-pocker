/**
 * Loads the hand drill (PLAN §13.5, §15.3) when its page opens: two lazy chunks, fetched side by
 * side and precached like every chunk, so the page opens offline. The page's code
 * (`screens/Drill.tsx`, with its words) is a `ui` chunk; its logic (`app/drill.ts` with `drill/`
 * and `persist/drill.ts`) comes through `loadDrill()` in `app/store.ts`, the UI's one door to `app`
 * (§2.1), and reaches the page as a prop.
 *
 * Like `screensModule.ts`, no `React.lazy`: `useDrillChunks()` gives the chunks from the first
 * render once they are loaded (a second visit), else null and it renders again when they arrive.
 * This module itself is part of the screens chunk (`screensEntry.tsx`), never initial.
 */
import { useEffect, useState } from 'react';
import { loadDrill, type DrillModule } from '../app/store.ts';

export interface DrillChunks {
  page: typeof import('./screens/Drill.tsx');
  logic: DrillModule;
}

let loaded: DrillChunks | null = null;
let loading: Promise<DrillChunks> | null = null;

/** Loads both chunks once (a later call asks again after a failure). */
export function loadDrillChunks(): Promise<DrillChunks> {
  loading ??= Promise.all([import('./screens/Drill.tsx'), loadDrill()]).then(
    ([page, logic]) => {
      loaded = { page, logic };
      return loaded;
    },
    (e: unknown) => {
      loading = null;
      throw e;
    },
  );
  return loading;
}

export interface DrillLoad {
  chunks: DrillChunks | null;
  /** They could not be loaded (no connection and not cached yet): a reload tries again. */
  failed: boolean;
}

export function useDrillChunks(): DrillLoad {
  const [state, setState] = useState<DrillLoad>(() => ({ chunks: loaded, failed: false }));
  useEffect(() => {
    if (state.chunks !== null || state.failed) return;
    let live = true;
    loadDrillChunks().then(
      (chunks) => {
        if (live) setState({ chunks, failed: false });
      },
      () => {
        if (live) setState({ chunks: null, failed: true });
      },
    );
    return () => {
      live = false;
    };
  }, [state]);
  return state;
}
