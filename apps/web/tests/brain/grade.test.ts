/**
 * Grading (PLAN §8.9 "Grade", §8.10, Appendix A.5, F.4, F.5; chunk 6.1).
 *
 * The rules on plain numbers first (`scoreGrade`, `leakOf`, `feedbackRow`: no Monte Carlo): the
 * table's threshold for each grade, the bb floors, the price signal and the order of the three,
 * pot-relative thresholds with bb floors, the recommendation and the Close spot's alternative
 * (both Best, ±15% for a size), a move the model rates higher (exactly Good), every leak row and
 * every F.5 row (each reachable, in F.5's order, never saying numbers that contradict it).
 *
 * Then spots played by the real engine and graded by the real coach (`coachAnswer`): following
 * the hint is Best (C8) whatever HUD number either job brings, the close alternative is Best, a
 * blunder needs 5 bb (the nut flush folded heads-up in a 3 bb pot is a Mistake, three-handed with
 * 6 bb lost a Blunder), and each row of F.5 and the leak table shows up where a player would meet
 * it. The property test over random decision points is `grade.property.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { feedbackLine, TEMPLATE_KEYS, type FeedbackInput } from '../../src/brain/explain.ts';
import { candidateKey } from '../../src/brain/ev.ts';
import {
  capByBB,
  coachAnswer,
  feedbackRow,
  grade,
  gradeOf,
  gradeOfLoss,
  GRADES,
  leakOf,
  milderOf,
  priceSignal,
  recommendationTrace,
  sameMove,
  scoreGrade,
  severity,
  worseOf,
  type FeedbackFacts,
  type GradeFacts,
  type LeakFacts,
} from '../../src/brain/grade.ts';
import type { Grade } from '../../src/brain/types.ts';
import type { LegalActions, Observation, PlayerAction } from '../../src/engine/types.ts';
import { bet, call, check, fold, raise } from '../engine/play.ts';
import { observeSpot, playSpot, type SpotSpec } from './fixtures.ts';

const FOLD: PlayerAction = { type: 'fold' };
const CHECK: PlayerAction = { type: 'check' };
const CALL: PlayerAction = { type: 'call' };
const betTo = (to: number): PlayerAction => ({ type: 'bet', to });
const raiseTo = (to: number): PlayerAction => ({ type: 'raise', to });

/** Facing a bet of 100 (to call) with a raise possible up to 10,000. */
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
/** Nothing to call; a bet possible up to 10,000. */
const FREE: LegalActions = {
  seat: 0,
  toCall: 0,
  callAmount: 0,
  callIsAllIn: false,
  canFold: false,
  canCheck: true,
  canCall: false,
  bet: { min: 100, max: 10000 },
  raise: null,
};

/** Grade facts: facing a bet of 100 into 1,000 (bb 100); the coach calls (EV 100). */
function facts(over: Partial<GradeFacts>): GradeFacts {
  return {
    legal: FACING,
    rec: CALL,
    recEV: 100,
    alt: null,
    taken: FOLD,
    takenEV: 0,
    pot: 1000,
    bb: 100,
    E: 0.5,
    R: 1,
    need: 0.25,
    ...over,
  };
}

describe('grades: order and helpers', () => {
  it('runs from Best to Blunder (F.4: "Best move" … "Big mistake")', () => {
    expect(GRADES).toEqual(['best', 'good', 'inaccuracy', 'mistake', 'blunder']);
    expect(GRADES.map(severity)).toEqual([0, 1, 2, 3, 4]);
    expect(worseOf('good', 'mistake')).toBe('mistake');
    expect(worseOf('blunder', 'best')).toBe('blunder');
    expect(milderOf('good', 'mistake')).toBe('good');
    expect(milderOf('inaccuracy', 'inaccuracy')).toBe('inaccuracy');
  });
});

describe('the §8.9 table: each grade’s threshold, by the loss over the pot', () => {
  it('Best ≤ 1%, Good ≤ 5%, Inaccuracy ≤ 15%, Mistake ≤ 40%, Blunder above', () => {
    const cases: [number, Grade][] = [
      [0, 'best'],
      [0.01, 'best'],
      [0.0101, 'good'],
      [0.05, 'good'],
      [0.0501, 'inaccuracy'],
      [0.15, 'inaccuracy'],
      [0.1501, 'mistake'],
      [0.4, 'mistake'],
      [0.4001, 'blunder'],
      [3, 'blunder'],
    ];
    for (const [lossPot, g] of cases) expect([lossPot, gradeOfLoss(lossPot)]).toEqual([lossPot, g]);
  });

  it('holds at a boundary computed in floating point (0.07 / 7 is not exactly 0.01)', () => {
    expect(gradeOfLoss(0.07 / 7)).toBe('best');
    expect(gradeOfLoss((0.1 + 0.05) / 3)).toBe('good'); // 0.05 up to one ulp
  });

  it('a move off the recommendation is graded by its loss (pot 1,000, 100 bb deep in chips)', () => {
    // The coach calls (EV 600); the hero raises to a size the model rates lower (no price signal).
    const graded = (loss: number) =>
      scoreGrade(facts({ recEV: 600, taken: raiseTo(400), takenEV: 600 - loss, bb: 10 })).grade;
    expect(graded(10)).toBe('best'); // 1%
    expect(graded(50)).toBe('good'); // 5%
    expect(graded(150)).toBe('inaccuracy'); // 15%
    expect(graded(400)).toBe('mistake'); // 40%
    expect(graded(401)).toBe('blunder'); // 40.1%, 40.1 bb
  });

  it('reports the loss in chips, pots and integer milli-big-blinds', () => {
    const s = scoreGrade(facts({ recEV: 250, taken: FOLD, takenEV: 0, E: 0.3, need: 0.25 }));
    expect(s).toEqual({ grade: 'mistake', loss: 250, lossPot: 0.25, lossBB: 2.5 });
    // The worse-than-recommended EV is never negative loss.
    expect(scoreGrade(facts({ recEV: 100, takenEV: 120, taken: raiseTo(300) })).loss).toBe(0);
  });
});

