/**
 * Schema migrations (PLAN Appendix H.2). Every persisted object carries `schema`; a migration table
 * maps version n to a pure function that turns a version-n object into version n + 1. Loading runs
 * them step by step up to the version this app writes, then the type guard of that version checks
 * the result (§14.6 rule 1).
 *
 * Version 1 is the first, so the tables are empty today. Stage 8 and later add entries here, each
 * with a frozen fixture of the old version under `tests/persist/fixtures/` (H.2 rule 1). A
 * migration never deletes a field it does not understand: it copies it into `legacy` (rule 2).
 */

/** Turns a version-n object into version n + 1. Pure: it returns a new object. */
export type Migration = (x: unknown) => unknown;
/** `[n]` migrates version n to n + 1. */
export type Migrations = Readonly<Partial<Record<number, Migration>>>;

/** The `pc.v1.profile` schema this app reads and writes. */
export const PROFILE_VERSION = 1;
export const PROFILE_MIGRATIONS: Migrations = {};

/**
 * The `pc.v1.session` schema. A session is short-lived: it gets migrations only if a future schema
 * change needs them, and never across engine major versions (H.2 rule 4: that hand is voided).
 */
export const SESSION_VERSION = 1;
export const SESSION_MIGRATIONS: Migrations = {};

export type MigrateResult =
  { ok: true; value: unknown; from: number } | { ok: false; problem: string };

/** The `schema` field of a persisted object: a whole number ≥ 0, else null. */
export function schemaOf(x: unknown): number | null {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return null;
  const version = (x as { schema?: unknown }).schema;
  return Number.isSafeInteger(version) && (version as number) >= 0 ? (version as number) : null;
}

/**
 * Brings `x` from its own `schema` to `target`, one step at a time. Never throws: a missing
 * version, a version newer than this app, a missing step, a step that throws or a step that does
 * not produce the next version all give `{ ok: false, problem }`. `from` is the version found; the
 * value is returned unchanged (the same object) when it is already at `target`.
 */
export function migrate(x: unknown, target: number, migrations: Migrations): MigrateResult {
  const from = schemaOf(x);
  if (from === null) return { ok: false, problem: 'no schema version' };
  if (from > target) {
    return { ok: false, problem: `schema ${from} is newer than this app (${target})` };
  }
  let value = x;
  for (let version = from; version < target; version++) {
    const step = migrations[version];
    if (step === undefined) return { ok: false, problem: `no migration from schema ${version}` };
    try {
      value = step(value);
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      return { ok: false, problem: `the migration from schema ${version} failed (${why})` };
    }
    const reached = schemaOf(value);
    if (reached !== version + 1) {
      return {
        ok: false,
        problem: `the migration from schema ${version} produced schema ${String(reached)}`,
      };
    }
  }
  return { ok: true, value, from };
}
