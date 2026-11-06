/**
 * The stats reducers (PLAN §14.4, §11.4; chunk 8.2): `applyHand` counts one hand record into each
 * bucket, `endSession` moves the running session to the ring. Pure, JSON-safe, and the result
 * always passes the profile guard. The 20-hand fixture with hand-computed numbers on every card
 * is `tests/ui/stats.fixture.test.ts`; the controller's side is `tests/app/controller.stats.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { BotLevel } from '../../src/engine/types.ts';
import {
  emptyStats,
  profileProblem,
  defaultProfile,
  type DecisionRecord,
  type HandRecord,
  type Stats,
} from '../../src/persist/schema.ts';
import {
  applyHand,
  endSession,
  levelOfHand,
  RECENT_HANDS_KEEP,
  SCORE_POINTS,
  SESSIONS_KEEP,
} from '../../src/persist/stats.ts';
import { SCORE_POINTS as APP_SCORE_POINTS } from '../../src/app/levels.ts';
import { deepFreeze } from '../engine/play.ts';
import { decision, handRecord, NOW } from './fixtures.ts';

/** A clean hand: heads-up (the fixture's table), no decision, nothing won. */
function rec(overrides: Partial<HandRecord> = {}): HandRecord {
  return {
    ...handRecord(),
    assisted: false,
    undoCount: 0,
    decisions: [],
    net: [0, 0],
    heroNetMilliBB: 0,
    bestCategory: null,
    heroPlay: { vpip: false, pfr: false, sawFlop: false, showdown: false, won: 0 },
    ...overrides,
  };
}

const d = (overrides: Partial<DecisionRecord>): DecisionRecord =>
  decision({ leak: null, quiz: null, lossMilliBB: 0, ...overrides });

/** `applyHand` over the records, from empty stats; each input frozen (purity). */
const fold = (records: readonly HandRecord[], from: Stats = emptyStats()): Stats =>
  records.reduce((s, r) => applyHand(deepFreeze(s), deepFreeze(r)), from);

const valid = (stats: Stats): string | null => profileProblem({ ...defaultProfile(NOW), stats });

describe('results (§14.4, §11.4)', () => {
  it('clean hands to `clean` and their level; Undo hands only to `practice`', () => {
    const s = fold([
      rec({ net: [120, -120], heroNetMilliBB: 1200 }),
      rec({ assisted: true, undoCount: 1, net: [-60, 60], heroNetMilliBB: -600 }),
      rec({ net: [-40, 40], heroNetMilliBB: -400 }),
    ]);
    expect(s.results.clean).toMatchObject({ hands: 2, netChips: 80, netMilliBB: 800 });
    expect(s.results.practice).toMatchObject({ hands: 1, netChips: -60, netMilliBB: -600 });
    expect(s.results.byBotLevel.easy).toMatchObject({ hands: 2, netChips: 80, netMilliBB: 800 });
    expect(s.results.byBotLevel.medium.hands).toBe(0);
    expect(valid(s)).toBeNull();
  });

  it('hands won, VPIP, PFR, flops, showdowns, the biggest pot and all-in luck', () => {
    const play = (p: Partial<HandRecord['heroPlay']>): HandRecord['heroPlay'] => ({
      vpip: false,
      pfr: false,
      sawFlop: false,
      showdown: false,
      won: 0,
      ...p,
    });
    const s = fold([
      // Raised, saw the flop, won 300 at a showdown, all in at 70% for a 300 pot, won it all.
      rec({
        heroPlay: play({ vpip: true, pfr: true, sawFlop: true, showdown: true, won: 300 }),
        allIn: { expected: 0.7, actual: 1, pot: 300 },
      }),
      // Called, saw the flop, lost a showdown; all in at 55.5% for 200, lost: luck −111.
      rec({
        heroPlay: play({ vpip: true, sawFlop: true, showdown: true }),
        allIn: { expected: 0.555, actual: 0, pot: 200 },
      }),
      // A walk in the big blind: won 15 without a decision.
      rec({ heroPlay: play({ won: 15 }) }),
      // Folded before the flop.
      rec(),
    ]);
    expect(s.results.clean).toMatchObject({
      hands: 4,
      handsWon: 2,
      vpipHands: 2,
      pfrHands: 1,
      sawFlop: 2,
      wentToShowdown: 2,
      wonAtShowdown: 1,
      biggestPotWon: 300,
      // Whole chips per hand: 210 + 111 (0.555 × 200 = 111), and 300 + 0.
      allInExpectedChips: 321,
      allInActualChips: 300,
    });
  });

  it('a mixed table adds to the totals and to no level bucket (§14.4, §9.3)', () => {
    const base = rec();
    const mixed = rec({
      table: { ...base.table, config: { ...base.table.config, seatLevels: [null, 'hard'] } },
    });
    expect(levelOfHand(base)).toBe('easy');
    expect(levelOfHand(mixed)).toBeNull();
    // An override equal to the table's level is not another level.
    const same = rec({
      table: { ...base.table, config: { ...base.table.config, seatLevels: [null, 'easy'] } },
    });
    expect(levelOfHand(same)).toBe('easy');
    // A seat with no chips at hand start was not dealt in: its level does not count.
    const out = rec({
      table: {
        ...base.table,
        config: { ...base.table.config, seatCount: 3, seatLevels: [null, null, 'expert'] },
        slots: [
          ...base.table.slots,
          {
            ...(base.table.slots[1] as HandRecord['table']['slots'][number]),
            playerId: 'bot-9',
            stack: 0,
          },
        ],
      },
    });
    expect(levelOfHand(out)).toBe('easy');

    const s = fold([base, mixed]);
    expect(s.results.clean.hands).toBe(2);
    const levels = Object.values(s.results.byBotLevel).reduce((n, b) => n + b.hands, 0);
    expect(levels).toBe(1);
    expect(s.recentHands).toHaveLength(1);
  });
});

