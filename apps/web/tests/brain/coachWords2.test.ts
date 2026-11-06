/**
 * The second QA round of 6 Nov 2026 (fix/coach-words-round-2, PLAN 1.3.90): coach words and
 * grades that a second exploratory pass (about 450 hands on the final build) found wrong. Each
 * QA spot is rebuilt here with the real engine and asked of the real coach (`coachAnswer`: the
 * hint and the grade from one deliberation, as `brain.worker` answers them).
 *
 * 1. A call with the nut flush where raising wins more was a "Big mistake" (seed 5eed2301, hand 1).
 * 2. "Only 5 big blinds left" when the bot was the short stack, the hero 35 bb deep (5eed2102, 18).
 * 3. The grade compared another "likely hands" number than the hint showed (5eed2103, hand 5).
 * 5. A raise that put the short hero all-in got push/fold words: "go all-in or fold. They fold
 *    only about 0%", and a second "likely hands" number (5eed2402, hand 10).
 * 7. Heads-up, "Players only called … play against fewer players" (5eed2203, hand 1).
 *
 * Items 4 (a committed call below its price), 6 (the summary never said all-in) and 8 ("about
 * >99%") are in `allInCall.test.ts`, `tests/ui/summaryNumbers.test.ts` and
 * `tests/i18n/coach.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { rangeNumber, type Line } from '../../src/brain/explain.ts';
import { coachAnswer, scoreGrade, type GradeFacts } from '../../src/brain/grade.ts';
import type { LegalActions, Observation, PlayerAction } from '../../src/engine/types.ts';
import { hintText, lineText } from '../../src/i18n/coach.ts';
import { bet, call, check, fold, raise } from '../engine/play.ts';
import { observeSpot, playSpot, type SpotSpec } from './fixtures.ts';

const FOLD: PlayerAction = { type: 'fold' };
const CHECK: PlayerAction = { type: 'check' };
const CALL: PlayerAction = { type: 'call' };

interface Asked {
  obs: Observation;
  answer: ReturnType<typeof coachAnswer>;
  /** The hint as the player reads it, one string per line. */
  text: string[];
}

function ask(spec: SpotSpec, hero: number): Asked {
  const obs = observeSpot(playSpot(spec), hero);
  expect(obs.legal.seat).toBe(hero);
  const answer = coachAnswer(obs, null);
  return { obs, answer, text: hintText(answer.hint.explanation) };
}

const code = (s: Asked): string | undefined => s.answer.hint.decision.trace[0]?.code;

/**
 * Seed 5eed2301, hand 1 (Advanced, 2 players, 500 bb): the hero bets the nut flush on the river,
 * the bot raises to 700, the hero calls.
 */
const NUT_FLUSH_RIVER: SpotSpec = {
  stacks: [10000, 10000],
  button: 0,
  bb: 20,
  holes: { 0: 'Ah 3c' },
  board: '5h Kh 6h Ac 2h',
  inputs: [
    call(0),
    check(1),
    check(1),
    bet(0, 30),
    call(1),
    check(1),
    bet(0, 80),
    call(1),
    check(1),
    bet(0, 200),
    raise(1, 700),
  ],
};