describe('the bb floors', () => {
  it('below 0.25 bb at most Good, below 1 bb at most Inaccuracy; a Blunder needs 5 bb', () => {
    expect(capByBB('blunder', 0.2)).toBe('good');
    expect(capByBB('mistake', 0.2499)).toBe('good');
    expect(capByBB('mistake', 0.25)).toBe('inaccuracy');
    expect(capByBB('blunder', 0.99)).toBe('inaccuracy');
    expect(capByBB('mistake', 1)).toBe('mistake');
    expect(capByBB('blunder', 4.99)).toBe('mistake');
    expect(capByBB('blunder', 5)).toBe('blunder');
    // Floors only cap: a milder grade stays.
    expect(capByBB('best', 0.1)).toBe('best');
    expect(capByBB('good', 0.5)).toBe('good');
    expect(capByBB('inaccuracy', 100)).toBe('inaccuracy');
  });
});

describe('the price signal', () => {
  it('a call with E·R below need − 0.15 is at least a Mistake, below need − 0.30 a Blunder', () => {
    expect(priceSignal('call', 0.4 - 0.15, 0.4)).toBeNull(); // at the boundary: not below
    expect(priceSignal('call', 0.2499, 0.4)).toBe('mistake');
    expect(priceSignal('call', 0.1, 0.4)).toBe('mistake'); // exactly need − 0.30
    expect(priceSignal('call', 0.0999, 0.4)).toBe('blunder');
    expect(priceSignal('call', 0.5, 0.4)).toBeNull();
  });

  it('a fold with E·R above need + 0.15 is at least a Mistake, above need + 0.30 a Blunder', () => {
    expect(priceSignal('fold', 0.25 + 0.15, 0.25)).toBeNull();
    expect(priceSignal('fold', 0.4001, 0.25)).toBe('mistake');
    expect(priceSignal('fold', 0.55, 0.25)).toBe('mistake');
    expect(priceSignal('fold', 0.5501, 0.25)).toBe('blunder');
    expect(priceSignal('fold', 0.1, 0.25)).toBeNull();
  });

  it('says nothing about a check, a bet or a raise', () => {
    for (const t of ['check', 'bet', 'raise'] as const) expect(priceSignal(t, 0, 0.5)).toBeNull();
  });
});

describe('the order: table, then the price signal, then the bb floors', () => {
  /** A call the coach folds, against a 40% price: `E·R` 0.2 says Mistake, 0 says Blunder. */
  const called = (takenEV: number, E: number, bb = 100) =>
    scoreGrade(facts({ rec: FOLD, recEV: 0, taken: CALL, takenEV, E, need: 0.4, bb }));

  it('the price signal raises a small loss', () => {
    // A call losing 3% of the pot (Good by the table) with E·R 0.2 against 0.4: a Mistake.
    const s = called(-30, 0.2, 10);
    expect(gradeOfLoss(s.lossPot)).toBe('good');
    expect(priceSignal('call', 0.2, 0.4)).toBe('mistake');
    expect(s.grade).toBe('mistake');
    // Below need − 0.30 with 6 bb lost (6% of the pot): a Blunder.
    expect(priceSignal('call', 0, 0.4)).toBe('blunder');
    expect(called(-600, 0).grade).toBe('blunder');
  });

  it('the floors cap the price signal too: a Blunder from any path needs 5 bb', () => {
    // E·R far below the price (signal: Blunder), 4 bb lost: a Mistake.
    expect(called(-400, 0).grade).toBe('mistake');
    // 0.5 bb lost: at most an Inaccuracy; 0.2 bb: at most Good.
    expect(called(-50, 0).grade).toBe('inaccuracy');
    expect(called(-20, 0).grade).toBe('good');
  });

  it('a fold that throws away a good price: the signal with R (the call’s realisation)', () => {
    // E 0.7 against a 0.25 price: E·R = 0.7 > 0.55 → Blunder (8 bb lost).
    expect(scoreGrade(facts({ recEV: 800, E: 0.7 })).grade).toBe('blunder');
    // Out of position on the flop (R 0.75): E·R = 0.525, at least a Mistake only.
    expect(scoreGrade(facts({ recEV: 300, E: 0.7, R: 0.75 })).grade).toBe('mistake');
  });
});

