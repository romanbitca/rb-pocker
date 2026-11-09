/**
 * Loads the screens of Play with friends (`mpEntry.tsx`: PLAN §19.3, §19.10), a lazy chunk of its
 * own (§15.3), the way `aboutModule.ts` loads About: one `import()`, then `useMpModule()` gives the
 * module from the first render on once it is there.
 *
 * Only the screens chunk imports this file, and only a screen of Play with friends or a table of
 * the server's asks for the module, so outside Telegram it is never fetched.
 */
import { useEffect, useState } from 'react';

export type MpModule = typeof import('./mpEntry.tsx');

let loaded: MpModule | null = null;
let loading: Promise<MpModule> | null = null;

/** Loads the chunk once (a later call asks again after a failure). */
export function loadMp(): Promise<MpModule> {
  loading ??= import('./mpEntry.tsx').then(
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

export interface MpChunk {
  /** The chunk, or null while it loads or after it failed. */
  mod: MpModule | null;
  /** It could not be loaded (no connection and not cached yet): a reload is the sure retry. */
  failed: boolean;
}

/** The chunk for a screen or a table part that shows it. */
export function useMpModule(): MpChunk {
  const [state, setState] = useState<MpChunk>(() => ({ mod: loaded, failed: false }));
  useEffect(() => {
    if (state.mod !== null || state.failed) return;
    let live = true;
    loadMp().then(
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
