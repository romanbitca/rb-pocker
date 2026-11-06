/**
 * The service worker and new versions of the game (PLAN §15.1, chunk 9.5). This module talks to
 * the browser's Service Worker API; the controller decides when a new version may reload the page
 * (never mid-hand: `updateMayReload` in `app/lifecycle.ts`, and before a new hand is dealt). It is
 * a lazy chunk (§15.3): `app/boot.ts` loads it when the controller starts the port, and the
 * registration waits for the page's `load` anyway. It imports nothing at run time, so it cannot
 * pull a module of the entry chunk into a shared chunk (pitfall 47).
 *
 * - **Registration:** `./sw.js` with the scope `./` (what vite-plugin-pwa's `generateSW` builds,
 *   §15.1), once the page has loaded, so a first visit's precaching does not compete with the
 *   first paint. Bundled code, no inline script (the CSP, pitfall 32).
 * - **Events** for the controller:
 *   - `offlineReady`: the first version finished installing (the §12.11 toast "Ready to play
 *     offline.", once);
 *   - `updateReady`: a new version finished installing while another one is active: it waits
 *     until the game lets it in;
 *   - `activated`: that new version took over (this tab's `apply()`, or another tab's): the page
 *     still runs the old code, and reloads at the next safe moment.
 *   A worker counts as a new version when another one was active when it was first seen. The
 *   registration's `waiting` and `installing` workers are looked at as soon as it is registered:
 *   the browser's own check at page load may have found the new version before the app listened.
 * - `check()`: `registration.update()`, one GET of `sw.js` (`no-cache`, §17.2). The browser checks
 *   only when a page loads, and an app on a phone is often resumed instead, so the controller asks
 *   when the page comes back to the front and every hour. Offline it fails quietly.
 * - `apply()`: the `SKIP_WAITING` message that generateSW's worker listens for (`registerType:
 *   'prompt'`); `activated` follows. `reload()`: `location.reload()`.
 * - Nothing here uses a timer (§0.3: the controller's) or reloads by itself.
 *
 * Without service workers (an insecure page, such as a phone on a plain-http LAN address, §12.14,
 * or an old browser) there is no port at all (`serviceWorkerOf` in `app/lifecycle.ts` is null):
 * no toasts, no checks, and the game plays online as before.
 */

/** What vite-plugin-pwa builds (`generateSW`'s default file name, the scope of Vite's `base: './'`). */
export const SW_URL = './sw.js';
export const SW_SCOPE = './';

/** The message that lets a waiting `generateSW` worker take over (`registerType: 'prompt'`). */
export const SKIP_WAITING = { type: 'SKIP_WAITING' } as const;

export type UpdateEvent = 'offlineReady' | 'updateReady' | 'activated';

/** The service worker, as the controller uses it (`ControllerOptions.updates`). */
export interface UpdatePort {
  /** Registers the worker once the page has loaded; events come to `listener` from then on. */
  start(listener: (event: UpdateEvent) => void): void;
  /** Asks the server for a new version (`registration.update()`). Never throws. */
  check(): void;
  /** Lets the waiting version take over; `activated` follows (at once when none waits). */
  apply(): void;
  /** Reloads the page: the version that controls it now runs. */
  reload(): void;
}

/** A `ServiceWorker`, as used here (fakes in tests). */
export interface WorkerLike {
  readonly state: string;
  postMessage(message: unknown): void;
  addEventListener(type: 'statechange', listener: () => void): void;
}

/** A `ServiceWorkerRegistration`, as used here. */
export interface RegistrationLike {
  readonly installing: WorkerLike | null;
  readonly waiting: WorkerLike | null;
  readonly active: WorkerLike | null;
  update(): Promise<unknown>;
  addEventListener(type: 'updatefound', listener: () => void): void;
}

/** `navigator.serviceWorker`, as used here. */
export interface ContainerLike {
  register(url: string, options: { scope: string }): Promise<RegistrationLike>;
}

/** The page around the port. */
export interface UpdateEnv {
  readonly serviceWorker: ContainerLike;
  /** Runs `run` once the page has loaded (at once when it has). */
  whenLoaded(run: () => void): void;
  reload(): void;
}

/** The real page's environment, over its `navigator.serviceWorker` (`serviceWorkerOf`). */
export function browserUpdateEnv(win: Window, serviceWorker: ServiceWorkerContainer): UpdateEnv {
  return {
    serviceWorker: serviceWorker as unknown as ContainerLike,
    whenLoaded: (run) => {
      if (win.document.readyState === 'complete') run();
      else win.addEventListener('load', () => run(), { once: true });
    },
    reload: () => win.location.reload(),
  };
}

export function createUpdatePort(env: UpdateEnv): UpdatePort {
  let emit: (event: UpdateEvent) => void = () => {};
  let registration: RegistrationLike | null = null;
  /** Every worker listened to, and whether it came as a new version (another one was active). */
  const watched = new Map<WorkerLike, boolean>();

  const changed = (sw: WorkerLike): void => {
    const isUpdate = watched.get(sw) === true;
    if (sw.state === 'installed') emit(isUpdate ? 'updateReady' : 'offlineReady');
    else if (sw.state === 'activated' && isUpdate) emit('activated');
  };

  const watch = (reg: RegistrationLike, sw: WorkerLike | null): void => {
    if (sw === null || watched.has(sw)) return;
    watched.set(sw, reg.active !== null && reg.active !== sw);
    sw.addEventListener('statechange', () => changed(sw));
    if (sw.state === 'installed') changed(sw); // waiting already
  };

  const registered = (reg: RegistrationLike): void => {
    registration = reg;
    reg.addEventListener('updatefound', () => watch(reg, reg.installing));
    watch(reg, reg.waiting);
    watch(reg, reg.installing);
  };

  return {
    start(listener) {
      emit = listener;
      env.whenLoaded(() => {
        let registering: Promise<RegistrationLike>;
        try {
          registering = env.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
        } catch {
          return; // a browser mode without service workers: the game plays online
        }
        registering.then(registered, () => {
          // The same (e.g. a private mode that refuses them).
        });
      });
    },
    check() {
      const reg = registration;
      if (reg === null) return;
      try {
        reg.update().catch(() => {
          // Offline, or the server is restarting: the next check tries again.
        });
      } catch {
        // The same.
      }
    },
    apply() {
      const reg = registration;
      const waiting = reg?.waiting ?? null;
      if (reg === null || waiting === null) {
        // Nothing waits any more (another tab let it in): the page only needs its reload.
        emit('activated');
        return;
      }
      watch(reg, waiting);
      waiting.postMessage(SKIP_WAITING);
    },
    reload() {
      env.reload();
    },
  };
}