describe('pot-relative thresholds with bb floors (§8.9 "why pot-relative")', () => {
  // The coach checks (EV = loss); the hero bets a size the model rates lower by `loss`.
  const lossIn = (loss: number, pot: number, bb: number): Grade =>
    scoreGrade({
      legal: FREE,
      rec: CHECK,
      recEV: loss,
      alt: null,
      taken: betTo(Math.max(bb, Math.round(pot / 2))),
      takenEV: 0,
      pot,
      bb,
      E: 0.3,
      R: 1,
      need: 0,
    }).grade;

  it('the same 3 bb are a mistake in a small pot and nothing in a big one', () => {
    expect(lossIn(300, 600, 100)).toBe('mistake'); // 50% of a 6 bb pot (a Blunder needs 5 bb)
    expect(lossIn(300, 3000, 100)).toBe('inaccuracy'); // 10% of 30 bb
    expect(lossIn(300, 30000, 100)).toBe('best'); // 1% of 300 bb
  });

  it('the same share of the pot is softer in a tiny pot (the floors) and harsh in a deep one', () => {
    // 20% of the pot: a Mistake at 100 bb, an Inaccuracy when it is 0.8 bb, Good at 0.2 bb.
    expect(lossIn(2000, 10000, 100)).toBe('mistake');
    expect(lossIn(80, 400, 100)).toBe('inaccuracy');
    expect(lossIn(20, 100, 100)).toBe('good');
    // 60% of the pot: a Blunder with 12 bb lost, a Mistake with 3 bb.
    expect(lossIn(1200, 2000, 100)).toBe('blunder');
    expect(lossIn(300, 500, 100)).toBe('mistake');
  });

  it('only the ratio to the stakes counts: the same spot at 10/20 and at 500/1,000', () => {
    for (const bb of [20, 1000]) {
      expect(lossIn(3 * bb, 6 * bb, bb)).toBe('mistake');
      expect(lossIn(3 * bb, 30 * bb, bb)).toBe('inaccuracy');
      expect(lossIn(3 * bb, 300 * bb, bb)).toBe('best');
    }
  });
});

describe('the recommendation, the close spot, and moves rated higher (C8, §8.9)', () => {
  it('sameMove: the same type; a bet or raise within ±15% of the recommended "to"', () => {
    expect(sameMove(FOLD, FOLD)).toBe(true);
    expect(sameMove(CALL, CHECK)).toBe(false);
    expect(sameMove(raiseTo(345), raiseTo(300))).toBe(true);
    expect(sameMove(raiseTo(255), raiseTo(300))).toBe(true);
    expect(sameMove(raiseTo(346), raiseTo(300))).toBe(false);
    expect(sameMove(raiseTo(254), raiseTo(300))).toBe(false);
    expect(sameMove(betTo(300), raiseTo(300))).toBe(false);
  });

  it('following the recommendation is Best, even at a size the model rates a little lower', () => {
    const s = scoreGrade(
      facts({ rec: raiseTo(300), recEV: 200, taken: raiseTo(330), takenEV: 120, E: 0 }),
    );
    expect(s.grade).toBe('best');
    expect(s.loss).toBe(80); // the loss is still reported (error rate, §14.4)
    // Also when the price signal would cry out: the coach recommended it (C8).
    expect(scoreGrade(facts({ rec: CALL, taken: CALL, takenEV: 100, E: 0 })).grade).toBe('best');
  });

  it('in a Close spot the alternative is Best too ("Close call: {alt} is also fine")', () => {
    // The coach bets 300 (EV 400); checking is within 3% of the 1,000 pot (EV 375).
    const close = (taken: PlayerAction, takenEV: number, alt: PlayerAction | null = CHECK) =>
      scoreGrade({
        legal: FREE,
        rec: betTo(300),
        recEV: 400,
        alt,
        taken,
        takenEV,
        pot: 1000,
        bb: 10,
        E: 0.6,
        R: 1,
        need: 0,
      });
    expect(close(CHECK, 375).grade).toBe('best');
    expect(close(CHECK, 375).loss).toBe(25);
    // The same check outside a Close spot: by its loss (2.5% of the pot, Good).
    expect(close(CHECK, 375, null).grade).toBe('good');
    // A bet alternative is matched within ±15% as well.
    expect(close(betTo(520), 380, betTo(600)).grade).toBe('best');
    expect(close(betTo(400), 380, betTo(600)).grade).toBe('good');
  });

  it('a move the model rates above the recommendation is exactly Good (never Best, never worse)', () => {
    expect(scoreGrade(facts({ taken: raiseTo(400), takenEV: 101 })).grade).toBe('good');
    // Overrides the table and the price signal: a call rated above a recommended fold (its
    // implied odds), with E·R far below the price.
    const call = scoreGrade(
      facts({ rec: FOLD, recEV: 0, taken: CALL, takenEV: 30, E: 0, need: 0.4 }),
    );
    expect(priceSignal('call', 0, 0.4)).toBe('blunder');
    expect(call.grade).toBe('good');
    expect(call.loss).toBe(0);
    // In a Close spot too, unless it is the alternative.
    expect(scoreGrade(facts({ alt: raiseTo(400), taken: raiseTo(1000), takenEV: 500 })).grade).toBe(
      'good',
    );
    // An equal EV is no loss: Best by the table.
    expect(scoreGrade(facts({ taken: raiseTo(400), takenEV: 100 })).grade).toBe('best');
  });

  it('a fold when checking is free is a Blunder (the engine refuses it; the rule is kept)', () => {
    const s = scoreGrade(
      facts({ legal: FREE, rec: CHECK, recEV: 5, taken: FOLD, takenEV: 0, E: 0.01, need: 0 }),
    );
    expect(s).toMatchObject({ grade: 'blunder', loss: 5 });
  });
});

