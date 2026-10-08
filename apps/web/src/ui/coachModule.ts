/**
 * The coach's lazy chunk (PLAN §15.3: the initial bundle stays small, the sheet is lazy-loaded):
 * the coach's words (`i18n/coachUi.ts`), the view builders (`ui/coach.ts`) and the sheet
 * (`CoachSheet.tsx`) load with one `import()` of `coachEntry.ts`. The Table asks for it when it
 * mounts, long before the first hint; the service worker precaches it like every chunk.
 *
 * `useCoachView()` is what the coach's places read: the `CoachView` of this moment, shared by all
 * of them (one build per change), or null until the chunk is there.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  selectActionBarInput,
  selectCoach,
  selectNarration,
  useAppStore,
  type ActionBarInputData,
  type CoachData,
  type NarrationData,
} from '../app/store.ts';
import type { CoachView } from './coach.ts';

export type CoachModule = typeof import('./coachEntry.ts');

let loaded: CoachModule | null = null;
let loading: Promise<CoachModule> | null = null;

/** Loads the chunk once (again after a failure). */
export function loadCoach(): Promise<CoachModule> {
  loading ??= import('./coachEntry.ts').then(
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

/** The chunk once loaded; null before (the component renders again when it arrives). */
export function useCoachModule(): CoachModule | null {
  const [mod, setMod] = useState<CoachModule | null>(loaded);
  useEffect(() => {
    if (mod !== null) return;
    let live = true;
    loadCoach().then(
      (m) => {
        if (live) setMod(m);
      },
      () => {
        // Offline without the chunk: the coach stays quiet (it is precached, so this is rare).
      },
    );
    return () => {
      live = false;
    };
  }, [mod]);
  return mod;
}

let last: {
  mod: CoachModule;
  data: CoachData;
  narration: NarrationData | null;
  input: ActionBarInputData | null;
  view: CoachView;
} | null = null;

/** The coach's view of this moment (the same object for every component), or null until loaded. */
export function useCoachView(): CoachView | null {
  const mod = useCoachModule();
  const data = useAppStore(selectCoach);
  const narration = useAppStore(selectNarration);
  const input = useAppStore(selectActionBarInput);
  return useMemo(() => {
    if (mod === null) return null;
    if (
      last !== null &&
      last.mod === mod &&
      last.data === data &&
      last.narration === narration &&
      last.input === input
    ) {
      return last.view;
    }
    const view = mod.coachView(data, narration, input);
    last = { mod, data, narration, input, view };
    return view;
  }, [mod, data, narration, input]);
}
