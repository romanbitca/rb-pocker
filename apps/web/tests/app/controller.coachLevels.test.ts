/**
 * The coach levels in the TableController (PLAN §10, §10.2, §10.3, §11.3 r8, §12.9; chunk 6.4):
 * - the per-decision latch: a level chosen in Settings applies from the next hero decision; a
 *   decision started at Beginner had its hint on show, so it counts as helped (`hintSeen`);
 * - the pause and Undo per level (Exam: never; Advanced: only inside the feedback card);
 * - the end-of-hand summary offered per level (1.3.92: never opened by itself, a late grade can
 *   bring the offer), and the next hand waiting while the player has it open;
 * - the Advanced quiz: its roll only at Advanced, never again on an undone decision, and its
 *   score in the decision's record.
 * Stub graders (`graders.ts`) and fake timers throughout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { coachKeyOf } from '../../src/app/hintJobs.ts';
import { quizRolls, quizScore } from '../../src/app/quiz.ts';
import {
  selectCoachLevel,
  selectUndoButton,
  type AppState,
  type CoachSlice,
} from '../../src/app/store.ts';
import type { Decision } from '../../src/brain/types.ts';
import type { CoachLevel, HandState, LegalActions, PlayerAction } from '../../src/engine/types.ts';
import { coachBrain } from '../workers/fakeBrainWorker.ts';
import { stubGrader, type StubAnswer } from './graders.ts';
import { elapse, flush, makeHarness, scriptedBrain, tick, type Harness } from './harness.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const passive = (legal: LegalActions): PlayerAction =>
  legal.canCheck ? { type: 'check' } : { type: 'call' };

const passiveBots = () => scriptedBrain({ thinkMs: 300, choose: (obs) => passive(obs.legal) });

interface GameOptions {
  level?: CoachLevel;
  answer?: (decisionId: number) => StubAnswer;
  summaries?: boolean;
  players?: number;
}

function game(options: GameOptions = {}): Harness {
  const answer = options.answer;
  const h = makeHarness({
    brain: passiveBots(),
    grader: stubGrader(answer === undefined ? {} : { answer: (ask) => answer(ask.decisionId) }),
    settings: {
      players: options.players ?? 3,
      coachLevel: options.level ?? 'beginner',
      speed: 'normal',
    },
    ...(options.summaries !== undefined && { summaries: options.summaries }),
  });
  h.dispatch({ type: 'play' });
  return h;
}

async function toHeroTurn(h: Harness): Promise<HandState> {
  for (let i = 0; i < 400; i++) {
    const s = h.state();
    if (s.game.mode === 'heroTurn' && s.game.hand !== null) return s.game.hand;
    if (s.game.mode === 'feedback') h.dispatch({ type: 'keepMove' });
    else if (s.ui.overlays.includes('outOfChips')) h.dispatch({ type: 'reload' });
    else await tick();
  }
  throw new Error('no hero turn');
}

const act = (h: Harness, action?: PlayerAction): void => {
  const legal = h.state().game.legal as LegalActions;
  h.dispatch({ type: 'act', action: action ?? passive(legal) });
};

/** Plays on (passive hero, Keep my move on a card) until `until` holds. */
async function playUntil(h: Harness, until: (s: AppState) => boolean): Promise<void> {
  for (let i = 0; i < 4000; i++) {
    const s = h.state();
    if (until(s)) return;
    if (s.game.mode === 'heroTurn' && s.game.legal !== null) act(h);
    else if (s.game.mode === 'feedback') h.dispatch({ type: 'keepMove' });
    else if (s.ui.overlays.includes('outOfChips')) h.dispatch({ type: 'reload' });
    else await tick();
  }
  throw new Error('playUntil: never');
}