describe('leak tags (§8.9: the first matching row, Inaccuracy or worse)', () => {
  const leak = (over: Partial<LeakFacts>) =>
    leakOf({
      street: 'flop',
      facing: 'bet',
      bucket: 'medium',
      pushFold: false,
      taken: FOLD,
      rec: CALL,
      grade: 'mistake',
      ...over,
    });
  const pre = { street: 'preflop', bucket: null } as const;

  it('reaches every tag', () => {
    expect(leak({ ...pre, facing: 'none', taken: raiseTo(250), rec: FOLD })).toBe('open-loose');
    expect(leak({ ...pre, facing: 'limpers', taken: FOLD, rec: raiseTo(400) })).toBe('open-tight');
    expect(leak({ ...pre, facing: 'none', taken: CALL, rec: raiseTo(250) })).toBe('limp');
    expect(leak({ ...pre, facing: 'limpers', taken: CALL, rec: FOLD })).toBe('limp');
    expect(leak({ ...pre, facing: 'open', taken: CALL, rec: FOLD })).toBe('call-pre-wide');
    expect(leak({ ...pre, facing: 'allin', taken: CALL, rec: FOLD })).toBe('call-pre-wide');
    expect(leak({ ...pre, facing: '3bet', taken: FOLD, rec: CALL })).toBe('fold-pre-much');
    expect(leak({ ...pre, facing: '4bet+', taken: FOLD, rec: raiseTo(5000) })).toBe(
      'fold-pre-much',
    );
    expect(
      leak({ ...pre, facing: 'none', pushFold: true, taken: raiseTo(250), rec: raiseTo(800) }),
    ).toBe('pushfold');
    expect(leak({ ...pre, facing: 'open', pushFold: true, taken: raiseTo(800), rec: FOLD })).toBe(
      'pushfold',
    );
    expect(
      leak({ facing: 'none', bucket: 'strong', taken: CHECK, rec: betTo(300), street: 'turn' }),
    ).toBe('missed-value');
    expect(leak({ facing: 'bet', bucket: 'monster', taken: CALL, rec: raiseTo(900) })).toBe(
      'missed-value',
    );
    expect(leak({ facing: 'none', bucket: 'air', taken: betTo(300), rec: CHECK })).toBe(
      'bluff-much',
    );
    expect(leak({ facing: 'bet', bucket: 'air', taken: raiseTo(900), rec: FOLD })).toBe(
      'bluff-much',
    );
    expect(leak({ street: 'turn', facing: 'bet', taken: FOLD, rec: CALL })).toBe('overfold');
    expect(leak({ facing: 'allin', taken: FOLD, rec: CALL })).toBe('overfold');
    expect(leak({ facing: 'bet', bucket: 'draw', taken: CALL, rec: FOLD })).toBe('chase');
    expect(leak({ street: 'river', facing: 'bet', taken: CALL, rec: FOLD })).toBe('river-call');
    expect(leak({ street: 'turn', facing: 'raise', taken: CALL, rec: FOLD })).toBe('call-light');
    expect(leak({ facing: 'none', bucket: 'strong', taken: betTo(900), rec: betTo(200) })).toBe(
      'sizing',
    );
    expect(leak({ ...pre, facing: 'open', taken: raiseTo(2000), rec: raiseTo(750) })).toBe(
      'sizing',
    );
  });

  it('takes the first matching row: a short stack’s folded shove is open-tight (row 2)', () => {
    expect(leak({ ...pre, facing: 'none', pushFold: true, taken: FOLD, rec: raiseTo(800) })).toBe(
      'open-tight',
    );
    // A draw's call on the flop is "chase" before "call-light".
    expect(leak({ facing: 'bet', bucket: 'draw', taken: CALL, rec: FOLD, street: 'turn' })).toBe(
      'chase',
    );
  });

  it('none for Best and Good, and none when no row fits', () => {
    expect(leak({ grade: 'best', street: 'river', taken: CALL, rec: FOLD })).toBeNull();
    expect(leak({ grade: 'good', street: 'river', taken: CALL, rec: FOLD })).toBeNull();
    expect(leak({ grade: 'inaccuracy', street: 'river', taken: CALL, rec: FOLD })).toBe(
      'river-call',
    );
    expect(leak({ taken: CALL, rec: raiseTo(900), bucket: 'medium' })).toBeNull();
    expect(leak({ ...pre, facing: 'open', taken: raiseTo(900), rec: CALL })).toBeNull();
    // After the flop there is no push/fold rule (§8.4 is preflop): no pushfold tag.
    expect(leak({ facing: 'bet', pushFold: true, taken: raiseTo(900), rec: CALL })).toBeNull();
  });
});