describe('item 1: a call that wins chips, where raising wins more, is never a Big mistake', () => {
  it('the nut flush called on the river: Slightly off, and the card says raising wins more', () => {
    const s = ask(NUT_FLUSH_RIVER, 0);
    expect(s.answer.hint.decision.action.type).toBe('raise');
    const g = s.answer.grade(CALL, 4);
    expect(g.lossPot).toBeGreaterThan(0.4); // the §8.9 table alone says Big mistake
    expect(g.grade).toBe('inaccuracy');
    expect(g.leak).toBe('missed-value');
    expect(lineText(g.feedback as Line)).toBe(
      'Calling wins chips too, but raising wins more here.',
    );
    // Folding the same hand loses chips: still a Big mistake.
    expect(s.answer.grade(FOLD, 4).grade).toBe('blunder');
  }, 20_000);

  /** Facing 100 into 1,000 (bb 100): the coach raises (EV 1,000); the call wins 100. */
  const FACING: LegalActions = {
    seat: 0,
    toCall: 100,
    callAmount: 100,
    callIsAllIn: false,
    canFold: true,
    canCheck: false,
    canCall: true,
    bet: null,
    raise: { min: 200, max: 10000 },
  };
  const facts = (over: Partial<GradeFacts>): GradeFacts => ({
    legal: FACING,
    rec: { type: 'raise', to: 400 },
    recEV: 1000,
    alt: null,
    taken: CALL,
    takenEV: 100,
    pot: 1000,
    bb: 100,
    E: 0.9,
    R: 1,
    need: 0.25,
    ...over,
  });

  it('the rule: a check, or a call the price pays, that wins chips where the coach bets or raises', () => {
    // 90% of the pot missed: the table says Big mistake; value missed is at most Slightly off.
    expect(scoreGrade(facts({})).grade).toBe('inaccuracy');
    const free: LegalActions = { ...FACING, toCall: 0, callAmount: 0, canFold: false };
    const checked = facts({
      legal: {
        ...free,
        canCheck: true,
        canCall: false,
        bet: { min: 100, max: 10000 },
        raise: null,
      },
      rec: { type: 'bet', to: 600 },
      taken: CHECK,
      takenEV: 300,
      need: 0,
    });
    expect(scoreGrade(checked).grade).toBe('inaccuracy');
    // Smaller losses keep the table's grade.
    expect(scoreGrade(facts({ takenEV: 960 })).grade).toBe('good');
    // A call the price does not pay, or one that loses chips, is graded as before.
    expect(scoreGrade(facts({ E: 0.2, takenEV: 100 })).grade).toBe('blunder');
    expect(scoreGrade(facts({ takenEV: -50 })).grade).toBe('blunder');
    // A fold is never value missed.
    expect(scoreGrade(facts({ taken: FOLD, takenEV: 0 })).grade).toBe('blunder');
    // The coach calls and the hero folds: as before.
    expect(scoreGrade(facts({ rec: CALL, taken: FOLD, takenEV: 0 })).grade).toBe('blunder');
  });
});

describe('item 2: PUSH_FOLD names whose stack is short', () => {
  it('the bot has 5 bb, the hero 35 bb (seed 5eed2102, hand 18): "They have only 5 big blinds"', () => {
    const s = ask({ stacks: [710, 100], button: 0, bb: 20, holes: { 0: 'Qh 7h' }, inputs: [] }, 0);
    expect(s.answer.hint.decision.action).toEqual({ type: 'raise', to: 710 });
    expect(code(s)).toBe('PUSH_FOLD');
    const why = s.text.find((t) => t.includes('go all-in or fold')) ?? '';
    expect(why).toMatch(/^They have only 5 big blinds: go all-in or fold\./);
    expect(s.text.join(' ')).not.toMatch(/Only 5 big blinds left/);
  }, 20_000);

  it('the hero is the short stack: "Only 5 big blinds left", as before', () => {
    const s = ask({ stacks: [100, 710], button: 0, bb: 20, holes: { 0: 'Qh 7h' }, inputs: [] }, 0);
    expect(code(s)).toBe('PUSH_FOLD');
    const why = s.text.find((t) => t.includes('go all-in or fold')) ?? '';
    expect(why).toMatch(/^Only 5 big blinds left: go all-in or fold\./);
  }, 20_000);

  it('several opponents, all shorter than the hero: "No one else has more than …"', () => {
    const s = ask(
      {
        stacks: [3000, 200, 200, 200],
        button: 0,
        bb: 20,
        holes: { 0: 'Ah Kd' },
        inputs: [call(3)],
      },
      0,
    );
    expect(code(s)).toBe('PUSH_FOLD');
    const why = s.text.find((t) => t.includes('go all-in or fold')) ?? '';
    expect(why).toMatch(/^No one else has more than 10 big blinds: go all-in or fold\./);
  }, 20_000);
});

