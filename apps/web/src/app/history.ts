/**
 * Stats → History (PLAN §14.4, chunk 8.2): the hands stored in `pc.v1.hands` (§14.2, the last
 * 100), as rows for the list, and one of them as a Review hand (§12.10). The controller reads them
 * when the History page or one of its hands is asked for. (Not a lazy module: one that imports the
 * engine or the review views splits them out of the entry chunk, pitfall 47, and costs more than
 * these few lines.)
 *
 * ⚠️ A `HandRecord` holds the seed (the whole deck follows from it, §2.4) and the full table: it
 * stays here. A row has no cards at all, and a Review hand goes to the store's review slice, which
 * builds its frames from the replay (only shown cards reach the UI, `app/review.ts`).
 */
import type { Grade } from '../brain/types.ts';
import type { ReplayRecord } from '../engine/types.ts';
import type { HandCategory } from '../eval/evaluate.ts';
import { loadHands } from '../persist/hands.ts';
import type { HandRecord } from '../persist/schema.ts';
import type { SafeStorage } from '../persist/storage.ts';
import type { ReviewHand } from './review.ts';
import { replayedEnd } from './reviewViews.ts';

/** One row of Stats → History: number, time, result, best hand, grade dots (§14.4). No cards. */
export interface HistoryItem {
  readonly handSeq: number;
  /** "Hand 12": the number the table's top bar showed (as in Review). */
  readonly handNumber: number;
  /** When the hand ended (ISO UTC). */
  readonly at: string;
  /** The hero's net chips. */
  readonly net: number;
  readonly bestCategory: HandCategory | null;
  /** Each decision's grade, in order, undone ones too (null: no grade). */
  readonly grades: readonly (Grade | null)[];
  /** A practice hand (it had an Undo, §11.4). */
  readonly practice: boolean;
}

/** The rows, newest first. */
export function historyOf(records: readonly HandRecord[]): HistoryItem[] {
  return records
    .map((r) => ({
      handSeq: r.handSeq,
      handNumber: r.table.handsDealt + 1,
      at: r.at,
      net: r.net[0] ?? 0,
      bestCategory: r.bestCategory,
      grades: r.decisions.map((d) => d.grade),
      practice: r.assisted,
    }))
    .sort((a, b) => b.handSeq - a.handSeq);
}

/** The stored hands that are counted (§14.3), as History rows. */
export function readHistory(storage: SafeStorage, lastCommittedHandSeq: number): HistoryItem[] {
  return historyOf(loadHands(storage, lastCommittedHandSeq).hands);
}

/**
 * A stored hand for Review (§12.10): its replay record and the result the banner showed, from a
 * replay. A record that does not replay (another engine version, §4.7) keeps only the hero's
 * result: Review then shows its summary.
 */
export function reviewHandOf(record: HandRecord): ReviewHand {
  const replayRecord: ReplayRecord = {
    engineVersion: record.engineVersion,
    seed: record.seed,
    commit: record.commit,
    table: record.table,
    inputs: record.inputs,
  };
  const end = replayedEnd(replayRecord);
  return {
    handSeq: record.handSeq,
    at: record.at,
    record: replayRecord,
    heroHole: record.heroHole,
    // The board as the hand ended: "Check the shuffle" compares it (§16.3, chunk 9.4), and the
    // Undos with the logged reshuffles; "saved before the cards were dealt" only when known.
    board: [...record.board],
    undoCount: record.undoCount,
    commitBeforeDeal: record.commitBeforeDeal === true,
    end: end ?? {
      handSeq: record.handSeq,
      endedBy: 'fold',
      winners: [],
      shown: [],
      heroNet: record.net[0] ?? 0,
    },
  };
}

/** The stored hand `handSeq` for Review, or null when it is not stored (any more). */
export function readReviewHand(
  storage: SafeStorage,
  lastCommittedHandSeq: number,
  handSeq: number,
): ReviewHand | null {
  const record = loadHands(storage, lastCommittedHandSeq).hands.find((r) => r.handSeq === handSeq);
  return record === undefined ? null : reviewHandOf(record);
}
