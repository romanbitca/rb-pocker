/**
 * The hand records under `pc.v1.hands` (PLAN §14.2, §14.3 step 1, A.7 `HandRing`): the last 100
 * finished hands, oldest first, one per `handSeq`, each with what `replay()` needs (§4.7). The
 * commit writes them at hand end, before the profile; Stats → History reads them (chunk 8.2).
 *
 * A record counts only once the profile has counted its hand (`handSeq ≤ lastCommittedHandSeq`).
 * A record above it is left over from a commit that stopped before its commit point (§14.3 load
 * table: "drop them"): readers skip it, and the next commit removes it from the ring.
 */
import { handRecordProblem, handRingProblem, parseJson, type HandRecord } from './schema.ts';
import { STORAGE_KEYS, keepCorruptCopy, type SafeStorage, type WriteResult } from './storage.ts';

/** How many hand records the ring keeps (§14.2; Stats → History lists the last 100, §14.4). */
export const HANDS_KEEP = 100;

export interface HandsRead {
  /** The counted records that pass their guard, oldest first. */
  hands: HandRecord[];
  /** Why the ring, or some of its records, were left out (for Diagnostics), else null. */
  problem: string | null;
}

/** The stored ring's list, or why it is not a ring (absent: an empty list). */
function storedList(
  raw: string | null,
): { ok: true; list: unknown[] } | { ok: false; problem: string } {
  if (raw === null) return { ok: true, list: [] };
  const parsed = parseJson(raw);
  if (!parsed.ok) return { ok: false, problem: `hands: ${parsed.problem}` };
  const problem = handRingProblem(parsed.value);
  if (problem !== null) return { ok: false, problem };
  return { ok: true, list: (parsed.value as { hands: unknown[] }).hands };
}

/**
 * The counted hand records (Stats → History, chunk 8.2). Writes nothing: a damaged ring reads as
 * empty (the next commit keeps a copy of it and starts a new one), a record that fails its guard
 * or is not counted yet is left out.
 */
export function loadHands(store: SafeStorage, lastCommittedHandSeq: number): HandsRead {
  const read = store.get(STORAGE_KEYS.hands);
  if (!read.ok) return { hands: [], problem: `hands: storage ${read.reason}` };
  const stored = storedList(read.value);
  if (!stored.ok) return { hands: [], problem: stored.problem };
  const hands: HandRecord[] = [];
  let problem: string | null = null;
  for (const item of stored.list) {
    const invalid = handRecordProblem(item);
    if (invalid !== null) problem ??= invalid;
    else if ((item as HandRecord).handSeq <= lastCommittedHandSeq) hands.push(item as HandRecord);
  }
  return { hands, problem };
}

/** A stored item's `handSeq` (any positive whole number), else null. */
function seqOf(x: unknown): number | null {
  const seq = typeof x === 'object' && x !== null ? (x as { handSeq?: unknown }).handSeq : null;
  return Number.isSafeInteger(seq) && (seq as number) >= 1 ? (seq as number) : null;
}

/**
 * §14.3 step 1, `ring.upsert(record by handSeq)`: safe to repeat. The stored records stay as they
 * are (no guard here: the reader checks them), except an older copy of this hand, a record above
 * `lastCommittedHandSeq` (the profile's, before this hand: never counted) and anything without a
 * `handSeq`; then the newest `HANDS_KEEP`. A ring that is not readable is copied to
 * `pc.corrupt.<timestamp>` and replaced; when even the copy fails, nothing is written (§14.6
 * rule 2): the hand still counts, only its record is missing.
 */
export function upsertHand(
  store: SafeStorage,
  record: HandRecord,
  lastCommittedHandSeq: number,
  now: Date,
): WriteResult | { ok: false; reason: 'kept' } {
  const read = store.get(STORAGE_KEYS.hands);
  // An unreadable storage reads as empty: the write below fails too, and the ring lives in memory.
  const raw = read.ok ? read.value : null;
  let stored = storedList(raw);
  if (!stored.ok) {
    if (keepCorruptCopy(store, raw as string, now) === null) return { ok: false, reason: 'kept' };
    stored = { ok: true, list: [] };
  }
  const kept = stored.list.filter((item) => {
    const seq = seqOf(item);
    return seq !== null && seq !== record.handSeq && seq <= lastCommittedHandSeq;
  });
  const hands = [...kept, record].sort((a, b) => (seqOf(a) as number) - (seqOf(b) as number));
  return store.set(
    STORAGE_KEYS.hands,
    JSON.stringify({ schema: 1, hands: hands.slice(-HANDS_KEEP) }),
  );
}
