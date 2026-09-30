/**
 * Starts the app side (PLAN §12.14 "Boot"): the controller on the app's store, the page lifecycle
 * (visibility, Back, layout) and, in development and E2E builds, the test hooks. main.tsx calls it
 * before the first render.
 */
import { createSimpleBrain } from './brain.ts';
import {
  createTableController,
  randomSeeds,
  realTimers,
  type TableController,
} from './controller.ts';
import { createSafeStorage } from '../persist/storage.ts';
import { installLifecycle } from './lifecycle.ts';
import { appStore } from './store.ts';
import { startEquityWorker } from './workerClient.ts';
import type { SafeStorage } from '../persist/storage.ts';
import type * as TestHooks from './testHooks.ts';

export interface StartOptions {
  /** The hero's name from `en.ts` ("You", Appendix F.10): `app` may not import `i18n` (§2.1). */
  heroName: string;
  /** The test-hooks module, passed only by development and E2E builds (see main.tsx). */
  hooks?: typeof TestHooks;
  win?: Window;
  /** The storage (tests pass one over a fake `localStorage`). */
  storage?: SafeStorage;
}

export function startApp(options: StartOptions): TableController {
  const win = options.win ?? window;
  const hooks = options.hooks;
  const seed = hooks?.seedFromSearch(win.location.search) ?? null;
  const controller = createTableController({
    store: appStore,
    // Stage 3's SimpleBot on the main thread; Stage 5 swaps in the brain.worker client.
    brain: createSimpleBrain(),
    heroName: options.heroName,
    seeds: hooks !== undefined && seed !== null ? hooks.fixedSeeds(seed) : randomSeeds(),
    // One storage wrapper per launch over the real localStorage (§14.6).
    storage: options.storage ?? createSafeStorage(),
    // Warmed at start, never awaited (§12.14); without module workers it reports "unavailable".
    equity: startEquityWorker(realTimers),
  });
  installLifecycle(win, appStore);
  if (hooks !== undefined) hooks.installTestHooks(win, appStore, controller, seed);
  // Reads the profile and the saved session (§12.14, §14.5), then shows Welcome or Home.
  controller.boot();
  return controller;
}
