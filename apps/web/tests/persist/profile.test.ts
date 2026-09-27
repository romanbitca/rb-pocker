import { describe, expect, it, vi } from 'vitest';
import { loadProfile, saveProfile, saveSettings } from '../../src/persist/profile.ts';
import {
  defaultProfile,
  defaultSettings,
  isProfile,
  type Profile,
  type Settings,
} from '../../src/persist/schema.ts';
import { STORAGE_KEYS, createSafeStorage } from '../../src/persist/storage.ts';
import { FakeStorage, quotaError, securityError } from './fakeStorage.ts';
import { NOW, profileV0ToV1, v0Profile } from './fixtures.ts';

const KEY = STORAGE_KEYS.profile;
const LATER = new Date('2026-09-28T10:05:00.000Z');
const COPY = 'pc.corrupt.2026-09-28T10:00:00.000Z';

/** A fake browser storage and a fresh wrapper over it (a new wrapper = a new launch). */
function setup(initial: Record<string, string> = {}): {
  fake: FakeStorage;
  launch: () => ReturnType<typeof createSafeStorage>;
} {
  const fake = new FakeStorage(initial);
  return { fake, launch: () => createSafeStorage(() => fake) };
}

const custom = (): Settings => ({
  ...defaultSettings(),
  players: 4,
  seatLevels: [null, null, 'medium', null],
  startingStack: 5000,
  sb: 25,
  bb: 50,
  botLevel: 'medium',
  coachLevel: 'intermediate',
  speed: 'fast',
  autoNext: false,
  amounts: 'bb',
});

describe('persist/profile first launch and saving settings', () => {
  it('nothing stored: status new, the defaults, nothing written', () => {
    const { fake, launch } = setup();
    const load = loadProfile(launch(), { now: NOW });
    expect(load).toEqual({ status: 'new', profile: defaultProfile(NOW) });
    expect(fake.writes).toBe(0);
  });

  it('last-used settings, levels and speed survive a reload (Stage 3)', () => {
    const { fake, launch } = setup();
    const first = loadProfile(launch(), { now: NOW });
    const saved = saveSettings(launch(), first.profile, custom(), LATER);
    expect(saved.result).toEqual({ ok: true });
    expect(fake.writeLog).toEqual([KEY]);

    const reload = loadProfile(launch(), { now: LATER });
    expect(reload).toEqual({ status: 'ok', profile: saved.profile, migratedFrom: null });
    if (reload.status !== 'ok') return;
    expect(reload.profile.settings).toEqual(custom());
    expect(reload.profile.createdAt).toBe(NOW.toISOString());
    expect(reload.profile.updatedAt).toBe(LATER.toISOString());
  });

  it('the stored text round-trips deep-equal', () => {
    const { fake, launch } = setup();
    const { profile } = saveSettings(launch(), defaultProfile(NOW), custom(), LATER);
    expect(JSON.parse(fake.data.get(KEY) as string)).toStrictEqual(profile);
  });

  it('every write counts in rev and bumps updatedAt (§14.3)', () => {
    const store = setup().launch();
    let profile = defaultProfile(NOW);
    for (let i = 1; i <= 3; i++) {
      profile = saveSettings(
        store,
        profile,
        { ...profile.settings, sound: i % 2 === 0 },
        LATER,
      ).profile;
      expect(profile.rev).toBe(i);
    }
    expect(saveProfile(store, profile, LATER).profile.rev).toBe(4);
  });

  it('refuses invalid settings: nothing written, the profile unchanged', () => {
    const { fake, launch } = setup();
    const profile = defaultProfile(NOW);
    const bad = { ...defaultSettings(), players: 7 }; // seatLevels still has 6 entries
    const saved = saveSettings(launch(), profile, bad, LATER);
    expect(saved.profile).toBe(profile);
    expect(saved.result).toEqual({
      ok: false,
      reason: 'invalid',
      problem: 'settings.seatLevels: expected 7 entries, one per seat',
    });
    expect(fake.writes).toBe(0);
  });

  it('refuses a profile that would not load again', () => {
    const { fake, launch } = setup();
    const broken = { ...defaultProfile(NOW), lastCommittedHandSeq: -1 };
    const saved = saveProfile(launch(), broken, LATER);
    expect(saved.profile).toBe(broken);
    expect(saved.result).toMatchObject({ ok: false, reason: 'invalid' });
    expect(fake.writes).toBe(0);
  });
});

