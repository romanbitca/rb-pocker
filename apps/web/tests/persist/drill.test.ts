// PLAN §13.5, §14.6, Appendix H: the hand drill's own key `pc.v1.drill`: the guard, the load path
// (JSON, schema, migrations, guard), a damaged value copied to pc.corrupt.<time> and the drill
// started fresh, private modes in memory (SafeStorage), and saves that never write a bad value.
import { describe, expect, it } from 'vitest';
import { drillStorage } from '../../src/app/drill.ts';
import { emptyDrillData, type DrillData } from '../../src/drill/data.ts';
import {
  DRILL_MIGRATIONS,
  DRILL_VERSION,
  drillDataProblem,
  loadDrillData,
  saveDrillData,
} from '../../src/persist/drill.ts';
import { createSafeStorage, STORAGE_KEYS } from '../../src/persist/storage.ts';
import { FakeStorage, quotaError, securityError } from './fakeStorage.ts';

const KEY = STORAGE_KEYS.drill;
const NOW = new Date('2026-11-06T10:00:00.000Z');

const sample = (): DrillData => {
  const data = emptyDrillData();
  return {
    ...data,
    game: 'showdown',
    difficulty: 'hard',
    best: 7,
    answered: 31,
    hands: { ...data.hands, flush: { seen: 6, missed: 2 }, royalFlush: { seen: 1, missed: 1 } },
  };
};

function storeWith(raw: string | null) {
  const backend = new FakeStorage(raw === null ? {} : { [KEY]: raw });
  return { backend, store: createSafeStorage(() => backend) };
}

describe('pc.v1.drill guard', () => {
  it('accepts a valid value, and fields it does not know (H.2 rule 2)', () => {
    expect(KEY).toBe('pc.v1.drill');
    expect(DRILL_VERSION).toBe(1);
    expect(DRILL_MIGRATIONS).toEqual({});
    expect(drillDataProblem(sample())).toBeNull();
    expect(drillDataProblem({ ...sample(), later: { x: 1 } })).toBeNull();
  });

  it.each([
    ['not an object', null],
    ['an array', []],
    ['another schema', { ...sample(), schema: 2 }],
    ['an unknown game', { ...sample(), game: 'poker' }],
    ['an unknown difficulty', { ...sample(), difficulty: 'insane' }],
    ['a negative best', { ...sample(), best: -1 }],
    ['a fractional count', { ...sample(), answered: 1.5 }],
    ['no hands', { ...sample(), hands: undefined }],
    ['a missing hand', { ...sample(), hands: { ...sample().hands, pair: undefined } }],
    [
      'more misses than answers',
      { ...sample(), hands: { ...sample().hands, pair: { seen: 1, missed: 2 } } },
    ],
    [
      'a count as text',
      { ...sample(), hands: { ...sample().hands, pair: { seen: '3', missed: 0 } } },
    ],
  ])('refuses %s', (_name, value) => {
    expect(drillDataProblem(value)).not.toBeNull();
  });
});

describe('pc.v1.drill load and save', () => {
  it('reads nothing on a first visit, and what it saved after', () => {
    const { store, backend } = storeWith(null);
    expect(loadDrillData(store, NOW)).toEqual({ status: 'empty' });
    expect(saveDrillData(store, sample())).toEqual({ ok: true });
    expect(JSON.parse(backend.data.get(KEY) as string)).toEqual(sample());
    expect(loadDrillData(store, NOW)).toEqual({ status: 'ok', data: sample() });
  });

  it.each([
    ['broken JSON', '{"schema":1,'],
    ['a wrong shape', JSON.stringify({ ...sample(), best: 'many' })],
    [
      'a newer schema (counts as damaged, §14.6 rule 2)',
      JSON.stringify({ ...sample(), schema: 9 }),
    ],
    ['no schema', JSON.stringify({ game: 'cards' })],
  ])('copies %s to pc.corrupt.<time> and starts fresh', (_name, raw) => {
    const { store, backend } = storeWith(raw);
    const found = loadDrillData(store, NOW);
    expect(found.status).toBe('damaged');
    if (found.status !== 'damaged') return;
    expect(found.kept).toBe(`pc.corrupt.${NOW.toISOString()}`);
    expect(backend.data.get(found.kept as string)).toBe(raw);
    expect(backend.data.has(KEY)).toBe(false); // removed: the next load is a first visit
    expect(loadDrillData(store, NOW)).toEqual({ status: 'empty' });
  });

  it('never overwrites a damaged value it could not copy (§14.6 rule 2)', () => {
    const { store, backend } = storeWith('not json');
    backend.failWrites = quotaError(); // the copy cannot be written
    const storage = drillStorage(
      store,
      () => NOW,
      () => true,
    );
    expect(storage.load()).toBeNull();
    backend.failWrites = null;
    storage.save(sample()); // still blocked for this launch
    expect(backend.data.get(KEY)).toBe('not json');
  });

  it('runs a migration step and writes the result back (the mechanism, with a test step)', () => {
    const migrations = DRILL_MIGRATIONS as Record<number, (x: unknown) => unknown>;
    const { store, backend } = storeWith(JSON.stringify({ ...sample(), schema: 0 }));
    migrations[0] = (x) => ({ ...(x as object), schema: 1 });
    try {
      expect(loadDrillData(store, NOW)).toEqual({ status: 'ok', data: sample() });
      expect(JSON.parse(backend.data.get(KEY) as string)).toEqual(sample());
    } finally {
      delete migrations[0];
    }
  });

  it('never writes a value that fails the guard', () => {
    const { store, backend } = storeWith(null);
    const bad = { ...sample(), best: -3 } as DrillData;
    const result = saveDrillData(store, bad);
    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
    expect(backend.data.has(KEY)).toBe(false);
  });

  it('keeps playing in memory when the browser storage fails (private modes, §14.6 rule 3)', () => {
    const { store, backend } = storeWith(null);
    const failures: string[] = [];
    store.onFailure((reason) => failures.push(reason));
    backend.failWrites = quotaError();
    const storage = drillStorage(
      store,
      () => NOW,
      () => true,
    );
    storage.save(sample());
    expect(backend.data.has(KEY)).toBe(false);
    expect(storage.load()).toEqual(sample()); // read back from memory for this launch
    expect(failures).toEqual(['quota']); // the banner's one call

    const blocked = createSafeStorage(() => {
      throw securityError();
    });
    expect(loadDrillData(blocked, NOW)).toEqual({ status: 'unreadable', reason: 'security' });
    expect(() => drillStorage(blocked).save(sample())).not.toThrow();
  });

  it('writes nothing in a tab that another tab took the game from (§14.7)', () => {
    const { store, backend } = storeWith(null);
    let writer = false;
    const storage = drillStorage(
      store,
      () => NOW,
      () => writer,
    );
    storage.save(sample());
    expect(backend.data.has(KEY)).toBe(false);
    writer = true;
    storage.save(sample());
    expect(backend.data.has(KEY)).toBe(true);
  });
});
