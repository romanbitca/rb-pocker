/**
 * Chunk 6.1's real grade through chunk 6.2's flow (PLAN §11.3 r5, §10.2, §8.9; Stage 6 acceptance
 * 2 and 4 at the unit level). The TableController grades every hero decision in brain.worker's
 * job runner with the real coach (`realCoach`: `brainService` + `coachAnswer`, in a fake worker),
 * the bots follow the `river-min-bet` script, and the table is the E2E spec's (`?seed=46`, 3
 * players): the hero, big blind with A♣3♣, has the nut flush on the river of hand 1 (8♣5♥2♣ J♦ T♣)
 * and faces the small blind's minimum bet there. Fake timers throughout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HERO, realTimers } from '../../src/app/controller.ts';
import { scriptedBrain } from '../../src/app/botScripts.ts';
import { brainGrader, GRADE_PAUSE_MS } from '../../src/app/grading.ts';
import { coachKeyOf } from '../../src/app/hintJobs.ts';
import { selectUndoButton, type AppState } from '../../src/app/store.ts';
import { formatCards } from '../../src/core/cards.ts';
import type {
  CoachLevel,
  HandState,
  LegalActions,
  PlayerAction,
} from '../../src/engine/types.ts';
import { lineText } from '../../src/i18n/coach.ts';
import { elapse, flush, makeHarness, tick, type Harness } from './harness.ts';
import { realCoach, SEED_46, type RealCoach } from './realCoach.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const passive = (legal: LegalActions): PlayerAction =>
  legal.canCheck ? { type: 'check' } : { type: 'call' };

/** The E2E table at `level`, Play pressed: scripted bots, the real coach, hints on. */
function table(level: CoachLevel, coach: RealCoach = realCoach()): Harness {
  const brain = scriptedBrain('river-min-bet', realTimers, coach.spawn);
  const h = makeHarness({
    brain,
    grader: brainGrader(brain),
    hints: true,
    seed: SEED_46,
    settings: { players: 3, coachLevel: level, speed: 'normal' },
  });
  h.dispatch({ type: 'play' });
  return h;
}

const handOf = (h: Harness): HandState => h.state().game.hand as HandState;

/** The hero's turn, with the coach's hint for it in. */
async function heroTurn(h: Harness): Promise<AppState> {
  for (let i = 0; i < 400; i++) {
    const s = h.state();
    const hand = s.game.hand;
    if (
      s.game.mode === 'heroTurn' &&
      hand !== null &&
      s.coach.status === 'ready' &&
      s.coach.key === coachKeyOf(hand)
    ) {
      return s;
    }
    await tick();
  }
  throw new Error('no hero turn with its hint');
}

/** Lets the grade job's reply land: the worker answers on later microtasks (no timer runs). */
const graded = (): Promise<void> => flush();

/** The hero's river decision facing the minimum bet; before it the hero plays `before`. */
async function toRiverBet(
  h: Harness,
  before: (s: AppState) => PlayerAction = (s) => passive(s.game.legal as LegalActions),
): Promise<AppState> {
  for (let decisions = 0; decisions < 10; decisions++) {
    const s = await heroTurn(h);
    const hand = s.game.hand as HandState;
    if (hand.street === 'river' && (s.game.legal as LegalActions).callAmount > 0) return s;
    h.dispatch({ type: 'act', action: before(s) });
    await graded();
    if (h.state().game.mode === 'feedback') h.dispatch({ type: 'keepMove' });
  }
  throw new Error('no river bet to face');
}

/** The coach's move for the hero's decision on show (the hint, chunk 5.7). */
const coachMove = (s: AppState): PlayerAction => {
  const action = s.coach.decision?.action;
  if (action === undefined) throw new Error('no hint');
  return action;
};

describe('the E2E table (`?seed=46&script=river-min-bet`, 3 players)', () => {
  it('the hero has the nut flush on the river of hand 1 and faces a minimum bet', async () => {
    const h = table('beginner');
    const s = await toRiverBet(h);
    const hand = s.game.hand as HandState;
    expect(hand.handSeq).toBe(1);
    expect(formatCards(hand.seats[HERO]?.hole ?? [])).toBe('Ac 3c');
    expect(formatCards(hand.board)).toBe('8c 5h 2c Jd Tc');
    expect(s.game.legal?.callAmount).toBe(hand.bb); // the minimum bet: one big blind
    const last = hand.log.at(-1);
    expect(last).toMatchObject({ e: 'act', seat: 2, action: { type: 'bet', to: hand.bb } });
  });
});

