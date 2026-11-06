/**
 * The Stats screen's numbers (PLAN §14.4, chunk 8.2): pure, from the profile's `Stats` (A.7). It
 * loads with the screen's lazy chunk (§15.3). Every percentage and score is a whole number,
 * rounded half away from zero; "Big blinds per 100 hands" has one decimal.
 *
 * - Progress: the decision score of this session (the last one when none runs), of the last 7
 *   local days with the change from the 7 days before, and of the last 20 sessions (the line
 *   chart); mistakes per 100 decisions the same way, the last 10 sessions as bars; on your own;
 *   following the coach; the streak; the top 3 leaks (seen 3 times or more, by EV lost, in chips at
 *   the current big blind); "Fixed with Undo"; the quiz.
 * - Results: the clean hands (§11.4), the practice hands only as their count.
 * - Hands: the collection, strongest first, as the rankings panel (§13.2).
 *
 * The sessions are `recentSessions` and then `currentSession`; a session belongs to the day of
 * its last hand (`end`). Pooled scores add each session's points (`round(score × decisions)`,
 * exact: the points are whole numbers) and decisions.
 */
import type { LeakId } from '../brain/types.ts';
import { RANKINGS } from '../data/rankings.ts';
import type { BotLevel } from '../engine/types.ts';
import type { HandCategory } from '../eval/evaluate.ts';
import type { SessionSummary, Stats } from '../persist/schema.ts';

/** §14.4: "Play 5 hands to see your first stats". */
export const STATS_MIN_HANDS = 5;
/** The decision score's line chart: the last 20 sessions. */
export const SCORE_SESSIONS = 20;
/** The mistakes' bars: the last 10 sessions with decisions. */
export const MISTAKE_SESSIONS = 10;
/** §14.4 Leaks: the top 3 by Σ loss, with count ≥ 3. */
export const TOP_LEAKS = 3;
export const LEAK_MIN_COUNT = 3;

/** The lessons a leak links to (Appendix F.8): Your options, Position, Pot odds, Outs. */
export type LeakLesson = 3 | 5 | 6 | 7;

/**
 * §8.9 "Lesson links": the lesson that teaches what each leak gets wrong. Before the flop, how
 * many hands to play is Position; the moves (limping, not betting a strong hand, bluffing) are
 * Your options; chasing a draw is Outs; every call or fold against the price, and a bet's size
 * (which sets the price), is Pot odds. Stats opens it by number (`{ type: 'lesson' }`), so Learn's
 * lessons stay in Learn's chunk; the titles of these four are in `i18n/stats.ts`.
 */
export const LEAK_LESSON: Readonly<Record<LeakId, LeakLesson>> = {
  'open-loose': 5,
  'open-tight': 5,
  limp: 3,
  'call-pre-wide': 6,
  'fold-pre-much': 6,
  pushfold: 6,
  'missed-value': 3,
  'bluff-much': 3,
  overfold: 6,
  chase: 7,
  'river-call': 6,
  'call-light': 6,
  sizing: 6,
};

const BOT_LEVELS: readonly BotLevel[] = ['easy', 'medium', 'hard', 'expert'];

/** Half away from zero (Math.round sends −2.5 to −2). */
export const roundHalfAway = (x: number): number => Math.sign(x) * Math.round(Math.abs(x));
/** `part / whole` as a whole percentage; null when `whole` is 0. */
export const percent = (part: number, whole: number): number | null =>
  whole === 0 ? null : roundHalfAway((part * 100) / whole);

export interface ProgressView {
  score: {
    /** The running session's score, or the last finished one's (`last`); null: no graded decision. */
    session: number | null;
    /** The session shown is the last finished one (no session runs). */
    last: boolean;
    /** The last 7 local days, and the change from the 7 days before (null: one of them is empty). */
    week: number | null;
    change: number | null;
    /** The last 20 sessions, oldest first (null: a session without graded decisions). */
    series: (number | null)[];
  };
  mistakes: {
    session: number | null;
    week: number | null;
    /** The last 10 sessions with decisions, oldest first. */
    series: number[];
  };
  /** Best or Good among the decisions without the hint (Beginner never counts). */
  own: number | null;
  /** The hero did the coach's move, among the decisions whose hint was seen. */
  follow: number | null;
  streak: { current: number; best: number };
  leaks: { id: LeakId; count: number; chips: number }[];
  fixedWithUndo: number;
  quiz: { right: number; asked: number; pct: number | null };
}

export interface ResultsView {
  hands: number;
  won: number;
  netChips: number;
  /** Net big blinds per 100 hands, one decimal (null: no hand). */
  bb100: number | null;
  vpip: number | null;
  pfr: number | null;
  showdowns: number;
  showdownWins: number;
  showdownPct: number | null;
  biggestPot: number;
  reloads: number;
  /** All-in luck in whole chips (null: no all-in run-out counted yet). */
  luck: { expected: number; actual: number; luck: number } | null;
  byLevel: { level: BotLevel; hands: number; bb100: number | null }[];
  practice: number;
}

export interface CollectionRow {
  category: HandCategory;
  count: number;
  /** ISO UTC of the first time, or null. */
  first: string | null;
}

export interface StatsView {
  /** Hands counted, clean and practice. */
  hands: number;
  /** Enough hands for Progress and Results (`STATS_MIN_HANDS`). */
  ready: boolean;
  progress: ProgressView;
  results: ResultsView;
  /** Strongest first, as the rankings panel. */
  collection: CollectionRow[];
}

