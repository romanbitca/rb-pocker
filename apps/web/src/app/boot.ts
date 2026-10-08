/**
 * Starts the app side (PLAN §12.14 "Boot"): the controller on the app's store, the page lifecycle
 * (visibility, Back, layout) and, in development and E2E builds, the test hooks. main.tsx calls it
 * before the first render.
 */
import {
  createTableController,
  randomSeeds,
  realTimers,
  type TableController,
} from './controller.ts';
import { createSafeStorage } from '../persist/storage.ts';
import { installLifecycle } from './lifecycle.ts';
import { appStore } from './store.ts';
import { startBrainWorker, startEquityWorker } from './workerClient.ts';
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
    // Warmed at start like the equity worker, never awaited (§12.14, §15.3): the bots decide in
    // brain.worker; without module workers it is `failed` and the bots take the safest action.
    brain: startBrainWorker(realTimers),
    heroName: options.heroName,
    seeds: hooks !== undefined && seed !== null ? hooks.fixedSeeds(seed) : randomSeeds(),
    // One storage wrapper per launch over the real localStorage (§14.6).
    storage: options.storage ?? createSafeStorage(),
    // Warmed at start, never awaited (§12.14); without module workers it reports "unavailable".
    equity: startEquityWorker(realTimers),
    // The coach's hint at every hero decision, from brain.worker (§8.2, chunk 5.7).
    hints: true,
  });
  installLifecycle(win, appStore);
  if (hooks !== undefined) hooks.installTestHooks(win, appStore, controller, seed);
  // Reads the profile and the saved session (§12.14, §14.5), then shows Welcome or Home.
  controller.boot();
  return controller;
}
