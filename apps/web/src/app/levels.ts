/**
 * The level rules (PLAN §9.2, §9.3, §10, §10.2): the coach levels as data (chunk 6.4) and the bot
 * levels of each seat (chunk 7.2). Pure; no timers, no store.
 *
 * **Coach levels (chunk 6.4).** What each level shows and does, row by row of the §10.2 table. The
 * controller (pause, Undo, the hand summary), the selectors (win badge, price chip, draw chips,
 * "By river", grade chips) and the UI (coach strip, rankings panel) all read it, so a level never
 * shows one thing in one place and another elsewhere. `tests/app/levels.test.ts` holds it against
 * the table.
 *
 * The level that counts is the one in force for the decision (§10: a change applies from the next
 * hero decision): the controller fixes it when the decision starts (`game.coachLevel`), and
 * `selectCoachLevel` falls back to the settings before the hero's first decision of a hand.
 *
 * **Bot levels (chunk 7.2).** Which level decides a seat, whether that level shows the bot's
 * personality, and which levels the next hand is dealt at. The pods, the bot card, the observation
 * the brain gets (`visiblePersonality`, `seatLevels`) and the controller all read these functions,
 * so they cannot disagree.
 *
 * Per-seat overrides. A seat's level is its own override in `TableConfig.seatLevels`, else the
 * table's `botLevel`. The table a hand is dealt from is never changed while the hand is played; a
 * new level reaches the table through `withLevels` when the next hand is dealt, and the levels it
 * takes are `nextLevels`: the settings' table level and the settings' per-seat overrides (the same
 * way a new table level has always reached the table, §10).
 */
import type { Grade } from '../brain/types.ts';
import type { BotLevel, CoachLevel, TableState } from '../engine/types.ts';
import type { Settings } from '../persist/schema.ts';

// ---------------------------------------------------------------------------------------------
// Coach levels (chunk 6.4)

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

// ---------------------------------------------------------------------------------------------
// Bot levels, per seat (chunk 7.2)

/** The level that decides a seat's play and label: its own override, else the table's (§9.3). */
export function seatLevelOf(table: TableState, seat: number): BotLevel {
  return table.config.seatLevels[seat] ?? table.config.botLevel;
}

/**
 * Whether a bot at `level` shows its personality (§9.2 "Personality label visible"): Easy and
 * Medium yes, Hard and Expert no ("Read their stats"). The one rule for the pod's badge, the bot
 * card and the `visiblePersonality` that the brain sees.
 */
export function labelVisible(level: BotLevel): boolean {
  return level === 'easy' || level === 'medium';
}

/**
 * The level of every seat of `table`, index = seat (the hero's entry is the table level and is
 * never used). These are the levels in force for a hand dealt from `table`, so the table a hand
 * records (§14.3, `ReplayRecord.table`) holds them per seat.
 */
export function levelsOf(table: TableState): BotLevel[] {
  return table.slots.map((_, seat) => seatLevelOf(table, seat));
}

/** A table level and the per-seat overrides that go with it (`TableConfig`'s two level fields). */
export interface TableLevels {
  botLevel: BotLevel;
  /** Index = seat; null = the table's level; [0] (the hero) is always null. */
  seatLevels: (BotLevel | null)[];
}

/**
 * The levels the next hand at `table` is dealt at (§9.3, §10): the settings' table level and the
 * settings' per-seat overrides, so a level picked on a bot's card, in Settings or in Setup is
 * saved with the settings and followed by the table from the next hand.
 *
 * The settings' overrides are one per seat of the table they were made for (`Settings.players`,
 * A.7). Should they belong to another seat count (a profile that does not match the saved table),
 * the table keeps its own overrides rather than take some that belong to other seats.
 */
export function nextLevels(
  settings: Pick<Settings, 'botLevel' | 'players' | 'seatLevels'>,
  table: TableState,
): TableLevels {
  const seats = table.config.seatCount;
  const own = settings.players === seats ? settings.seatLevels : table.config.seatLevels;
  return {
    botLevel: settings.botLevel,
    seatLevels: Array.from({ length: seats }, (_, seat) =>
      seat === 0 ? null : (own[seat] ?? null),
    ),
  };
}

/** Two lists of overrides are the same. */
export function sameSeatLevels(
  a: readonly (BotLevel | null)[],
  b: readonly (BotLevel | null)[],
): boolean {
  return a.length === b.length && a.every((level, seat) => level === b[seat]);
}