describe('decisions (§14.4, §11.4)', () => {
  it('every graded decision counts, undone ones too; a failed grade counts nowhere', () => {
    const s = fold([
      rec({
        coachLevel: 'intermediate',
        decisions: [
          d({ decisionId: 0, grade: 'mistake', undone: true, hintSeen: false, lossMilliBB: 800 }),
          d({ decisionId: 0, grade: 'best', hintSeen: false }),
          d({ decisionId: 1, street: 'flop', grade: null, lossMilliBB: 999 }),
          d({ decisionId: 2, street: 'turn', grade: 'good', hintSeen: true }),
        ],
        assisted: true,
        undoCount: 1,
      }),
    ]);
    const all = s.decisions.all;
    expect(all.decisions).toBe(3);
    expect(all.byGrade).toEqual({ best: 1, good: 1, inaccuracy: 0, mistake: 1, blunder: 0 });
    expect(all.lossMilliBB).toBe(800);
    expect(all.undone).toBe(1);
    expect(all.own).toBe(2);
    expect(all.ownBestOrGood).toBe(1);
    expect(all.hintSeen).toBe(1);
    expect(s.decisions.byCoachLevel.intermediate.decisions).toBe(3);
    expect(s.decisions.byCoachLevel.beginner.decisions).toBe(0);
    expect(s.decisions.byStreet.preflop.decisions).toBe(2);
    expect(s.decisions.byStreet.flop.decisions).toBe(0);
    expect(s.decisions.byStreet.turn.decisions).toBe(1);
    // The practice hand counts in the decision score (§11.4): (25 + 100 + 90) / 3.
    expect(s.currentSession?.decisionScore).toBeCloseTo(215 / 3, 10);
  });

  it('on your own never counts a Beginner decision; the hint is followed by the same kind of move', () => {
    const s = fold([
      rec({
        coachLevel: 'beginner',
        decisions: [d({ grade: 'best', hintSeen: false })],
      }),
      rec({
        coachLevel: 'advanced',
        decisions: [
          d({
            grade: 'good',
            hintSeen: true,
            taken: { type: 'raise', to: 80 },
            rec: { type: 'raise', to: 60 },
          }),
          d({ grade: 'mistake', hintSeen: true, taken: { type: 'call' }, rec: { type: 'fold' } }),
          d({ grade: 'best', hintSeen: false, taken: { type: 'fold' }, rec: { type: 'fold' } }),
        ],
      }),
    ]);
    expect(s.decisions.all).toMatchObject({
      own: 1,
      ownBestOrGood: 1,
      hintSeen: 2,
      hintFollowed: 1,
    });
  });

  it('quiz answers, leaks and the streak', () => {
    const s = fold([
      rec({
        decisions: [
          d({ grade: 'good', quiz: { correct: 2, of: 3 } }),
          d({
            grade: 'inaccuracy',
            leak: 'call-light',
            lossMilliBB: 300,
            quiz: { correct: 1, of: 2 },
          }),
          d({ grade: 'best' }),
        ],
      }),
      rec({
        decisions: [
          d({ grade: 'blunder', leak: 'call-light', lossMilliBB: 5200 }),
          d({ grade: 'good' }),
          d({ grade: 'mistake', leak: 'chase', lossMilliBB: 1100, undone: true }),
          d({ grade: 'best' }),
        ],
      }),
    ]);
    expect(s.decisions.all).toMatchObject({ quizAsked: 5, quizCorrect: 3 });
    expect(s.leaks).toEqual({
      'call-light': { count: 2, lossMilliBB: 5500 },
      chase: { count: 1, lossMilliBB: 1100 },
    });
    // good, inaccuracy, best → 3; blunder → 0; good → 1; mistake (undone, still counts) → 0; best → 1.
    expect(s.streak).toEqual({ current: 1, best: 3 });
  });
});