describe('the feedback card’s reason (Appendix F.5)', () => {
  /** Facts: facing a bet of 100 after the flop, heads-up, the coach calls with 50% (price 25%). */
  const fb = (over: Partial<FeedbackFacts>): FeedbackInput =>
    feedbackRow({
      legal: FACING,
      street: 'flop',
      facing: 'bet',
      bucket: 'medium',
      nOpp: 1,
      pushFold: false,
      S: 15,
      rankPct: 30,
      hand: 'Ace-King suited',
      bb: 100,
      toCall: 100,
      taken: FOLD,
      rec: CALL,
      E: 0.5,
      R: 1,
      need: 0.25,
      rangeAdjust: false,
      ...over,
    });
  /** Unopened before the flop, 8 bb: the coach shoves (the legal maximum). */
  const SHORT: LegalActions = { ...FACING, toCall: 100, raise: { min: 200, max: 800 } };
  const pushSpot = {
    street: 'preflop',
    facing: 'none',
    bucket: null,
    pushFold: true,
    S: 8,
    legal: SHORT,
  } as const;

  it('push/fold deviation (§8.4 spots): the coach’s all-in or fold', () => {
    expect(fb({ ...pushSpot, taken: FOLD, rec: raiseTo(800) })).toEqual({
      row: 'pushFold',
      S: 8,
      hand: 'Ace-King suited',
      move: 'allin',
    });
    expect(fb({ ...pushSpot, taken: raiseTo(800), rec: FOLD })).toMatchObject({ move: 'fold' });
    // Calling an all-in that puts the hero all-in is going all-in.
    const allInCall = { ...SHORT, callIsAllIn: true, raise: null };
    expect(fb({ ...pushSpot, facing: 'allin', legal: allInCall, taken: FOLD, rec: CALL })).toEqual({
      row: 'pushFold',
      S: 8,
      hand: 'Ace-King suited',
      move: 'allin',
    });
    // A call that leaves chips behind is not "go all-in": the next rows decide.
    expect(fb({ ...pushSpot, facing: 'allin', taken: FOLD, rec: CALL })).toMatchObject({
      row: 'foldedStrong',
    });
  });

  it('the preflop rows: opened too loose; folded a strong hand (the top half)', () => {
    const pre = { street: 'preflop', facing: 'none', bucket: null } as const;
    expect(fb({ ...pre, taken: raiseTo(250), rec: FOLD, hand: 'Seven-Two offsuit' })).toEqual({
      row: 'openLoose',
      hand: 'Seven-Two offsuit',
    });
    expect(fb({ ...pre, facing: 'limpers', taken: CALL, rec: FOLD })).toMatchObject({
      row: 'openLoose',
    });
    expect(fb({ ...pre, taken: FOLD, rec: raiseTo(250), rankPct: 0.45 })).toEqual({
      row: 'foldedStrong',
      hand: 'Ace-King suited',
      rankPct: 0.45,
    });
    expect(fb({ ...pre, taken: FOLD, rec: raiseTo(250), rankPct: 50 })).toMatchObject({
      row: 'foldedStrong',
    });
    // A weak hand the big blind defends for the price: the price row, not "strong".
    expect(fb({ ...pre, facing: 'open', taken: FOLD, rec: CALL, rankPct: 70 })).toMatchObject({
      row: 'foldedPrice',
    });
    // Before anyone raised there is no price row (the coach never just calls there).
    expect(fb({ ...pre, taken: FOLD, rec: raiseTo(250), rankPct: 70 })).toMatchObject({
      row: 'fallback',
    });
  });

  it('the size: too big or too small, with the coach’s size', () => {
    const pre = { street: 'preflop', facing: 'none', bucket: null } as const;
    expect(fb({ ...pre, taken: raiseTo(1000), rec: raiseTo(250) })).toEqual({
      row: 'size',
      tooBig: true,
      to: 250,
      bb: 100,
    });
    expect(fb({ legal: FREE, facing: 'none', taken: betTo(100), rec: betTo(300) })).toEqual({
      row: 'size',
      tooBig: false,
      to: 300,
      bb: 100,
    });
  });

  it('the price rows, only when their whole numbers agree with them', () => {
    expect(fb({ taken: FOLD })).toEqual({
      row: 'foldedPrice',
      E: 0.5,
      need: 0.25,
      rangeAdjust: false,
    });
    expect(fb({ taken: FOLD, rangeAdjust: true })).toMatchObject({ rangeAdjust: true });
    // E·R and need show the same whole number: no price sentence.
    expect(fb({ taken: FOLD, E: 0.252, need: 0.249 })).toMatchObject({ row: 'fallback' });
    // R < 1: E·R must beat the price, not only E.
    expect(fb({ taken: FOLD, E: 0.3, R: 0.8, need: 0.25 })).toMatchObject({ row: 'fallback' });
    const called = { taken: CALL, rec: FOLD, E: 0.1, need: 0.25 } as const;
    expect(fb(called)).toEqual({ row: 'calledPrice', E: 0.1, need: 0.25, rangeAdjust: false });
    expect(fb({ ...called, rangeAdjust: true })).toMatchObject({ rangeAdjust: true });
    expect(fb({ ...called, E: 0.248, need: 0.251 })).toMatchObject({ row: 'fallback' });
    // E·R below the price but {E} above it: "You called with 30%. You needed 28%" would be false.
    expect(fb({ ...called, E: 0.3, R: 0.8, need: 0.28 })).toMatchObject({ row: 'fallback' });
  });

  it('checked a strong hand; bet with air into several players, or heads-up when a check was free', () => {
    const free = { legal: FREE, facing: 'none', toCall: 0, need: 0 } as const;
    expect(fb({ ...free, taken: CHECK, rec: betTo(300), bucket: 'strong' })).toEqual({
      row: 'checkedStrong',
    });
    expect(fb({ ...free, taken: CHECK, rec: betTo(300), bucket: 'monster' })).toMatchObject({
      row: 'checkedStrong',
    });
    expect(fb({ ...free, taken: CHECK, rec: betTo(300), bucket: 'medium' })).toMatchObject({
      row: 'fallback',
    });
    expect(fb({ ...free, taken: betTo(300), rec: CHECK, bucket: 'air', nOpp: 3 })).toEqual({
      row: 'airMultiway',
      players: 3,
    });
    expect(fb({ taken: raiseTo(400), rec: FOLD, bucket: 'air', nOpp: 2 })).toMatchObject({
      row: 'airMultiway',
    });
    expect(fb({ ...free, taken: betTo(300), rec: CHECK, bucket: 'air' })).toEqual({
      row: 'airHeadsUp',
    });
    // Raising a bet heads-up: "Checking was cheaper" would be false.
    expect(fb({ taken: raiseTo(400), rec: FOLD, bucket: 'air' })).toMatchObject({
      row: 'fallback',
    });
  });

  it('the fallback carries the coach’s move', () => {
    expect(fb({ taken: CALL, rec: raiseTo(400), E: 0.6 })).toEqual({
      row: 'fallback',
      alt: raiseTo(400),
      legal: FACING,
      toCall: 100,
      bb: 100,
    });
  });

  it('checks the rows in F.5’s order: push/fold, the preflop rows, the size, then the rest', () => {
    const pre = { street: 'preflop', bucket: null } as const;
    // A short stack's shove with a fold hand: push/fold before "opened too loose".
    expect(
      fb({ ...pre, facing: 'none', pushFold: true, legal: SHORT, taken: raiseTo(800), rec: FOLD }),
    ).toMatchObject({ row: 'pushFold' });
    // A strong preflop fold facing a good price: the preflop row before the price row.
    expect(fb({ ...pre, facing: 'open', taken: FOLD, rec: CALL, rankPct: 12 })).toMatchObject({
      row: 'foldedStrong',
    });
    // An Air bet too big: the size before the Air rows.
    const free = { legal: FREE, facing: 'none', toCall: 0, need: 0 } as const;
    expect(fb({ ...free, taken: betTo(900), rec: betTo(300), bucket: 'air' })).toMatchObject({
      row: 'size',
    });
  });

  it('every F.5 reason is reachable: each feedback template is some row’s line', () => {
    const free = { legal: FREE, facing: 'none', toCall: 0, need: 0 } as const;
    const pre = { street: 'preflop', facing: 'none', bucket: null } as const;
    const rows: FeedbackInput[] = [
      fb({ ...pushSpot, taken: FOLD, rec: raiseTo(800) }),
      fb({ ...pushSpot, taken: raiseTo(800), rec: FOLD }),
      fb({ ...pre, taken: raiseTo(250), rec: FOLD }),
      fb({ ...pre, taken: FOLD, rec: raiseTo(250), rankPct: 5 }),
      fb({ ...pre, taken: raiseTo(1000), rec: raiseTo(250) }),
      fb({ ...pre, taken: raiseTo(200), rec: raiseTo(250 * 4) }),
      fb({ taken: FOLD }),
      fb({ taken: FOLD, rangeAdjust: true }),
      fb({ taken: CALL, rec: FOLD, E: 0.1 }),
      fb({ taken: CALL, rec: FOLD, E: 0.1, rangeAdjust: true }),
      fb({ ...free, taken: CHECK, rec: betTo(300), bucket: 'monster' }),
      fb({ ...free, taken: betTo(300), rec: CHECK, bucket: 'air', nOpp: 2 }),
      fb({ ...free, taken: betTo(300), rec: CHECK, bucket: 'air' }),
      fb({ taken: CALL, rec: raiseTo(400), E: 0.6 }),
    ];
    const keys = new Set(rows.map((r) => feedbackLine(r).key));
    const f5 = TEMPLATE_KEYS.filter((k) => k.startsWith('feedback.'));
    expect(f5).toHaveLength(14);
    expect([...keys].sort()).toEqual([...f5].sort());
  });
});