describe('real grades (chunk 6.1) through the flow (§11.3 r5)', () => {
  it('following the hint is Best at every decision; folding the nuts is a Big mistake with its card', async () => {
    const h = table('beginner');
    const s = await toRiverBet(h, coachMove);
    expect(s.game.decisions.length).toBeGreaterThan(0);
    expect(s.game.decisions.every((d) => d.grade === 'best' && !d.undone)).toBe(true);

    const before = h.controller.snapshot().inputs.length;
    h.dispatch({ type: 'act', action: { type: 'fold' } });
    expect(h.state().game.mode).toBe('grading');
    await graded();
    const after = h.state();
    expect(after.game.mode).toBe('feedback');
    expect(after.ui.overlays).toContain('feedback');
    // Nothing moved after the fold: no bot action, no card (§11.1).
    expect(h.controller.snapshot().inputs).toHaveLength(before + 1);
    expect(handOf(h).log.at(-1)).toMatchObject({ e: 'act', seat: HERO, action: { type: 'fold' } });
    const card = after.game.feedback;
    expect(card).toMatchObject({ grade: 'blunder', canUndo: true });
    expect(card?.coachMove.kind).toBe(coachMove(s).type);
    expect(card?.reason).not.toBeNull();
    expect(lineText(card?.reason ?? (null as never))).toMatch(/^You folded with /);
    expect(after.game.decisions.at(-1)).toMatchObject({
      grade: 'blunder',
      leak: 'overfold',
      street: 'river',
      undone: false,
    });
    expect(after.game.decisions.at(-1)?.lossMilliBB).toBeGreaterThan(0);

    // Undo restores the decision; a second Undo is refused (§11.3 r2).
    h.dispatch({ type: 'undo' });
    const back = h.state();
    expect(back.game.mode).toBe('heroTurn');
    expect(back.game.feedback).toBeNull();
    expect(formatCards(handOf(h).board)).toBe('8c 5h 2c Jd Tc');
    expect(handOf(h).seats[HERO]?.folded).toBe(false);
    expect(handOf(h).log.at(-1)).toMatchObject({ e: 'reshuffle' });
    expect(back.game.canUndo).toBe(false);
    expect(selectUndoButton(back)).toBe('disabled');
    expect(back.game.decisions.at(-1)).toMatchObject({ grade: 'blunder', undone: true });

    // The same mistake again: the card again, its Undo disabled now.
    await heroTurn(h);
    h.dispatch({ type: 'act', action: { type: 'fold' } });
    await graded();
    expect(h.state().game.feedback).toMatchObject({ grade: 'blunder', canUndo: false });
    h.dispatch({ type: 'undo' });
    expect(h.state().game.mode).toBe('feedback');
    expect(h.controller.snapshot().meta.undoCount).toBe(1);
    h.dispatch({ type: 'keepMove' });
    expect(h.state().game.mode).not.toBe('feedback');
  });

  it('the pause per level (§10.2): Beginner from Inaccuracy, Intermediate and Advanced from Mistake, Exam never', async () => {
    // The flop check is an Inaccuracy (the coach bets), the river fold a Big mistake.
    const seen: Record<CoachLevel, string[]> = {
      beginner: [],
      intermediate: [],
      advanced: [],
      exam: [],
    };
    for (const level of ['beginner', 'intermediate', 'advanced', 'exam'] as const) {
      const h = table(level);
      for (let decisions = 0; decisions < 10; decisions++) {
        const s = await heroTurn(h);
        const legal = s.game.legal as LegalActions;
        const riverBet = (s.game.hand as HandState).street === 'river' && legal.callAmount > 0;
        h.dispatch({ type: 'act', action: riverBet ? { type: 'fold' } : passive(legal) });
        await graded();
        const after = h.state();
        const record = after.game.decisions.at(-1);
        if (after.game.mode === 'feedback') {
          seen[level].push(`${record?.street}:${after.game.feedback?.grade}`);
          if (!riverBet) h.dispatch({ type: 'keepMove' });
        }
        if (riverBet) break;
      }
      const grades = h.state().game.decisions.map((d) => `${d.street}:${d.grade}`);
      expect(grades, level).toEqual([
        'preflop:best',
        'flop:inaccuracy',
        'turn:inaccuracy',
        'river:blunder',
      ]);
      // Advanced: only the card offers Undo; Exam: no Undo at all.
      if (level === 'advanced') {
        expect(selectUndoButton(h.state())).toBe('hidden');
        expect(h.state().game.feedback?.canUndo).toBe(true);
      }
      if (level === 'exam') {
        expect(selectUndoButton(h.state())).toBe('hidden');
        expect(h.state().game.canUndo).toBe(false);
      }
    }
    expect(seen).toEqual({
      beginner: ['flop:inaccuracy', 'turn:inaccuracy', 'river:blunder'],
      intermediate: ['river:blunder'],
      advanced: ['river:blunder'],
      exam: [],
    });
  });

  it('the toolbar Undo waits for the real grade, then takes the move back', async () => {
    const h = table('beginner', realCoach({ gradeDelayMs: () => 1000 }));
    await heroTurn(h);
    h.dispatch({ type: 'act', action: { type: 'check' } }); // the big blind's check: Best
    await elapse(999);
    expect(h.state().game.mode).toBe('grading');
    expect(h.state().game.canUndo).toBe(false);
    h.dispatch({ type: 'undo' }); // refused (r5)
    expect(h.controller.snapshot().meta.undoCount).toBe(0);
    await elapse(1);
    await graded();
    expect(h.state().game.decisions).toEqual([
      expect.objectContaining({ decisionId: 0, grade: 'best' }),
    ]);
    expect(h.state().game.canUndo).toBe(true);
    h.dispatch({ type: 'undo' });
    expect(h.controller.snapshot().meta.undoCount).toBe(1);
    expect(h.state().game.mode).toBe('heroTurn');
  });

  it('a real grade later than 1,500 ms does not block the game: no pause, no card; recorded when it lands', async () => {
    // Only the flop check's grade (decision 1, an Inaccuracy) is slow.
    const h = table('beginner', realCoach({ gradeDelayMs: (id) => (id === 1 ? 2500 : 0) }));
    for (let i = 0; i < 2; i++) {
      const s = await heroTurn(h);
      const inputs = h.controller.snapshot().inputs.length;
      h.dispatch({ type: 'act', action: passive(s.game.legal as LegalActions) });
      if (i === 0) {
        await graded();
        continue;
      }
      expect(h.state().game.mode).toBe('grading');
      await elapse(GRADE_PAUSE_MS);
      // The hand goes on without the grade: the next bot is asked at once.
      expect(h.state().game.mode).toBe('botTurn');
      expect(h.state().game.canUndo).toBe(false);
      await elapse(900);
      // A bot has acted; the grade is still on its way, so Undo still waits for it (r5).
      expect(h.controller.snapshot().inputs.length).toBeGreaterThan(inputs + 1);
      expect(h.state().game.decisions).toHaveLength(1);
      expect(h.state().game.canUndo).toBe(false);
      await elapse(200);
      const s2 = h.state();
      expect(s2.game.decisions.map((d) => d.grade)).toEqual(['best', 'inaccuracy']);
      expect(s2.game.mode).not.toBe('feedback');
      expect(s2.game.feedback).toBeNull();
      expect(s2.ui.overlays).not.toContain('feedback');
      expect(s2.game.canUndo).toBe(true);
    }
  });

  it('a grade job that errors twice (the real job runner) records grade null and enables Undo', async () => {
    const coach = realCoach({ failGrades: true });
    const h = table('beginner', coach);
    await heroTurn(h);
    h.dispatch({ type: 'act', action: { type: 'check' } });
    await graded();
    const grades = coach.received.filter((m) => m.kind === 'grade');
    expect(grades).toHaveLength(2); // the first try and one retry, the same inputs
    expect({ ...grades[1], jobId: 0 }).toEqual({ ...grades[0], jobId: 0 });
    expect(h.state().game.decisions).toEqual([
      expect.objectContaining({ decisionId: 0, grade: null }),
    ]);
    expect(h.state().game.mode).not.toBe('grading');
    expect(h.state().game.canUndo).toBe(true);
  });

  it('the grade job carries the decision as the hint saw it: same observation, the HUD number or null', async () => {
    const coach = realCoach();
    const h = table('beginner', coach);
    await heroTurn(h);
    h.dispatch({ type: 'act', action: { type: 'check' } });
    await graded();
    const hint = coach.received.find((m) => m.kind === 'hint');
    const grade = coach.received.find((m) => m.kind === 'grade');
    if (hint?.kind !== 'hint' || grade?.kind !== 'grade') throw new Error('no hint or grade job');
    expect(grade.obs).toEqual(hint.obs);
    expect(grade).toMatchObject({ taken: { type: 'check' }, decisionId: 0, eRandom: null });
    expect(grade.obs).not.toHaveProperty('deck');
  });
});

