import { describe, expect, it } from 'vitest';
import {
  DEFAULTS_REV,
  PROFILE_MIGRATIONS,
  PROFILE_VERSION,
  SESSION_MIGRATIONS,
  SESSION_VERSION,
  migrate,
  schemaOf,
  upgradeDefaults,
  type Migrations,
} from '../../src/persist/migrations.ts';
import { loadProfile } from '../../src/persist/profile.ts';
import {
  defaultProfile,
  defaultSettings,
  isProfile,
  type Profile,
} from '../../src/persist/schema.ts';
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
  it('profile.v1.json (stats, hero model, flags) still loads, at the current defaults', () => {
    const backend = new FakeStorage({ [STORAGE_KEYS.profile]: JSON.stringify(profileV1) });
    const load = loadProfile(
      createSafeStorage(() => backend),
      { now: NOW },
    );
    // Saved before 1.3.94 (no `defaultsRev`, "Deal the next hand by itself" on): everything as it
    // was but that switch, now off, and the revision that did it (H.2 rule 6), written back.
    const upgraded = {
      ...profileV1,
      settings: { ...profileV1.settings, autoNext: false, defaultsRev: DEFAULTS_REV },
    };
    expect(load).toEqual({ status: 'ok', profile: upgraded, migratedFrom: null });
    expect(backend.writeLog).toEqual([STORAGE_KEYS.profile]);
    expect(JSON.parse(backend.data.get(STORAGE_KEYS.profile) as string)).toEqual(upgraded);
    // From schema 2 on, this fixture loads through PROFILE_MIGRATIONS[1] instead.
    expect(migrate(profileV1, PROFILE_VERSION, PROFILE_MIGRATIONS)).toMatchObject({
      ok: true,
      from: 1,
    });
  });
});

describe('persist/migrations defaults revision (H.2 rule 6, 1.3.94)', () => {
  const old = (): Profile => {
    const p = defaultProfile(NOW);
    delete p.settings.defaultsRev; // as saved before 1.3.94
    return { ...p, settings: { ...p.settings, autoNext: true } };
  };

  it('revision 0 (no defaultsRev): "Deal the next hand by itself" goes off, the revision is kept', () => {
    const before = deepFreeze(old());
    const after = upgradeDefaults(before) as Profile;
    expect(after).not.toBe(before); // pure: a new object, the frozen input untouched
    expect(after).toEqual({
      ...before,
      settings: { ...before.settings, autoNext: false, defaultsRev: DEFAULTS_REV },
    });
    expect(isProfile(after)).toBe(true);
    // Whatever the old value: an old profile with it off already gets only the revision.
    const off = upgradeDefaults({ ...before, settings: { ...before.settings, autoNext: false } });
    expect((off as Profile).settings).toMatchObject({ autoNext: false, defaultsRev: 1 });
    // A revision 0 written out counts as absent.
    const zero = upgradeDefaults({ ...before, settings: { ...before.settings, defaultsRev: 0 } });
    expect((zero as Profile).settings).toMatchObject({ autoNext: false, defaultsRev: 1 });
  });

  it('once: at this revision or a newer one, the same object comes back (a choice stays)', () => {
    const on = deepFreeze({
      ...defaultProfile(NOW),
      settings: { ...defaultSettings(), autoNext: true }, // turned on again after the upgrade
    });
    expect(upgradeDefaults(on)).toBe(on);
    expect(upgradeDefaults(upgradeDefaults(old()))).toEqual(upgradeDefaults(old()));
    const newer = deepFreeze({ ...on, settings: { ...on.settings, defaultsRev: 2 } });
    expect(upgradeDefaults(newer)).toBe(newer);
  });

  it('never throws: what is not a profile with settings comes back as it is, for the guard', () => {
    const odd: unknown[] = [
      null,
      1,
      'profile',
      [],
      {},
      { schema: 1, settings: null },
      { schema: 1, settings: [] },
      { schema: 1, settings: { autoNext: true, defaultsRev: '1' } },
    ];
    for (const x of odd) expect(upgradeDefaults(x)).toBe(x);
  });
});
