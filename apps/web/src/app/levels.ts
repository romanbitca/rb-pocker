/**
 * The coach levels as data (PLAN §10.2, chunk 6.4): what each level shows and does, row by row of
 * the §10.2 table. The controller (pause, Undo, the hand summary), the selectors (win badge, price
 * chip, draw chips, "By river", grade chips) and the UI (coach strip, rankings panel) all read it,
 * so a level never shows one thing in one place and another elsewhere. `tests/app/levels.test.ts`
 * holds it against the table.
 *
 * The level that counts is the one in force for the decision (§10: a change applies from the next
 * hero decision): the controller fixes it when the decision starts (`game.coachLevel`), and
 * `selectCoachLevel` falls back to the settings before the hero's first decision of a hand.
 */
import type { Grade } from '../brain/types.ts';
import type { CoachLevel } from '../engine/types.ts';

/** The grades from best to worst (§8.9). */
export const GRADE_ORDER: readonly Grade[] = ['best', 'good', 'inaccuracy', 'mistake', 'blunder'];

/** `grade` is `from` or worse (a null grade, grading failed, never is). */
export function atLeast(grade: Grade | null, from: Grade): boolean {
  return grade !== null && GRADE_ORDER.indexOf(grade) >= GRADE_ORDER.indexOf(from);
}

export interface LevelRules {
  /**
   * "Hint before you act": always on show in the coach strip ('always', Beginner), or behind a
   * "Hint" button ('button'), which at Exam reads "Hint (counts as help)" ('countsAsHelp').
   */
  readonly hint: 'always' | 'button' | 'countsAsHelp';
  /** Advanced: a quiz on 1 in 4 decisions (§10.3, `app/quiz.ts`). */
  readonly quiz: boolean;
  /** The win chance badge while you decide (Exam: hidden; the hand summary shows it). */
  readonly badge: boolean;
  /** The price chip "need X%": under the badge, in the coach's "Why?" only, or nowhere. */
  readonly price: 'chip' | 'why' | 'none';
  /** Draw chips: outs and % ('full'), or the name only ('name'). */
  readonly draws: 'full' | 'name';
  /** Rankings panel: the one-line tips (Intermediate collapses them; Advanced and Exam have none). */
  readonly tips: boolean;
  /** Rankings panel: the "By river" column. */
  readonly byRiver: boolean;
  /** Rankings panel: the "Which hand wins?" quiz button (§13.2). */
  readonly whichWins: boolean;
  /** The grade chip after you act: from this grade on; null = none during the hand. */
  readonly chipFrom: Grade | null;
  /** Pause + Undo offer (the feedback card, §11.1): from this grade on; null = never. */
  readonly pauseFrom: Grade | null;
  /**
   * Where Undo is offered: 'toolbar' (the toolbar Undo, and the feedback card), 'feedback' (only
   * inside the feedback card: Advanced), 'none' (Exam: no undo at all, §11.3 r8).
   */
  readonly undo: 'toolbar' | 'feedback' | 'none';
  /**
   * The end-of-hand summary (§12.9): 'every' hand, or only when a decision of the hand was graded
   * at least this.
   */
  readonly summary: 'every' | Grade;
  /** Exam: the summary is the "Exam result", with the score (§10.2, §14.4). */
  readonly exam: boolean;
  /**
   * "Counts as on your own": never at Beginner (the hint is on show), else when the hint was not
   * opened. True = the hint counts as seen whatever the player did.
   */
  readonly hintAlwaysSeen: boolean;
}

/** PLAN §10.2, column by column. */
export const LEVEL_RULES: Readonly<Record<CoachLevel, LevelRules>> = {
  beginner: {
    hint: 'always',
    quiz: false,
    badge: true,
    price: 'chip',
    draws: 'full',
    tips: true,
    byRiver: true,
    whichWins: false,
    chipFrom: 'best',
    pauseFrom: 'inaccuracy',
    undo: 'toolbar',
    summary: 'every',
    exam: false,
    hintAlwaysSeen: true,
  },
  intermediate: {
    hint: 'button',
    quiz: false,
    badge: true,
    price: 'chip',
    draws: 'full',
    tips: false,
    byRiver: true,
    whichWins: false,
    chipFrom: 'inaccuracy',
    pauseFrom: 'mistake',
    undo: 'toolbar',
    summary: 'inaccuracy',
    exam: false,
    hintAlwaysSeen: false,
  },
  advanced: {
    hint: 'button',
    quiz: true,
    badge: true,
    price: 'why',
    draws: 'full',
    tips: false,
    byRiver: true,
    whichWins: true,
    chipFrom: 'mistake',
    pauseFrom: 'mistake',
    undo: 'feedback',
    summary: 'mistake',
    exam: false,
    hintAlwaysSeen: false,
  },
  exam: {
    hint: 'countsAsHelp',
    quiz: false,
    badge: false,
    price: 'none',
    draws: 'name',
    tips: false,
    byRiver: false,
    whichWins: true,
    chipFrom: null,
    pauseFrom: null,
    undo: 'none',
    summary: 'every',
    exam: true,
    hintAlwaysSeen: false,
  },
};

/** The grade chip after a decision graded `grade` shows at `level` (§10.2, §12.6). */
export function chipShows(level: CoachLevel, grade: Grade | null): boolean {
  const from = LEVEL_RULES[level].chipFrom;
  return from !== null && atLeast(grade, from);
}

/** The level shows the end-of-hand summary for a hand with these grades (§10.2, §12.9). */
export function summaryShows(level: CoachLevel, grades: readonly (Grade | null)[]): boolean {
  if (grades.length === 0) return false; // no decision: nothing to sum up
  const rule = LEVEL_RULES[level].summary;
  return rule === 'every' || grades.some((g) => atLeast(g, rule));
}

/** §14.4 decision score points: Best 100 / Good 90 / Inaccuracy 60 / Mistake 25 / Blunder 0. */
export const SCORE_POINTS: Readonly<Record<Grade, number>> = {
  best: 100,
  good: 90,
  inaccuracy: 60,
  mistake: 25,
  blunder: 0,
};

/** The decision score of these grades (null ones left out), rounded; null with none graded. */
export function decisionScore(grades: readonly (Grade | null)[]): number | null {
  let sum = 0;
  let n = 0;
  for (const g of grades) {
    if (g === null) continue;
    sum += SCORE_POINTS[g];
    n++;
  }
  return n === 0 ? null : Math.round(sum / n);
}
