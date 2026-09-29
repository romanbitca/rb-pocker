import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CORRUPT_KEY_PREFIX,
  STORAGE_KEYS,
  classifyStorageError,
  createSafeStorage,
  keepCorruptCopy,
  type StorageFailure,
} from '../../src/persist/storage.ts';
import { FakeStorage, quotaError, securityError } from './fakeStorage.ts';

const NOW = new Date('2026-09-28T10:00:00.000Z');

describe('persist/storage keys', () => {
  it('uses the §14.2 key names, with the internal pc prefix (§0.3)', () => {
    expect(STORAGE_KEYS).toEqual({
      profile: 'pc.v1.profile',
      profileBackup: 'pc.v1.profile.bak',
      hands: 'pc.v1.hands',
      session: 'pc.v1.session',
      diag: 'pc.v1.diag',
      preimport: 'pc.v1.preimport',
    });
    expect(CORRUPT_KEY_PREFIX).toBe('pc.corrupt.');
  });
});

describe('persist/storage with a working browser storage', () => {
  it('reads, writes and removes strings', () => {
    const fake = new FakeStorage();
    const store = createSafeStorage(() => fake);
    expect(store.get('k')).toEqual({ ok: true, value: null });
    expect(store.set('k', 'v1')).toEqual({ ok: true });
    expect(store.get('k')).toEqual({ ok: true, value: 'v1' });
    expect(fake.data.get('k')).toBe('v1');
    expect(store.remove('k')).toEqual({ ok: true });
    expect(store.get('k')).toEqual({ ok: true, value: null });
    expect(fake.data.has('k')).toBe(false);
    expect(store.failure).toBeNull();
  });

  it('never reports a failure while every call works', () => {
    const store = createSafeStorage(() => new FakeStorage());
    const listener = vi.fn();
    store.onFailure(listener);
    store.set('a', '1');
    store.get('a');
    store.remove('a');
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('persist/storage failures (§14.6 rule 3: never throws)', () => {
  it('missing localStorage: every call fails with "unavailable", and the game keeps the values in memory', () => {
    for (const missing of [undefined, null]) {
      const store = createSafeStorage(() => missing);
      expect(store.get('k')).toEqual({ ok: false, reason: 'unavailable' });
      expect(store.set('k', 'v')).toEqual({ ok: false, reason: 'unavailable' });
      // In-memory mode: the value we tried to write reads back for the rest of the launch.
      expect(store.get('k')).toEqual({ ok: true, value: 'v' });
      expect(store.remove('k')).toEqual({ ok: false, reason: 'unavailable' });
      expect(store.get('k')).toEqual({ ok: true, value: null });
      expect(store.failure).toBe('unavailable');
    }
  });

  it('a SecurityError from merely reading window.localStorage is caught', () => {
    const store = createSafeStorage(() => {
      throw securityError();
    });
    expect(store.get('k')).toEqual({ ok: false, reason: 'security' });
    expect(store.set('k', 'v')).toEqual({ ok: false, reason: 'security' });
    expect(store.failure).toBe('security');
  });

  it('a SecurityError from getItem is caught', () => {
    const fake = new FakeStorage({ k: 'v' });
    fake.failAll = securityError();
    const store = createSafeStorage(() => fake);
    expect(store.get('k')).toEqual({ ok: false, reason: 'security' });
  });

  it('quota exceeded on write: ok false, the value stays in memory, the stored value is untouched', () => {
    const fake = new FakeStorage({ k: 'old' });
    fake.failWrites = quotaError();
    const store = createSafeStorage(() => fake);
    expect(store.set('k', 'new')).toEqual({ ok: false, reason: 'quota' });
    expect(store.get('k')).toEqual({ ok: true, value: 'new' });
    expect(fake.data.get('k')).toBe('old');
    expect(store.failure).toBe('quota');
  });

  it('a real size quota is reported the same way', () => {
    const fake = new FakeStorage();
    fake.quota = 20;
    const store = createSafeStorage(() => fake);
    expect(store.set('a', 'x'.repeat(10))).toEqual({ ok: true });
    expect(store.set('b', 'x'.repeat(10))).toEqual({ ok: false, reason: 'quota' });
    // Replacing a value frees its old size first.
    expect(store.set('a', 'y'.repeat(18))).toEqual({ ok: true });
  });

  it('retries the browser storage on the next write, and a success ends the in-memory override', () => {
    const fake = new FakeStorage();
    fake.failWrites = quotaError();
    const store = createSafeStorage(() => fake);
    expect(store.set('k', 'v1').ok).toBe(false);
    fake.failWrites = null; // space was freed
    expect(store.set('k', 'v2')).toEqual({ ok: true });
    expect(fake.data.get('k')).toBe('v2');
    fake.data.set('k', 'from another tab');
    expect(store.get('k')).toEqual({ ok: true, value: 'from another tab' });
  });

  it('a failed removal reads back as absent in memory', () => {
    const fake = new FakeStorage({ k: 'v' });
    const store = createSafeStorage(() => fake);
    fake.failAll = new Error('broken');
    expect(store.remove('k')).toEqual({ ok: false, reason: 'error' });
    fake.failAll = null;
    expect(store.get('k')).toEqual({ ok: true, value: null });
    expect(fake.data.get('k')).toBe('v');
  });

  it('classifies what browsers throw', () => {
    const cases: [unknown, StorageFailure][] = [
      [quotaError(), 'quota'],
      [{ name: 'NS_ERROR_DOM_QUOTA_REACHED' }, 'quota'],
      [{ name: 'Error', code: 22 }, 'quota'],
      [{ code: 1014 }, 'quota'],
      [securityError(), 'security'],
      [{ code: 18 }, 'security'],
      [new TypeError('x'), 'error'],
      ['a string', 'error'],
      [null, 'error'],
      [undefined, 'error'],
    ];
    for (const [error, reason] of cases) expect(classifyStorageError(error)).toBe(reason);
  });
});

describe('persist/storage failure notice (§12.14: the banner once per launch)', () => {
  it('calls each listener once, at the first failure only', () => {
    const fake = new FakeStorage();
    const store = createSafeStorage(() => fake);
    const listener = vi.fn();
    store.onFailure(listener);
    fake.failWrites = quotaError();
    store.set('a', '1');
    store.set('b', '2');
    fake.failAll = securityError();
    store.get('c');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('quota');
    expect(store.failure).toBe('quota');
  });

  it('a listener added after the failure is called at once, and only once', () => {
    const store = createSafeStorage(() => null);
    store.get('k');
    const late = vi.fn();
    store.onFailure(late);
    store.get('k2');
    expect(late).toHaveBeenCalledTimes(1);
    expect(late).toHaveBeenCalledWith('unavailable');
  });

  it('an unsubscribed listener is not called', () => {
    const store = createSafeStorage(() => null);
    const listener = vi.fn();
    const off = store.onFailure(listener);
    off();
    store.get('k');
    expect(listener).not.toHaveBeenCalled();
  });

  it('a listener that throws does not break the storage call', async () => {
    const store = createSafeStorage(() => null);
    const thrown: unknown[] = [];
    const onError = (e: unknown): void => {
      thrown.push(e);
    };
    const boom = new Error('listener bug');
    const other = vi.fn();
    store.onFailure(() => {
      throw boom;
    });
    store.onFailure(other);
    // The re-thrown error surfaces on a microtask; catch it here instead of failing the run.
    const original = globalThis.queueMicrotask;
    globalThis.queueMicrotask = (task) =>
      original(() => {
        try {
          task();
        } catch (e) {
          onError(e);
        }
      });
    try {
      expect(store.set('k', 'v')).toEqual({ ok: false, reason: 'unavailable' });
      await Promise.resolve();
    } finally {
      globalThis.queueMicrotask = original;
    }
    expect(other).toHaveBeenCalledWith('unavailable');
    expect(thrown).toEqual([boom]);
  });
});

describe('persist/storage default backend (window.localStorage)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses globalThis.localStorage', () => {
    const fake = new FakeStorage();
    vi.stubGlobal('localStorage', fake);
    const store = createSafeStorage();
    expect(store.set('k', 'v')).toEqual({ ok: true });
    expect(fake.data.get('k')).toBe('v');
  });

  it('works without any localStorage global (Node, old web views)', () => {
    vi.stubGlobal('localStorage', undefined);
    const store = createSafeStorage();
    expect(store.get('k')).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('survives a localStorage getter that throws SecurityError', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw securityError();
      },
    });
    try {
      const store = createSafeStorage();
      expect(store.set('k', 'v')).toEqual({ ok: false, reason: 'security' });
    } finally {
      if (descriptor === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
      else Object.defineProperty(globalThis, 'localStorage', descriptor);
    }
  });
});

describe('persist/storage keepCorruptCopy (§14.6 rule 2)', () => {
  it('copies the raw text to pc.corrupt.<timestamp>', () => {
    const fake = new FakeStorage();
    const store = createSafeStorage(() => fake);
    expect(keepCorruptCopy(store, '{"broken', NOW)).toBe('pc.corrupt.2026-09-28T10:00:00.000Z');
    expect(fake.data.get('pc.corrupt.2026-09-28T10:00:00.000Z')).toBe('{"broken');
  });

  it('never overwrites an earlier copy', () => {
    const fake = new FakeStorage();
    const store = createSafeStorage(() => fake);
    const first = keepCorruptCopy(store, 'one', NOW);
    const second = keepCorruptCopy(store, 'two', NOW);
    const third = keepCorruptCopy(store, 'three', NOW);
    expect([first, second, third]).toEqual([
      'pc.corrupt.2026-09-28T10:00:00.000Z',
      'pc.corrupt.2026-09-28T10:00:00.000Z.1',
      'pc.corrupt.2026-09-28T10:00:00.000Z.2',
    ]);
    expect(fake.data.get(first as string)).toBe('one');
  });

  it('returns null when the copy cannot be written', () => {
    const fake = new FakeStorage();
    fake.failWrites = quotaError();
    expect(
      keepCorruptCopy(
        createSafeStorage(() => fake),
        'x',
        NOW,
      ),
    ).toBeNull();
    expect(
      keepCorruptCopy(
        createSafeStorage(() => null),
        'x',
        NOW,
      ),
    ).toBeNull();
  });
});
