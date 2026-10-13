/**
 * The player's profile under `pc.v1.profile` (PLAN §14.2, §14.3, A.7, H): settings, stats, the
 * hero model, flags, `rev` and `lastCommittedHandSeq`. Settings are saved when they change; the
 * rest changes at hand end, through the commit protocol (`persist/commit.ts`, §14.3).
 *
 * Load path (§14.6 rules 1–2): read → `JSON.parse` (never throws) → migrations step by step up to
 * `PROFILE_VERSION` → the type guard of that version → write back when migrated. A damaged value,
 * or one from an unknown (newer) version, never crashes the game: its raw text is copied to
 * `pc.corrupt.<timestamp>`, then the backup `pc.v1.profile.bak` (the profile before the last
 * write: at most one hand lost) takes its place, else the game starts from the defaults.
 *
 * Every write (§14.3 steps 2–4): the stored `rev` must still be ours (else another tab has written
 * since: nothing is written), the stored string goes to `pc.v1.profile.bak`, then the new profile
 * with `rev + 1` is written in one `setItem`.
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
   * The stored profile was damaged (or from an unknown version) and the backup was good: the
   * backup is the profile now (the hand of the last write may be missing, §14.6 rule 2). The raw
   * text was copied to `copiedTo` and the backup written in its place; when the copy could not be
   * written (`copiedTo` null, or `readOnly`) nothing was overwritten. Toast "Your saved data was
   * damaged. We restored a backup…" (§12.11).
   */
  | { status: 'restored'; profile: Profile; problem: string; copiedTo: string | null }
  /**
   * The stored profile and its backup are both damaged or from an unknown version: the defaults.
   * The raw text was copied to `copiedTo` and the defaults written in its place, so the next launch
   * is normal. Show the §12.11 toast "Your saved data was damaged. We started fresh and kept a
   * copy." When the copy could not be written (`copiedTo` null, or `readOnly`) nothing was
   * overwritten; the next save replaces it.
   */
  | { status: 'reset'; profile: Profile; problem: string; copiedTo: string | null };

export interface ProfileLoadOptions {
  /** The time for new timestamps and the corrupt-copy key (default: now). */
  now?: Date;
  /** Profile migrations (default `PROFILE_MIGRATIONS`; tests pass their own). */
  migrations?: Migrations;
  /**
   * Write nothing: no migration write-back, no corrupt copy, no repair. For a tab that does not
   * hold the `pc-writer` lock (§14.7, chunk 8.3); the result is the same.
   */
  readOnly?: boolean;
}

type Read = { ok: true; profile: Profile; from: number } | { ok: false; problem: string };

/** One stored string → a current-version profile (JSON, migrations, the guard), or why not. */
function readProfile(raw: string, migrations: Migrations, key: string): Read {
  const parsed = parseJson(raw);
  if (!parsed.ok) return { ok: false, problem: `${key}: ${parsed.problem}` };
  const migrated = migrate(parsed.value, PROFILE_VERSION, migrations);
  if (!migrated.ok) return { ok: false, problem: `${key}: ${migrated.problem}` };
  const invalid = profileProblem(migrated.value);
  if (invalid !== null) return { ok: false, problem: invalid };
  return { ok: true, profile: migrated.value as Profile, from: migrated.from };
}

/** Reads the profile once at boot (§12.14: synchronous, before Welcome or Home renders). */
export function loadProfile(store: SafeStorage, options: ProfileLoadOptions = {}): ProfileLoad {
  const now = options.now ?? new Date();
  const write = options.readOnly !== true;
  const migrations = options.migrations ?? PROFILE_MIGRATIONS;
  const read = store.get(STORAGE_KEYS.profile);
  if (!read.ok) return { status: 'unavailable', profile: defaultProfile(now), reason: read.reason };
  if (read.value === null) return { status: 'new', profile: defaultProfile(now) };

  const main = readProfile(read.value, migrations, 'profile');
  if (main.ok) {
    const wasOlder = main.from !== PROFILE_VERSION;
    if (wasOlder && write) store.set(STORAGE_KEYS.profile, JSON.stringify(main.profile));
    return { status: 'ok', profile: main.profile, migratedFrom: wasOlder ? main.from : null };
  }

  // §14.6 rule 2: keep the damaged text, then the backup, else start fresh.
  const copiedTo = write ? keepCorruptCopy(store, read.value, now) : null;
  const bak = store.get(STORAGE_KEYS.profileBackup);
  const backup = bak.ok && bak.value !== null ? readProfile(bak.value, migrations, 'bak') : null;
  const restored = backup?.ok === true;
  const profile = backup?.ok === true ? backup.profile : defaultProfile(now);
  if (copiedTo !== null) store.set(STORAGE_KEYS.profile, JSON.stringify(profile));
  const problem = main.problem;
  return restored
    ? { status: 'restored', profile, problem, copiedTo }
    : { status: 'reset', profile, problem, copiedTo };
}

