/**
 * Starts the app side (PLAN §12.14 "Boot"): the controller on the app's store, the page lifecycle
 * (visibility, Back, layout) and, in development and E2E builds, the test hooks. main.tsx calls it
 * before the first render.
 */
import { createSimpleBrain } from './brain.ts';
import { createTableController, randomSeeds, type TableController } from './controller.ts';
import { installLifecycle } from './lifecycle.ts';
import { appStore } from './store.ts';
import type * as TestHooks from './testHooks.ts';

export interface StartOptions {
  /** The hero's name from `en.ts` ("You", Appendix F.10): `app` may not import `i18n` (§2.1). */
  heroName: string;
  /** The test-hooks module, passed only by development and E2E builds (see main.tsx). */
  hooks?: typeof TestHooks;
  win?: Window;
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
  });
  installLifecycle(win, appStore);
  if (hooks !== undefined) hooks.installTestHooks(win, appStore, controller, seed);
  // Chunk 3.2 reads the profile and the saved session before this (§12.14, §14.5).
  controller.boot();
  return controller;
}
