/**
 * Test doubles for the tab lock (PLAN §14.7): a `navigator.locks` with the Web Locks rules the app
 * uses (one exclusive lock per name, `ifAvailable`, `steal`), and a page per tab that hears the
 * other tabs' `storage` events, like browser tabs of one origin.
 */
import type { LockManagerLike, StorageEventLike, TabLockEnv } from '../../src/app/tabLock.ts';
import type { StorageBackend } from '../../src/persist/storage.ts';

const abortError = (): DOMException => new DOMException('The lock was stolen.', 'AbortError');

/**
 * One origin's lock manager, shared by its tabs, with the Web Locks rules the app uses: one
 * exclusive lock per name; `ifAvailable` answers null when it is held; `steal` takes it (the
 * holder's request fails with AbortError); any other request waits in line (first come, first
 * served) until the lock is free, or until its `signal` aborts (it leaves the line and fails with
 * AbortError). Callbacks run on a microtask, as in browsers. `signals: false` ignores signals.
 */
export class FakeLocks implements LockManagerLike {
  /** The held lock of each name: who to tell when it is stolen. */
  private readonly held = new Map<string, { abort: () => void }>();
  /** Requests waiting for each name, in order. */
  private readonly waiting = new Map<string, (() => void)[]>();
  /** Every request, for the tests: its options (without the signal). */
  readonly requests: { ifAvailable?: boolean; steal?: boolean }[] = [];
  private readonly signals: boolean;

  constructor(options: { signals?: boolean } = {}) {
    this.signals = options.signals !== false;
  }

  isHeld(name: string): boolean {
    return this.held.has(name);
  }

  queued(name: string): number {
    return this.waiting.get(name)?.length ?? 0;
  }

  request(
    name: string,
    options: { ifAvailable?: boolean; steal?: boolean; signal?: AbortSignal },
    callback: (lock: unknown) => unknown,
  ): Promise<unknown> {
    const { signal: given, ...shown } = options;
    const signal = this.signals ? given : undefined;
    this.requests.push(shown);
    return new Promise((resolve, reject) => {
      const take = (): void => {
        const entry = { abort: () => reject(abortError()) };
        this.held.set(name, entry);
        Promise.resolve(callback({ name, mode: 'exclusive' })).then(
          (value) => {
            this.free(name, entry);
            resolve(value);
          },
          (error: unknown) => {
            this.free(name, entry);
            reject(error);
          },
        );
      };
      queueMicrotask(() => {
        const current = this.held.get(name);
        if (current === undefined) {
          take();
        } else if (options.steal === true) {
          this.held.delete(name);
          current.abort();
          take();
        } else if (options.ifAvailable === true) {
          Promise.resolve(callback(null)).then(resolve, reject);
        } else if (signal?.aborted === true) {
          reject(abortError());
        } else {
          const line = this.waiting.get(name) ?? [];
          line.push(take);
          this.waiting.set(name, line);
          signal?.addEventListener(
            'abort',
            () => {
              const at = line.indexOf(take);
              if (at < 0) return; // granted already
              line.splice(at, 1);
              reject(abortError());
            },
            { once: true },
          );
        }
      });
    });
  }

  /** `entry` lets go: the next request in line gets the lock. */
  private free(name: string, entry: { abort: () => void }): void {
    if (this.held.get(name) !== entry) return;
    this.held.delete(name);
    this.waiting.get(name)?.shift()?.();
  }
}

/** The tabs of one origin: one `localStorage` and one lock manager. */
export class FakeOrigin {
  readonly pages: FakePage[] = [];
  readonly backend: StorageBackend & { data: Map<string, string> };
  readonly locks: FakeLocks | null;
  /**
   * Deliver `storage` events later (on a microtask), as browsers queue them, instead of inside
   * the write: then a tab can still write before it hears another tab's write.
   */
  readonly lateEvents: boolean;
  /** A tab's next `getItem` of a key runs this first (to change the storage between two reads). */
  beforeRead: ((key: string) => void) | null = null;

  constructor(
    backend: StorageBackend & { data: Map<string, string> },
    locks: FakeLocks | null = new FakeLocks(),
    options: { lateEvents?: boolean } = {},
  ) {
    this.backend = backend;
    this.locks = locks;
    this.lateEvents = options.lateEvents === true;
  }

  /** A new tab (its own `storage` listeners). */
  page(): FakePage {
    const page = new FakePage(this);
    this.pages.push(page);
    return page;
  }

  /** `localStorage` as a tab sees it: its writes are heard by the other tabs. */
  storageFor(page: FakePage): StorageBackend {
    const { backend } = this;
    return {
      getItem: (key) => {
        this.beforeRead?.(key);
        return backend.getItem(key);
      },
      setItem: (key, value) => {
        backend.setItem(key, value);
        page.writes.push(key);
        this.broadcast(page, key);
      },
      removeItem: (key) => {
        backend.removeItem(key);
        page.writes.push(key);
        this.broadcast(page, key);
      },
    };
  }

  /** Another tab wrote `key`: every other tab hears it (as browsers do, after the write). */
  broadcast(from: FakePage | null, key: string | null): void {
    for (const page of this.pages) {
      if (page === from) continue;
      const event = { key, storageArea: this.backend };
      if (this.lateEvents) queueMicrotask(() => page.hear(event));
      else page.hear(event);
    }
  }
}

/** One tab: what `createTabLock` reads (`TabLockEnv`). */
export class FakePage implements TabLockEnv {
  private readonly listeners = new Set<(event: StorageEventLike) => void>();
  readonly locks: FakeLocks | null;
  readonly localStorage: unknown;
  readonly origin: FakeOrigin;
  /** The keys this tab wrote or removed, in order. */
  readonly writes: string[] = [];

  constructor(origin: FakeOrigin) {
    this.origin = origin;
    this.locks = origin.locks;
    this.localStorage = origin.backend;
  }

  addEventListener(_type: 'storage', listener: (event: StorageEventLike) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'storage', listener: (event: StorageEventLike) => void): void {
    this.listeners.delete(listener);
  }

  hear(event: StorageEventLike): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  listening(): number {
    return this.listeners.size;
  }
}

/** Lets microtasks (lock callbacks) run. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