// ── Spots played by the real engine, graded by the real coach ─────────────────────────────────

interface Spot {
  obs: Observation;
  answer: ReturnType<typeof coachAnswer>;
  rec: PlayerAction;
}

function spot(spec: SpotSpec, hero: number): Spot {
  const obs = observeSpot(playSpot(spec), hero);
  expect(obs.legal.seat).toBe(hero);
  const answer = coachAnswer(obs, null);
  return { obs, answer, rec: answer.hint.decision.action };
}

const SIX = [10000, 10000, 10000, 10000, 10000, 10000];
/** River, heads-up after a limped pot: the hero holds the nut flush; the big blind bets 1 bb. */
const NUT_FLUSH_HU: SpotSpec = {
  stacks: [10000, 10000],
  button: 0,
  holes: { 0: 'Ah Kh' },
  board: 'Th 7h 2c 4h 9s',
  inputs: [call(0), check(1), check(1), check(0), check(1), check(0), bet(1, 100)],
};
/** The same three-handed: a 1 bb bet and a call into the hero's nut flush (pot 5 bb). */
const NUT_FLUSH_3: SpotSpec = {
  stacks: [10000, 10000, 10000],
  button: 0,
  holes: { 0: 'Ah Kh' },
  board: 'Th 7h 2c 4h 9s',
  inputs: [
    call(0),
    call(1),
    check(2),
    check(1),
    check(2),
    check(0),
    check(1),
    check(2),
    check(0),
    bet(1, 100),
    call(2),
  ],
};

