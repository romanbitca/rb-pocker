/**
 * Starts the app side (PLAN §12.14 "Boot"): the controller on the app's store, the page lifecycle
 * (visibility, Back, layout), the service worker (§15.1, `app/swUpdate.ts`: production builds on
 * pages that have one) and, in development and E2E builds, the test hooks. main.tsx calls it
 * before the first render.
 */
import {
  createTableController,
  randomSeeds,
  realTimers,
  type TableController,
} from './controller.ts';
import { launchStorage } from '../persist/storage.ts';
import { brainGrader } from './grading.ts';
import {
  installEnv,
  installLifecycle,
  isStandalone,
  serviceWorkerOf,
  storageManagerOf,
  watchStaleChunks,
} from './lifecycle.ts';
import { pageSha256 } from './shuffleCode.ts';
import { appStore, setDrillLoader } from './store.ts';
import type { UpdatePort } from './swUpdate.ts';
import { browserTabLockEnv, createTabLock } from './tabLock.ts';
import { parseLaunch } from './tg/launch.ts';
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
  /**
   * New versions (§15.1). Default: the page's, in a production build (`vite build`, the E2E build
   * too): its service worker where it has one (none on an insecure page, §12.14), and lazy chunks
   * gone after a redeploy on every page; none on the dev server (it serves no `sw.js`, and its
   * imports are not Vite's wrapped ones). Tests pass a fake, or null.
   */
  updates?: UpdatePort | null;
}

/**
 * The page's port for new versions (see `StartOptions.updates`), in a production build. Its
 * service worker code is a lazy chunk (`app/swUpdate.ts`, kept out of the initial JS, §15.3),
 * loaded when the controller starts it at boot; the registration waits for the page's `load`
 * anyway. Not loaded (a first visit that went offline): no new versions this launch.
 *
 * A lazy chunk gone from the server after a redeploy (§15.1 "Redeploys", `watchStaleChunks`) is a
 * new version too, with or without a service worker: the port says `stale`, and the controller
 * reloads the page at the next safe moment, as for a new version that took over.
 */
function pageUpdates(win: Window): UpdatePort | null {
  if (!import.meta.env.PROD) return null;
  const serviceWorker = serviceWorkerOf(win);
  let port: UpdatePort | null = null;
  return {
    start(listener) {
      watchStaleChunks(win, () => listener('stale'));
      if (serviceWorker === null) return;
      void import('./swUpdate.ts').then(
        ({ browserUpdateEnv, createUpdatePort }) => {
          port = createUpdatePort(browserUpdateEnv(win, serviceWorker));
          port.start(listener);
        },
        () => {
          // See above.
        },
      );
    },
    check: () => port?.check(),
    apply: () => port?.apply(),
    reload: () => win.location.reload(),
    online: () => win.navigator.onLine !== false,
  };
}

export function startApp(options: StartOptions): TableController {
  const win = options.win ?? window;
  const hooks = options.hooks;
  const seed = hooks?.seedFromSearch(win.location.search) ?? null;
  // Development and E2E builds: `?script=<name>` puts scripted bots in front of it (the coach's
  // hints and grades still come from brain.worker), and a layer for faults sits in front of the
  // worker (`window.__pc.faults`, chunk 6.5).
  const script = hooks?.scriptFromSearch(win.location.search) ?? null;
  const rig = hooks?.testBrain(script, realTimers);
  // Warmed at start like the equity worker, never awaited (§12.14, §15.3): the bots decide in
  // brain.worker; without module workers it is `failed` and the bots take the safest action.
  const brain = rig?.brain ?? startBrainWorker(realTimers);
  const controller = createTableController({
    store: appStore,
    brain,
    // Every hero decision is graded in brain.worker too (§11.3 r5): chunk 6.1's `grade()`, from
    // the same deliberation as the decision's hint (§8.11).
    grader: brainGrader(brain),
    heroName: options.heroName,
    seeds: hooks !== undefined && seed !== null ? hooks.fixedSeeds(seed) : randomSeeds(),
    // One storage wrapper per launch over the real localStorage (§14.6), shared with the drill.
    storage: options.storage ?? launchStorage(),
    // Warmed at start, never awaited (§12.14); without module workers it reports "unavailable".
    equity: startEquityWorker(realTimers),
    // The coach's hint at every hero decision, from brain.worker (§8.2, chunk 5.7).
    hints: true,
    // The end-of-hand summary when the coach level shows one (§10.2, §12.9, chunk 6.4): offered on
    // the hand-end banner, opened only by the player (1.3.92).
    summaries: true,
    // The first-table tips (§12.11, chunk 9.3). The E2E specs turn them off unless a spec is
    // about them (`tests/e2e/fixtures.ts`): a tip waits for a tap, and their flows do not tap it.
    tips: hooks?.tipsWanted(win) ?? true,
    // One writer at a time (§14.7): Web Locks, else the rev check and the storage event.
    tabLock: createTabLock(browserTabLockEnv(win)),
    // Keeping the data (§14.8): persist() where it exists (secure pages), at once when installed.
    storageManager: storageManagerOf(win),
    standalone: isStandalone(win),
    // Installing (§12.13): the browser's offer, kept for "Install app"; iOS gets the Share tip.
    install: installEnv(win),
    // The provable shuffle (§16.3): `crypto.subtle` hashes each hand's shuffle code before the
    // deal; on a plain-http page there is none and the codes are null (§12.14).
    sha256: pageSha256(win),
    // New versions between hands, the offline-ready toast (§15.1). The E2E specs turn that
    // toast off unless a spec is about it (`tests/e2e/fixtures.ts`), as with the tips.
    updates: options.updates === undefined ? pageUpdates(win) : options.updates,
    offlineToast: hooks?.offlineToastWanted(win) ?? true,
    // §12.8: the system asks for less motion, so the first launch's speed is Fast.
    reducedMotion: win.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
  });
  // Inside Telegram only (§19.7): outside it nothing else runs and no chunk loads. Not loaded (the
  // network went away): the game plays on without Telegram's buttons.
  const launch = parseLaunch(win);
  if (launch !== null) {
    appStore.setState({ tg: { inside: true } });
    void import('./tg/start.ts').then(
      (m) =>
        m.startTelegram({
          win,
          store: appStore,
          controller,
          launch,
          timers: realTimers,
          heroName: options.heroName,
        }),
      () => {},
    );
  }
  installLifecycle(win, appStore);
  // The hand drill's logic, loaded when its page opens (§13.5).
  setDrillLoader(() => import('./drill.ts'));
  if (hooks !== undefined) {
    hooks.installTestHooks(win, appStore, controller, seed, script, rig?.faults ?? null);
  }
  // Reads the profile and the saved session (§12.14, §14.5), then shows Welcome or Home.
  controller.boot();
  return controller;
}
