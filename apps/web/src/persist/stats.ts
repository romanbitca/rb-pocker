/**
 * The stats reducers (PLAN §14.4): pure functions on the A.7 `Stats` of the profile.
 *
 * - `applyHand(stats, record)` counts one finished hand (§14.3 step 4): it runs inside the commit,
 *   so a hand is counted exactly once whatever crashes happen. Results go to the `clean` bucket, or
 *   to `practice` when the hand had an Undo (§11.4), and the clean ones also to `byBotLevel`.
 *   Every graded decision counts in the decision buckets, undone ones too (§11.4); a decision
 *   whose grading failed (`grade: null`) counts in none (A.7).
 * - `endSession(stats)` moves the running session to the ring of recent sessions (§14.4: Leave
 *   table, New table, or 30 minutes without an action, checked at the next launch).
 *
 * Readings where the text is open (§14.4 notes, chunk 8.2): a session starts with its first
 * counted hand and takes its levels, players and blinds from its latest one; a hand counts in
 * `byBotLevel` and `recentHands` only when every bot dealt in plays at the table's level (§9.3);
 * "hands won" and "won at showdown" mean the hero won chips from a pot (a split pot too, as
 * tracker software counts it); the biggest pot won is the most chips taken from the pots in one
 * hand; "did the recommendation" (hint follow) is the same kind of action (fold, check, call, bet,
 * raise), whatever the size; all-in luck adds whole chips per hand, so every sum stays an integer.
 */
import type { Grade } from '../brain/types.ts';
import type { BotLevel } from '../engine/types.ts';
import type {
  DecisionBucket,
  DecisionRecord,
  HandRecord,
  ResultBucket,
  SessionSummary,
  Stats,
} from './schema.ts';

/** §14.4 decision score points: Best 100 / Good 90 / Inaccuracy 60 / Mistake 25 / Blunder 0. */
export const SCORE_POINTS: Readonly<Record<Grade, number>> = {
  best: 100,
  good: 90,
  inaccuracy: 60,
  mistake: 25,
  blunder: 0,
};

/** The ring of recent sessions keeps the last 60 (A.7). */
export const SESSIONS_KEEP = 60;
/** The ring of recent hands keeps the last 500 (A.7, §10.4). */
export const RECENT_HANDS_KEEP = 500;
/** §14.4: a session ends after 30 minutes without an action (checked at the next launch). */
export const SESSION_IDLE_MS = 30 * 60 * 1000;

type Graded = DecisionRecord & { grade: Grade };

/**
 * The table's bot level when every bot dealt in plays at it, else null (a mixed table: §14.4, the
 * hand adds to the totals and to no level bucket). The record's table is the table as at hand
 * start: a seat with chips was dealt in.
 */
export function levelOfHand(record: HandRecord): BotLevel | null {
  const { config, slots } = record.table;
  const mixed = slots.some(
    (slot, seat) =>
      seat > 0 &&
      slot.stack > 0 &&
      (config.seatLevels[seat] ?? config.botLevel) !== config.botLevel,
  );
  return mixed ? null : config.botLevel;
}

function addResult(b: ResultBucket, r: HandRecord): ResultBucket {
  const p = r.heroPlay;
  const won = p.won > 0;
  const allIn = r.allIn;
  return {
    hands: b.hands + 1,
    handsWon: b.handsWon + Number(won),
    // The guard keeps `net` one entry per seat (2 to 9), the hero's first.
    netChips: b.netChips + (r.net[0] as number),
    netMilliBB: b.netMilliBB + r.heroNetMilliBB,
    vpipHands: b.vpipHands + Number(p.vpip),
    pfrHands: b.pfrHands + Number(p.pfr),
    sawFlop: b.sawFlop + Number(p.sawFlop),
    wentToShowdown: b.wentToShowdown + Number(p.showdown),
    wonAtShowdown: b.wonAtShowdown + Number(p.showdown && won),
    biggestPotWon: Math.max(b.biggestPotWon, p.won),
    allInExpectedChips:
      b.allInExpectedChips + (allIn === null ? 0 : Math.round(allIn.expected * allIn.pot)),
    allInActualChips:
      b.allInActualChips + (allIn === null ? 0 : Math.round(allIn.actual * allIn.pot)),
  };
}

function addDecision(b: DecisionBucket, d: Graded, own: boolean): DecisionBucket {
  const good = d.grade === 'best' || d.grade === 'good';
  return {
    decisions: b.decisions + 1,
    byGrade: { ...b.byGrade, [d.grade]: b.byGrade[d.grade] + 1 },
    lossMilliBB: b.lossMilliBB + d.lossMilliBB,
    own: b.own + Number(own),
    ownBestOrGood: b.ownBestOrGood + Number(own && good),
    hintSeen: b.hintSeen + Number(d.hintSeen),
    hintFollowed: b.hintFollowed + Number(d.hintSeen && d.taken.type === d.rec.type),
    undone: b.undone + Number(d.undone),
    quizAsked: b.quizAsked + (d.quiz?.of ?? 0),
    quizCorrect: b.quizCorrect + (d.quiz?.correct ?? 0),
  };
}