describe('collection, sessions and recent hands (§14.4, A.7)', () => {
  it('counts each category made, and keeps the first date', () => {
    const s = fold([
      rec({ bestCategory: 'flush', at: '2026-10-01T10:00:00.000Z' }),
      rec({ bestCategory: 'pair', at: '2026-10-02T10:00:00.000Z' }),
      rec({ bestCategory: 'flush', at: '2026-10-03T10:00:00.000Z' }),
      rec({ bestCategory: null, at: '2026-10-04T10:00:00.000Z' }),
    ]);
    expect(s.collection.flush).toEqual({ count: 2, first: '2026-10-01T10:00:00.000Z' });
    expect(s.collection.pair).toEqual({ count: 1, first: '2026-10-02T10:00:00.000Z' });
    expect(s.collection.royalFlush).toEqual({ count: 0, first: null });
    expect(s.firstPlayedAt).toBe('2026-10-01T10:00:00.000Z');
    expect(s.lastPlayedAt).toBe('2026-10-04T10:00:00.000Z');
  });

  it('the running session sums its hands; it starts with the first, its levels are the latest', () => {
    const s = fold([
      rec({
        at: '2026-10-01T10:00:00.000Z',
        net: [100, -100],
        decisions: [d({ grade: 'best' }), d({ grade: 'blunder' })],
      }),
      rec({ at: '2026-10-01T10:01:00.000Z', net: [-30, 30], coachLevel: 'exam' }),
      rec({
        at: '2026-10-01T10:02:00.000Z',
        net: [0, 0],
        assisted: true,
        decisions: [d({ grade: 'mistake' }), d({ grade: 'good' }), d({ grade: 'best' })],
      }),
    ]);
    expect(s.currentSession).toEqual({
      start: '2026-10-01T10:00:00.000Z',
      end: '2026-10-01T10:02:00.000Z',
      hands: 3,
      netChips: 70,
      decisionScore: (100 + 0 + 25 + 90 + 100) / 5,
      mistakes: 1,
      blunders: 1,
      decisions: 5,
      botLevel: 'easy',
      coachLevel: 'beginner',
      players: 2,
      bb: 100,
    });
    expect(s.sessions).toBe(0);
    expect(s.recentHands.map((h) => [h.scorePoints, h.graded, h.assisted])).toEqual([
      [100, 2, false],
      [0, 0, false],
      [215, 3, true],
    ]);
  });

  it('a session score stays exact over many decisions (whole points, no drift)', () => {
    // 1/3-style means: (100 + 25 + 25) / 3 = 50 exactly, then on and on.
    const grades = ['best', 'mistake', 'mistake', 'good', 'inaccuracy', 'best', 'blunder'] as const;
    const records = Array.from({ length: 300 }, (_, i) =>
      rec({ decisions: [d({ grade: grades[i % grades.length] as (typeof grades)[number] })] }),
    );
    const s = fold(records);
    const points = records.reduce(
      (sum, r) =>
        sum + SCORE_POINTS[(r.decisions[0] as DecisionRecord).grade as keyof typeof SCORE_POINTS],
      0,
    );
    expect(s.currentSession?.decisions).toBe(300);
    expect(Math.round((s.currentSession?.decisionScore ?? 0) * 300)).toBe(points);
    expect(s.currentSession?.decisionScore).toBeCloseTo(points / 300, 9);
  });

  it('endSession moves the session to the ring of 60 and counts it; without one, nothing', () => {
    const empty = emptyStats();
    expect(endSession(empty)).toBe(empty);
    let s = emptyStats();
    for (let i = 0; i < SESSIONS_KEEP + 3; i++) {
      s = endSession(fold([rec({ net: [i, -i] })], s));
    }
    expect(s.sessions).toBe(SESSIONS_KEEP + 3);
    expect(s.currentSession).toBeNull();
    expect(s.recentSessions).toHaveLength(SESSIONS_KEEP);
    expect(s.recentSessions[0]?.netChips).toBe(3);
    expect(s.recentSessions.at(-1)?.netChips).toBe(SESSIONS_KEEP + 2);
    expect(valid(s)).toBeNull();
  });

  it('keeps the last 500 recent hands, for the level suggestions (§10.4)', () => {
    const levels: BotLevel[] = ['easy', 'medium'];
    let s = emptyStats();
    const base = rec();
    for (let i = 0; i < RECENT_HANDS_KEEP + 20; i++) {
      const level = levels[i % 2] as BotLevel;
      s = applyHand(s, {
        ...base,
        botLevel: level,
        table: { ...base.table, config: { ...base.table.config, botLevel: level } },
        heroNetMilliBB: i,
      });
    }
    expect(s.recentHands).toHaveLength(RECENT_HANDS_KEEP);
    expect(s.recentHands[0]?.netMilliBB).toBe(20);
    expect(s.recentHands.at(-1)).toMatchObject({
      botLevel: 'medium',
      netMilliBB: RECENT_HANDS_KEEP + 19,
    });
    expect(s.results.byBotLevel.easy.hands + s.results.byBotLevel.medium.hands).toBe(520);
  });

  it('the decision-score points are the app`s (one table, §14.4)', () => {
    expect(APP_SCORE_POINTS).toBe(SCORE_POINTS);
  });
});