describe('real spots: following the hint is Best (C8), the coach never contradicts itself', () => {
  it('the recommendation is Best whatever HUD number the hint and the grade bring', () => {
    const s = spot(NUT_FLUSH_3, 0);
    for (const e of [null, 0, 0.37, 1]) {
      const g = s.answer.grade(s.rec, 2, e);
      expect(g).toMatchObject({ decisionId: 2, grade: 'best', rec: s.rec, taken: s.rec });
      expect(g).toMatchObject({ lossChips: 0, lossPot: 0, lossMilliBB: 0, leak: null });
      expect(g.feedback).toBeNull();
      expect(grade(s.obs, s.rec, e, 2).grade).toBe('best'); // computed afresh: the same
    }
  });

  it('is the same grade from the cached hint or computed afresh (pure, deterministic)', () => {
    const s = spot(NUT_FLUSH_HU, 0);
    for (const taken of [FOLD, CALL, raiseTo(250)]) {
      const cached = s.answer.grade(taken, 4, 0.9);
      expect(grade(s.obs, taken, 0.9, 4)).toEqual(cached);
      expect(coachAnswer(s.obs, 0.2).grade(taken, 4, 0.9)).toEqual(cached);
      expect(s.answer.grade(taken, 4, 0.9)).toEqual(cached);
      expect(structuredClone(cached)).toEqual(cached); // plain data: it posts as it is
    }
    // The adapter takes any object with the request's fields (A.6 grade, 6.2's GradeAsk).
    const request = { kind: 'grade', jobId: 9, epoch: 1, obs: s.obs, taken: FOLD, eRandom: 0.9 };
    expect(gradeOf({ ...request, decisionId: 4 })).toEqual(s.answer.grade(FOLD, 4, 0.9));
  });

  it('a Close spot: the alternative is Best; a move rated above the recommendation is Good', () => {
    // Pocket sixes on K♦ 8♥ 3♣, checked to the button: bet 150, or check (within 3% of the pot).
    const s = spot(
      {
        stacks: [10000, 10000],
        button: 0,
        holes: { 0: '6d 6c' },
        board: 'Kd 8h 3c',
        inputs: [raise(0, 250), call(1), check(1)],
      },
      0,
    );
    const d = s.answer.hint.decision;
    expect(d.confidence).toBe('close');
    expect(d.alt).toEqual(CHECK);
    expect(s.answer.grade(CHECK, 1).grade).toBe('best');
    expect(s.answer.grade(s.rec, 1).grade).toBe('best');
    // A bigger bet the model likes better: Good, not Best (the coach did not recommend it).
    const bigger = betTo(250);
    expect(d.ev[candidateKey(s.obs.legal, bigger)] as number).toBeGreaterThan(
      d.ev[candidateKey(s.obs.legal, s.rec)] as number,
    );
    expect(s.answer.grade(bigger, 1).grade).toBe('good');
  });

  it('a size within ±15% of the recommendation is Best; an exact-size EV is computed once', () => {
    const s = spot({ stacks: SIX, button: 0, holes: { 3: 'Ac Ad' }, inputs: [] }, 3);
    expect(s.rec).toEqual(raiseTo(250));
    const near = raiseTo(275); // not a candidate: its EV is computed for the grade
    expect(s.answer.hint.decision.ev[candidateKey(s.obs.legal, near)]).toBeUndefined();
    expect(s.answer.grade(near, 0).grade).toBe('best');
    // All-in with aces: the model rates it above the open (fold equity), so exactly Good.
    expect(s.answer.grade(raiseTo(s.obs.legal.raise?.max ?? 0), 0).grade).toBe('good');
  });

  it('keeps only the recommendation’s reasons in the trace (no line that shows the HUD number)', () => {
    const s = spot(NUT_FLUSH_HU, 0);
    const g = s.answer.grade(FOLD, 0);
    expect(g.trace).toEqual(recommendationTrace(s.answer.hint.decision.trace));
    expect(g.trace.length).toBeGreaterThan(0);
    for (const r of g.trace)
      expect(r.code).not.toMatch(/^(RANGE_ADJUST|WHY_NOT|CLOSE_SPOT|RULE_2_4)/);
  });

  it('refuses an illegal move; a fold when checking is free is a Blunder', () => {
    const s = spot(
      {
        stacks: [10000, 10000],
        button: 0,
        holes: { 0: '7c 7d' },
        board: 'Ks 7h 2c',
        inputs: [raise(0, 300), call(1), check(1)],
      },
      0,
    );
    expect(() => s.answer.grade(betTo(1), 0)).toThrow(RangeError);
    expect(() => s.answer.grade(CALL, 0)).toThrow(RangeError);
    expect(s.answer.grade(FOLD, 0).grade).toBe('blunder');
  });
});

