/**
 * The Advanced quiz's pure parts (PLAN §10.3, chunk 6.4; Stage 6 acceptance 5's logic): it fires
 * on about 1 in 4 eligible hero decisions (a seeded distribution over engine-played hands), never
 * under 10 big blinds in the pot; its questions, bands (lower bounds inclusive, the whole
 * percentages the badge shows), the right move (a Close spot's other type counts too) and the
 * score.
 */
import { describe, expect, it } from 'vitest';
import {
  bandOf,
  choiceCount,
  moveChoice,
  NEED_BANDS,
  quizQuestions,
  quizRolls,
  quizScore,
  rightAnswers,
  WIN_BANDS,
} from '../../src/app/quiz.ts';
import type { Decision } from '../../src/brain/types.ts';
import { deriveSeed, randInt, rngFromSeed, type Rng } from '../../src/core/rng.ts';
import { legalActions } from '../../src/engine/legal.ts';
import { observe } from '../../src/engine/observe.ts';
import { startHand } from '../../src/engine/start.ts';
import { step } from '../../src/engine/step.ts';
import type { HandState, Observation, PlayerAction } from '../../src/engine/types.ts';
import { tableWith } from '../engine/helpers.ts';

type QuizDecision = Pick<Decision, 'eRandom' | 'need' | 'action' | 'confidence' | 'alt'>;

const decision = (d: Partial<QuizDecision> = {}): QuizDecision => ({
  eRandom: 0.45,
  need: 0.25,
  action: { type: 'call' },
  confidence: 'clear',
  alt: null,
  ...d,
});

describe('bands (§10.3: lower bounds inclusive, whole percentages)', () => {
  it('win chance: Under 25% · 25–50% · 50–75% · Over 75%', () => {
    expect(
      [0, 0.244, 0.2451, 0.25, 0.4999, 0.5, 0.7449, 0.7451, 0.75, 1].map((x) =>
        bandOf(x, WIN_BANDS),
      ),
    ).toEqual([0, 0, 1, 1, 2, 2, 2, 3, 3, 3]);
  });

  it('need: Under 20% · 20–35% · 35–50% · Over 50%', () => {
    expect(
      [0.1, 0.1951, 0.2, 0.344, 0.35, 0.494, 0.5, 0.6].map((x) => bandOf(x, NEED_BANDS)),
    ).toEqual([0, 1, 1, 1, 2, 2, 3, 3]);
  });
});

describe('questions and right answers', () => {
  it('three questions facing a bet, two without (no price question)', () => {
    expect(quizQuestions({ need: 0.25 })).toEqual(['win', 'need', 'move']);
    expect(quizQuestions({ need: 0 })).toEqual(['win', 'move']);
    expect(['win', 'need', 'move'].map((q) => choiceCount(q as 'win'))).toEqual([4, 4, 3]);
  });

  it('the move: a call all-in is Check/Call, an all-in raise is Bet/Raise', () => {
    const moves: [PlayerAction, number][] = [
      [{ type: 'fold' }, 0],
      [{ type: 'check' }, 1],
      [{ type: 'call' }, 1],
      [{ type: 'bet', to: 60 }, 2],
      [{ type: 'raise', to: 2_000 }, 2],
    ];
    for (const [action, choice] of moves) expect(moveChoice(action)).toBe(choice);
  });

  it('in a Close spot the also-fine move`s type counts too; a Clear spot has one answer', () => {
    const close = decision({ confidence: 'close', alt: { type: 'fold' } });
    expect(rightAnswers(close, 'move')).toEqual([0, 1]);
    expect(rightAnswers(decision({ confidence: 'close', alt: { type: 'call' } }), 'move')).toEqual([
      1,
    ]);
    expect(rightAnswers(decision({ alt: { type: 'fold' } }), 'move')).toEqual([1]); // not close
    expect(rightAnswers(decision(), 'win')).toEqual([1]);
    expect(rightAnswers(decision(), 'need')).toEqual([1]);
  });

  it('the score counts the answers given, in question order', () => {
    const d = decision(); // win 45% → 1, need 25% → 1, Call → 1
    expect(quizScore(d, [1, 1, 1])).toEqual({ correct: 3, of: 3 });
    expect(quizScore(d, [0, 1, 2])).toEqual({ correct: 1, of: 3 });
    expect(quizScore(d, [1])).toEqual({ correct: 1, of: 1 }); // skipped after one
    expect(quizScore(d, [])).toEqual({ correct: 0, of: 0 });
    // No bet to face: two questions, the second is the move.
    expect(quizScore(decision({ need: 0, action: { type: 'check' } }), [1, 1])).toEqual({
      correct: 2,
      of: 2,
    });
  });
});

