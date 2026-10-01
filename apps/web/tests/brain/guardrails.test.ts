/**
 * PLAN §8.8 guardrails. Each rule gets a spot played through the real engine, the coach's real
 * features, and a raw proposal that goes wrong there (what a rule-based advisor or a noisy bot
 * could pick). With every guardrail on, the action is fixed and the engine accepts it; with that
 * one rule removed from the list, the mistake goes through unchanged. So each guardrail has a test
 * that fails if the guardrail is removed (§18 Stage 5 criterion 3).
 */
import { describe, expect, it } from 'vitest';
import { coachSeed, features } from '../../src/brain/features.ts';
import {
  allInPriceBad,
  allInPriceGood,
  checkFree,
  GUARDRAILS,
  guardrails,
  guardSpot,
  isLegalAction,
  legalAmount,
  riverNoChance,
  snapToLegal,
  tooStrongToFold,
  type Guardrail,
  type GuardSpot,
} from '../../src/brain/guardrails.ts';
import type { Features } from '../../src/brain/types.ts';
import { step } from '../../src/engine/step.ts';
import type { HandState, LegalActions, PlayerAction } from '../../src/engine/types.ts';
import { bet, call, check, fold, raise } from '../engine/play.ts';
import { COACH_LIKE, observeSpot, playSpot, type SpotSpec } from './fixtures.ts';

const FOLD: PlayerAction = { type: 'fold' };
const CHECK: PlayerAction = { type: 'check' };
const CALL: PlayerAction = { type: 'call' };

interface Played {
  h: HandState;
  seat: number;
  f: Features;
  spot: GuardSpot;
}

/** Plays the spot and takes the coach's features for the seat to act. */
function coachAt(spec: SpotSpec): Played {
  const h = playSpot(spec);
  const seat = h.toAct as number;
  const obs = observeSpot(h, seat);
  const f = features(obs, COACH_LIKE, coachSeed(obs));
  return { h, seat, f, spot: guardSpot(obs, f) };
}

/** The engine takes `action` from the seat to act. */
function engineAccepts(p: Played, action: PlayerAction): boolean {
  try {
    step(p.h, { kind: 'act', seat: p.seat, action });
    return true;
  } catch {
    return false;
  }
}

const without = (rule: Guardrail): Guardrail[] => GUARDRAILS.filter((g) => g !== rule);

interface Case {
  rule: Guardrail;
  name: string;
  spec: SpotSpec;
  proposed: PlayerAction;
  expected: PlayerAction;
  /** What makes the spot a test of this rule alone. */
  premise: (p: Played) => void;
}

const HU = [10000, 10000];