describe('item 3: the grade reads the number the hint showed', () => {
  it('heads-up before the flop: the price is the hint’s "likely hands" number (seed 5eed2103)', () => {
    // The button opens, the big blind defends: the hint's number is §8.3's E against the
    // opener's range; the decision's eRange (the §8.6 Monte Carlo) is another estimate of it.
    const s = ask(
      { stacks: [2000, 2000], button: 0, bb: 20, holes: { 1: 'Jd 8c' }, inputs: [raise(0, 60)] },
      1,
    );
    const d = s.answer.hint.decision;
    expect(d.action).toEqual(CALL);
    expect(d.trace[0]?.code).toBe('CALL_PREFLOP');
    const shown = rangeNumber({
      action: d.action,
      trace: d.trace,
      legal: s.obs.legal,
      eRange: d.eRange,
      nOpp: 1,
    });
    expect(shown.E).toBe(d.trace[0]?.data.E);
    expect(Math.abs(shown.E - d.eRange)).toBeGreaterThan(0.01); // two estimates
    for (const taken of [CALL, FOLD]) {
      const g = s.answer.grade(taken, 0);
      expect(g.price).toMatchObject({ E: shown.E, callers: null, players: 1 });
    }
  }, 20_000);

  it('players behind: the number counts the raiser alone, and the price says whom', () => {
    // Six players: the first to act opens, two folds, the hero on the button; both blinds behind.
    const s = ask(
      {
        stacks: [2000, 2000, 2000, 2000, 2000, 2000],
        button: 0,
        bb: 20,
        holes: { 0: 'Qh Td' },
        inputs: [raise(3, 60), fold(4), fold(5)],
      },
      0,
    );
    const d = s.answer.hint.decision;
    const shown = rangeNumber({
      action: d.action,
      trace: d.trace,
      legal: s.obs.legal,
      eRange: d.eRange,
      nOpp: 3,
    });
    expect(shown.callers).toBe(0);
    const g = s.answer.grade(d.action.type === 'fold' ? CALL : FOLD, 0);
    expect(g.price).toMatchObject({ E: shown.E, callers: 0, players: 3 });
  }, 20_000);
});

describe('item 5: a raise that puts the hero all-in is a call or a fold at the price', () => {
  it('12 bb, the big blind re-raises over the hero’s stack (seed 5eed2402): no shove words', () => {
    const s = ask(
      {
        stacks: [240, 2000],
        button: 0,
        bb: 20,
        holes: { 0: 'Ts 8h' },
        inputs: [raise(0, 60), raise(1, 300)],
      },
      0,
    );
    expect(s.obs.legal.callIsAllIn).toBe(true);
    expect(['CALL_ALLIN', 'FOLD_ALLIN']).toContain(code(s));
    const all = s.text.join(' ');
    expect(all).not.toMatch(/go all-in or fold/);
    expect(all).not.toMatch(/They fold/);
    // One "likely hands" number: RANGE_ADJUST, when shown, says the reason's own.
    const e = s.answer.hint.explanation;
    const reasonE = s.answer.hint.decision.trace[0]?.data.E as number;
    if (e.shown.eRange !== null) expect(e.shown.eRange).toBe(reasonE);
  }, 20_000);

  it('deep: a 3-bet to exactly the hero’s stack is read as an all-in too (R = 1, no set odds)', () => {
    const s = ask(
      {
        stacks: [1000, 5000],
        button: 0,
        bb: 20,
        holes: { 0: '5s 5h' },
        inputs: [raise(0, 60), raise(1, 1000)],
      },
      0,
    );
    expect(s.obs.legal.callIsAllIn).toBe(true);
    expect(['CALL_ALLIN', 'FOLD_ALLIN']).toContain(code(s));
    expect(s.answer.hint.decision.trace.some((r) => r.code === 'SET_MINING')).toBe(false);
  }, 20_000);
});

describe('item 7: an isolation raise heads-up', () => {
  it('the button limps, the big blind raises (seed 5eed2203): no "fewer players"', () => {
    const s = ask(
      { stacks: [2000, 2000], button: 0, bb: 20, holes: { 1: 'Qc Ts' }, inputs: [call(0)] },
      1,
    );
    expect(code(s)).toBe('ISOLATE');
    expect(s.text[1]).toBe(
      'They only called. Queen-Ten offsuit is strong enough to raise to 70 (3.5 BB).',
    );
    expect(s.text.join(' ')).not.toMatch(/fewer players|Players only called/);
  }, 20_000);

  it('with players still to act, the F.1 sentence stays', () => {
    const s = ask(
      {
        stacks: [2000, 2000, 2000, 2000, 2000, 2000],
        button: 0,
        bb: 20,
        holes: { 0: 'Ad Kd' },
        inputs: [call(3), call(4), call(5)],
      },
      0,
    );
    expect(code(s)).toBe('ISOLATE');
    expect(s.text[1]).toMatch(
      /^Players only called\. Raise to .* to play against fewer players\.$/,
    );
  }, 20_000);
});
