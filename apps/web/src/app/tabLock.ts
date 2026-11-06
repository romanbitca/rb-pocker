/**
 * One writer at a time when the game is open in several tabs (PLAN §14.7, pitfall 26).
 *
 * With Web Locks (secure pages, §12.14): at start the tab asks for the `pc-writer` lock without
 * waiting (`ifAvailable`) and holds it for the page's life. Granted: this tab writes. Not granted:
 * another tab has the game, so this one is read-only (§12.11 banner). "Play here" asks again with
 * `steal: true`; the tab that held it sees its request fail with `AbortError` and becomes
 * read-only. A read-only tab also waits in line for the lock (a request without `ifAvailable`),
 * so closing the other tab hands the game to this one, as the banner says ("Close it, or…").
 *
 * Without Web Locks (a plain-http LAN address, §12.14) the `rev` check of every profile write
 * (§14.3 step 2) is the guard, plus the `storage` event: the tab starts as the writer, and when
 * another tab writes the game (the profile or the session) it becomes read-only. "Play here" makes
 * it the writer again; the controller then writes the profile once, so the other tab hears it.
 * From then on this tab gives way to a profile write only: the other tab may still save a step of
 * its hand before it hears that write, and that session write must not take the game back (both
 * tabs would end read-only).
 *
 * Either way a read-only tab hears every profile write of the writer (`changed`), so the stats it
 * shows stay current. The lock name, like the storage keys, is an internal identifier (§0.3).
 */
import { STORAGE_KEYS } from '../persist/storage.ts';

/** The Web Locks name (§14.7). */
export const WRITER_LOCK = 'pc-writer';

export type TabLockEvent =
  /** This tab writes: it holds the lock (without Web Locks: nobody else has written). */
  | 'granted'
  /** Another tab holds the lock: read-only. */
  | 'denied'
  /** Another tab's "Play here" took the lock, or (without Web Locks) it wrote the game: read-only. */
  | 'lost'
  /** Another tab wrote the profile: a read-only tab reads it again. */
  | 'changed';

export interface TabLock {
  /** `locks`: Web Locks decide; `fallback`: the `rev` check and the `storage` event (§14.7). */
  readonly mode: 'locks' | 'fallback';
  /**
   * Asks once (boot). The answer comes as an event; without Web Locks it is `granted`, at once,
   * inside this call.
   */
  start(listener: (event: TabLockEvent) => void): void;
  /** "Play here" (§12.11): the lock is taken from the other tab; `granted` follows. */
  takeOver(): void;
  /** Lets the lock go and stops listening (tests; the app keeps it for the page's life). */
  release(): void;
}

/** The parts of `navigator.locks` used here (a fake in tests). */
export interface LockManagerLike {
  request(
    name: string,
    options: { ifAvailable?: boolean; steal?: boolean },
    callback: (lock: unknown) => unknown,
  ): Promise<unknown>;
}

/** The page: `navigator.locks` (feature-detected) and the `storage` event. */
export interface TabLockEnv {
  locks: LockManagerLike | null;
  addEventListener(type: 'storage', listener: (event: StorageEventLike) => void): void;
  removeEventListener(type: 'storage', listener: (event: StorageEventLike) => void): void;
  /** `window.localStorage`, to tell its events from `sessionStorage`'s; null when unreadable. */
  localStorage: unknown;
}

/** The fields of a `StorageEvent` used here. */
export interface StorageEventLike {
  key: string | null;
  storageArea: unknown;
}

const isAbort = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';

/** The page's `navigator.locks`, or null (insecure page, old browser, or a getter that throws). */
export function webLocksOf(win: Window): LockManagerLike | null {
  try {
    const locks = (win.navigator as { locks?: unknown }).locks;
    return typeof locks === 'object' && locks !== null && 'request' in locks
      ? (locks as LockManagerLike)
      : null;
  } catch {
    return null;
  }
}

/** The real page's environment. */
export function browserTabLockEnv(win: Window): TabLockEnv {
  let localStorage: unknown = null;
  try {
    localStorage = win.localStorage;
  } catch {
    // Blocked storage: no storage events either; the rev check still guards.
  }
  return {
    locks: webLocksOf(win),
    addEventListener: (type, listener) => win.addEventListener(type, listener),
    removeEventListener: (type, listener) => win.removeEventListener(type, listener),
    localStorage,
  };
}

export function createTabLock(env: TabLockEnv): TabLock {
  let locks = env.locks;
  let listener: ((event: TabLockEvent) => void) | null = null;
  /** This tab writes (holds the lock, or the fallback's claim). */
  let holding = false;
  /** Without Web Locks: this tab took the game with "Play here" (it gives way to profile writes only). */
  let claimed = false;
  /** Each request's number: a request that a newer one replaced is not listened to any more. */
  let generation = 0;
  let letGo: (() => void) | null = null;

  const emit = (event: TabLockEvent): void => listener?.(event);

  const grant = (): void => {
    holding = true;
    emit('granted');
  };

  const lose = (): void => {
    holding = false;
    emit('lost');
  };

  /** Held until `release()` (or the page goes). */
  const hold = (): Promise<void> =>
    new Promise<void>((resolve) => {
      letGo = resolve;
    });

  /** No usable Web Locks after all (e.g. a SecurityError): the fallback, writer at once. */
  const fallBack = (): void => {
    locks = null;
    grant();
  };

  const ask = (options: { ifAvailable?: boolean; steal?: boolean }): void => {
    const lockManager = locks;
    if (lockManager === null) return;
    const mine = ++generation;
    letGo?.();
    letGo = null;
    let request: Promise<unknown>;
    try {
      request = lockManager.request(WRITER_LOCK, options, (lock) => {
        if (mine !== generation) return undefined;
        if (lock === null) {
          emit('denied');
          ask({}); // wait in line: granted once the other tab lets go (closes)
          return undefined;
        }
        grant();
        return hold();
      });
    } catch {
      fallBack();
      return;
    }
    request.catch((e: unknown) => {
      if (mine !== generation) return;
      if (!isAbort(e)) {
        fallBack();
        return;
      }
      lose();
      ask({}); // in line again, behind the tab that took it
    });
  };

  const onStorage = (event: StorageEventLike): void => {
    if (event.storageArea !== env.localStorage) return;
    const key = event.key;
    // `key` null: another tab cleared the whole storage.
    const profile = key === STORAGE_KEYS.profile || key === null;
    if (!profile && key !== STORAGE_KEYS.session) return;
    if (locks === null && holding) {
      // A session write after "Play here" can be the other tab's last step before it heard us.
      if (profile || !claimed) lose();
    } else if (profile) emit('changed');
  };

  return {
    get mode() {
      return locks === null ? 'fallback' : 'locks';
    },
    start(next) {
      listener = next;
      env.addEventListener('storage', onStorage);
      if (locks === null) grant();
      else ask({ ifAvailable: true });
    },
    takeOver() {
      if (locks === null) claimed = true;
      if (locks === null || holding) grant();
      else ask({ steal: true });
    },
    release() {
      generation++;
      holding = false;
      letGo?.();
      letGo = null;
      env.removeEventListener('storage', onStorage);
      listener = null;
    },
  };
}
