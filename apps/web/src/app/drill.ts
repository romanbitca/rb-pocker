/**
 * The hand drill's app side (PLAN §13.5): one session per launch over the drill's pure logic
 * (`drill/`), its random stream seeded like a new table's (`randomSeed()`, §2.4), its data saved
 * under `pc.v1.drill` (`persist/drill.ts`) through the launch's one storage wrapper. It is a lazy
 * chunk: the drill screen loads it with `loadDrill()` (app/store.ts, §2.1: the UI reaches `app`
 * only through the store) when the page opens, and gets it as a prop, the way the Bench gets
 * `runBench`.
 *
 * Bundling (pitfall 47): this chunk imports `store.ts` (for the tab mode below). Without that
 * import the evaluator, which the store chunk holds and the drill uses, was cut out of the store
 * chunk into an initial file of its own (+1 file, about +0.5 KB of initial JS).
 */
import { randomSeed, rngFromSeed, type Seed128 } from '../core/rng.ts';
import type { DrillData } from '../drill/data.ts';
import { createDrillSession, type DrillSession, type DrillStorage } from '../drill/session.ts';
import { loadDrillData, saveDrillData } from '../persist/drill.ts';
import { launchStorage, type SafeStorage } from '../persist/storage.ts';
import { appStore } from './store.ts';

export { DIFFICULTIES, GAME_IDS, needsName, needsPosition, optionsOf } from '../drill/questions.ts';
export { involved, rightName, rightOption, rightPosition } from '../drill/questions.ts';
export { categoryAt, POSITIONS } from '../drill/ladder.ts';
export type { DrillSession, DrillView } from '../drill/session.ts';

/** A tab that another tab took the game from writes nothing (§14.7). */
const writer = (): boolean => appStore.getState().data.tab !== 'readOnly';

/**
 * `pc.v1.drill` as the session's storage. A damaged value is copied away and the drill starts
 * fresh; when it could not be copied, nothing is written over it for the rest of the launch
 * (§14.6 rule 2). Nothing is written while `canWrite()` says no (a read-only tab, §14.7).
 */
export function drillStorage(
  store: SafeStorage,
  now: () => Date = () => new Date(),
  canWrite: () => boolean = writer,
): DrillStorage {
  let blocked = false;
  return {
    load(): DrillData | null {
      const found = loadDrillData(store, now());
      if (found.status === 'ok') return found.data;
      if (found.status === 'damaged' && found.kept === null) blocked = true;
      return null;
    },
    save(data) {
      if (!blocked && canWrite()) saveDrillData(store, data);
    },
  };
}

/** A session over `store`, seeded with `seed` (tests fix both). */
export function newDrillSession(seed: Seed128, store: SafeStorage): DrillSession {
  return createDrillSession({ rng: rngFromSeed(seed), storage: drillStorage(store) });
}

let session: DrillSession | null = null;

/** This launch's session: the same question and counters when the page opens again. */
export function drillSession(): DrillSession {
  return (session ??= newDrillSession(randomSeed(), launchStorage()));
}
