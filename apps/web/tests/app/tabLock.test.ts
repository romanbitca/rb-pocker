// @vitest-environment jsdom
/**
 * The tab lock (PLAN §14.7): Web Locks decide which tab writes; without them the `storage` event
 * does. Two or three `createTabLock`s over one fake origin are tabs of one site. The controller's
 * side (read-only mode, "Play here", no lost update) is `tests/app/controller.tabs.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  browserTabLockEnv,
  createTabLock,
  webLocksOf,
  WRITER_LOCK,
  type LockManagerLike,
  type TabLockEvent,
} from '../../src/app/tabLock.ts';
import { STORAGE_KEYS } from '../../src/persist/storage.ts';
import { FakeStorage } from '../persist/fakeStorage.ts';
import { FakeLocks, FakeOrigin, settle, type FakePage } from './fakeLocks.ts';

/** A tab's lock and what it heard. */
function tab(page: FakePage) {
  const events: TabLockEvent[] = [];
  const lock = createTabLock(page);
  return { lock, events, start: () => lock.start((e) => events.push(e)) };
}

describe('with Web Locks', () => {
  it('the first tab writes; a second one is told another tab has the game', async () => {
    const origin = new FakeOrigin(new FakeStorage());
    const a = tab(origin.page());
    const b = tab(origin.page());
    expect(a.lock.mode).toBe('locks');
    a.start();
    expect(a.events).toEqual([]); // the answer is not synchronous
    await settle();
    expect(a.events).toEqual(['granted']);
    b.start();
    await settle();
    expect(b.events).toEqual(['denied']);
    // B also waits in line, so closing A hands the game to B (the banner: "Close it, or…").
    expect(origin.locks?.requests).toEqual([{ ifAvailable: true }, { ifAvailable: true }, {}]);
    expect(origin.locks?.queued(WRITER_LOCK)).toBe(1);
  });

  it('closing the tab that has the game hands it to the one waiting', async () => {
    const origin = new FakeOrigin(new FakeStorage());
    const a = tab(origin.page());
    const b = tab(origin.page());
    a.start();
    await settle();
    b.start();
    await settle();
    a.lock.release(); // the tab closes
    await settle();
    expect(b.events).toEqual(['denied', 'granted']);
    expect(origin.locks?.isHeld(WRITER_LOCK)).toBe(true);
  });

  it('"Play here" steals the lock: the old tab loses it, the new one writes', async () => {
    const origin = new FakeOrigin(new FakeStorage());
    const a = tab(origin.page());
    const b = tab(origin.page());
    a.start();
    await settle();
    b.start();
    await settle();
    b.lock.takeOver();
    await settle();
    expect(origin.locks?.requests).toContainEqual({ steal: true });
    expect(a.events).toEqual(['granted', 'lost']);
    expect(b.events).toEqual(['denied', 'granted']);
    // And back again.
    a.lock.takeOver();
    await settle();
    expect(a.events).toEqual(['granted', 'lost', 'granted']);
    expect(b.events).toEqual(['denied', 'granted', 'lost']);
    // The tab that lost it waits in line again: A closes, B has the game.
    a.lock.release();
    await settle();
    expect(b.events).toEqual(['denied', 'granted', 'lost', 'granted']);
  });

  it('a tab that still holds the lock (a rev conflict made it read-only) just writes again', async () => {
    const origin = new FakeOrigin(new FakeStorage());
    const a = tab(origin.page());
    a.start();
    await settle();
    const requests = origin.locks?.requests.length;
    a.lock.takeOver();
    expect(a.events).toEqual(['granted', 'granted']);
    expect(origin.locks?.requests.length).toBe(requests);
  });

  it('release lets the next tab have it; nothing is heard after release', async () => {
    const origin = new FakeOrigin(new FakeStorage());
    const page = origin.page();
    const a = tab(page);
    a.start();
    await settle();
    expect(origin.locks?.isHeld(WRITER_LOCK)).toBe(true);
    a.lock.release();
    await settle();
    expect(origin.locks?.isHeld(WRITER_LOCK)).toBe(false);
    expect(page.listening()).toBe(0);
    const b = tab(origin.page());
    b.start();
    await settle();
    expect(b.events).toEqual(['granted']);
  });

  it('a read-only tab hears the writer change the profile (not the session, not other keys)', async () => {
    const origin = new FakeOrigin(new FakeStorage());
    const pageA = origin.page();
    const a = tab(pageA);
    const b = tab(origin.page());
    a.start();
    await settle();
    b.start();
    await settle();
    origin.broadcast(pageA, STORAGE_KEYS.session);
    origin.broadcast(pageA, STORAGE_KEYS.hands);
    origin.broadcast(pageA, 'someone.else');
    origin.broadcast(pageA, STORAGE_KEYS.profile);
    expect(b.events).toEqual(['denied', 'changed']);
    // The writer hears nothing it has to act on from a session write by another (old) tab.
    expect(a.events).toEqual(['granted']);
  });

  it('a lock manager that refuses (e.g. a SecurityError): the fallback, writer at once', async () => {
    const refusing: LockManagerLike = {
      request: () => Promise.reject(new DOMException('no', 'SecurityError')),
    };
    const throwing: LockManagerLike = {
      request: () => {
        throw new TypeError('not here');
      },
    };
    for (const locks of [refusing, throwing]) {
      const lock = createTabLock({
        locks,
        addEventListener: () => {},
        removeEventListener: () => {},
        localStorage: null,
      });
      const events: TabLockEvent[] = [];
      lock.start((e) => events.push(e));
      await settle();
      expect(events).toEqual(['granted']);
      expect(lock.mode).toBe('fallback');
    }
  });
});

