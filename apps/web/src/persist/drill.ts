/**
 * The hand drill's own key, `pc.v1.drill` (PLAN §13.5, §14.2, Appendix H): load, guard and save.
 * It is not part of the profile and never touches its commit protocol (§14.3); the drill writes it
 * after every answer. A Reset (Settings → Data, §14.8) removes it; Export and Import leave it out.
 *
 * The load path is §14.6 rule 1 on a small scale: JSON, `schema`, the migrations
 * (`DRILL_MIGRATIONS`, empty while version 1 is the only one), then the guard of the current
 * version. A damaged value (bad JSON, a wrong shape, a schema newer than this app) is copied to
 * `pc.corrupt.<time>` and then removed, so the drill starts fresh; when even the copy cannot be
 * written, nothing is removed or overwritten for the rest of the launch (§14.6 rule 2). Storage
 * that fails (private modes) is `SafeStorage`'s: it keeps the value in memory (§14.6 rule 3).
 *
 * Bundling (pitfall 47): this module is in the drill's lazy chunk, so it imports only modules that
 * import nothing (`storage.ts`, `migrations.ts`), and the drill's ids as types; the lists the guard
 * needs are written out here, and `Record<…, true>` makes the compiler keep them complete.
 */
import type { DrillData } from '../drill/data.ts';
import type { Difficulty, GameId, HandStats } from '../drill/questions.ts';
import type { HandCategory } from '../eval/evaluate.ts';
import { migrate, type Migrations } from './migrations.ts';
import {
  keepCorruptCopy,
  STORAGE_KEYS,
  type SafeStorage,
  type SaveResult,
  type StorageFailure,
} from './storage.ts';

/** The `pc.v1.drill` schema this app reads and writes. */
export const DRILL_VERSION = 1;
export const DRILL_MIGRATIONS: Migrations = {};

const GAMES: Readonly<Record<GameId, true>> = {
  mixed: true,
  cards: true,
  holdem: true,
  showdown: true,
  versus: true,
  order: true,
  pos2name: true,
  name2pos: true,
};

const DIFFICULTIES: Readonly<Record<Difficulty, true>> = { easy: true, normal: true, hard: true };

const HANDS: Readonly<Record<HandCategory, true>> = {
  highCard: true,
  pair: true,
  twoPair: true,
  trips: true,
  straight: true,
  flush: true,
  fullHouse: true,
  quads: true,
  straightFlush: true,
  royalFlush: true,
};

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

const isCount = (x: unknown): x is number =>
  typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;

const oneOf = (table: Readonly<Record<string, true>>, x: unknown): boolean =>
  typeof x === 'string' && Object.hasOwn(table, x);

function handProblem(x: unknown, path: string): string | null {
  if (!isObject(x)) return `${path}: expected { seen, missed }`;
  const s = x as Partial<HandStats>;
  if (!isCount(s.seen)) return `${path}.seen: expected a whole number ≥ 0`;
  if (!isCount(s.missed) || s.missed > s.seen) {
    return `${path}.missed: expected a whole number from 0 to seen`;
  }
  return null;
}

/**
 * Why `x` is not a version-1 `DrillData`, or null when it is. Fields it does not know are allowed
 * (H.2 rule 2: a later version may add them).
 */
export function drillDataProblem(x: unknown): string | null {
  if (!isObject(x)) return 'expected an object';
  if (x.schema !== DRILL_VERSION) return `schema: expected ${DRILL_VERSION}`;
  if (!oneOf(GAMES, x.game)) return 'game: not a game of the drill';
  if (!oneOf(DIFFICULTIES, x.difficulty)) return 'difficulty: expected easy, normal or hard';
  if (!isCount(x.best)) return 'best: expected a whole number ≥ 0';
  if (!isCount(x.answered)) return 'answered: expected a whole number ≥ 0';
  if (!isObject(x.hands)) return 'hands: expected an object';
  for (const category of Object.keys(HANDS)) {
    const problem = handProblem(x.hands[category], `hands.${category}`);
    if (problem !== null) return problem;
  }
  return null;
}

/** What the load found. */
export type DrillLoad =
  /** Nothing stored (a first visit, or after a Reset). */
  | { status: 'empty' }
  | { status: 'ok'; data: DrillData }
  /**
   * Damaged: copied to `kept` (`pc.corrupt.<time>`) and removed; `kept` is null when the copy
   * could not be written, and then the value was left as it is.
   */
  | { status: 'damaged'; problem: string; kept: string | null }
  /** The storage could not be read at all (blocked or missing). */
  | { status: 'unreadable'; reason: StorageFailure };

/** Reads `pc.v1.drill` (see the module note). */
export function loadDrillData(store: SafeStorage, now: Date): DrillLoad {
  const read = store.get(STORAGE_KEYS.drill);
  if (!read.ok) return { status: 'unreadable', reason: read.reason };
  const raw = read.value;
  if (raw === null) return { status: 'empty' };
  let problem: string;
  try {
    const migrated = migrate(JSON.parse(raw) as unknown, DRILL_VERSION, DRILL_MIGRATIONS);
    if (migrated.ok) {
      const found = drillDataProblem(migrated.value);
      if (found === null) {
        const data = migrated.value as DrillData;
        // A migrated value is written back, so the next launch reads the current version.
        if (migrated.from !== DRILL_VERSION) store.set(STORAGE_KEYS.drill, JSON.stringify(data));
        return { status: 'ok', data };
      }
      problem = found;
    } else {
      problem = migrated.problem;
    }
  } catch (e) {
    problem = `not valid JSON (${e instanceof Error ? e.message : String(e)})`;
  }
  const kept = keepCorruptCopy(store, raw, now);
  if (kept !== null) store.remove(STORAGE_KEYS.drill);
  return { status: 'damaged', problem, kept };
}

/** Writes `data` when it passes the guard; else writes nothing (`invalid`: a bug, not a failure). */
export function saveDrillData(store: SafeStorage, data: DrillData): SaveResult {
  const problem = drillDataProblem(data);
  if (problem !== null) return { ok: false, reason: 'invalid', problem };
  return store.set(STORAGE_KEYS.drill, JSON.stringify(data));
}
