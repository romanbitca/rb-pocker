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
  /**
   * The grade's own numbers (`DecisionRecord.eRange`, `.R`): the chance against the likely hands
   * of every live opponent, and the call's realisation; null without them (no grade, nothing to
   * call, an older record).
   */
  readonly eRange: number | null;
  readonly R: number | null;
  /** Taken back with Undo (it still counts, §11.4). */
  readonly undone: boolean;
}

/**
 * The numbers of a row (§12.9; QA-1 of 6 Nov 2026), as fractions, each honest about the grade:
 * - `none`: no HUD number; `win`: "You had 45%." (nothing to call, or a price no number can
 *   explain);
 * - `price`: "You had 45%, needed 25%.", the HUD's number when it tells the grade's story;
 * - `likely`: the HUD's number and the grade's `eRange` labelled ("Any cards: 45%. Their likely
 *   hands: about 20%, needed 30%."), when they differ as §8.10's RANGE_ADJUST rule says (5 points,
 *   or the price between the two whole numbers), or when only the grade's number agrees;
 * - `later` (with `price` or `likely`): the realised `eRange × R` ("Counting later bets: about
 *   26%.") when only it explains a fold the price alone would not (the sheet's price bar, §12.6).
 * A comparison that would argue against the coach's move (a call at a price the numbers beat,
 * graded worse than the fold; or the reverse) is never shown: the price is left out instead.
 */
export type RowNumbers =
  | { readonly kind: 'none' }
  | { readonly kind: 'win'; readonly win: number }
  | {
      readonly kind: 'price';
      readonly win: number;
      readonly need: number;
      readonly later: number | null;
    }
  | { readonly kind: 'likelyOnly'; readonly win: number; readonly likely: number }
  | {
      readonly kind: 'likely';
      readonly win: number;
      readonly likely: number;
      readonly need: number;
      readonly later: number | null;
    };

/** A fraction as the whole number the summary shows (the HUD's rounding). */
const whole = (x: number): number => Math.round(100 * x);

/** §8.10 RANGE_ADJUST's rule: 5 points apart, or the price strictly between the whole numbers. */
function differ(win: number, likely: number, need: number): boolean {
  if (Math.abs(likely - win) >= 0.05 - 1e-9) return true;
  const a = whole(win);
  const b = whole(likely);
  return Math.min(a, b) < 100 * need && 100 * need < Math.max(a, b);
}

/** The numbers a summary row shows (see `RowNumbers`). */
export function rowNumbers(row: SummaryRow): RowNumbers {
  const { eRandom: win, need, eRange: likely, R } = row;
  if (win === null) return { kind: 'none' };
  if (need === null) return { kind: 'win', win };
  // What the coach's move says about the price: call (or raise) when it pays, fold when not.
  const fold = row.rec.type === 'fold';
  const agrees = (x: number): boolean => (fold ? whole(x) < whole(need) : whole(x) >= whole(need));
  if (likely === null)
    return agrees(win) ? { kind: 'price', win, need, later: null } : { kind: 'win', win };
  const labelled = differ(win, likely, need) || (!agrees(win) && agrees(likely));
  const shown = labelled ? likely : win;
  let later: number | null = null;
  if (!agrees(shown)) {
    // A fold the price alone would pay: later bets decided it (§8.5 R, §8.3 R), as the sheet's bar.
    const realised = R === null ? null : likely * R;
    if (!fold || realised === null || !agrees(realised)) {
      return labelled ? { kind: 'likelyOnly', win, likely } : { kind: 'win', win };
    }
    later = realised;
  }
  return labelled
    ? { kind: 'likely', win, likely, need, later }
    : { kind: 'price', win, need, later };
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
      eRange: d.eRange ?? null,
      R: d.R ?? null,
      undone: d.undone,
    })),
    score: exam ? decisionScore(grades) : null,
  };
}