describe('the per-decision latch (§10: changes apply from the next hero decision)', () => {
  it('a level chosen mid-decision waits for the next decision; the first counts as helped', async () => {
    const h = game({ level: 'beginner' });
    await toHeroTurn(h);
    expect(h.state().game.coachLevel).toBe('beginner');
    h.dispatch({ type: 'settings', patch: { coachLevel: 'exam' } });
    expect(h.state().settings.coachLevel).toBe('exam');
    // The decision on screen keeps its level: the strip, the HUD and Undo still follow Beginner.
    expect(h.state().game.coachLevel).toBe('beginner');
    expect(selectCoachLevel(h.state())).toBe('beginner');
    expect(selectUndoButton(h.state())).not.toBe('hidden');
    act(h);
    await flush();
    const [first] = h.state().game.decisions;
    // The hint was on show when it started (Beginner): helped, though the act came at "Exam".
    expect(first?.hintSeen).toBe(true);
    // The next decision is at Exam.
    await playUntil(
      h,
      (s) => s.game.mode === 'heroTurn' && s.game.decisions.length >= 1 && s.game.hand !== null,
    );
    expect(h.state().game.coachLevel).toBe('exam');
    expect(selectUndoButton(h.state())).toBe('hidden');
  });

  it('before the hero`s first decision of a hand the settings` level is in force', async () => {
    const h = game({ level: 'intermediate' });
    expect(h.state().game.coachLevel).toBeNull();
    expect(selectCoachLevel(h.state())).toBe('intermediate');
    h.dispatch({ type: 'settings', patch: { coachLevel: 'advanced' } });
    expect(selectCoachLevel(h.state())).toBe('advanced');
    await toHeroTurn(h);
    expect(h.state().game.coachLevel).toBe('advanced');
  });

  it('above Beginner a decision counts as on your own unless the hint was opened', async () => {
    for (const level of ['intermediate', 'advanced', 'exam'] as const) {
      const h = game({ level });
      await toHeroTurn(h);
      act(h);
      await flush();
      expect(h.state().game.decisions[0]?.hintSeen, level).toBe(false);
      await playUntil(h, (s) => s.game.mode === 'heroTurn' && s.game.decisions.length === 1);
      h.dispatch({ type: 'showHint' }); // "Hint" (or "Hint (counts as help)")
      act(h);
      await flush();
      expect(h.state().game.decisions[1]?.hintSeen, level).toBe(true);
    }
  });

  it('an Undo returns to the decision at its own level', async () => {
    const h = game({ level: 'beginner', answer: () => 'mistake' });
    await toHeroTurn(h);
    h.dispatch({ type: 'settings', patch: { coachLevel: 'intermediate' } });
    act(h);
    await flush();
    expect(h.state().game.mode).toBe('feedback'); // Beginner pauses on a Mistake
    h.dispatch({ type: 'undo' });
    expect(h.state().game.mode).toBe('heroTurn');
    expect(h.state().game.coachLevel).toBe('beginner');
  });
});

describe('pause and Undo per level (§10.2, §11.3 r8)', () => {
  it('Exam never pauses and never offers Undo, even for a Big mistake', async () => {
    const h = game({ level: 'exam', answer: () => 'blunder' });
    await toHeroTurn(h);
    act(h);
    await flush();
    expect(h.state().game.mode).not.toBe('feedback');
    expect(h.state().game.decisions[0]?.grade).toBe('blunder');
    expect(h.state().game.canUndo).toBe(false);
    expect(selectUndoButton(h.state())).toBe('hidden');
    h.dispatch({ type: 'undo' });
    expect(h.controller.snapshot().meta.undoCount).toBe(0);
  });

  it('Advanced: no toolbar Undo; the feedback card offers it on a Mistake', async () => {
    const h = game({ level: 'advanced', answer: () => 'mistake' });
    await toHeroTurn(h);
    expect(selectUndoButton(h.state())).toBe('hidden');
    act(h);
    await flush();
    expect(h.state().game.mode).toBe('feedback');
    expect(h.state().game.feedback?.canUndo).toBe(true);
    h.dispatch({ type: 'undo' });
    expect(h.controller.snapshot().meta.undoCount).toBe(1);
  });

  it('Advanced: an Inaccuracy does not pause', async () => {
    const h = game({ level: 'advanced', answer: () => 'inaccuracy' });
    await toHeroTurn(h);
    act(h);
    await flush();
    expect(h.state().game.mode).not.toBe('feedback');
  });
});

