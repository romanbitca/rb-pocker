/**
 * PLAN §8.9 EV model: the formulas against numbers computed by hand (the §0.3 short call
 * included: need 25%, not 8%), then the model on spots played through the real engine. Bet EVs
 * are checked in closed form where `E_called` is exactly 1 (the hero holds a royal flush on the
 * river), so `EV = FE·pot + (1 − FE)·(R·pot′ − inv)` can be written out.
 */
import { describe, expect, it } from 'vitest';
import {
  actionEV,
  candidateActions,
  candidateEVs,
  candidateKey,
  confidence,
  continueFraction,
  continuingWeights,
  evBetOrRaise,
  evCall,
  evCheck,
  evFold,
  evModel,
  foldEquity,
  mdf,
  readContinueFraction,
  seatStickiness,
  type EvSpot,
} from '../../src/brain/ev.ts';
import { emptySeatStats } from '../../src/brain/opponentStats.ts';
import { coachSeed, features } from '../../src/brain/features.ts';
import { isLegalAction } from '../../src/brain/guardrails.ts';
import { COMBOS } from '../../src/brain/ranges.ts';
import type { Features } from '../../src/brain/types.ts';
import type { Observation, PlayerAction, SeatStats } from '../../src/engine/types.ts';
import { bet, call, check, raise } from '../engine/play.ts';
import { COACH_LIKE, observeSpot, playSpot, type ExtrasSpec, type SpotSpec } from './fixtures.ts';

const FOLD: PlayerAction = { type: 'fold' };
const CHECK: PlayerAction = { type: 'check' };
const CALL: PlayerAction = { type: 'call' };
const HU = [10000, 10000];
const SIX = [10000, 10000, 10000, 10000, 10000, 10000];

describe('§8.9 formulas, by hand', () => {
  it('EV(fold) = 0 and EV(check) = E·R·pot', () => {
    expect(evFold()).toBe(0);
    expect(evCheck(0.4, 0.85, 600)).toBeCloseTo(204, 10);
  });

  it('EV(call) = E·R·(winPot + toCall) − toCall + implied', () => {
    expect(evCall(0.4, 0.9, 600, 200)).toBeCloseTo(88, 10); // 0.36 × 800 − 200
    expect(evCall(0.2, 0.85, 600, 200, 150)).toBeCloseTo(86, 10); // 136 − 200 + 150
    expect(evCall(0.25, 1, 600, 200)).toBeCloseTo(0, 10); // E = need = 200 / 800: break-even
  });

  it('the §0.3 short call (50 to call, the villain bet 500 more): need 25%, not 8%', () => {
    // winPot = 50 + min(550, 100) = 150, so a call wins 200 for 50.
    expect(evCall(0.25, 1, 150, 50)).toBeCloseTo(0, 12);
    expect(evCall(0.2, 1, 150, 50)).toBeCloseTo(-10, 12);
    // Against the whole pot of 600 the same 20% would look like +80 chips (8% needed): wrong.
    expect(evCall(0.2, 1, 600, 50)).toBeCloseTo(80, 12);
  });

  it('MDF, the continue fraction (clamped to 0.15–0.95) and multiway fold equity', () => {
    expect(mdf(100, 50)).toBeCloseTo(2 / 3, 12);
    expect(continueFraction(100, 50, 1)).toBeCloseTo(2 / 3, 12);
    expect(continueFraction(100, 50, 1.4)).toBeCloseTo(14 / 15, 12);
    expect(continueFraction(100, 50, 2)).toBe(0.95);
    expect(continueFraction(100, 1000, 0.8)).toBe(0.15);
    expect(foldEquity([0.6])).toBeCloseTo(0.4, 12);
    // Two opponents: Π (1 − c_i / √2) = 0.57574 × 0.64645 = 0.37218.
    expect(foldEquity([0.6, 0.5])).toBeCloseTo(0.372183, 6);
    expect(foldEquity([])).toBe(1);
  });

  it('EV(bet or raise) = FE·pot + (1 − FE)·(E_called·R·pot′ − inv)', () => {
    // Bet 50 into 100: MDF 2/3 → FE 1/3; if called, pot′ = 200 and E_called = 0.5.
    const bet50 = { pot: 100, heroIn: 50, callIn: 50, FE: 1 / 3, eCalled: 0.5, R: 1 };
    expect(evBetOrRaise(bet50)).toBeCloseTo(200 / 3, 10);
    // Raise to 300 over a bet of 100 into 300 (pot 400): inv 300, the villain adds 200, pot′ 900,
    // MDF 4/7 → FE 3/7, E_called 0.6: 3/7 × 400 + 4/7 × (540 − 300) = 2160/7.
    const FE = 1 - continueFraction(400, 300, 1);
    expect(FE).toBeCloseTo(3 / 7, 12);
    const raise300 = { pot: 400, heroIn: 300, callIn: 200, FE, eCalled: 0.6, R: 1 };
    expect(evBetOrRaise(raise300)).toBeCloseTo(2160 / 7, 10);
  });

  it('the top c of a weighted range: c of its weight, strongest first, the edge combo in part', () => {
    const w = new Float64Array(COMBOS);
    w[0] = 0.5;
    w[1] = 1;
    w[2] = 1;
    const cut = continuingWeights(w, [2, 0, 1], 0.6); // total 2.5: keep 1.5
    expect([cut[2], cut[0], cut[1]]).toEqual([1, 0.5, 0]);
    expect([...continuingWeights(w, [2, 0, 1], 1).slice(0, 3)]).toEqual([0.5, 1, 1]);
  });

  it('confidence: Close within 3% of the pot, Clear above 10%, a lone candidate Clear', () => {
    expect(confidence([10, 9.5, 0], 100)).toBe('close');
    expect(confidence([0, 10, 7], 100)).toBe('close'); // a gap of exactly 3%
    expect(confidence([20, 10], 100)).toBe('normal'); // exactly 10% is not more than 10%
    expect(confidence([21, -5, 10], 100)).toBe('clear');
    expect(confidence([5], 100)).toBe('clear');
  });
});

