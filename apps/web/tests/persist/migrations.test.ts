import { describe, expect, it } from 'vitest';
import {
  PROFILE_MIGRATIONS,
  PROFILE_VERSION,
  SESSION_MIGRATIONS,
  SESSION_VERSION,
  migrate,
  schemaOf,
  type Migrations,
} from '../../src/persist/migrations.ts';
import { loadProfile } from '../../src/persist/profile.ts';
import { defaultProfile, isProfile, type Profile } from '../../src/persist/schema.ts';
import { createSafeStorage, STORAGE_KEYS } from '../../src/persist/storage.ts';
import { FakeStorage } from './fakeStorage.ts';
import { NOW, profileV0ToV1, v0Profile } from './fixtures.ts';
import profileV1 from './fixtures/profile.v1.json' with { type: 'json' };

function deepFreeze<T>(x: T): T {
  if (typeof x === 'object' && x !== null) {
    for (const value of Object.values(x)) deepFreeze(value);
    Object.freeze(x);
  }
  return x;
}

describe('persist/migrations scaffold (Appendix H.2)', () => {
  it('version 1 is the first schema: no migrations yet', () => {
    expect(PROFILE_VERSION).toBe(1);
    expect(SESSION_VERSION).toBe(1);
    expect(Object.keys(PROFILE_MIGRATIONS)).toEqual([]);
    expect(Object.keys(SESSION_MIGRATIONS)).toEqual([]);
  });

  it('identity: a current profile comes back unchanged, as the same object', () => {
    const profile = deepFreeze(defaultProfile(NOW));
    const result = migrate(profile, PROFILE_VERSION, PROFILE_MIGRATIONS);
    expect(result).toEqual({ ok: true, value: profile, from: 1 });
    if (result.ok) expect(result.value).toBe(profile);
  });

  it('reads the schema field', () => {
    expect(schemaOf({ schema: 0 })).toBe(0);
    expect(schemaOf({ schema: 3 })).toBe(3);
    for (const x of [{}, { schema: '1' }, { schema: -1 }, { schema: 1.5 }, [1], null, 1, 'x']) {
      expect(schemaOf(x)).toBeNull();
    }
  });
});

describe('persist/migrations mechanism (§14.9: a hand-written v0 fixture)', () => {
  const V0: Migrations = { 0: profileV0ToV1 };

  it('migrates the v0 fixture to a valid v1 profile, keeping unknown fields in legacy', () => {
    const v0 = deepFreeze(v0Profile());
    const result = migrate(v0, 1, V0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.from).toBe(0);
    expect(isProfile(result.value)).toBe(true);
    const p = result.value as Profile & { legacy: unknown };
    expect(p.settings).toMatchObject({
      players: 4,
      startingStack: 5000,
      sb: 25,
      bb: 50,
      botLevel: 'medium',
      coachLevel: 'intermediate',
      speed: 'fast',
      sound: false,
      seatLevels: [null, null, null, null],
    });
    expect(p.createdAt).toBe('2026-09-01T08:00:00.000Z');
    expect(p.legacy).toEqual({ theme: 'felt-blue' });
  });

  it('runs the steps in order, one version at a time', () => {
    const seen: number[] = [];
    const steps: Migrations = {
      0: (x) => (seen.push(0), { ...(x as object), schema: 1, a: true }),
      1: (x) => (seen.push(1), { ...(x as object), schema: 2, b: true }),
    };
    expect(migrate({ schema: 0 }, 2, steps)).toEqual({
      ok: true,
      value: { schema: 2, a: true, b: true },
      from: 0,
    });
    expect(seen).toEqual([0, 1]);
    seen.length = 0;
    expect(migrate({ schema: 1 }, 2, steps)).toMatchObject({ ok: true, from: 1 });
    expect(seen).toEqual([1]);
  });

  it('never throws: every failure is a problem', () => {
    const cases: [unknown, Migrations, string][] = [
      [{ schema: 0 }, {}, 'no migration from schema 0'],
      [{ schema: 5 }, {}, 'schema 5 is newer than this app (1)'],
      [{ version: 1 }, {}, 'no schema version'],
      ['{"schema":1}', {}, 'no schema version'],
      [
        { schema: 0 },
        {
          0: () => {
            throw new Error('boom');
          },
        },
        'the migration from schema 0 failed (boom)',
      ],
      [{ schema: 0 }, { 0: (x) => x }, 'the migration from schema 0 produced schema 0'],
      [{ schema: 0 }, { 0: () => null }, 'the migration from schema 0 produced schema null'],
    ];
    for (const [x, steps, problem] of cases) {
      expect(migrate(x, 1, steps)).toEqual({ ok: false, problem });
    }
  });
});

describe('frozen fixtures of past schema versions (H.2 rule 1, chunk 8.1)', () => {
  it('profile.v1.json (stats, hero model, flags) still loads as it is', () => {
    const backend = new FakeStorage({ [STORAGE_KEYS.profile]: JSON.stringify(profileV1) });
    const load = loadProfile(
      createSafeStorage(() => backend),
      { now: NOW },
    );
    expect(load).toEqual({ status: 'ok', profile: profileV1, migratedFrom: null });
    expect(backend.writeLog).toEqual([]);
    // From schema 2 on, this fixture loads through PROFILE_MIGRATIONS[1] instead.
    expect(migrate(profileV1, PROFILE_VERSION, PROFILE_MIGRATIONS)).toMatchObject({
      ok: true,
      from: 1,
    });
  });
});
