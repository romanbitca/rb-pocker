/**
 * The resumable table and hand under `pc.v1.session` (PLAN §14.2, §14.5, A.7).
 *
 * Saving happens after every engine step (§14.5: iOS may kill a backgrounded PWA at any time), so
 * `saveSession` is one `JSON.stringify` and one `setItem`, with no checks and no read-back: the
 * engine already ran `checkInvariants` on the state it returned.
 *
 * Loading checks everything, once per launch (§14.3 load table, §14.6): the JSON, the version, the
 * type guards, `checkInvariants` on the hand and on the undo snapshot, that the hand belongs to its
 * table as at hand start, and the engine major version (H.2 rule 4). What fails is never used:
 * - a usable table but an unusable hand → the hand is **voided**: dropped, and the table kept with
 *   its hand-start stacks, so the chips go back to where they were before the hand;
 * - no usable table → the session is **discarded**: a new table starts.
 * Either way the repaired state is written back at once (unless `readOnly`), so the next launch
 * starts clean.
 */
import type { SeatStats, TableState } from '../engine/types.ts';
import { SESSION_MIGRATIONS, SESSION_VERSION, migrate, type Migrations } from './migrations.ts';
import {
  emptyHandMeta,
  isIsoDate,
  isSeatStats,
  isTableState,
  parseJson,
  sessionStateProblem,
  type SessionState,
} from './schema.ts';
import {
  STORAGE_KEYS,
  type SafeStorage,
  type SaveResult,
  type StorageFailure,
  type WriteResult,
} from './storage.ts';

export type SessionLoad =
  /** Nothing saved: Home's Play starts a new table with the last-used settings (§12.1). */
  | { status: 'none' }
  /** The browser storage cannot be read: as `none` (the banner comes from `SafeStorage`). */
  | { status: 'unavailable'; reason: StorageFailure }
  /** Resume exactly this (§14.5): Home's Play continues it. */
  | { status: 'ok'; session: SessionState }
  /**
   * The hand could not be restored: it was dropped and `session` keeps the table as at hand start,
   * so every seat has its hand-start stack back (already written back, unless `readOnly`). Show
   * the §14.3 toast "Your last hand could not be restored. Chips were returned." `problem` is for
   * Diagnostics.
   */
  | { status: 'voided'; session: SessionState; problem: string }
  /**
   * Nothing usable (no valid table, or an unknown version): start a new table. The key is removed
   * (unless `readOnly`).
   */
  | { status: 'discarded'; problem: string };

export interface SessionLoadOptions {
  /**
   * The running engine's version: pass `ENGINE_VERSION` from `engine/types.ts` (persist may import
   * only types from there, §2.1). A hand from another engine major version is voided (H.2 rule 4).
   */
  engineVersion: string;
  /** The time used when a voided session needs new timestamps (default: now). */
  now?: Date;
  /** Session migrations (default `SESSION_MIGRATIONS`; tests pass their own). */
  migrations?: Migrations;
  /**
   * Write nothing (no write-back, no removal): for a tab that does not hold the `pc-writer` lock
   * (§14.7, Stage 8). The result is the same.
   */
  readOnly?: boolean;
}

/** Writes the session: one `JSON.stringify` + one `setItem`, nothing else. Never throws. */
export function saveSession(store: SafeStorage, session: SessionState): SaveResult {
  let raw: string;
  try {
    raw = JSON.stringify(session);
  } catch (e) {
    return { ok: false, reason: 'invalid', problem: `session: ${String(e)}` };
  }
  return store.set(STORAGE_KEYS.session, raw);
}

/** Removes the session (the table's session ended: Change table after a bust, §3.1). */
export function clearSession(store: SafeStorage): WriteResult {
  return store.remove(STORAGE_KEYS.session);
}

/** A new session around a table between hands: no hand, no inputs, no undo, no seat stats. */
export function newSession(table: TableState, now: Date): SessionState {
  const at = now.toISOString();
  return {
    schema: SESSION_VERSION,
    savedAt: at,
    sessionStart: at,
    table,
    hand: null,
    handInputs: [],
    meta: emptyHandMeta(),
    undoSnapshot: null,
    seatStats: table.slots.map(() => null),
    resumeAfterUpdate: false,
  };
}

/** Reads the session once at boot (§12.14) and decides resume, void or discard (§14.3). */
export function loadSession(store: SafeStorage, options: SessionLoadOptions): SessionLoad {
  const write = options.readOnly !== true;
  const discard = (problem: string): SessionLoad => {
    if (write) store.remove(STORAGE_KEYS.session);
    return { status: 'discarded', problem };
  };
  const read = store.get(STORAGE_KEYS.session);
  if (!read.ok) return { status: 'unavailable', reason: read.reason };
  if (read.value === null) return { status: 'none' };

  const parsed = parseJson(read.value);
  if (!parsed.ok) return discard(`session: ${parsed.problem}`);
  const migrated = migrate(parsed.value, SESSION_VERSION, options.migrations ?? SESSION_MIGRATIONS);
  if (!migrated.ok) return discard(`session: ${migrated.problem}`);
  const value = migrated.value;

  const problem =
    sessionStateProblem(value) ?? engineProblem(value as SessionState, options.engineVersion);
  if (problem === null) {
    const session = value as SessionState;
    if (migrated.from !== SESSION_VERSION && write) saveSession(store, session);
    return { status: 'ok', session };
  }

  const fields = value as Record<string, unknown>;
  if (!isTableState(fields.table)) return discard(problem);
  const session = voided(fields, fields.table, options.now ?? new Date());
  if (write) saveSession(store, session);
  return { status: 'voided', session, problem };
}

/** The major part of a semver string ("0" for "0.1.0"), or null. */
const majorOf = (version: string): string | null => /^(\d+)\./.exec(version)?.[1] ?? null;

/** H.2 rule 4: an unfinished hand from another engine major version is not resumed. */
function engineProblem(s: SessionState, running: string): string | null {
  const states = [
    ['hand', s.hand],
    ['undoSnapshot.state', s.undoSnapshot?.state ?? null],
  ] as const;
  const want = majorOf(running);
  for (const [where, h] of states) {
    if (h !== null && (want === null || majorOf(h.engineVersion) !== want)) {
      return `session.${where}: engine ${h.engineVersion} is another major version than ${running} (H.2 rule 4)`;
    }
  }
  return null;
}

/**
 * The session with its hand dropped: the table as stored (its stacks are the hand-start stacks),
 * and the table-level fields kept where they are still valid.
 */
function voided(fields: Record<string, unknown>, table: TableState, now: Date): SessionState {
  const fresh = newSession(table, now);
  const stats = fields.seatStats;
  const statsOk =
    Array.isArray(stats) &&
    stats.length === table.config.seatCount &&
    stats.every((s) => s === null || isSeatStats(s));
  return {
    ...fresh,
    savedAt: isIsoDate(fields.savedAt) ? fields.savedAt : fresh.savedAt,
    sessionStart: isIsoDate(fields.sessionStart) ? fields.sessionStart : fresh.sessionStart,
    seatStats: statsOk ? (stats as (SeatStats | null)[]) : fresh.seatStats,
    resumeAfterUpdate:
      typeof fields.resumeAfterUpdate === 'boolean' ? fields.resumeAfterUpdate : false,
  };
}
