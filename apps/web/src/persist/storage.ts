/**
 * The only door to `localStorage` (PLAN §14.6 rule 3, Known pitfall 27). Every call goes through
 * `SafeStorage`, which never throws: it returns `{ ok: false, reason }` when the browser storage is
 * missing, blocked (`SecurityError`, e.g. cookies off), full (`QuotaExceededError`) or broken.
 *
 * On a failure the game keeps playing in memory (§12.14 "Storage unavailable / full"):
 * - a key whose last write or removal failed reads back what we tried to write, for the rest of
 *   this launch, so the rest of the app sees one consistent in-memory store;
 * - the next write of that key tries the browser storage again ("retry on the next commit");
 * - `onFailure` tells the UI about the first failure of the launch, once, so it can show the
 *   §12.11 banner "Stats can't be saved in this browser mode…" once per launch.
 *
 * It stores strings only. JSON, type guards and versions live in `schema.ts`, `profile.ts` and
 * `session.ts`.
 */

/**
 * Every key this app writes (§14.2). These are internal identifiers: they keep the short `pc`
 * form after the rename to RB Poker Coach and must never be renamed (§0.3).
 */
export const STORAGE_KEYS = {
  profile: 'pc.v1.profile',
  profileBackup: 'pc.v1.profile.bak',
  hands: 'pc.v1.hands',
  session: 'pc.v1.session',
  diag: 'pc.v1.diag',
  preimport: 'pc.v1.preimport',
} as const;

/** Unreadable data is copied to `pc.corrupt.<timestamp>`, never deleted automatically (§14.6). */
export const CORRUPT_KEY_PREFIX = 'pc.corrupt.';

/**
 * Why a storage call failed:
 * - `unavailable`: there is no `localStorage` (old or locked-down browsers, some web views);
 * - `security`: the browser refused access (`SecurityError`, e.g. site data blocked);
 * - `quota`: the storage is full, or a private mode allows no writes (`QuotaExceededError`);
 * - `error`: anything else the browser threw.
 */
export type StorageFailure = 'unavailable' | 'security' | 'quota' | 'error';

export type ReadResult = { ok: true; value: string | null } | { ok: false; reason: StorageFailure };
export type WriteResult = { ok: true } | { ok: false; reason: StorageFailure };
/**
 * The result of a save that also checks what it writes. `invalid` means nothing was written
 * because the value would not load again: a bug in the caller, not a storage failure (it never
 * triggers the banner). `problem` says why, for Diagnostics and tests.
 */
export type SaveResult = WriteResult | { ok: false; reason: 'invalid'; problem: string };

/** The part of the Web Storage API we use: `localStorage`, or a fake in tests. */
export interface StorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SafeStorage {
  /** The stored string, `null` when the key is absent. */
  get(key: string): ReadResult;
  set(key: string, value: string): WriteResult;
  remove(key: string): WriteResult;
  /** The first failure of this launch, or `null` while every call has worked. */
  readonly failure: StorageFailure | null;
  /**
   * Calls `listener` once, at the first failure of this launch (at once if it already happened),
   * then never again: that is when the UI shows the §12.11 storage banner. Returns an unsubscribe
   * function. A listener that throws does not break the storage call (the error is re-thrown on a
   * microtask, so it still reaches the console).
   */
  onFailure(listener: (reason: StorageFailure) => void): () => void;
}

const OK: WriteResult = { ok: true };

/** `window.localStorage`, or null where it does not exist. Reading it may throw a SecurityError. */
function browserStorage(): StorageBackend | null {
  return (globalThis as { localStorage?: StorageBackend | null }).localStorage ?? null;
}

/** Maps what a Storage call threw to a reason (names and legacy codes across browsers). */
export function classifyStorageError(error: unknown): StorageFailure {
  const { name, code } = (typeof error === 'object' && error !== null ? error : {}) as {
    name?: unknown;
    code?: unknown;
  };
  // 22: QUOTA_EXCEEDED_ERR; 1014 and NS_ERROR_DOM_QUOTA_REACHED: older Firefox.
  if (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    code === 22 ||
    code === 1014
  ) {
    return 'quota';
  }
  if (name === 'SecurityError' || code === 18) return 'security';
  return 'error';
}

/**
 * Creates the wrapper. The app makes one per launch over the real `localStorage` (the default);
 * tests pass a fake. `getBackend` is called on every operation inside the same try/catch as the
 * operation, because merely reading `window.localStorage` can throw.
 */
export function createSafeStorage(
  getBackend: () => StorageBackend | null | undefined = browserStorage,
): SafeStorage {
  /** Keys whose last write (a string) or removal (null) did not reach the browser storage. */
  const memory = new Map<string, string | null>();
  const listeners = new Set<(reason: StorageFailure) => void>();
  let failure: StorageFailure | null = null;

  const notify = (listener: (reason: StorageFailure) => void, reason: StorageFailure): void => {
    try {
      listener(reason);
    } catch (e) {
      queueMicrotask(() => {
        throw e;
      });
    }
  };

  const report = (reason: StorageFailure): void => {
    if (failure !== null) return;
    failure = reason;
    const waiting = [...listeners];
    listeners.clear();
    for (const listener of waiting) notify(listener, reason);
  };

  /** Runs `op` on the backend; any throw (or no backend) becomes a reported failure. */
  function attempt<T>(
    op: (backend: StorageBackend) => T,
  ): { ok: true; value: T } | { ok: false; reason: StorageFailure } {
    let reason: StorageFailure;
    try {
      const backend = getBackend();
      if (backend !== null && backend !== undefined) return { ok: true, value: op(backend) };
      reason = 'unavailable';
    } catch (e) {
      reason = classifyStorageError(e);
    }
    report(reason);
    return { ok: false, reason };
  }

  return {
    get(key) {
      if (memory.has(key)) return { ok: true, value: memory.get(key) ?? null };
      const read = attempt((backend) => backend.getItem(key));
      if (!read.ok) return read;
      return { ok: true, value: typeof read.value === 'string' ? read.value : null };
    },
    set(key, value) {
      const write = attempt((backend) => backend.setItem(key, value));
      if (write.ok) {
        memory.delete(key);
        return OK;
      }
      memory.set(key, value);
      return { ok: false, reason: write.reason };
    },
    remove(key) {
      const write = attempt((backend) => backend.removeItem(key));
      if (write.ok) {
        memory.delete(key);
        return OK;
      }
      memory.set(key, null);
      return { ok: false, reason: write.reason };
    },
    get failure() {
      return failure;
    },
    onFailure(listener) {
      if (failure !== null) {
        notify(listener, failure);
        return () => {};
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Copies unreadable data to `pc.corrupt.<timestamp>` (§14.6 rule 2: never delete it
 * automatically). Returns the key used, or null when the copy could not be written (then the
 * caller must not overwrite the original either).
 */
export function keepCorruptCopy(store: SafeStorage, raw: string, now: Date): string | null {
  const base = `${CORRUPT_KEY_PREFIX}${now.toISOString()}`;
  let key = base;
  for (let i = 1; ; i++) {
    const existing = store.get(key);
    if (!existing.ok) return null;
    if (existing.value === null) break;
    key = `${base}.${i}`;
  }
  return store.set(key, raw).ok ? key : null;
}
