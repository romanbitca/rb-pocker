/**
 * Export, import and reset (PLAN §14.8, H.2 rule 5; chunk 8.3). Only the Data commands use this
 * module, so it is part of their lazy chunk (`app/dataTools.ts`): first paint does not pay for it
 * (§15.3).
 *
 * Export writes A.7 `ExportFile`, `rb-poker-coach-stats-YYYY-MM-DD.json` = `{ app: 'poker-coach',
 * schemaVersion, exportedAt, profile, hands }`: the profile as stored and its counted hand records.
 *
 * Import reads such a file the way boot reads the profile (§14.6 rule 1): JSON, then the
 * migrations up to `PROFILE_VERSION`, then the settings' defaults revision (`upgradeDefaults`,
 * H.2 rule 6: a file from before 1.3.94 gets "Deal the next hand by itself" off, once), then the
 * guard of that version. A file from a newer app is
 * refused, never guessed at. Hand records that fail their guard, or that the profile has not
 * counted, are left out (Review only needs the good ones); the profile itself must be whole.
 *
 * Import and Reset replace what is stored, so each is a small protocol like the commit (§14.3),
 * and a crash at any write leaves either the old profile or the new one, never a mix:
 *
 *   1. check     the stored profile's `rev` is ours (else another tab writes: nothing is written)
 *   2. preimport ← the stored profile string (§14.2)
 *   3. hands     ← an empty ring (so no crash can leave one profile's hands under the other)
 *   4. bak, profile ← the new profile, `rev` + 1                       ◄ COMMIT POINT (one setItem)
 *   5. hands     ← the imported records (Import only, once step 4 reached the storage)
 *
 * Steps 2 and 3 must reach the storage, else nothing more is written: so a browser mode that
 * keeps nothing (private browsing, §14.6 rule 3) never imports or resets; it says so.
 *
 * Reset keeps the settings, the flags, `createdAt` and `lastCommittedHandSeq` (§14.3: Reset never
 * lowers it) and empties the stats and the hero model. Import takes the file's profile but keeps
 * what belongs to this browser rather than to the player: `persistGranted` and the flags
 * `iosInstall`, `safariImport` and `offlineReady` (§14.8 notes). Both continue this tab's `rev`, so
 * the `rev` check of every later write still works (§14.3 step 2).
 */
import {
  PROFILE_MIGRATIONS,
  PROFILE_VERSION,
  migrate,
  schemaOf,
  upgradeDefaults,
  type Migrations,
} from './migrations.ts';
import type { checkWriter, writeProfile } from './profile.ts';
import type {
  emptySeatStats,
  emptyStats,
  ExportFile,
  handRecordProblem,
  HandRecord,
  isIsoDate,
  parseJson,
  Profile,
  profileProblem,
} from './schema.ts';
import { STORAGE_KEYS, type SafeStorage, type SaveResult, type StorageFailure } from './storage.ts';

/**
 * The persist functions this module uses, handed in by the caller (`persist/kit.ts`
 * `PERSIST_KIT`) instead of imported. This module lives in a lazy chunk, and a static import of a
 * module that imports `schema.ts` makes the bundler cut the entry chunk into pieces (pitfall 47:
 * +1.4 KB of initial JS for nothing). `migrations.ts` and `storage.ts` import nothing, so they are
 * imported as usual.
 */
export interface PersistKit {
  parseJson: typeof parseJson;
  isIsoDate: typeof isIsoDate;
  profileProblem: typeof profileProblem;
  handRecordProblem: typeof handRecordProblem;
  emptyStats: typeof emptyStats;
  emptySeatStats: typeof emptySeatStats;
  checkWriter: typeof checkWriter;
  writeProfile: typeof writeProfile;
  /** `HANDS_KEEP`: the ring keeps the newest 100 records (§14.2). */
  handsKeep: number;
}

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/** The export file's `app` field: an internal identifier, never renamed (§0.3). */
export const EXPORT_APP = 'poker-coach';

/** The largest file Import reads: the browser keeps 5 MiB per site in all (§14.1). */
export const IMPORT_MAX_CHARS = 5 * 1024 * 1024;

/**
 * `rb-poker-coach-stats-2026-09-12.json` (`rb-poker-coach-debug-…` for the debug report): the
 * local date, as the player's calendar shows it.
 */
export function exportFileName(now: Date, kind: 'stats' | 'debug' = 'stats'): string {
  const two = (n: number): string => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
  return `rb-poker-coach-${kind}-${date}.json`;
}

/**
 * Settings → Diagnostics → "Export debug report" (§4.5, chunk 8.4): `rb-poker-coach-debug-…json`
 * = `{ app: 'poker-coach', kind: 'debug', exportedAt, …report, diag }`, where `diag` is
 * `pc.v1.diag` (the voided hands' replay records, A.7 `DiagRing`) as stored: parsed, or its text
 * when it does not parse, or null. The player sends it by their own choice; nothing is sent.
 */