/** A random legal action (calls and checks mostly, some bets and raises, a few folds). */
function randomAction(h: HandState, rng: Rng): PlayerAction {
  const legal = legalActions(h);
  if (legal === null) throw new Error('nobody to act');
  const roll = randInt(rng, 100);
  const aggressive = legal.bet ?? legal.raise;
  if (aggressive !== null && roll < 30) {
    const to = aggressive.min + randInt(rng, Math.max(1, aggressive.max - aggressive.min + 1));
    return { type: legal.bet !== null ? 'bet' : 'raise', to: Math.min(to, aggressive.max) };
  }
  if (legal.canFold && !legal.canCheck && roll > 85) return { type: 'fold' };
  return legal.canCheck ? { type: 'check' } : { type: 'call' };
}

/** The hero's observations over `hands` random 6-handed hands (seeded). */
function heroObservations(hands: number, seed: string): Observation[] {
  const out: Observation[] = [];
  const rng = rngFromSeed(seed);
  const extras = {
    seatStats: new Array(6).fill(null),
    visiblePersonality: new Array(6).fill(null),
    seatLevels: new Array(6).fill('easy'),
  };
  for (let n = 0; n < hands; n++) {
    const table = tableWith([2000, 2000, 2000, 2000, 2000, 2000], {
      sb: 10,
      bb: 20,
      startingStack: 2000,
    });
    let h = startHand(table, deriveSeed(seed, 'hand', n));
    for (let guard = 0; h.phase !== 'complete' && guard < 400; guard++) {
      if (h.phase === 'betting' && h.toAct !== null) {
        if (h.toAct === 0) out.push(observe(h, 0, extras));
        h = step(h, { kind: 'act', seat: h.toAct, action: randomAction(h, rng) });
      } else {
        h = step(h, { kind: 'advance' });
      }
    }
  }
  return out;
}

describe('it fires on about 1 in 4 eligible decisions (§10.3, Stage 6 acceptance 5)', () => {
  it(
    'seeded: of the hero`s decisions with a pot of 10 big blinds or more, 25% ± 3.5 points',
    { timeout: 60_000 },
    () => {
      const all = heroObservations(1500, 'a1b2c3d4000000000000000000006400');
      const eligible = all.filter((o) => o.pot >= 10 * o.bb);
      const small = all.filter((o) => o.pot < 10 * o.bb);
      expect(eligible.length).toBeGreaterThan(1500);
      expect(small.length).toBeGreaterThan(200);
      // Under 10 big blinds it never fires.
      expect(small.some(quizRolls)).toBe(false);
      const rate = eligible.filter(quizRolls).length / eligible.length;
      // Binomial sd at p = 0.25: about 1.1 points at n ≈ 1,500; 3.5 points is over 3 sd.
      expect(rate).toBeGreaterThan(0.215);
      expect(rate).toBeLessThan(0.285);
    },
  );

  it('the same observation always rolls the same way; any change of it may change the roll', () => {
    const obs = heroObservations(40, '00000000000000000000000000000640').filter(
      (o) => o.pot >= 10 * o.bb,
    );
    expect(obs.length).toBeGreaterThan(10);
    for (const o of obs) expect(quizRolls(structuredClone(o))).toBe(quizRolls(o));
  });
});