describe('the end-of-hand summary (§10.2, §12.9; on demand since 1.3.92)', () => {
  const summaryOpen = (s: AppState): boolean => s.ui.overlays.includes('summary');
  const handEnd = (s: AppState): boolean => s.game.mode === 'handEnd';
  /** The hero's acts in the hand so far (each one a decision, recorded once graded). */
  const heroActs = (s: AppState): number =>
    s.game.hand?.log.filter((e) => e.e === 'act' && e.seat === 0).length ?? 0;

  /** Plays one hand to its end; returns how many decisions the hero made in it. */
  async function oneHand(h: Harness): Promise<number> {
    await playUntil(h, handEnd);
    return h.state().game.decisions.length;
  }

  /** Plays hands (each to its end) until one where the hero made a decision. */
  async function toHandEndWithDecision(h: Harness): Promise<void> {
    for (let i = 0; i < 6; i++) {
      if ((await oneHand(h)) > 0) return;
      expect(h.state().game.summary).toBeNull(); // nothing to sum up
      h.dispatch({ type: 'nextHand' });
    }
    throw new Error('no hand with a hero decision');
  }

  it('Beginner: every hand with a decision is offered, never opened; the next hand comes by itself', async () => {
    const h = game({ level: 'beginner', summaries: true });
    await toHandEndWithDecision(h);
    expect(h.state().game.summary).toBe('hand'); // the banner's "Hand summary"
    expect(summaryOpen(h.state())).toBe(false);
    expect(h.state().ui.gates).not.toContain('sheet');
    // As for a hand with no summary: the banner's 3 s wait, then the next hand (auto-next).
    const handSeq = h.state().game.hand?.handSeq as number;
    await elapse(3_100);
    expect(h.state().game.hand?.handSeq).toBe(handSeq + 1);
    expect(h.state().game.summary).toBeNull(); // a new hand: no offer until it ends
    expect(summaryOpen(h.state())).toBe(false);
  });

  it('the tap opens it: the next hand waits for its "Next hand ›"; ✕ returns to the banner, whose wait runs on', async () => {
    const h = game({ level: 'beginner', summaries: true });
    await toHandEndWithDecision(h);
    const handSeq = h.state().game.hand?.handSeq as number;
    // The banner's "Hand summary" (the Table opens the overlay, as for the other sheets).
    h.dispatch({ type: 'open', overlay: 'summary' });
    expect(summaryOpen(h.state())).toBe(true);
    expect(h.state().ui.gates).toContain('sheet');
    await elapse(30_000);
    expect(h.state().game.hand?.handSeq).toBe(handSeq); // it waits (§12.8)
    expect(h.state().game.mode).toBe('handEnd');
    // ✕ (Esc, the scrim, Back): the banner again, the offer still there, the wait runs on.
    h.dispatch({ type: 'close', overlay: 'summary' });
    expect(h.state().game.summary).toBe('hand');
    expect(h.state().ui.gates).not.toContain('sheet');
    await elapse(3_100);
    expect(h.state().game.hand?.handSeq).toBe(handSeq + 1);
  });

  it('the sheet`s "Next hand ›" deals the next hand and closes it; it can be opened again first', async () => {
    const h = game({ level: 'beginner', summaries: true });
    await toHandEndWithDecision(h);
    const handSeq = h.state().game.hand?.handSeq as number;
    h.dispatch({ type: 'open', overlay: 'summary' });
    h.dispatch({ type: 'close', overlay: 'summary' });
    h.dispatch({ type: 'open', overlay: 'summary' }); // again: still the same hand's
    expect(summaryOpen(h.state())).toBe(true);
    await elapse(10_000);
    expect(h.state().game.hand?.handSeq).toBe(handSeq);
    h.dispatch({ type: 'nextHand' }); // the sheet's "Next hand ›"
    expect(h.state().game.hand?.handSeq).toBe(handSeq + 1);
    expect(summaryOpen(h.state())).toBe(false);
    expect(h.state().game.summary).toBeNull();
  });

  it('Exam: the "Exam result", offered every hand and never opened', async () => {
    const h = game({ level: 'exam', summaries: true });
    for (let hands = 0; hands < 2; hands++) {
      await toHandEndWithDecision(h);
      expect(h.state().game.summary).toBe('exam');
      expect(summaryOpen(h.state())).toBe(false);
      h.dispatch({ type: 'nextHand' }); // the banner's tap
    }
  });

  it('Intermediate: only after an Inaccuracy or worse; Advanced: only after a Mistake or worse', async () => {
    const cases: [CoachLevel, StubAnswer, 'hand' | null][] = [
      ['intermediate', 'good', null],
      ['intermediate', 'inaccuracy', 'hand'],
      ['advanced', 'inaccuracy', null],
      ['advanced', 'mistake', 'hand'],
    ];
    for (const [level, grade, offer] of cases) {
      const h = game({ level, summaries: true, answer: () => grade });
      await toHandEndWithDecision(h);
      expect(h.state().game.summary, `${level} ${grade}`).toBe(offer);
      expect(summaryOpen(h.state()), `${level} ${grade}`).toBe(false);
    }
  });

  it('a late grade brings the offer during the hand end; it never opens the sheet', async () => {
    // Advanced shows a summary only after a Mistake. Every grade comes 10 s late: an earlier
    // decision's is dropped at the next decision (recorded ungraded, r5); the last one's arrives
    // while the banner waits for its tap (auto-next off).
    const h = makeHarness({
      brain: passiveBots(),
      grader: stubGrader({ answer: () => 'mistake', delayMs: 10_000 }),
      settings: { players: 3, coachLevel: 'advanced', speed: 'normal', autoNext: false },
      summaries: true,
    });
    h.dispatch({ type: 'play' });
    for (let i = 0; i < 6; i++) {
      await playUntil(h, handEnd);
      if (heroActs(h.state()) > 0) break;
      h.dispatch({ type: 'nextHand' });
    }
    const acts = heroActs(h.state());
    expect(acts).toBeGreaterThan(0);
    // The hand has ended; its last decision's grade is still on its way.
    expect(h.state().game.decisions).toHaveLength(acts - 1);
    expect(h.state().game.decisions.every((d) => d.grade === null)).toBe(true);
    expect(h.state().game.summary).toBeNull();
    await elapse(10_000);
    expect(h.state().game.mode).toBe('handEnd');
    expect(h.state().game.decisions).toHaveLength(acts);
    expect(h.state().game.decisions.at(-1)?.grade).toBe('mistake');
    expect(h.state().game.summary).toBe('hand'); // the button appears...
    expect(summaryOpen(h.state())).toBe(false); // ...and nothing opens
    expect(h.state().ui.gates).not.toContain('sheet');
  });

  it('off without the `summaries` option (the other tests): no offer, hands go on by themselves', async () => {
    const h = game({ level: 'beginner' });
    await playUntil(h, (s) => handEnd(s) && s.game.decisions.length > 0);
    expect(h.state().game.summary).toBeNull();
    expect(summaryOpen(h.state())).toBe(false);
  });
});

