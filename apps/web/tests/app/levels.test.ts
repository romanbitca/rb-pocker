/**
 * The coach levels as data (PLAN §10.2, chunk 6.4): `LEVEL_RULES` against the §10.2 table, row by
 * row, and the selectors that read it: the level in force (the per-decision latch, §10), the
 * grade chip, the quiz hiding the badge and holding Row A, and the coach slice's quiz commands.
 */
import { describe, expect, it } from 'vitest';
import {
  atLeast,
  chipShows,
  createAppStore,
  decisionScore,
  initialCoach,
  initialEquity,
  initialGame,
  LEVEL_RULES,
  quizHidesBadge,
  reduceCoach,
  selectCoachLevel,
  selectGradeChip,
  selectQuiz,
  selectQuizAsking,
  selectUndoButton,
  selectWinBadge,
  summaryShows,
  UNDO_POLICY,
  type AppState,
  type CoachSlice,
  type GameSlice,
} from '../../src/app/store.ts';
import type { Decision, Grade } from '../../src/brain/types.ts';
import { legalActions } from '../../src/engine/legal.ts';
import { startHand } from '../../src/engine/start.ts';
import { step } from '../../src/engine/step.ts';
import type { CoachLevel, HandState } from '../../src/engine/types.ts';
import { defaultSettings, type DecisionRecord } from '../../src/persist/schema.ts';
import { tableWith } from '../engine/helpers.ts';

const LEVELS: readonly CoachLevel[] = ['beginner', 'intermediate', 'advanced', 'exam'];