const CASES: Case[] = [
  {
    rule: checkFree,
    name: 'rule 1: 7♣2♦ on A♠K♠Q♠, checked to the hero (E12): a "give up" fold becomes a check',
    spec: {
      stacks: HU,
      button: 0,
      holes: { 0: '7c 2d' },
      board: 'As Ks Qs',
      inputs: [call(0), check(1), check(1)],
    },
    proposed: FOLD,
    expected: CHECK,
    premise: ({ spot, f }) => {
      expect(spot.legal.canCheck).toBe(true);
      expect(f.p).toBeLessThan(0.95);
    },
  },
  {
    rule: tooStrongToFold,
    name: 'rule 2: A♠K♠ with a royal flush facing a river bet (E15 shape): a fold becomes a call',
    spec: {
      stacks: HU,
      button: 0,
      holes: { 0: 'As Ks' },
      board: 'Qs Js Ts 4d 2c',
      inputs: [raise(0, 300), call(1), check(1), check(0), check(1), check(0), bet(1, 600)],
    },
    proposed: FOLD,
    expected: CALL,
    premise: ({ f }) => {
      expect(f.p).toBeGreaterThanOrEqual(0.95);
      expect(f.facing).toBe('bet');
    },
  },
  {
    rule: riverNoChance,
    name: 'rule 3: 3♣2♦ when the board plays, a pot-sized river bet (E17): a call becomes a fold',
    spec: {
      stacks: HU,
      button: 0,
      holes: { 1: '3c 2d' },
      board: 'As Kd Qc Jh 9s',
      inputs: [
        raise(0, 300),
        call(1),
        check(1),
        bet(0, 200),
        call(1),
        check(1),
        check(0),
        check(1),
        bet(0, 1000),
      ],
    },
    proposed: CALL,
    expected: FOLD,
    premise: ({ f }) => {
      expect(f.street).toBe('river');
      expect(f.facing).toBe('bet');
      expect(f.eRange).toBeLessThan(0.03);
    },
  },
  {
    rule: allInPriceGood,
    name: 'rule 4: K♥Q♦ with top pair, a river all-in at 6.77-to-1 (§1.7): a fold becomes a call',
    spec: {
      stacks: [10000, 388, 10000],
      button: 1,
      bb: 2,
      holes: { 0: 'Kh Qd' },
      board: 'Qs 9c 5d 3h 2s',
      inputs: [
        raise(1, 288),
        fold(2),
        call(0),
        check(0),
        check(1),
        check(0),
        check(1),
        check(0),
        bet(1, 100),
      ],
    },
    proposed: FOLD,
    expected: CALL,
    premise: ({ f }) => {
      expect(f.facing).toBe('allin');
      expect(f.pot / f.toCall).toBeCloseTo(6.77, 12); // 677 in the pot, 100 to call
      expect(f.need).toBeCloseTo(100 / 777, 12);
      expect(f.eRange).toBeGreaterThanOrEqual(f.need + 0.15);
      expect(f.p).toBeLessThan(0.95);
    },
  },
  {
    rule: allInPriceBad,
    name: 'rule 4: 7♣2♦ on A♠K♠Q♠J♦, a turn all-in of 4,700 into 600: a call becomes a fold',
    spec: {
      stacks: [10000, 5000],
      button: 0,
      holes: { 0: '7c 2d' },
      board: 'As Ks Qs Jd',
      inputs: [raise(0, 300), call(1), check(1), check(0), bet(1, 4700)],
    },
    proposed: CALL,
    expected: FOLD,
    premise: ({ f }) => {
      expect(f.street).toBe('turn'); // rule 3 is for the river only
      expect(f.facing).toBe('allin');
      expect(f.need).toBeCloseTo(0.47, 12);
      expect(f.eRange).toBeLessThan(f.need - 0.25);
    },
  },
  {
    rule: legalAmount,
    name: 'rule 5: a raise to 600 against a 400 bet (the minimum is 800) is snapped to 800',
    spec: {
      stacks: HU,
      button: 0,
      inputs: [raise(0, 300), call(1), check(1), bet(0, 400)],
    },
    proposed: { type: 'raise', to: 600 },
    expected: { type: 'raise', to: 800 },
    premise: ({ spot }) => {
      expect(spot.legal.raise).toEqual({ min: 800, max: 9700 });
    },
  },
];

describe('§8.8 guardrails: each one fixes its spot, and the spot fails without it', () => {
  it.each(CASES)('$name', ({ rule, spec, proposed, expected, premise }) => {
    const p = coachAt(spec);
    premise(p);
    expect(isLegalAction(p.spot.legal, expected)).toBe(true);

    const all = guardrails(p.spot, proposed);
    expect(all.action).toEqual(expected);
    expect(all.fired).toEqual([rule.id]); // the spot tests this rule alone
    expect(engineAccepts(p, all.action)).toBe(true);

    const removed = guardrails(p.spot, proposed, without(rule));
    expect(removed.action).toEqual(proposed); // nothing else catches the mistake
    expect(removed.action).not.toEqual(expected);
    expect(removed.fired).toEqual([]);
  });

  it('without rules 1 and 5 the advice is one the engine refuses', () => {
    const free = CASES[0] as Case;
    const p1 = coachAt(free.spec);
    expect(engineAccepts(p1, guardrails(p1.spot, FOLD, without(checkFree)).action)).toBe(false);
    const sub = CASES[5] as Case;
    const p5 = coachAt(sub.spec);
    const raw = guardrails(p5.spot, sub.proposed, without(legalAmount)).action;
    expect(engineAccepts(p5, raw)).toBe(false);
  });

  it('a fired rule 1–4 leaves a GUARDRAIL reason with its number and detail key (F.1)', () => {
    const reasons = CASES.map((c) => guardrails(coachAt(c.spec).spot, c.proposed).trace);
    expect(reasons).toEqual([
      [{ code: 'GUARDRAIL', data: { rule: 1, detail: 'checkFree' } }],
      [{ code: 'GUARDRAIL', data: { rule: 2, detail: 'tooStrongToFold' } }],
      [{ code: 'GUARDRAIL', data: { rule: 3, detail: 'riverNoChance' } }],
      [{ code: 'GUARDRAIL', data: { rule: 4, detail: 'allInPriceGood' } }],
      [{ code: 'GUARDRAIL', data: { rule: 4, detail: 'allInPriceBad' } }],
      [], // snapping an amount explains nothing
    ]);
  });

  it('the list holds every rule once, the amount snap first (every later rule reads a legal action)', () => {
    expect(GUARDRAILS.map((g) => g.id)).toEqual([
      'legalAmount',
      'checkFree',
      'tooStrongToFold',
      'riverNoChance',
      'allInPriceGood',
      'allInPriceBad',
    ]);
    expect(GUARDRAILS.map((g) => g.rule)).toEqual([5, 1, 2, 3, 4, 4]);
  });

  it('a raise that cannot be made and becomes a call still meets rules 3 and 4', () => {
    // The 4b spot: facing the last opponent's all-in there is nothing to raise against.
    const p = coachAt(CASES[4]?.spec as SpotSpec);
    expect(p.spot.legal.raise).toBeNull();
    const r = guardrails(p.spot, { type: 'raise', to: 9000 });
    expect(r.fired).toEqual(['legalAmount', 'allInPriceBad']);
    expect(r.action).toEqual(FOLD);
  });
});

