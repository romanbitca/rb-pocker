/**
 * The player's profile under `pc.v1.profile` (PLAN §14.2, A.7, H). Stage 3 keeps only `settings`
 * in it (the last-used Setup values, the levels, the speed and the other Game settings, §12.1,
 * §12.2); every other field holds its schema default. Stage 8 adds the stats and the §14.3 commit
 * protocol on top of the same key: the backup copy (`pc.v1.profile.bak`), the `rev` check and the
 * `.bak` fallback on load plug into `saveProfile` and `loadProfile` below.
 *
 * Load path (§14.6 rule 1): read → `JSON.parse` (never throws) → migrations step by step up to
 * `PROFILE_VERSION` → the type guard of that version → write back when migrated. A damaged value,
 * or one from an unknown (newer) version, never crashes the game: it is copied to
 * `pc.corrupt.<timestamp>` and the game starts from the defaults (§14.6 rule 2).
 */
import { PROFILE_MIGRATIONS, PROFILE_VERSION, migrate, type Migrations } from './migrations.ts';
import {
  defaultProfile,
  parseJson,
  profileProblem,
  settingsProblem,
  type Profile,
  type Settings,
} from './schema.ts';
import {
  STORAGE_KEYS,
  keepCorruptCopy,
  type SafeStorage,
  type SaveResult,
  type StorageFailure,
} from './storage.ts';

export type ProfileLoad =
  /** The stored profile; `migratedFrom` is the old schema when it was migrated (and written back). */
  | { status: 'ok'; profile: Profile; migratedFrom: number | null }
  /** Nothing stored yet: the first launch (Welcome). Nothing is written until the first save. */
  | { status: 'new'; profile: Profile }
  /**
   * The browser storage cannot be read: the defaults, in memory. The §12.11 storage banner comes
   * from `SafeStorage.onFailure`, not from here.
   */
  | { status: 'unavailable'; profile: Profile; reason: StorageFailure }
  /**
   * The stored profile is damaged or from an unknown version: the defaults. The raw text was
   * copied to `copiedTo` and the defaults written in its place, so the next launch is normal. Show
   * the §12.11 toast "Your saved data was damaged. We started fresh and kept a copy." When the copy
   * could not be written (`copiedTo` null) nothing was overwritten; the next save replaces it.
   */
  | { status: 'reset'; profile: Profile; problem: string; copiedTo: string | null };

export interface ProfileLoadOptions {
  /** The time for new timestamps and the corrupt-copy key (default: now). */
  now?: Date;
  /** Profile migrations (default `PROFILE_MIGRATIONS`; tests pass their own). */
  migrations?: Migrations;
}

/** Reads the profile once at boot (§12.14: synchronous, before Welcome or Home renders). */
export function loadProfile(store: SafeStorage, options: ProfileLoadOptions = {}): ProfileLoad {
  const now = options.now ?? new Date();
  const read = store.get(STORAGE_KEYS.profile);
  if (!read.ok) return { status: 'unavailable', profile: defaultProfile(now), reason: read.reason };
  if (read.value === null) return { status: 'new', profile: defaultProfile(now) };

  const parsed = parseJson(read.value);
  let problem: string;
  if (parsed.ok) {
    const migrated = migrate(
      parsed.value,
      PROFILE_VERSION,
      options.migrations ?? PROFILE_MIGRATIONS,
    );
    if (migrated.ok) {
      const invalid = profileProblem(migrated.value);
      if (invalid === null) {
        const profile = migrated.value as Profile;
        const wasOlder = migrated.from !== PROFILE_VERSION;
        if (wasOlder) store.set(STORAGE_KEYS.profile, JSON.stringify(profile));
        return { status: 'ok', profile, migratedFrom: wasOlder ? migrated.from : null };
      }
      problem = invalid;
    } else {
      problem = `profile: ${migrated.problem}`;
    }
  } else {
    problem = `profile: ${parsed.problem}`;
  }

  const profile = defaultProfile(now);
  const copiedTo = keepCorruptCopy(store, read.value, now);
  if (copiedTo !== null) store.set(STORAGE_KEYS.profile, JSON.stringify(profile));
  return { status: 'reset', profile, problem, copiedTo };
}

export interface ProfileSave {
  /**
   * The profile as written (`rev + 1`, `updatedAt` = now): keep it as the in-memory profile even
   * when the write failed (§14.6 rule 3: play on in memory; the next save retries). When the save
   * was refused (`invalid`) it is the profile passed in, unchanged.
   */
  profile: Profile;
  result: SaveResult;
}

/**
 * Writes the whole profile. `rev` counts the writes (§14.3: Stage 8's commit compares the stored
 * `rev` with ours to spot a second writer). A profile that would not load again (fails the guard)
 * is refused and nothing is written.
 *
 * Stage 8 plugs in here: the §14.3 step 2 `rev` check against the stored profile and step 3, the
 * copy of the stored string to `pc.v1.profile.bak` just before the write.
 */
export function saveProfile(store: SafeStorage, profile: Profile, now = new Date()): ProfileSave {
  const next: Profile = { ...profile, rev: profile.rev + 1, updatedAt: now.toISOString() };
  const problem = profileProblem(next);
  if (problem !== null) return { profile, result: { ok: false, reason: 'invalid', problem } };
  return { profile: next, result: store.set(STORAGE_KEYS.profile, JSON.stringify(next)) };
}

/**
 * Replaces the settings and saves the profile: Setup's Start game (the last-used values that
 * Home's Play reuses, §12.2) and every Settings change. The caller debounces Settings changes by
 * 250 ms and flushes on `visibilitychange → hidden` and `pagehide` (§14.2, §14.6 rule 4).
 * Invalid settings are refused: nothing is written and the profile comes back unchanged.
 */
export function saveSettings(
  store: SafeStorage,
  profile: Profile,
  settings: Settings,
  now = new Date(),
): ProfileSave {
  const problem = settingsProblem(settings);
  if (problem !== null) return { profile, result: { ok: false, reason: 'invalid', problem } };
  return saveProfile(store, { ...profile, settings }, now);
}