// ── The model on played spots ──────────────────────────────────────────────────────────────────

interface Model {
  obs: Observation;
  f: Features;
  spot: EvSpot;
}

/** The coach's features for the seat to act, and an EV spot with R, implied and stickiness. */
function modelAt(
  spec: SpotSpec,
  opts: { R?: number; implied?: number; stickiness?: number; extras?: ExtrasSpec } = {},
): Model {
  const h = playSpot(spec);
  const obs = observeSpot(h, h.toAct as number, opts.extras);
  const f = features(obs, COACH_LIKE, coachSeed(obs));
  const spot: EvSpot = { obs, f, R: opts.R ?? 1, implied: opts.implied ?? 0, seed: coachSeed(obs) };
  const s = opts.stickiness;
  return { obs, f, spot: s === undefined ? spot : { ...spot, stickiness: () => s } };
}

/** The §0.3 example: 50 each in (pot 100), the villain bets 500 more, the hero has 50 left. */
const SHORT_CALL: SpotSpec = {
  stacks: [100, 1100],
  button: 0,
  bb: 2,
  inputs: [raise(0, 50), call(1), check(1), check(0), check(1), check(0), bet(1, 500)],
};

/** A royal flush (A♠K♠ on Q♠J♠T♠4♦2♣) for seat 0, 600 in the pot, checked to the hero. */
function royal(stacks = HU, villainBets = false): SpotSpec {
  const river = villainBets ? [bet(1, 600)] : [check(1)];
  return {
    stacks,
    button: 0,
    holes: { 0: 'As Ks' },
    board: 'Qs Js Ts 4d 2c',
    inputs: [raise(0, 300), call(1), check(1), check(0), check(1), check(0), ...river],
  };
}

