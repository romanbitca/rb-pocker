/**
 * The commit protocol at hand end (PLAN §14.3): atomic and idempotent. When a hand is complete
 * the session already holds it (saved after its last step, §14.5); then:
 *
 *   2. check  the stored profile's `rev` is ours (else another writer: stop, write nothing)
 *   1. hands  ← ring.upsert(record by handSeq)                       safe to repeat
 *   3. bak    ← the stored profile string
 *   4. profile ← apply(profile, record); lastCommittedHandSeq = handSeq; rev + 1   ◄ COMMIT POINT
 *   5. session ← the next table (no hand), once step 4 has reached the storage
 *
 * The `rev` check runs first (the PLAN lists it second) so that a tab that is not the writer
 * writes nothing at all, not even its hand record (§14 notes). `lastCommittedHandSeq` is the one
 * source of truth for "has this hand been counted": a hand at or below it is not counted again,
 * only step 5 runs. One `setItem` is the commit point, so a crash before it leaves the hand
 * uncounted (the session still holds it and the next launch commits it, §14.3 load table) and a
 * crash after it leaves it counted once (the next launch runs step 5 only).
 */
import { checkWriter, writeProfile } from './profile.ts';
import { upsertHand } from './hands.ts';
import { handRecordProblem, profileProblem, type HandRecord, type Profile } from './schema.ts';
import type { SessionState } from './schema.ts';
import { saveSession } from './session.ts';
import type { SafeStorage, SaveResult } from './storage.ts';

export interface HandCommit {
  /** The finished hand (A.7), built by the controller (`app/handRecord.ts`). */
  record: HandRecord;
  /**
   * `applyHand` and the hero model (§14.3 step 4, §9.5): the profile with this hand counted. Pure;
   * the protocol sets `lastCommittedHandSeq`, `rev` and `updatedAt` itself.
   */
  apply(profile: Profile): Profile;
  /** Step 5: the session after the hand (its next table, no hand); null: the caller writes it. */
  session: SessionState | null;
}

export type CommitResult =
  /**
   * Counted: `profile` is the new one (keep it in memory even when `result` says the write
   * failed: §14.6 rule 3, the next write retries).
   */
  | { status: 'committed'; profile: Profile; result: SaveResult }
  /** `handSeq ≤ lastCommittedHandSeq`: already counted; only step 5 ran. */
  | { status: 'counted'; profile: Profile }
  /** Another writer has written the profile since we read it: nothing was written (§14.7). */
  | { status: 'conflict'; profile: Profile; storedRev: number }
  /** The record or the counted profile fails its guard (a bug): not counted; step 5 ran. */
  | { status: 'invalid'; profile: Profile; problem: string };

export function commitHand(
  store: SafeStorage,
  profile: Profile,
  commit: HandCommit,
  now = new Date(),
): CommitResult {
  const { record, session } = commit;
  const step5 = (): void => {
    if (session !== null) saveSession(store, session);
  };
  if (record.handSeq <= profile.lastCommittedHandSeq) {
    step5();
    return { status: 'counted', profile };
  }
  const next: Profile = {
    ...commit.apply(profile),
    lastCommittedHandSeq: record.handSeq,
    rev: profile.rev + 1,
    updatedAt: now.toISOString(),
  };
  const problem = handRecordProblem(record) ?? profileProblem(next);
  if (problem !== null) {
    step5();
    return { status: 'invalid', profile, problem };
  }
  const writer = checkWriter(store, profile.rev, now); // step 2
  if (!writer.ok) return { status: 'conflict', profile, storedRev: writer.storedRev };
  upsertHand(store, record, profile.lastCommittedHandSeq, now); // step 1
  const result = writeProfile(store, next, writer.backup); // steps 3 and 4
  // A commit point that did not reach the storage leaves the session holding the hand, so the
  // next launch can still count it (§14.6 rule 3: the next write retries in any case).
  if (result.ok) step5();
  return { status: 'committed', profile: next, result };
}