describe('without Web Locks: the rev check and the storage event (§14.7)', () => {
  it('every tab starts as the writer, at once; another tab writing the game makes it read-only', async () => {
    const origin = new FakeOrigin(new FakeStorage(), null);
    const pageA = origin.page();
    const pageB = origin.page();
    const a = tab(pageA);
    const b = tab(pageB);
    expect(a.lock.mode).toBe('fallback');
    a.start();
    b.start();
    expect(a.events).toEqual(['granted']);
    expect(b.events).toEqual(['granted']);
    // B writes the session (it dealt a hand): A stops writing.
    origin.broadcast(pageB, STORAGE_KEYS.session);
    expect(a.events).toEqual(['granted', 'lost']);
    // From then on A only hears profile changes, to show the new numbers.
    origin.broadcast(pageB, STORAGE_KEYS.session);
    origin.broadcast(pageB, STORAGE_KEYS.profile);
    expect(a.events).toEqual(['granted', 'lost', 'changed']);
    // "Play here": A writes again at once (the controller then writes the profile, and B hears it).
    a.lock.takeOver();
    expect(a.events).toEqual(['granted', 'lost', 'changed', 'granted']);
    origin.broadcast(pageA, STORAGE_KEYS.profile);
    expect(b.events).toEqual(['granted', 'lost']);
  });

  it('a whole-storage clear counts as a profile write; other storage areas are not ours', () => {
    const origin = new FakeOrigin(new FakeStorage(), null);
    const page = origin.page();
    const a = tab(page);
    a.start();
    page.hear({ key: STORAGE_KEYS.profile, storageArea: {} });
    expect(a.events).toEqual(['granted']);
    page.hear({ key: null, storageArea: origin.backend });
    expect(a.events).toEqual(['granted', 'lost']);
  });
});

describe('the real page', () => {
  it('feature-detects navigator.locks, never throwing', () => {
    expect(webLocksOf(window)).toBe(null); // jsdom has no Web Locks
    const locks = new FakeLocks();
    const withLocks = { navigator: { locks } } as unknown as Window;
    expect(webLocksOf(withLocks)).toBe(locks);
    const throwing = {
      get navigator(): never {
        throw new Error('blocked');
      },
    } as unknown as Window;
    expect(webLocksOf(throwing)).toBe(null);
  });

  it('listens to the window and tells localStorage events from others', () => {
    const env = browserTabLockEnv(window);
    expect(env.locks).toBe(null);
    expect(env.localStorage).toBe(window.localStorage);
    const lock = createTabLock(env);
    const events: TabLockEvent[] = [];
    lock.start((e) => events.push(e));
    expect(events).toEqual(['granted']);
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: STORAGE_KEYS.profile,
        storageArea: window.sessionStorage,
      }),
    );
    expect(events).toEqual(['granted']);
    window.dispatchEvent(
      new StorageEvent('storage', { key: STORAGE_KEYS.profile, storageArea: window.localStorage }),
    );
    expect(events).toEqual(['granted', 'lost']);
    lock.release();
    window.dispatchEvent(
      new StorageEvent('storage', { key: STORAGE_KEYS.session, storageArea: window.localStorage }),
    );
    expect(events).toEqual(['granted', 'lost']);
  });

  it('blocked localStorage: no storage events to tell apart, still works', () => {
    const win = {
      navigator: {},
      get localStorage(): never {
        throw new DOMException('blocked', 'SecurityError');
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as Window;
    const env = browserTabLockEnv(win);
    expect(env.localStorage).toBe(null);
    const lock = createTabLock(env);
    const events: TabLockEvent[] = [];
    lock.start((e) => events.push(e));
    expect(events).toEqual(['granted']);
  });
});