describe('§8.9 EV model on spots played through the engine', () => {
  it('the §0.3 short call: EV = eRange × 200 − 50, and 25% breaks even', () => {
    const { f, spot } = modelAt(SHORT_CALL, { R: 0.8, implied: 30 });
    expect(f).toMatchObject({ pot: 600, toCall: 50, winPot: 150 });
    expect(f.need).toBeCloseTo(0.25, 12);
    // An all-in call ends the hero's betting: R = 1 and no implied odds, whatever the policy says.
    expect(actionEV(spot, CALL)).toBeCloseTo(f.eRange * 200 - 50, 10);
    expect(actionEV({ ...spot, f: { ...f, eRange: 0.25 } }, CALL)).toBeCloseTo(0, 12);
    expect(actionEV({ ...spot, f: { ...f, eRange: 0.2 } }, CALL)).toBeCloseTo(-10, 12);
    expect(candidateEVs(spot).map((c) => c.key)).toEqual(['fold', 'call']);
  });

  it('a call with play left uses the policy’s R and implied odds (E9: A♥K♥ on Q♥7♥2♣)', () => {
    const spec: SpotSpec = {
      stacks: HU,
      button: 0,
      holes: { 0: 'Ah Kh' },
      board: 'Qh 7h 2c',
      inputs: [raise(0, 300), call(1), bet(1, 200)],
    };
    const { f, spot } = modelAt(spec, { R: 0.9, implied: 50 });
    expect(f).toMatchObject({ pot: 800, toCall: 200, winPot: 800 });
    expect(actionEV(spot, CALL)).toBeCloseTo(f.eRange * 0.9 * 1000 - 200 + 50, 10);
    expect(actionEV(spot, FOLD)).toBe(0);
    expect(actionEV(spot, CALL)).toBeGreaterThan(0); // E9: never fold
  });

  it('bets with the nuts in closed form: EV = (1 − c)·pot + c·(R·(pot + 2T) − T)', () => {
    const { f, spot } = modelAt(royal(), { R: 0.5, stickiness: 1 });
    expect(f.eRange).toBe(1);
    expect(actionEV(spot, CHECK)).toBeCloseTo(0.5 * 600, 10); // E·R·pot
    // Half pot (T = 300): c = MDF = 600 / 900 = 2/3; R = 0.5 → 200 + 2/3 × (600 − 300) = 400.
    expect(actionEV(spot, { type: 'bet', to: 300 })).toBeCloseTo(400, 9);
    const full = { ...spot, R: 1 };
    expect(actionEV(full, { type: 'bet', to: 300 })).toBeCloseTo(800, 9); // pot + c·T
    // All-in (T = 9,700) ends the betting, so R = 1 even when the policy says 0.5:
    // c = clamp(600 / 10,300, 0.15, 0.95) = 0.15 → 600 + 0.15 × 9,700 = 2,055.
    expect(actionEV(spot, { type: 'bet', to: 9700 })).toBeCloseTo(2055, 9);
  });

  it('a bet is called only up to what the villain has; the rest comes back uncalled', () => {
    // The villain has 2,000 left on the river, the hero 9,700.
    const { spot } = modelAt(royal([10000, 2300]), { R: 1, stickiness: 1 });
    const shove = actionEV(spot, { type: 'bet', to: 9700 });
    // Matched 2,000: c = 600 / 2,600 → EV = 600 + c × 2,000 (not 600 + 0.15 × 9,700 = 2,055).
    expect(shove).toBeCloseTo(600 + (600 / 2600) * 2000, 9);
    expect(actionEV(spot, { type: 'bet', to: 2000 })).toBeCloseTo(shove, 9);
  });

  it('an all-in opponent cannot fold: FE = 0 and it keeps its whole range', () => {
    // Three-handed: seat 1 called all-in for 200 preflop; seat 2 checks the river to the hero.
    const spec: SpotSpec = {
      stacks: [10000, 200, 10000],
      button: 0,
      holes: { 0: 'As Ks' },
      board: 'Qs Js Ts 4d 2c',
      inputs: [raise(0, 300), call(1), call(2), check(2), check(0), check(2), check(0), check(2)],
    };
    const { f, obs, spot } = modelAt(spec, { R: 1, stickiness: 1 });
    expect(obs.allIn[1]).toBe(true);
    expect(f.pot).toBe(800);
    // FE = 0: EV = E_called·R·(pot + 2T) − T = pot + T with the nuts.
    expect(actionEV(spot, { type: 'bet', to: 400 })).toBeCloseTo(1200, 9);
  });

  it('E_called is against the continuing part only: lower than eRange, lower for bigger bets', () => {
    // Q♥J♦ with top pair on the river, checked to the hero (exact equity heads-up on the river).
    const spec: SpotSpec = {
      stacks: HU,
      button: 0,
      holes: { 0: 'Qh Jd' },
      board: 'Qs 9c 5d 3h 2s',
      inputs: [raise(0, 300), call(1), check(1), check(0), check(1), check(0), check(1)],
    };
    const { f, spot } = modelAt(spec, { R: 1, stickiness: 1 });
    const pot = f.pot;
    const eCalled = [200, 300, 450, 600, 1200].map((T) => {
      const c = continueFraction(pot, T, 1);
      const ev = actionEV(spot, { type: 'bet', to: T });
      // Solve EV = (1 − c)·pot + c·(E_called·(pot + 2T) − T) for E_called.
      return ((ev - (1 - c) * pot) / c + T) / (pot + 2 * T);
    });
    for (const e of eCalled) expect(e).toBeLessThan(f.eRange);
    for (let i = 1; i < eCalled.length; i++) {
      expect(eCalled[i] as number).toBeLessThanOrEqual((eCalled[i - 1] as number) + 1e-12);
    }
    expect(eCalled[0] as number).toBeGreaterThan(eCalled[eCalled.length - 1] as number);
  });

  it('Expert: c read from fold to c-bet, shrunk (k = 20) toward the model at a ½-pot c-bet (7.3)', () => {
    const seen = (folds: number, chances: number): SeatStats => ({
      ...emptySeatStats(),
      foldToCbet: [folds, chances],
    });
    // Nothing seen: the model's c against a ½-pot c-bet (MDF ⅔ × stickiness), clamped like c.
    expect(readContinueFraction(null, 1)).toBeCloseTo(2 / 3, 12);
    expect(readContinueFraction(null, 1.4)).toBeCloseTo((2 / 3) * 1.4, 12);
    expect(readContinueFraction(seen(0, 0), 0.1)).toBeCloseTo(0.15, 12);
    // Seen: est = (x + 20 · 1/3) / (n + 20), c = 1 − est; lots of evidence wins, clamped.
    expect(readContinueFraction(seen(10, 100), 1)).toBeCloseTo(1 - (10 + 20 / 3) / 120, 12);
    expect(readContinueFraction(seen(0, 1000), 1)).toBe(0.95);
    expect(readContinueFraction(seen(1000, 1000), 1)).toBe(0.15);
    // The nuts on the river (closed form, R = 1): a caller seen never to fold pays more often.
    const caller = { stats: [null, seen(0, 180)] };
    const { spot } = modelAt(royal(), { R: 1, stickiness: 1, extras: caller });
    const read = { ...spot, readsFolds: true };
    // c = 0.95 at every size: EV = 0.05·pot + 0.95·(pot + T); the model's c = MDF.
    for (const T of [300, 600]) {
      const c = 600 / (600 + T);
      expect(actionEV(spot, { type: 'bet', to: T })).toBeCloseTo((1 - c) * 600 + c * (600 + T), 9);
      expect(actionEV(read, { type: 'bet', to: T })).toBeCloseTo(0.05 * 600 + 0.95 * (600 + T), 9);
    }
    // Before the flop the model stands.
    const pre: SpotSpec = { stacks: HU, button: 0, holes: { 0: '7c 2d' }, inputs: [] };
    const p = modelAt(pre, { R: 0.9, stickiness: 1, extras: caller }).spot;
    const open = { type: 'raise', to: 250 } as const;
    expect(actionEV({ ...p, readsFolds: true }, open)).toBe(actionEV(p, open));
  });

  it('stickiness: the visible personality’s, else the mean of the seat level’s list (§9.1, §9.5)', () => {
    const h = playSpot({ stacks: [10000, 10000, 10000], button: 0, inputs: [] });
    const obs = observeSpot(h, 0, {
      labels: [null, 'station', null],
      levels: ['medium', 'easy', 'easy'],
    });
    expect(seatStickiness(obs, 1)).toBe(1.4); // visible Station (its level does not matter)
    expect(seatStickiness(obs, 2)).toBeCloseTo(10.1 / 8, 12); // hidden, Easy list
    expect(seatStickiness(obs, 0)).toBeCloseTo(9.3 / 8, 12); // hidden, Medium list
  });
});