describe('persist/profile damaged data (§14.6 rule 2, §14.9)', () => {
  const valid = JSON.stringify(
    saveSettings(setup().launch(), defaultProfile(NOW), custom(), NOW).profile,
  );
  const damaged: [string, string, string][] = [
    ['corrupt JSON', '{"schema":1,"rev":', 'not valid JSON'],
    ['a truncated profile', valid.slice(0, valid.length - 40), 'not valid JSON'],
    ['not an object', '[1,2,3]', 'no schema version'],
    ['null', 'null', 'no schema version'],
    ['a number', '42', 'no schema version'],
    ['a string', '"profile"', 'no schema version'],
    ['no schema field', JSON.stringify({ rev: 1 }), 'no schema version'],
    ['a wrong shape', JSON.stringify({ schema: 1, settings: {} }), 'profile.rev'],
    ['wrong types', valid.replace('"players":4', '"players":"4"'), 'profile.settings.players'],
    [
      'a newer schema',
      JSON.stringify({ ...JSON.parse(valid), schema: 2 }),
      'schema 2 is newer than this app (1)',
    ],
    [
      'an older schema without a migration',
      JSON.stringify({ schema: 0 }),
      'no migration from schema 0',
    ],
  ];

  it.each(damaged)(
    '%s: the defaults, a copy of the raw text, and the defaults written back',
    (_, raw, problem) => {
      const { fake, launch } = setup({ [KEY]: raw });
      const load = loadProfile(launch(), { now: NOW });
      expect(load.status).toBe('reset');
      if (load.status !== 'reset') return;
      expect(load.problem).toContain(problem);
      expect(load.profile).toEqual(defaultProfile(NOW));
      expect(load.copiedTo).toBe(COPY);
      expect(fake.data.get(COPY)).toBe(raw);
      expect(JSON.parse(fake.data.get(KEY) as string)).toEqual(defaultProfile(NOW));
      // The next launch is normal: no second copy, no second toast.
      expect(loadProfile(launch(), { now: LATER })).toMatchObject({ status: 'ok' });
      expect([...fake.data.keys()].filter((k) => k.startsWith('pc.corrupt.'))).toEqual([COPY]);
    },
  );

  it('when the copy cannot be written, the damaged value is not overwritten', () => {
    const { fake, launch } = setup({ [KEY]: '{broken' });
    fake.failWrites = quotaError();
    const load = loadProfile(launch(), { now: NOW });
    expect(load).toMatchObject({ status: 'reset', copiedTo: null, profile: defaultProfile(NOW) });
    expect(fake.data.get(KEY)).toBe('{broken');
  });
});

describe('persist/profile migrations on load (H.2)', () => {
  it('an older profile is migrated, checked and written back', () => {
    const raw = JSON.stringify(v0Profile());
    const { fake, launch } = setup({ [KEY]: raw });
    const migrations = { 0: profileV0ToV1 };
    const load = loadProfile(launch(), { now: NOW, migrations });
    expect(load.status).toBe('ok');
    if (load.status !== 'ok') return;
    expect(load.migratedFrom).toBe(0);
    expect(load.profile.settings).toMatchObject({
      players: 4,
      bb: 50,
      speed: 'fast',
      sound: false,
    });
    const stored: unknown = JSON.parse(fake.data.get(KEY) as string);
    expect(isProfile(stored)).toBe(true);
    expect(stored).toEqual(load.profile);
    expect(loadProfile(launch(), { now: NOW, migrations })).toEqual({
      status: 'ok',
      profile: load.profile,
      migratedFrom: null,
    });
  });

  it('a migration that yields an invalid profile is treated as damage', () => {
    const { launch } = setup({ [KEY]: JSON.stringify({ schema: 0 }) });
    const load = loadProfile(launch(), { now: NOW, migrations: { 0: () => ({ schema: 1 }) } });
    expect(load).toMatchObject({ status: 'reset', copiedTo: COPY });
  });
});

describe('persist/profile when storage fails (§14.6 rule 3, §14.9)', () => {
  it('missing localStorage: the defaults in memory, no exception, the banner once', () => {
    const store = createSafeStorage(() => undefined);
    const banner = vi.fn();
    store.onFailure(banner);
    const load = loadProfile(store, { now: NOW });
    expect(load).toEqual({
      status: 'unavailable',
      profile: defaultProfile(NOW),
      reason: 'unavailable',
    });
    const saved = saveSettings(store, load.profile, custom(), LATER);
    expect(saved.result).toEqual({ ok: false, reason: 'unavailable' });
    // In memory the game keeps the new settings for the rest of the launch.
    expect(saved.profile.settings).toEqual(custom());
    expect(loadProfile(store, { now: LATER })).toMatchObject({
      status: 'ok',
      profile: saved.profile,
    });
    expect(banner).toHaveBeenCalledTimes(1);
  });

  it('a SecurityError (site data blocked) is "unavailable" too', () => {
    const { fake, launch } = setup();
    fake.failAll = securityError();
    expect(loadProfile(launch(), { now: NOW })).toMatchObject({
      status: 'unavailable',
      reason: 'security',
    });
  });

  it('quota exceeded: saves fail quietly, the banner shows once, the next save retries', () => {
    const { fake, launch } = setup();
    const store = launch();
    const banner = vi.fn();
    store.onFailure(banner);
    let profile: Profile = loadProfile(store, { now: NOW }).profile;
    fake.failWrites = quotaError();
    for (const speed of ['fast', 'instant'] as const) {
      const saved = saveSettings(store, profile, { ...profile.settings, speed }, LATER);
      expect(saved.result).toEqual({ ok: false, reason: 'quota' });
      profile = saved.profile;
    }
    expect(banner).toHaveBeenCalledTimes(1);
    expect(fake.data.has(KEY)).toBe(false);
    fake.failWrites = null;
    const saved = saveSettings(store, profile, { ...profile.settings, sound: false }, LATER);
    expect(saved.result).toEqual({ ok: true });
    const stored = JSON.parse(fake.data.get(KEY) as string) as Profile;
    expect(stored.settings).toMatchObject({ speed: 'instant', sound: false });
    expect(stored.rev).toBe(3);
  });
});