/**
 * A profile write's result: a `SaveResult`, or `conflict` when the stored `rev` is no longer ours
 * (another tab wrote since, §14.3 step 2, §14.7): nothing was written, and this tab must stop
 * writing (the read-only banner arrives with the tab lock, chunk 8.3).
 */
export type ProfileWriteResult = SaveResult | { ok: false; reason: 'conflict'; storedRev: number };

/** §14.3 step 2: may we write over the stored profile? `backup` is what step 3 copies to `.bak`. */
export type WriterCheck = { ok: true; backup: string | null } | { ok: false; storedRev: number };

/** The `rev` of a parsed profile-like object, or null. */
function revOf(x: unknown): number | null {
  if (typeof x !== 'object' || x === null) return null;
  const rev = (x as { rev?: unknown }).rev;
  return Number.isSafeInteger(rev) && (rev as number) >= 0 ? (rev as number) : null;
}

/**
 * §14.3 step 2: the stored profile's `rev` must be `rev` (ours: the one we read or last wrote).
 * Nothing stored, or a storage that cannot be read, lets the write go on (it fails or lands in
 * memory, §14.6 rule 3). A stored value that is not a profile at all (no readable `rev`) is copied
 * to `pc.corrupt.<timestamp>` first (§14.6 rule 2: never delete unreadable data) and not backed up.
 */
export function checkWriter(store: SafeStorage, rev: number, now: Date): WriterCheck {
  const read = store.get(STORAGE_KEYS.profile);
  if (!read.ok || read.value === null) return { ok: true, backup: null };
  const parsed = parseJson(read.value);
  const storedRev = parsed.ok ? revOf(parsed.value) : null;
  if (storedRev === null) {
    keepCorruptCopy(store, read.value, now);
    return { ok: true, backup: null };
  }
  return storedRev === rev ? { ok: true, backup: read.value } : { ok: false, storedRev };
}

/** §14.3 steps 3–4: the stored string to `.bak`, then the profile (one `setItem`, the commit point). */
export function writeProfile(
  store: SafeStorage,
  profile: Profile,
  backup: string | null,
): SaveResult {
  if (backup !== null) store.set(STORAGE_KEYS.profileBackup, backup);
  return store.set(STORAGE_KEYS.profile, JSON.stringify(profile));
}

export interface ProfileSave {
  /**
   * The profile as written (`rev + 1`, `updatedAt` = now): keep it as the in-memory profile even
   * when the write failed (§14.6 rule 3: play on in memory; the next save retries). When the save
   * was refused (`invalid`, `conflict`) it is the profile passed in, unchanged.
   */
  profile: Profile;
  result: ProfileWriteResult;
}

/**
 * Writes the whole profile. `rev` counts the writes, so the next write (or another tab, §14.7)
 * can tell whether someone else wrote in between. A profile that would not load again (fails the
 * guard) is refused and nothing is written.
 */
export function saveProfile(store: SafeStorage, profile: Profile, now = new Date()): ProfileSave {
  const next: Profile = { ...profile, rev: profile.rev + 1, updatedAt: now.toISOString() };
  const problem = profileProblem(next);
  if (problem !== null) return { profile, result: { ok: false, reason: 'invalid', problem } };
  const writer = checkWriter(store, profile.rev, now);
  if (!writer.ok) {
    return { profile, result: { ok: false, reason: 'conflict', storedRev: writer.storedRev } };
  }
  return { profile: next, result: writeProfile(store, next, writer.backup) };
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