// ── Boundaries, on legal sets written out by hand ──────────────────────────────────────────────

const FACING_BET: LegalActions = {
  seat: 0,
  toCall: 400,
  callAmount: 400,
  callIsAllIn: false,
  canFold: true,
  canCheck: false,
  canCall: true,
  bet: null,
  raise: { min: 800, max: 9700 },
};
const NOTHING_TO_CALL: LegalActions = {
  seat: 0,
  toCall: 0,
  callAmount: 0,
  callIsAllIn: false,
  canFold: false,
  canCheck: true,
  canCall: false,
  bet: { min: 100, max: 9700 },
  raise: null,
};

function spotWith(legal: LegalActions, f: Partial<GuardSpot['f']> = {}): GuardSpot {
  return {
    legal,
    sb: 50,
    streetBet: 0,
    f: { street: 'river', facing: 'bet', need: 0.3, eRange: 0.5, p: 0.5, ...f },
  };
}

const after = (s: GuardSpot, a: PlayerAction): PlayerAction => guardrails(s, a).action;

describe('§8.8 boundaries (≥ holds at the boundary, < does not)', () => {
  it('rule 2: p ≥ 0.95', () => {
    expect(after(spotWith(FACING_BET, { p: 0.95 }), FOLD)).toEqual(CALL);
    expect(after(spotWith(FACING_BET, { p: 0.949 }), FOLD)).toEqual(FOLD);
  });

  it('rule 3: eRange < 0.03, on the river only', () => {
    expect(after(spotWith(FACING_BET, { eRange: 0.03 }), CALL)).toEqual(CALL);
    expect(after(spotWith(FACING_BET, { eRange: 0.0299 }), CALL)).toEqual(FOLD);
    expect(after(spotWith(FACING_BET, { eRange: 0, street: 'turn' }), CALL)).toEqual(CALL);
  });

  it('rule 4: eRange ≥ need + 0.15 calls, eRange < need − 0.25 folds, only facing an all-in', () => {
    const allIn = { facing: 'allin' as const, need: 0.25 };
    expect(after(spotWith(FACING_BET, { ...allIn, eRange: 0.4 }), FOLD)).toEqual(CALL);
    expect(after(spotWith(FACING_BET, { ...allIn, eRange: 0.399 }), FOLD)).toEqual(FOLD);
    expect(after(spotWith(FACING_BET, { need: 0.25, eRange: 0.9 }), FOLD)).toEqual(FOLD);
    const short = { facing: 'allin' as const, need: 0.45 };
    expect(after(spotWith(FACING_BET, { ...short, eRange: 0.2 }), CALL)).toEqual(CALL);
    expect(after(spotWith(FACING_BET, { ...short, eRange: 0.199 }), CALL)).toEqual(FOLD);
    expect(after(spotWith(FACING_BET, { need: 0.45, eRange: 0.04 }), CALL)).toEqual(CALL);
  });

  it('rules 1–4 never touch a bet or raise, and leave a sound action alone', () => {
    const raiseTo: PlayerAction = { type: 'raise', to: 1200 };
    const nuts = spotWith(FACING_BET, { p: 1, eRange: 1 });
    expect(guardrails(nuts, raiseTo).action).toBe(raiseTo);
    const hopeless = spotWith(FACING_BET, { facing: 'allin', need: 0.45, eRange: 0 });
    expect(guardrails(hopeless, raiseTo)).toEqual({ action: raiseTo, fired: [], trace: [] });
    const fine = spotWith(FACING_BET);
    for (const a of [FOLD, CALL, raiseTo]) expect(guardrails(fine, a).action).toBe(a);
    const free = spotWith(NOTHING_TO_CALL, { p: 1 });
    expect(guardrails(free, CHECK).action).toBe(CHECK);
  });
});