describe('a hint opened above Beginner (§10.2 "on your own")', () => {
  it('marks that decision hintSeen, and only that one; it outlives an Undo', async () => {
    const h = table('intermediate');
    await heroTurn(h);
    h.dispatch({ type: 'showHint' });
    h.dispatch({ type: 'act', action: { type: 'check' } });
    await graded();
    await heroTurn(h);
    h.dispatch({ type: 'act', action: { type: 'check' } }); // the flop: the hint not opened
    await graded();
    expect(h.state().game.decisions.map((d) => d.hintSeen)).toEqual([true, false]);
    // Undo the flop check, open the hint this time, act again.
    h.dispatch({ type: 'undo' });
    await heroTurn(h);
    h.dispatch({ type: 'showHint' });
    h.dispatch({ type: 'act', action: { type: 'check' } });
    await graded();
    expect(
      h.state().game.decisions.map((d) => `${d.decisionId}:${d.hintSeen}:${d.undone}`),
    ).toEqual(['0:true:false', '1:false:true', '1:true:false']);
    expect(h.controller.snapshot().meta.hintShown).toEqual({ 0: true, 1: true });
  });

  it('at Beginner every decision is hintSeen (the hint is on show)', async () => {
    const h = table('beginner');
    await heroTurn(h);
    h.dispatch({ type: 'act', action: { type: 'check' } });
    await graded();
    expect(h.state().game.decisions.map((d) => d.hintSeen)).toEqual([true]);
  });
});
