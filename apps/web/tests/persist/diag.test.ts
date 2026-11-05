/**
 * `pc.v1.diag` (PLAN §4.5, §14.2, A.7 `DiagRing`): the replay records of the last 5 voided hands,
 * oldest first. A stored value that is not a `DiagRing` is copied to `pc.corrupt.<timestamp>`
 * before it is replaced, and nothing is written when even the copy fails (§14.6 rule 2); a
 * failing storage never throws.
 */
import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION, type HandState, type ReplayRecord } from '../../src/engine/types.ts';
import { appendDiag, DIAG_KEEP } from '../../src/persist/diag.ts';
import type { DiagRing } from '../../src/persist/schema.ts';
import { createSafeStorage, STORAGE_KEYS } from '../../src/persist/storage.ts';
import { FakeStorage, quotaError } from './fakeStorage.ts';
import { midHandSession, NOW } from './fixtures.ts';

const COPY = 'pc.corrupt.2026-09-28T10:00:00.000Z';

/** `appendDiag` on `fake`, through the app's storage wrapper. */
const append = (fake: FakeStorage, record: ReplayRecord) =>
  appendDiag(
    createSafeStorage(() => fake),
    record,
    NOW,
  );

/** A voided hand's replay record; `n` tells them apart (how many inputs it keeps). */
function voided(n: number): ReplayRecord {
  const session = midHandSession();
  return {
    engineVersion: ENGINE_VERSION,
    seed: (session.hand as HandState).seed,
    commit: null,
    table: session.table,
    inputs: session.handInputs.slice(0, n),
  };
}

const stored = (fake: FakeStorage): DiagRing =>
  JSON.parse(fake.data.get(STORAGE_KEYS.diag) as string) as DiagRing;

describe('pc.v1.diag', () => {
  it(`keeps the replay records of the last ${DIAG_KEEP} voided hands, oldest first`, () => {
    const fake = new FakeStorage();
    expect(fake.data.has(STORAGE_KEYS.diag)).toBe(false);
    expect(append(fake, voided(0))).toEqual({ ok: true });
    expect(stored(fake)).toEqual({ schema: 1, records: [voided(0)] });
    for (let n = 1; n <= DIAG_KEEP; n++) append(fake, voided(n % 4));
    const { records } = stored(fake);
    expect(records).toHaveLength(DIAG_KEEP);
    expect(records.map((r) => r.inputs.length)).toEqual([1, 2, 3, 0, 1]);
  });

  it('copies a stored value that is not a DiagRing before replacing it', () => {
    for (const bad of ['{"schema":1,"records":', '{"schema":2,"records":[]}', '[]']) {
      const fake = new FakeStorage({ [STORAGE_KEYS.diag]: bad });
      expect(append(fake, voided(1))).toEqual({ ok: true });
      expect(fake.data.get(COPY)).toBe(bad);
      expect(stored(fake).records).toEqual([voided(1)]);
    }
  });

  it('writes nothing when even the copy fails, and never throws on a failing storage', () => {
    const bad = 'not json';
    const full = new FakeStorage({ [STORAGE_KEYS.diag]: bad });
    full.failWrites = quotaError();
    expect(append(full, voided(1))).toEqual({ ok: false, reason: 'kept' });
    expect(full.data.get(STORAGE_KEYS.diag)).toBe(bad);

    const quota = new FakeStorage();
    quota.failWrites = quotaError();
    expect(append(quota, voided(1))).toMatchObject({ ok: false });
    const gone = new FakeStorage();
    gone.failAll = new Error('no storage');
    expect(() => append(gone, voided(1))).not.toThrow();
  });
});
