/**
 * The voided hands' replay records under `pc.v1.diag` (PLAN §4.5, §14.2, A.7 `DiagRing`): when a
 * broken invariant voids a hand, the controller adds the hand's replay record (its table at hand
 * start, seed and inputs, the failing input last), and the key keeps the last `DIAG_KEEP`, oldest
 * first. It is written on that path only. Settings → Diagnostics reads it ("Export debug report":
 * the user sends it by their own choice); nothing is ever sent automatically.
 */
import type { ReplayRecord } from '../engine/types.ts';
import { diagRingProblem, parseJson, type DiagRing } from './schema.ts';
import { STORAGE_KEYS, keepCorruptCopy, type SafeStorage, type WriteResult } from './storage.ts';

/** How many voided hands `pc.v1.diag` keeps (§4.5: "last 5"). */
export const DIAG_KEEP = 5;

/** The stored list, or null when the stored value is not a `DiagRing`. */
function storedRecords(raw: string): unknown[] | null {
  const parsed = parseJson(raw);
  if (!parsed.ok || diagRingProblem(parsed.value) !== null) return null;
  return (parsed.value as { records: unknown[] }).records;
}

/**
 * Adds `record` and keeps the newest `DIAG_KEEP`. The stored records are kept as they are (only
 * Diagnostics reads them). A stored value that is not a `DiagRing` is copied to
 * `pc.corrupt.<timestamp>` and replaced; when even the copy fails, nothing is written (§14.6
 * rule 2: unreadable data is never deleted automatically).
 */
export function appendDiag(
  store: SafeStorage,
  record: ReplayRecord,
  now: Date,
): WriteResult | { ok: false; reason: 'kept' } {
  const read = store.get(STORAGE_KEYS.diag);
  // An unreadable storage reads as empty: the write below fails too (the banner says so).
  const raw = read.ok ? read.value : null;
  let records = raw === null ? [] : storedRecords(raw);
  if (records === null) {
    if (keepCorruptCopy(store, raw as string, now) === null) return { ok: false, reason: 'kept' };
    records = [];
  }
  // The stored records are kept as they were written (`unknown`: only Diagnostics reads them).
  const ring: DiagRing = {
    schema: 1,
    records: [...(records as ReplayRecord[]), record].slice(-DIAG_KEEP),
  };
  return store.set(STORAGE_KEYS.diag, JSON.stringify(ring));
}