describe('snapToLegal (rule 5)', () => {
  const facing = { legal: FACING_BET, sb: 50, streetBet: 0 };
  const open = { legal: NOTHING_TO_CALL, sb: 50, streetBet: 0 };

  it('keeps a legal action as the same object, odd amounts included', () => {
    for (const a of [
      FOLD,
      CALL,
      { type: 'raise', to: 800 },
      { type: 'raise', to: 1037 },
      { type: 'raise', to: 9700 },
    ] as PlayerAction[]) {
      expect(snapToLegal(facing, a)).toBe(a);
    }
    expect(snapToLegal(open, { type: 'bet', to: 333 })).toEqual({ type: 'bet', to: 333 });
  });

  it('rounds to a multiple of the small blind, then clamps to the bounds', () => {
    expect(snapToLegal(open, { type: 'bet', to: 1000 / 3 })).toEqual({ type: 'bet', to: 350 });
    expect(snapToLegal(open, { type: 'bet', to: 60 })).toEqual({ type: 'bet', to: 100 });
    expect(snapToLegal(open, { type: 'bet', to: 20000 })).toEqual({ type: 'bet', to: 9700 });
    expect(snapToLegal(open, { type: 'bet', to: Infinity })).toEqual({ type: 'bet', to: 9700 });
    expect(snapToLegal(open, { type: 'bet', to: NaN })).toEqual({ type: 'bet', to: 100 });
    expect(snapToLegal(facing, { type: 'raise', to: 812.5 })).toEqual({ type: 'raise', to: 800 });
    expect(snapToLegal(facing, { type: 'raise', to: 9701 })).toEqual({ type: 'raise', to: 9700 });
  });

  it('at or below the call level it is a call (a check with nothing to call), §8.7', () => {
    expect(snapToLegal(facing, { type: 'raise', to: 420 })).toEqual(CALL); // rounds to 400
    expect(snapToLegal(facing, { type: 'raise', to: 100 })).toEqual(CALL);
    expect(snapToLegal(facing, { type: 'raise', to: -Infinity })).toEqual(CALL);
    expect(snapToLegal(open, { type: 'bet', to: 20 })).toEqual(CHECK);
    expect(snapToLegal(open, { type: 'bet', to: 0 })).toEqual(CHECK);
    // The hero's own chips count: 200 in, facing 600 more → the call level is 800.
    const blind = { legal: { ...FACING_BET, toCall: 600 }, sb: 50, streetBet: 200 };
    expect(snapToLegal(blind, { type: 'raise', to: 790 })).toEqual(CALL);
  });

  it('a bet facing a bet is that raise; a raise with nothing to raise is that bet', () => {
    expect(snapToLegal(facing, { type: 'bet', to: 1200 })).toEqual({ type: 'raise', to: 1200 });
    expect(snapToLegal(facing, { type: 'bet', to: 500 })).toEqual({ type: 'raise', to: 800 });
    expect(snapToLegal(open, { type: 'raise', to: 300 })).toEqual({ type: 'bet', to: 300 });
  });

  it('with no bet or raise allowed it is the call or the check', () => {
    const noRaise = { legal: { ...FACING_BET, raise: null }, sb: 50, streetBet: 0 };
    expect(snapToLegal(noRaise, { type: 'raise', to: 5000 })).toEqual(CALL);
    const noBet = { legal: { ...NOTHING_TO_CALL, bet: null }, sb: 50, streetBet: 0 };
    expect(snapToLegal(noBet, { type: 'bet', to: 300 })).toEqual(CHECK);
  });

  it('check ↔ call is the same button; a fold is left to rule 1; junk becomes passive', () => {
    expect(snapToLegal(facing, CHECK)).toEqual(CALL);
    expect(snapToLegal(open, CALL)).toEqual(CHECK);
    expect(snapToLegal(open, FOLD)).toBe(FOLD);
    const junk = { type: 'allin' } as unknown as PlayerAction;
    expect(snapToLegal(facing, junk)).toEqual(CALL);
    expect(snapToLegal(open, junk)).toEqual(CHECK);
    expect(isLegalAction(FACING_BET, junk)).toBe(false);
    const noAmount = { type: 'raise' } as unknown as PlayerAction;
    expect(isLegalAction(FACING_BET, noAmount)).toBe(false);
    expect(snapToLegal(facing, noAmount)).toEqual({ type: 'raise', to: 800 });
  });
});