export function debugData(
  kit: PersistKit,
  store: SafeStorage,
  report: Record<string, unknown>,
  now: Date,
): { name: string; text: string } {
  const read = store.get(STORAGE_KEYS.diag);
  const raw = read.ok ? read.value : null;
  const parsed = raw === null ? null : kit.parseJson(raw);
  const diag = parsed === null ? null : parsed.ok ? parsed.value : raw;
  return {
    name: exportFileName(now, 'debug'),
    text: JSON.stringify({
      app: EXPORT_APP,
      kind: 'debug',
      exportedAt: now.toISOString(),
      ...report,
      diag,
    }),
  };
}

/** The export file of `profile` and its counted hand records (oldest first). */
export function buildExport(profile: Profile, hands: HandRecord[], now: Date): ExportFile {
  return {
    app: EXPORT_APP,
    schemaVersion: PROFILE_VERSION,
    exportedAt: now.toISOString(),
    profile,
    hands,
  };
}

/**
 * The records of `list` that pass their guard and that a profile with `last` as its
 * `lastCommittedHandSeq` has counted: one per `handSeq` (the last one wins, as in the ring), oldest
 * first, the newest `HANDS_KEEP` (what `loadHands` reads, §14.3 notes).
 */
function countedRecords(kit: PersistKit, list: readonly unknown[], last: number): HandRecord[] {
  const bySeq = new Map<number, HandRecord>();
  for (const item of list) {
    if (kit.handRecordProblem(item) !== null) continue;
    const record = item as HandRecord;
    if (record.handSeq <= last) bySeq.set(record.handSeq, record);
  }
  return [...bySeq.values()].sort((a, b) => a.handSeq - b.handSeq).slice(-kit.handsKeep);
}

/**
 * What Export writes for `profile`: the file name and its text. The hands are the ring's counted
 * records, read here like `loadHands` does (a damaged ring exports no hands).
 */
export function exportData(
  kit: PersistKit,
  store: SafeStorage,
  profile: Profile,
  now: Date,
): { name: string; text: string } {
  const read = store.get(STORAGE_KEYS.hands);
  const ring = read.ok && read.value !== null ? kit.parseJson(read.value) : null;
  const value = ring?.ok === true ? ring.value : null;
  const list =
    isObject(value) && value.schema === 1 && Array.isArray(value.hands) ? value.hands : [];
  const hands = countedRecords(kit, list as unknown[], profile.lastCommittedHandSeq);
  return {
    name: exportFileName(now),
    text: JSON.stringify(buildExport(profile, hands, now)),
  };
}

/**
 * Why a file cannot be imported (the Data section words it, chunk 8.4):
 * - `notStats`: not an export of this app (not JSON, another app's file, or far too big);
 * - `newer`: written by a newer version of the app (update the app first);
 * - `damaged`: an export of this app, but its profile is broken.
 */
export type ImportProblem = 'notStats' | 'newer' | 'damaged';

/** The import preview (§14.8): "1,234 hands, exported 12 Sep 2026". */
export interface ImportPreview {
  /** Hands the file's stats have counted (clean and practice). */
  hands: number;
  /** ISO UTC. */
  exportedAt: string;
}

/** A file that passed every check: what Replace writes. */
export interface ImportFile {
  /** At `PROFILE_VERSION`, guarded. */
  profile: Profile;
  /** Guarded, counted, one per `handSeq`, oldest first, the newest `HANDS_KEEP`. */
  hands: HandRecord[];
  preview: ImportPreview;
  /** Hand records left out (damaged, not counted, repeated or beyond the newest 100). */
  dropped: number;
}

export type ImportRead =
  { ok: true; file: ImportFile } | { ok: false; why: ImportProblem; problem: string };

/** Hands the stats have counted (§14.4 results: clean and practice). */
export const countedHands = (profile: Profile): number =>
  profile.stats.results.clean.hands + profile.stats.results.practice.hands;

/**
 * Reads an export file's text (§14.8 Import: parse, type-guard, migrate). Never throws.
 * `migrations` are the profile's (tests pass their own, as for `loadProfile`).
 */