describe('LEVEL_RULES is the §10.2 table', () => {
  const column = <K extends keyof (typeof LEVEL_RULES)['beginner']>(key: K) =>
    LEVELS.map((l) => LEVEL_RULES[l][key]);

  it('hint before you act: always on show / "Hint" / "Hint" + quiz / "Hint (counts as help)"', () => {
    expect(column('hint')).toEqual(['always', 'button', 'button', 'countsAsHelp']);
    expect(column('quiz')).toEqual([false, false, true, false]);
  });
  it('win chance badge: hidden while you decide at Exam only', () => {
    expect(column('badge')).toEqual([true, true, true, false]);
  });
  it('price chip: shown, shown, in "Why?" only, hidden', () => {
    expect(column('price')).toEqual(['chip', 'chip', 'why', 'none']);
  });
  it('draw chips: outs and % but at Exam (name only)', () => {
    expect(column('draws')).toEqual(['full', 'full', 'full', 'name']);
  });
  it('rankings: tips at Beginner; By river but at Exam; "Which hand wins?" at Advanced and Exam', () => {
    expect(column('tips')).toEqual([true, false, false, false]);
    expect(column('byRiver')).toEqual([true, true, true, false]);
    expect(column('whichWins')).toEqual([false, false, true, true]);
  });
  it('grade chip after you act: every decision / Inaccuracy+ / Mistake+ / none during the hand', () => {
    expect(column('chipFrom')).toEqual(['best', 'inaccuracy', 'mistake', null]);
    const grades: Grade[] = ['best', 'good', 'inaccuracy', 'mistake', 'blunder'];
    expect(LEVELS.map((l) => grades.filter((g) => chipShows(l, g)))).toEqual([
      grades,
      ['inaccuracy', 'mistake', 'blunder'],
      ['mistake', 'blunder'],
      [],
    ]);
    expect(chipShows('beginner', null)).toBe(false); // grading failed: no chip
  });
  it('pause + Undo offer: Inaccuracy+ / Mistake+ / Mistake+ / never; toolbar Undo', () => {
    expect(column('pauseFrom')).toEqual(['inaccuracy', 'mistake', 'mistake', null]);
    expect(column('undo')).toEqual(['toolbar', 'toolbar', 'feedback', 'none']);
    for (const l of LEVELS) {
      expect(UNDO_POLICY[l]).toEqual({
        undo: LEVEL_RULES[l].undo,
        pauseFrom: LEVEL_RULES[l].pauseFrom,
      });
    }
  });
  it('end-of-hand summary: every hand / Inaccuracy+ / Mistake+ / every hand as the Exam result', () => {
    expect(column('summary')).toEqual(['every', 'inaccuracy', 'mistake', 'every']);
    expect(column('exam')).toEqual([false, false, false, true]);
    const hands: (Grade | null)[][] = [[], ['best'], ['good', 'inaccuracy'], ['mistake'], [null]];
    expect(LEVELS.map((l) => hands.map((g) => summaryShows(l, g)))).toEqual([
      [false, true, true, true, true],
      [false, false, true, true, false],
      [false, false, false, true, false],
      [false, true, true, true, true],
    ]);
  });
  it('counts as "on your own": never at Beginner, else unless the hint was opened', () => {
    expect(column('hintAlwaysSeen')).toEqual([true, false, false, false]);
  });
  it('grades order and the §14.4 decision score', () => {
    expect(atLeast('mistake', 'inaccuracy')).toBe(true);
    expect(atLeast('good', 'inaccuracy')).toBe(false);
    expect(decisionScore(['best', 'good', 'inaccuracy', 'mistake', 'blunder'])).toBe(55);
    expect(decisionScore(['best', null])).toBe(100);
    expect(decisionScore([null])).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Selectors over a store state at the hero's turn

/** A hand at the hero's turn (seat 0), facing the big blind preflop. */
function heroTurnHand(): HandState {
  let h = startHand(
    tableWith([2000, 2000, 2000], { sb: 10, bb: 20, startingStack: 2000 }),
    '0123456789abcdef0123456789abcdef',
  );
  for (let i = 0; h.toAct !== 0 && i < 10; i++) {
    h = step(h, { kind: 'act', seat: h.toAct as number, action: { type: 'call' } });
  }
  return h;
}

const DECISION: Decision = {
  action: { type: 'call' },
  kind: 'call',
  ev: {},
  eRandom: 0.45,
  eRange: 0.45,
  need: 0.25,
  bucket: null,
  strength: 'decent',
  confidence: 'clear',
  alt: null,
  trace: [],
};

function stateAt(
  level: CoachLevel,
  coach: Partial<CoachSlice> = {},
  game: Partial<GameSlice> = {},
): AppState {
  const hand = heroTurnHand();
  const key = `${hand.handSeq}:${hand.log.length}`;
  return {
    game: {
      ...initialGame(),
      mode: 'heroTurn',
      hand,
      legal: legalActions(hand),
      coachLevel: level,
      ...game,
    },
    equity: {
      ...initialEquity(),
      status: 'done',
      situation: { handSeq: hand.handSeq, hero: hand.seats[0]?.hole as never, board: [], nOpp: 2 },
      result: {
        n: 1000,
        win: 0.45,
        split: 0,
        equity: 0.45,
        exact: false,
        final: true,
        truncated: false,
      },
    },
    coach: {
      ...initialCoach(),
      key,
      status: 'ready',
      decision: DECISION,
      explanation: null,
      quiz: { key, answers: [], skipped: false },
      ...coach,
    },
    ui: createAppStore().getState().ui,
    settings: { ...defaultSettings(), coachLevel: 'beginner' },
    review: createAppStore().getState().review,
    dispatch: () => {},
  } as AppState;
}

describe('the level in force (§10 latch)', () => {
  it('is the decision`s level once it started, else the settings`', () => {
    const s = stateAt('exam');
    expect(s.settings.coachLevel).toBe('beginner');
    expect(selectCoachLevel(s)).toBe('exam');
    expect(selectUndoButton(s)).toBe('hidden'); // Exam: none
    const before = { ...s, game: { ...s.game, coachLevel: null } };
    expect(selectCoachLevel(before)).toBe('beginner');
  });
});

describe('the Advanced quiz in the store (§10.3)', () => {
  it('asks at Advanced only; hides the badge and holds Row A until answered or skipped', () => {
    const s = stateAt('advanced');
    expect(selectQuiz(s)).toMatchObject({ questions: ['win', 'need', 'move'], done: false });
    expect(selectQuizAsking(s)).toBe(true);
    expect(quizHidesBadge(s)).toBe(true);
    expect(selectWinBadge(s).status).toBe('off');
    for (const level of ['beginner', 'intermediate', 'exam'] as const) {
      const other = stateAt(level);
      expect(selectQuiz(other), level).toBeNull();
      expect(quizHidesBadge(other), level).toBe(false);
    }
    expect(selectWinBadge(stateAt('intermediate')).status).toBe('done');
  });

  it('the badge hides from the start of the decision, before the hint is ready', () => {
    const pending = stateAt('advanced', { key: 'old', status: 'idle', decision: null });
    expect(selectQuiz(pending)).toBeNull(); // the quiz needs the hint's numbers
    expect(quizHidesBadge(pending)).toBe(true);
    const failed = stateAt('advanced', { status: 'failed', decision: null });
    expect(quizHidesBadge(failed)).toBe(false); // no coach, no quiz
  });

  it('quizAnswer and quizSkip: answers in order, then done; skip ends it', () => {
    let s = stateAt('advanced');
    const apply = (cmd: Parameters<typeof reduceCoach>[1]) => {
      s = { ...s, coach: reduceCoach(s, cmd) };
    };
    apply({ type: 'quizAnswer', choice: 4 }); // not a band
    expect(s.coach.quiz?.answers).toEqual([]);
    apply({ type: 'quizAnswer', choice: 1 });
    apply({ type: 'quizAnswer', choice: 1 });
    expect(selectQuizAsking(s)).toBe(true);
    apply({ type: 'quizAnswer', choice: 1 });
    expect(s.coach.quiz?.answers).toEqual([1, 1, 1]);
    expect(selectQuiz(s)).toMatchObject({ done: true, score: { correct: 3, of: 3 } });
    expect(selectQuizAsking(s)).toBe(false);
    expect(quizHidesBadge(s)).toBe(false);
    apply({ type: 'quizAnswer', choice: 0 });
    expect(s.coach.quiz?.answers).toHaveLength(3);

    let t = stateAt('advanced');
    t = { ...t, coach: reduceCoach(t, { type: 'quizSkip' }) };
    expect(t.coach.quiz?.skipped).toBe(true);
    expect(selectQuiz(t)).toBeNull();
    expect(quizHidesBadge(t)).toBe(false);
    // Not Advanced: the commands do nothing.
    const b = stateAt('beginner');
    expect(reduceCoach(b, { type: 'quizAnswer', choice: 1 })).toBe(b.coach);
  });
});

describe('the grade chip after the hero acts (§12.6)', () => {
  const record = (grade: Grade | null, undone = false): DecisionRecord => ({
    decisionId: 0,
    street: 'preflop',
    taken: { type: 'call' },
    rec: { type: 'call' },
    grade,
    lossMilliBB: 0,
    eRandom: 0.4,
    need: 0.25,
    hintSeen: true,
    undone,
    leak: null,
    quiz: null,
  });

  it('shows the newest grade the level shows, never an undone or failed one', () => {
    const at = (level: CoachLevel, decisions: DecisionRecord[]) =>
      selectGradeChip(stateAt(level, {}, { mode: 'botTurn', legal: null, decisions }));
    expect(at('beginner', [record('best')])?.grade).toBe('best');
    expect(at('intermediate', [record('good')])).toBeNull();
    expect(at('intermediate', [record('inaccuracy')])?.grade).toBe('inaccuracy');
    expect(at('advanced', [record('inaccuracy')])).toBeNull();
    expect(at('advanced', [record('blunder')])?.grade).toBe('blunder');
    expect(at('exam', [record('blunder')])).toBeNull();
    expect(at('beginner', [record('mistake', true)])).toBeNull();
    expect(at('beginner', [record(null)])).toBeNull();
    // A new record is a new chip (its key changes).
    const one = at('beginner', [record('best')]);
    const two = at('beginner', [record('best'), record('good')]);
    expect(two?.key).not.toBe(one?.key);
  });
});
