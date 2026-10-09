/**
 * The `?script=<name>` hook (PLAN §18 Stage 6, `app/botScripts.ts`): which names it takes, and a
 * scripted table: bots follow the script, the hero's grades too, through the real brain client.
 * That it never reaches a production build is tests/app/testHooks.bundle.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HERO, realTimers } from '../../src/app/controller.ts';
import { BOT_SCRIPTS, scriptedBrain, scriptFromSearch } from '../../src/app/botScripts.ts';
import { brainGrader } from '../../src/app/grading.ts';
import { lineText } from '../../src/i18n/coach.ts';
import type { HandState, LegalActions, PlayerAction } from '../../src/engine/types.ts';
import { makeHarness, tick } from './harness.ts';

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
  });

  it('river-min-bet: bots check and call, bet the minimum on the river; a fold there is a Big mistake', async () => {
    const brain = scriptedBrain('river-min-bet', realTimers);
    const h = makeHarness({
      brain,
      grader: brainGrader(brain),
      settings: { players: 3, coachLevel: 'beginner', speed: 'normal' },
    });
    h.dispatch({ type: 'play' });
    let folded = false;
    for (let i = 0; i < 3000 && !folded; i++) {
      const s = h.state();
      if (s.game.mode === 'feedback') break;
      if (s.game.mode === 'heroTurn' && s.game.legal !== null) {
        const legal = s.game.legal;
        const hand = s.game.hand as HandState;
        const facingRiverBet = hand.street === 'river' && legal.callAmount > 0;
        h.dispatch({ type: 'act', action: facingRiverBet ? { type: 'fold' } : passive(legal) });
        folded = facingRiverBet;
      } else {
        await tick();
      }
    }
    await tick();
    expect(folded).toBe(true);
    const s = h.state();
    expect(s.game.mode).toBe('feedback');
    expect(s.game.feedback).toMatchObject({ grade: 'blunder', coachMove: { kind: 'call' } });
    expect(lineText(s.game.feedback?.reason ?? (null as never))).toMatch(
      /^You folded with a .+% win chance\. You needed only \d+% to call\.$/,
    );
    // Every bot action followed the script: check or call, the river's minimum bet.
    const hand = s.game.hand as HandState;
    for (const e of hand.log) {
      if (e.e !== 'act' || e.seat === HERO) continue;
      if (e.action.type === 'bet') expect(e.street).toBe('river');
      expect(['check', 'call', 'bet']).toContain(e.action.type);
    }
    // The earlier decisions were Best.
    expect(s.game.decisions.slice(0, -1).every((d) => d.grade === 'best')).toBe(true);
  });
});