/**
 * The session with this hand in it (a new one when none runs). `decisionScore` is the exact mean;
 * its points sum is a whole number, so `round(score × decisions)` gives it back without drift.
 */
function addToSession(
  s: SessionSummary | null,
  r: HandRecord,
  graded: readonly Graded[],
  points: number,
): SessionSummary {
  const before = s?.decisions ?? 0;
  const decisions = before + graded.length;
  const sum = Math.round((s?.decisionScore ?? 0) * before) + points;
  return {
    start: s?.start ?? r.at,
    end: r.at,
    hands: (s?.hands ?? 0) + 1,
    netChips: (s?.netChips ?? 0) + (r.net[0] as number),
    decisionScore: decisions === 0 ? null : sum / decisions,
    mistakes: (s?.mistakes ?? 0) + graded.filter((d) => d.grade === 'mistake').length,
    blunders: (s?.blunders ?? 0) + graded.filter((d) => d.grade === 'blunder').length,
    decisions,
    botLevel: r.botLevel,
    coachLevel: r.coachLevel,
    players: r.table.config.seatCount,
    bb: r.table.config.bb,
  };
}

export function applyHand(stats: Stats, record: HandRecord): Stats {
  const r = record;
  const graded = r.decisions.filter((d): d is Graded => d.grade !== null);
  const points = graded.reduce((sum, d) => sum + SCORE_POINTS[d.grade], 0);
  const level = levelOfHand(r);

  // Results: §11.4, Undo hands only in the practice bucket; the clean ones by bot level too.
  const key = r.assisted ? 'practice' : 'clean';
  let byBotLevel = stats.results.byBotLevel;
  if (!r.assisted && level !== null) {
    byBotLevel = { ...byBotLevel, [level]: addResult(byBotLevel[level], r) };
  }

  // Decisions, leaks and the streak: every graded decision, undone ones too (§11.4).
  let all = stats.decisions.all;
  const byCoachLevel = { ...stats.decisions.byCoachLevel };
  const byStreet = { ...stats.decisions.byStreet };
  const leaks = { ...stats.leaks };
  let { current, best } = stats.streak;
  for (const d of graded) {
    // "On your own": the hint was not opened; Beginner decisions never count (its hint is on show).
    const own = !d.hintSeen && r.coachLevel !== 'beginner';
    all = addDecision(all, d, own);
    byCoachLevel[r.coachLevel] = addDecision(byCoachLevel[r.coachLevel], d, own);
    byStreet[d.street] = addDecision(byStreet[d.street], d, own);
    if (d.leak !== null) {
      const leak = leaks[d.leak];
      leaks[d.leak] = {
        count: (leak?.count ?? 0) + 1,
        lossMilliBB: (leak?.lossMilliBB ?? 0) + d.lossMilliBB,
      };
    }
    current = d.grade === 'mistake' || d.grade === 'blunder' ? 0 : current + 1;
    best = Math.max(best, current);
  }

  const category = r.bestCategory;
  const made = category === null ? null : stats.collection[category];
  return {
    ...stats,
    firstPlayedAt: stats.firstPlayedAt ?? r.at,
    lastPlayedAt: r.at,
    results: { ...stats.results, [key]: addResult(stats.results[key], r), byBotLevel },
    decisions: { all, byCoachLevel, byStreet },
    leaks,
    collection:
      category === null || made === null
        ? stats.collection
        : { ...stats.collection, [category]: { count: made.count + 1, first: made.first ?? r.at } },
    streak: { current, best },
    currentSession: addToSession(stats.currentSession, r, graded, points),
    recentHands:
      level === null
        ? stats.recentHands
        : [
            ...stats.recentHands,
            {
              botLevel: r.botLevel,
              coachLevel: r.coachLevel,
              assisted: r.assisted,
              netMilliBB: r.heroNetMilliBB,
              scorePoints: points,
              graded: graded.length,
            },
          ].slice(-RECENT_HANDS_KEEP),
  };
}

/** §14.4: the running session ends (`stats` itself when none runs). */
export function endSession(stats: Stats): Stats {
  const session = stats.currentSession;
  if (session === null) return stats;
  return {
    ...stats,
    sessions: stats.sessions + 1,
    recentSessions: [...stats.recentSessions, session].slice(-SESSIONS_KEEP),
    currentSession: null,
  };
}