describe('§8.9 candidates', () => {
  const keysAt = (spec: SpotSpec): string[] => {
    const h = playSpot(spec);
    return candidateActions(observeSpot(h, h.toAct as number)).map((c) => c.key);
  };

  it('preflop opens: 2.5, 3, 4 bb plus 1 bb per limper, and all-in', () => {
    expect(keysAt({ stacks: SIX, button: 0, inputs: [] })).toEqual([
      'fold',
      'call',
      'raise:250',
      'raise:300',
      'raise:400',
      'allin',
    ]);
    expect(keysAt({ stacks: SIX, button: 0, inputs: [call(3)] })).toEqual([
      'fold',
      'call',
      'raise:350',
      'raise:400',
      'raise:500',
      'allin',
    ]);
  });

  it('raises: the minimum, 2.5×, 3×, 4× the bet (snapped to the small blind) and all-in', () => {
    // An open to 250: the minimum re-raise is 400; 2.5 × 250 = 625 rounds to 650.
    expect(keysAt({ stacks: SIX, button: 0, inputs: [raise(3, 250)] })).toEqual([
      'fold',
      'call',
      'raise:400',
      'raise:650',
      'raise:750',
      'raise:1000',
      'allin',
    ]);
  });

  it('postflop bets: 1/3, 1/2, 2/3, 3/4 and 1 pot and all-in; never a fold when checking is free', () => {
    const spec = { stacks: HU, button: 0, inputs: [raise(0, 300), call(1), check(1)] };
    expect(keysAt(spec)).toEqual([
      'check',
      'bet:200',
      'bet:300',
      'bet:400',
      'bet:450',
      'bet:600',
      'allin',
    ]);
    // Pot 700: 233.3 → 250, 466.7 → 450, and 525 (a whole number) → 550: sizes are multiples of
    // the small blind (§8.7), not just whole numbers.
    const odd = { stacks: HU, button: 0, inputs: [raise(0, 350), call(1), check(1)] };
    expect(keysAt(odd)).toEqual([
      'check',
      'bet:250',
      'bet:350',
      'bet:450',
      'bet:550',
      'bet:700',
      'allin',
    ]);
  });

  it('duplicates go: a short stack has one all-in, and facing an all-in only fold and call', () => {
    // 900 behind facing a bet of 400 into 600: min 800, the rest snap to all-in (900).
    const short = { stacks: [10000, 1200], button: 0, inputs: [raise(0, 300), call(1), check(1)] };
    const h = playSpot({ ...short, inputs: [...short.inputs, bet(0, 400)] });
    const obs = observeSpot(h, 1);
    expect(candidateActions(obs).map((c) => c.key)).toEqual(['fold', 'call', 'raise:800', 'allin']);
    expect(keysAt(SHORT_CALL)).toEqual(['fold', 'call']);
  });

  it('every candidate is legal, keyed by candidateKey, with a finite EV (fold 0)', () => {
    const { obs, spot } = modelAt(royal(HU, true));
    const cands = candidateEVs(spot);
    expect(new Set(cands.map((c) => c.key)).size).toBe(cands.length);
    for (const c of cands) {
      expect(isLegalAction(obs.legal, c.action)).toBe(true);
      expect(candidateKey(obs.legal, c.action)).toBe(c.key);
      expect(Number.isFinite(c.ev)).toBe(true);
    }
    expect(cands.find((c) => c.key === 'fold')?.ev).toBe(0);
    // With the nuts facing a bet, every way to continue beats folding.
    for (const c of cands) if (c.key !== 'fold') expect(c.ev).toBeGreaterThan(0);
  });
});

