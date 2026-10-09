/**
 * The `?script=<name>` hook (PLAN §18 Stage 6, `app/botScripts.ts`): which names it takes, and a
 * scripted table through the real brain client: the bots follow the script, while the coach's
 * hints and grades still go to brain.worker (here its job runner with chunk 6.1's coach, in a fake
 * worker: `realCoach`). That the hook never reaches a production build is
 * tests/app/testHooks.bundle.test.ts; the real grades through the flow are
 * `controller.grade.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HERO, realTimers } from '../../src/app/controller.ts';
import { BOT_SCRIPTS, scriptedBrain, scriptFromSearch } from '../../src/app/botScripts.ts';
import { brainGrader } from '../../src/app/grading.ts';
import type { HandState, LegalActions, PlayerAction } from '../../src/engine/types.ts';
import { makeHarness, tick } from './harness.ts';
import { realCoach, SEED_46 } from './realCoach.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const passive = (legal: LegalActions): PlayerAction =>
  legal.canCheck ? { type: 'check' } : { type: 'call' };

describe('?script=<name>', () => {
  it('takes only the names of known scripts', () => {
    expect(scriptFromSearch('?script=river-min-bet')).toBe('river-min-bet');
    expect(scriptFromSearch('?seed=abc&script=passive')).toBe('passive');
    expect(scriptFromSearch('?script=nope')).toBeNull();
    expect(scriptFromSearch('?script=toString')).toBeNull(); // not an inherited name
    expect(scriptFromSearch('')).toBeNull();
    expect(Object.keys(BOT_SCRIPTS).sort()).toEqual(['passive', 'river-min-bet']);
    expect(() => scriptedBrain('nope', realTimers, realCoach().spawn)).toThrow(/no bot script/);
  });

  it('river-min-bet: the bots check and call and bet the minimum on the river; the coach is brain.worker', async () => {
    const coach = realCoach();
    const brain = scriptedBrain('river-min-bet', realTimers, coach.spawn);
    const h = makeHarness({
      brain,
      grader: brainGrader(brain),
      hints: true,
      seed: SEED_46,
      settings: { players: 3, coachLevel: 'intermediate', speed: 'normal' },
    });
    h.dispatch({ type: 'play' });
    let hands = 0;
    const grades: (string | null)[] = [];
    for (let i = 0; i < 6000 && hands < 3; i++) {
      const s = h.state();
      if (s.game.mode === 'heroTurn' && s.game.legal !== null) {
        h.dispatch({ type: 'act', action: passive(s.game.legal) });
      } else if (s.game.mode === 'feedback') {
        h.dispatch({ type: 'keepMove' });
      } else if (s.game.mode === 'handEnd') {
        hands++;
        grades.push(...s.game.decisions.map((d) => d.grade));
        // Every bot action followed the script: check or call, the river's minimum bet.
        const hand = s.game.hand as HandState;
        for (const e of hand.log) {
          if (e.e !== 'act' || e.seat === HERO) continue;
          expect(['check', 'call', 'bet']).toContain(e.action.type);
          if (e.action.type === 'bet') {
            expect(e.street).toBe('river');
            expect(e.action.to).toBe(hand.bb);
          }
        }
        h.dispatch({ type: 'nextHand' });
      } else {
        await tick();
      }
    }
    expect(hands).toBe(3);
    // The bots never reached brain.worker; the coach's jobs all did, and were answered.
    const kinds = new Set(coach.received.map((m) => m.kind));
    expect(kinds.has('botDecision')).toBe(false);
    expect(kinds.has('hint')).toBe(true);
    expect(kinds.has('grade')).toBe(true);
    expect(grades.length).toBeGreaterThan(0);
    expect(grades.every((g) => g !== null)).toBe(true);
  });

  it('passive: everyone checks or calls', async () => {
    const brain = scriptedBrain('passive', realTimers, realCoach().spawn);
    const h = makeHarness({ brain, settings: { players: 4, speed: 'normal' } });
    h.dispatch({ type: 'play' });
    for (let i = 0; i < 3000 && h.state().game.mode !== 'handEnd'; i++) {
      const s = h.state();
      if (s.game.mode === 'heroTurn' && s.game.legal !== null) {
        h.dispatch({ type: 'act', action: passive(s.game.legal) });
      } else {
        await tick();
      }
    }
    const hand = h.state().game.hand as HandState;
    expect(hand.phase).toBe('complete');
    const bots = hand.log.filter((e) => e.e === 'act' && e.seat !== HERO);
    expect(bots.length).toBeGreaterThan(0);
    for (const e of bots) if (e.e === 'act') expect(['check', 'call']).toContain(e.action.type);
  });
});