describe('real spots: the grade, the leak and the F.5 reason a player meets', () => {
  it('folding the nut flush to a 1 bb bet: a Big mistake only with 5 bb lost (the bb floor)', () => {
    const hu = spot(NUT_FLUSH_HU, 0).answer.grade(FOLD, 3);
    expect(hu.lossPot).toBeGreaterThan(0.4); // the table and the price signal say Blunder…
    expect(hu.lossMilliBB).toBeLessThan(5000); // …but 4 bb is not enough
    expect(hu).toMatchObject({ grade: 'mistake', leak: 'overfold' });
    expect(hu.feedback?.key).toBe('feedback.foldedPrice');
    const three = spot(NUT_FLUSH_3, 0).answer.grade(FOLD, 3);
    expect(three.lossMilliBB).toBeGreaterThanOrEqual(5000);
    expect(three).toMatchObject({ grade: 'blunder', leak: 'overfold' });
    // Calling the nuts instead of raising: value missed.
    expect(spot(NUT_FLUSH_HU, 0).answer.grade(CALL, 3).leak).toBe('missed-value');
  });

  it('calling a pot-size river bet with ace-high: a Big mistake, river-call, the price row', () => {
    const s = spot(
      {
        stacks: [10000, 10000],
        button: 0,
        holes: { 0: 'Ac 3d' },
        board: 'Ks Qs 8h 5c 2d',
        inputs: [raise(0, 300), call(1), check(1), check(0), check(1), check(0), bet(1, 600)],
      },
      0,
    );
    expect(s.rec).toEqual(FOLD);
    const g = s.answer.grade(CALL, 5);
    expect(g).toMatchObject({ grade: 'blunder', leak: 'river-call', rec: FOLD });
    // The HUD (any two cards) and the range number differ: "… against their likely hands".
    expect(g.feedback?.key).toBe('feedback.calledPriceRange');
    const E = g.feedback?.params.E;
    const need = g.feedback?.params.need;
    expect(E?.kind === 'pct' && need?.kind === 'pct' && E.value < need.value).toBe(true);
  });

  it('checking a set: a Mistake, missed-value, "You checked a very strong hand"', () => {
    const s = spot(
      {
        stacks: [10000, 10000],
        button: 0,
        holes: { 0: '7c 7d' },
        board: 'Ks 7h 2c',
        inputs: [raise(0, 300), call(1), check(1)],
      },
      0,
    );
    expect(s.rec.type).toBe('bet');
    const g = s.answer.grade(CHECK, 1);
    expect(g).toMatchObject({ grade: 'mistake', leak: 'missed-value' });
    expect(g.feedback?.key).toBe('feedback.checkedStrong');
  });

  it('betting air into three players: bluff-much, "into 3 players"', () => {
    const s = spot(
      {
        stacks: [10000, 10000, 10000, 10000],
        button: 0,
        holes: { 3: '4c 3d' },
        board: 'Ks Qh 9s',
        inputs: [call(3), call(0), call(1), check(2), check(1), check(2)],
      },
      3,
    );
    expect(s.rec).toEqual(CHECK);
    const g = s.answer.grade(betTo(400), 1);
    expect(g).toMatchObject({ grade: 'mistake', leak: 'bluff-much' });
    expect(g.feedback).toEqual(feedbackLine({ row: 'airMultiway', players: 3 }));
  });

  it('opening 7-2 offsuit under the gun: open-loose, capped at Slightly off below 1 bb', () => {
    const s = spot({ stacks: SIX, button: 0, holes: { 3: '7c 2d' }, inputs: [] }, 3);
    expect(s.rec).toEqual(FOLD);
    const g = s.answer.grade(raiseTo(250), 0);
    expect(g.lossPot).toBeGreaterThan(0.15);
    expect(g.lossMilliBB).toBeLessThan(1000);
    expect(g).toMatchObject({ grade: 'inaccuracy', leak: 'open-loose' });
    expect(g.feedback).toEqual(feedbackLine({ row: 'openLoose', hand: 'Seven-Two offsuit' }));
    expect(s.answer.grade(CALL, 0)).toMatchObject({ grade: 'inaccuracy', leak: 'limp' });
  });

  it('folding pocket aces: open-tight, "Pocket Aces is in the top 1% of hands"', () => {
    const s = spot({ stacks: SIX, button: 0, holes: { 3: 'Ac Ad' }, inputs: [] }, 3);
    const g = s.answer.grade(FOLD, 0);
    expect(g).toMatchObject({ grade: 'mistake', leak: 'open-tight' });
    expect(g.feedback?.key).toBe('feedback.foldedStrong');
    expect(g.feedback?.params.hand).toEqual({ kind: 'name', text: 'Pocket Aces' });
  });

  it('8 bb on the button with A-5 offsuit: shove; folding is a push/fold deviation', () => {
    const s = spot(
      {
        stacks: [800, 800, 800, 800, 800, 800],
        button: 0,
        holes: { 0: 'Ac 5d' },
        inputs: [fold(3), fold(4), fold(5)],
      },
      0,
    );
    expect(s.rec).toEqual(raiseTo(800));
    const g = s.answer.grade(FOLD, 0);
    expect(g).toMatchObject({ grade: 'inaccuracy', leak: 'open-tight' });
    expect(g.feedback).toEqual(
      feedbackLine({ row: 'pushFold', S: 8, hand: 'Ace-Five offsuit', move: 'allin' }),
    );
    // A min-raise loses 0.15 bb: at most Good, no leak, no card.
    expect(s.answer.grade(raiseTo(250), 0)).toMatchObject({
      grade: 'good',
      leak: null,
      feedback: null,
    });
  });
});