describe('§8.9 determinism and hint/grade consistency', () => {
  const spec: SpotSpec = {
    stacks: [10000, 10000, 10000],
    button: 0,
    holes: { 0: '9h 8h' },
    board: 'Th 7c 2h',
    inputs: [raise(0, 300), call(1), call(2), check(1), check(2)],
  };

  it('the same spot gives the same EVs; each candidate’s EV is the EV of that action', () => {
    const { spot } = modelAt(spec, { R: 0.92, implied: 40 });
    const a = candidateEVs(spot);
    expect(candidateEVs(spot)).toEqual(a);
    const copy = JSON.parse(JSON.stringify(spot.obs)) as Observation;
    expect(candidateEVs({ ...spot, obs: copy })).toEqual(a);
    const model = evModel(spot);
    for (const c of a) expect(model.ev(c.action)).toBe(c.ev); // grading reads the hint's numbers
  });

  it('the hero’s own size is valued the same way; an illegal action is refused', () => {
    const { spot } = modelAt(spec);
    const own: PlayerAction = { type: 'bet', to: 437 };
    const ev = actionEV(spot, own);
    expect(Number.isFinite(ev)).toBe(true);
    expect(actionEV(spot, own)).toBe(ev);
    expect(() => actionEV(spot, FOLD)).toThrow(RangeError); // checking is free
    expect(() => actionEV(spot, { type: 'bet', to: 50 })).toThrow(RangeError); // below the minimum
  });
});