describe('the Advanced quiz (§10.3)', () => {
  const settings = { players: 6, startingStack: 2000, sb: 10, bb: 20 };

  /** A coach that answers at once with the real hint of a cheaper observation-free stand-in. */
  function quizGame(
    level: CoachLevel,
    grade?: StubAnswer,
  ): { h: Harness; brain: ReturnType<typeof coachBrain> } {
    const brain = coachBrain();
    const h = makeHarness({
      brain: brain.client,
      settings: { ...settings, coachLevel: level },
      hints: true,
      ...(grade !== undefined && { grader: stubGrader({ answer: () => grade }) }),
    });
    h.dispatch({ type: 'play' });
    return { h, brain };
  }

  /** Plays until a hero decision that rolled the quiz (or `limit` decisions went by). */
  async function toQuiz(h: Harness, limit = 60): Promise<HandState | null> {
    for (let n = 0; n < limit; n++) {
      const hand = await toHeroTurn(h);
      await flush();
      const coach = h.state().coach;
      if (coach.quiz?.key === coachKeyOf(hand)) return hand;
      act(h);
    }
    return null;
  }

  it(
    'rolls at Advanced only, by the observation (1 in 4 where the pot is at least 10 bb)',
    { timeout: 60_000 },
    async () => {
      const { h, brain } = quizGame('advanced');
      let rolled = 0;
      for (let n = 0; n < 40; n++) {
        const hand = await toHeroTurn(h);
        await flush();
        const req = brain.hints.at(-1);
        expect(req).toBeDefined();
        const expected = quizRolls(req?.obs as never);
        const quiz = h.state().coach.quiz;
        expect(quiz?.key === coachKeyOf(hand), `decision ${n}`).toBe(expected);
        if (expected) rolled++;
        act(h);
      }
      expect(rolled).toBeGreaterThan(0);
      // The same game at Intermediate never rolls one.
      const other = quizGame('intermediate');
      for (let n = 0; n < 20; n++) {
        await toHeroTurn(other.h);
        await flush();
        expect(other.h.state().coach.quiz).toBeNull();
        act(other.h);
      }
    },
  );

  it(
    'the answers are checked against the hint; the score goes into the decision`s record',
    { timeout: 60_000 },
    async () => {
      const { h } = quizGame('advanced');
      const hand = await toQuiz(h);
      expect(hand).not.toBeNull();
      const coach = h.state().coach as CoachSlice;
      const decision = coach.decision as Decision;
      // Answer every question right but the first.
      const questions = decision.need > 0 ? 3 : 2;
      h.dispatch({ type: 'quizAnswer', choice: 99 }); // not a choice: ignored
      expect(h.state().coach.quiz?.answers).toEqual([]);
      const winBand = Math.round(100 * decision.eRandom);
      const wrongWin = winBand >= 25 ? 0 : 3;
      h.dispatch({ type: 'quizAnswer', choice: wrongWin });
      if (questions === 3) {
        const need = Math.round(100 * decision.need);
        h.dispatch({
          type: 'quizAnswer',
          choice: need < 20 ? 0 : need < 35 ? 1 : need < 50 ? 2 : 3,
        });
      }
      const move =
        decision.action.type === 'fold'
          ? 0
          : decision.action.type === 'bet' || decision.action.type === 'raise'
            ? 2
            : 1;
      h.dispatch({ type: 'quizAnswer', choice: move });
      const answers = h.state().coach.quiz?.answers ?? [];
      expect(answers).toHaveLength(questions);
      h.dispatch({ type: 'quizAnswer', choice: 0 }); // finished: nothing more
      expect(h.state().coach.quiz?.answers).toHaveLength(questions);
      act(h);
      await flush();
      const record = h.state().game.decisions.at(-1);
      expect(record?.quiz).toEqual(quizScore(decision, answers));
      expect(record?.quiz).toEqual({ correct: questions - 1, of: questions });
      expect(record?.hintSeen).toBe(false); // a quiz is not the hint (§10.2)
    },
  );

  it(
    'Skip ends it: the answers given so far count, none = no quiz in the record',
    {
      timeout: 60_000,
    },
    async () => {
      const { h } = quizGame('advanced');
      expect(await toQuiz(h)).not.toBeNull();
      h.dispatch({ type: 'quizSkip' });
      expect(h.state().coach.quiz?.skipped).toBe(true);
      h.dispatch({ type: 'quizAnswer', choice: 0 }); // skipped: ignored
      expect(h.state().coach.quiz?.answers).toEqual([]);
      act(h);
      await flush();
      expect(h.state().game.decisions.at(-1)?.quiz).toBeNull();
    },
  );

  it('the observation decides it: the same decision rolls the same way', async () => {
    const { h, brain } = quizGame('advanced');
    await toHeroTurn(h);
    await flush();
    const obs = brain.hints.at(-1)?.obs;
    expect(obs).toBeDefined();
    if (obs === undefined) return;
    expect(quizRolls(obs)).toBe(quizRolls(structuredClone(obs)));
    // Under 10 big blinds in the pot: never.
    expect(quizRolls({ ...obs, pot: 10 * obs.bb - 1 })).toBe(false);
  });
  it(
    'a decision taken back with Undo gets no quiz again (its answers were on show)',
    { timeout: 60_000 },
    async () => {
      const { h } = quizGame('advanced', 'mistake'); // Advanced pauses on a Mistake
      const hand = await toQuiz(h);
      expect(hand).not.toBeNull();
      h.dispatch({ type: 'quizSkip' });
      act(h);
      await flush();
      expect(h.state().game.mode).toBe('feedback');
      h.dispatch({ type: 'undo' }); // the card's Undo (Advanced: only there)
      expect(h.state().game.mode).toBe('heroTurn');
      await flush();
      const again = h.state().game.hand as HandState;
      expect(again.undoneDecisions).toHaveLength(1);
      expect(h.state().coach.key).toBe(coachKeyOf(again));
      expect(h.state().coach.status).toBe('ready');
      expect(h.state().coach.quiz).toBeNull();
    },
  );
});