export function readImport(
  kit: PersistKit,
  text: string,
  migrations: Migrations = PROFILE_MIGRATIONS,
): ImportRead {
  const refuse = (why: ImportProblem, problem: string): ImportRead => ({ ok: false, why, problem });
  if (text.length > IMPORT_MAX_CHARS) return refuse('notStats', `${text.length} characters`);
  const parsed = kit.parseJson(text);
  if (!parsed.ok) return refuse('notStats', parsed.problem);
  const x = parsed.value;
  if (!isObject(x) || x.app !== EXPORT_APP) return refuse('notStats', 'not an export of this app');
  const version = x.schemaVersion;
  if (!Number.isSafeInteger(version) || (version as number) < 0) {
    return refuse('damaged', 'schemaVersion: expected a whole number');
  }
  const profileVersion = schemaOf(x.profile);
  if ((version as number) > PROFILE_VERSION || (profileVersion ?? 0) > PROFILE_VERSION) {
    return refuse('newer', `schema ${String(version)} is newer than this app (${PROFILE_VERSION})`);
  }
  if (!kit.isIsoDate(x.exportedAt)) return refuse('damaged', 'exportedAt: expected an ISO time');
  const migrated = migrate(x.profile, PROFILE_VERSION, migrations);
  if (!migrated.ok) return refuse('damaged', `profile: ${migrated.problem}`);
  const value = upgradeDefaults(migrated.value);
  const invalid = kit.profileProblem(value);
  if (invalid !== null) return refuse('damaged', invalid);
  const profile = value as Profile;
  if (!Array.isArray(x.hands)) return refuse('damaged', 'hands: expected a list');

  const hands = countedRecords(kit, x.hands as unknown[], profile.lastCommittedHandSeq);
  return {
    ok: true,
    file: {
      profile,
      hands,
      preview: { hands: countedHands(profile), exportedAt: x.exportedAt },
      dropped: x.hands.length - hands.length,
    },
  };
}

/** Import's or Reset's result. */
export type TransferResult =
  /**
   * Written: `profile` is the new one (keep it in memory even when the commit point's `result`
   * failed: §14.6 rule 3, it reads back from memory and the next write retries).
   */
  | { status: 'done'; profile: Profile; result: SaveResult }
  /** Another tab wrote the profile since this tab read it (§14.7): nothing was written. */
  | { status: 'conflict'; storedRev: number }
  /**
   * Nothing was replaced: step 2 or 3 could not be written (the storage is full, blocked or
   * missing: private modes), or the new profile is not valid (a bug).
   */
  | { status: 'failed'; reason: StorageFailure | 'invalid'; problem: string };

/** Steps 1–5 (module note): `next` replaces `current`, and the ring becomes `hands`. */
function replace(
  kit: PersistKit,
  store: SafeStorage,
  current: Profile,
  next: Profile,
  hands: HandRecord[],
  now: Date,
): TransferResult {
  const problem = kit.profileProblem(next);
  if (problem !== null) return { status: 'failed', reason: 'invalid', problem };
  const writer = kit.checkWriter(store, current.rev, now); // 1
  if (!writer.ok) return { status: 'conflict', storedRev: writer.storedRev };
  if (writer.backup !== null) {
    const kept = store.set(STORAGE_KEYS.preimport, writer.backup); // 2
    if (!kept.ok) return { status: 'failed', reason: kept.reason, problem: 'preimport not saved' };
  }
  const ring = (records: HandRecord[]): string => JSON.stringify({ schema: 1, hands: records });
  // 3: must reach the storage before the profile does, or a crash could show the old records
  // under the new profile (Reset would not have deleted them).
  const emptied = store.set(STORAGE_KEYS.hands, ring([]));
  if (!emptied.ok)
    return { status: 'failed', reason: emptied.reason, problem: 'hands not emptied' };
  const result = kit.writeProfile(store, next, writer.backup); // 4
  if (result.ok && hands.length > 0) store.set(STORAGE_KEYS.hands, ring(hands)); // 5
  return { status: 'done', profile: next, result };
}

/** §14.8 Import → Replace: the file's profile and hands replace the stored ones. */
export function importProfile(
  kit: PersistKit,
  store: SafeStorage,
  current: Profile,
  file: ImportFile,
  now: Date,
): TransferResult {
  const theirs = file.profile;
  const next: Profile = {
    ...theirs,
    rev: current.rev + 1,
    updatedAt: now.toISOString(),
    // What belongs to this browser, not to the player (module note).
    persistGranted: current.persistGranted,
    flags: {
      ...theirs.flags,
      iosInstall: current.flags.iosInstall,
      safariImport: current.flags.safariImport,
      offlineReady: current.flags.offlineReady,
    },
  };
  return replace(kit, store, current, next, file.hands, now);
}

/** §14.8 Reset stats: empty stats, hands and hero model; everything else stays. */
export function resetProfile(
  kit: PersistKit,
  store: SafeStorage,
  current: Profile,
  now: Date,
): TransferResult {
  const next: Profile = {
    ...current,
    stats: kit.emptyStats(),
    heroModel: kit.emptySeatStats(),
    rev: current.rev + 1,
    updatedAt: now.toISOString(),
  };
  return replace(kit, store, current, next, [], now);
}