/** One decimal, half away from zero: big blinds per 100 hands from milli-big-blinds per hand. */
const perHundred = (milliBB: number, hands: number): number | null =>
  hands === 0 ? null : roundHalfAway(milliBB / hands) / 10;

const sessionScore = (s: SessionSummary): number | null =>
  s.decisionScore === null ? null : roundHalfAway(s.decisionScore);

const sessionMistakes = (s: SessionSummary): number | null =>
  percent(s.mistakes + s.blunders, s.decisions);

/** Pooled over sessions: the decision score and mistakes per 100 decisions. */
function pooled(sessions: readonly SessionSummary[]): {
  score: number | null;
  mistakes: number | null;
} {
  let points = 0;
  let decisions = 0;
  let bad = 0;
  for (const s of sessions) {
    if (s.decisions === 0 || s.decisionScore === null) continue;
    points += Math.round(s.decisionScore * s.decisions);
    decisions += s.decisions;
    bad += s.mistakes + s.blunders;
  }
  return decisions === 0
    ? { score: null, mistakes: null }
    : { score: roundHalfAway(points / decisions), mistakes: percent(bad, decisions) };
}

/** The start of the local day `days` days before `now`'s (§14.4: "last 7 days" uses local days). */
const localDayStart = (now: Date, days: number): number =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate() - days).getTime();

function progressOf(stats: Stats, bb: number, now: Date): ProgressView {
  const sessions = [
    ...stats.recentSessions,
    ...(stats.currentSession === null ? [] : [stats.currentSession]),
  ];
  const shown = sessions[sessions.length - 1] ?? null;
  const weekStart = localDayStart(now, 6);
  const beforeStart = localDayStart(now, 13);
  const endOf = (s: SessionSummary): number => Date.parse(s.end);
  const week = pooled(sessions.filter((s) => endOf(s) >= weekStart));
  const before = pooled(sessions.filter((s) => endOf(s) >= beforeStart && endOf(s) < weekStart));
  const all = stats.decisions.all;

  const leaks = (Object.entries(stats.leaks) as [LeakId, { count: number; lossMilliBB: number }][])
    .filter(([, leak]) => leak.count >= LEAK_MIN_COUNT)
    .sort(
      ([a, x], [b, y]) =>
        y.lossMilliBB - x.lossMilliBB || y.count - x.count || (a < b ? -1 : a > b ? 1 : 0),
    )
    .slice(0, TOP_LEAKS)
    .map(([id, leak]) => ({
      id,
      count: leak.count,
      chips: roundHalfAway((leak.lossMilliBB * bb) / 1000),
    }));

  return {
    score: {
      session: shown === null ? null : sessionScore(shown),
      last: stats.currentSession === null && shown !== null,
      week: week.score,
      change: week.score === null || before.score === null ? null : week.score - before.score,
      series: sessions.slice(-SCORE_SESSIONS).map(sessionScore),
    },
    mistakes: {
      session: shown === null ? null : sessionMistakes(shown),
      week: week.mistakes,
      series: sessions
        .filter((s) => s.decisions > 0)
        .slice(-MISTAKE_SESSIONS)
        .map((s) => sessionMistakes(s) as number),
    },
    own: percent(all.ownBestOrGood, all.own),
    follow: percent(all.hintFollowed, all.hintSeen),
    streak: { ...stats.streak },
    leaks,
    fixedWithUndo: all.undone,
    quiz: {
      right: all.quizCorrect,
      asked: all.quizAsked,
      pct: percent(all.quizCorrect, all.quizAsked),
    },
  };
}

function resultsOf(stats: Stats): ResultsView {
  const c = stats.results.clean;
  const luck = c.allInExpectedChips !== 0 || c.allInActualChips !== 0;
  return {
    hands: c.hands,
    won: c.handsWon,
    netChips: c.netChips,
    bb100: perHundred(c.netMilliBB, c.hands),
    vpip: percent(c.vpipHands, c.hands),
    pfr: percent(c.pfrHands, c.hands),
    showdowns: c.wentToShowdown,
    showdownWins: c.wonAtShowdown,
    showdownPct: percent(c.wonAtShowdown, c.wentToShowdown),
    biggestPot: c.biggestPotWon,
    reloads: stats.reloads,
    luck: luck
      ? {
          expected: Math.round(c.allInExpectedChips),
          actual: Math.round(c.allInActualChips),
          luck: Math.round(c.allInActualChips) - Math.round(c.allInExpectedChips),
        }
      : null,
    byLevel: BOT_LEVELS.filter((level) => stats.results.byBotLevel[level].hands > 0).map(
      (level) => {
        const b = stats.results.byBotLevel[level];
        return { level, hands: b.hands, bb100: perHundred(b.netMilliBB, b.hands) };
      },
    ),
    practice: stats.results.practice.hands,
  };
}

/** The Stats screen's numbers; `bb` turns the leaks' milli-big-blinds into chips, `now` sets the week. */
export function statsView(stats: Stats, bb: number, now: Date): StatsView {
  const hands = stats.results.clean.hands + stats.results.practice.hands;
  return {
    hands,
    ready: hands >= STATS_MIN_HANDS,
    progress: progressOf(stats, bb, now),
    results: resultsOf(stats),
    collection: RANKINGS.map((row) => ({
      category: row.key,
      count: stats.collection[row.key].count,
      first: stats.collection[row.key].first,
    })),
  };
}
