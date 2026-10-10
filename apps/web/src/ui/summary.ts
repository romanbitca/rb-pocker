/**
 * The end-of-hand summary's view (PLAN §10.2, §12.9, §14.4; chunk 6.4): from the hand that just
 * ended and its decision records (A.7), the rows the sheet lists and, at Exam, the score. Pure,
 * and part of the summary's lazy chunk (`ui/summaryEntry.ts`): the main bundle only decides when
 * the sheet opens (the controller, `summaryShows`).
 */
import { decisionScore, LEVEL_RULES, summaryShows, type AppState } from '../app/store.ts';
import type { Grade } from '../brain/types.ts';
import type { CoachLevel, PlayerAction, Street } from '../engine/types.ts';

/** One hero decision of the hand, as the summary lists it. */
export interface SummaryRow {
  readonly decisionId: number;
  readonly street: Street;
  readonly taken: PlayerAction;
  /** The coach's move (the grade's recommendation). */
  readonly rec: PlayerAction;
  readonly grade: Grade | null;
  /** The HUD win chance when the hero acted, and the price (null with nothing to call). */
  readonly eRandom: number | null;
  readonly need: number | null;
  /** Taken back with Undo (it still counts, §11.4). */
  readonly undone: boolean;
}

export interface SummaryData {
  readonly handSeq: number;
  /** "Hand 12" (the top bar's number). */
  readonly handNumber: number;
  /** The hero's chips won or lost this hand. */
  readonly net: number;
  readonly bb: number;
  /** Exam: the "Exam result", with the score. */
  readonly exam: boolean;
  readonly rows: readonly SummaryRow[];
  /** The decision score of the hand (§14.4), Exam only; null when nothing was graded. */
  readonly score: number | null;
}

/** The hero's seat (§0.3). */
const HERO = 0;

/**
 * The summary of the hand that just ended, at the coach level in force (the hand's latest
 * decision's, §10), or null when there is none to show.
 */
export function summaryOf(game: AppState['game'], level: CoachLevel): SummaryData | null {
  const { mode, hand, table, decisions } = game;
  if (mode !== 'handEnd' || hand === null || hand.phase !== 'complete' || table === null) {
    return null;
  }
  const grades = decisions.map((d) => d.grade);
  if (!summaryShows(level, grades)) return null;
  const exam = LEVEL_RULES[level].exam;
  return {
    handSeq: hand.handSeq,
    handNumber: table.handsDealt + 1,
    net: hand.result?.net[HERO] ?? 0,
    bb: hand.bb,
    exam,
    rows: decisions.map((d) => ({
      decisionId: d.decisionId,
      street: d.street,
      taken: d.taken,
      rec: d.rec,
      grade: d.grade,
      eRandom: d.eRandom,
      need: d.need,
      undone: d.undone,
    })),
    score: exam ? decisionScore(grades) : null,
  };
}
