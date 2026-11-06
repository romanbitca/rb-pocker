/**
 * The preflop policy (PLAN §8.3) and the push/fold rules (§8.4): every preflop and push/fold
 * golden spot of Appendix E (E1–E8, E18) and a test per rule. Spots are played through the real
 * engine (tests may run it; the brain never does) and observed with `observe()`; the policy gets
 * the coach's features (`COACH_LIKE`: 'reweight+stats', 4,000 trials).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { coachSeed, features } from '../../src/brain/features.ts';
import {
  COACH_PREFLOP_STYLE,
  preflopCallers,
  preflopPolicy,
  preflopRaises,
  preflopStyle,
  realisation,
} from '../../src/brain/preflopPolicy.ts';
import { pushOutcome, shoveVsRaise } from '../../src/brain/pushfold.ts';
import {
  callPct,
  inPushSet,
  pushOrderPct,
  pushPct,
  pushSetPct,
} from '../../src/brain/pushFoldData.ts';
import { rangeEquity, type RangeModel } from '../../src/brain/ranges.ts';
import { equityVsTopOfClass, rankPctOfClass } from '../../src/brain/rangesData.ts';
import type { PreflopDecision, PreflopStyle } from '../../src/brain/types.ts';
import { deriveSeed, rngFromSeed, type Seed128 } from '../../src/core/rng.ts';
import { classByName } from '../../src/data/rangesLayout.ts';
import { observe } from '../../src/engine/observe.ts';
import { step } from '../../src/engine/step.ts';
import type { EngineInput, HandState, Observation, PersonalityId } from '../../src/engine/types.ts';
import { cards } from '../helpers/cards.ts';
import { FC_SEED } from '../engine/helpers.ts';
import { call, fold, handArb, raise, randomInput } from '../engine/play.ts';
import { COACH_LIKE, extrasFor, observeSpot, playSpot, testProfile } from './fixtures.ts';

const SEED: Seed128 = '0000000000000000000000000000c0de';
const BB = 100;

interface Spot {
  players: number;
  /** Stack of every seat in big blinds (100 unless given), or one stack per seat. */
  bb?: number | number[];
  hero: number;
  hole: string;
  inputs?: EngineInput[];
  labels?: Record<number, PersonalityId>;
  style?: PreflopStyle;
}

/** Plays the spot (button 0: seat 1 SB, seat 2 BB, seat 3 first to act) and asks the policy. */
function ask(spot: Spot): { d: PreflopDecision; obs: Observation } {
  const stacks =
    typeof spot.bb === 'object'
      ? spot.bb.map((x) => x * BB)
      : new Array<number>(spot.players).fill((spot.bb ?? 100) * BB);
  const h = playSpot({
    stacks,
    button: 0,
    holes: { [spot.hero]: spot.hole },
    inputs: spot.inputs ?? [],
  });
  const labels = new Array<PersonalityId | null>(spot.players).fill(null);
  for (const [seat, id] of Object.entries(spot.labels ?? {})) labels[Number(seat)] = id;
  const obs = observeSpot(h, spot.hero, { labels });
  expect(obs.legal.seat).toBe(spot.hero);
  const f = features(obs, COACH_LIKE, SEED);
  const d = preflopPolicy(obs, f, spot.style === undefined ? {} : { style: spot.style });
  return { d, obs };
}

const code = (d: PreflopDecision): string => (d.trace[0] as { code: string }).code;
const raisedTo = (d: PreflopDecision): number => (d.action.type === 'raise' ? d.action.to : -1);
const folds = (...seats: number[]): EngineInput[] => seats.map(fold);
const rank = (name: string): number => rankPctOfClass(classByName(name));

describe('Appendix E golden spots (preflop and push/fold)', () => {
  it('E1: 6 players, 100 bb, first to act (k = 5) with A♠A♥: raise to 2.5 bb (OPEN_RANGE)', () => {
    const { d } = ask({ players: 6, hero: 3, hole: 'As Ah' });
    expect(d.kind).toBe('raise');
    expect(Math.abs(raisedTo(d) - 2.5 * BB)).toBeLessThanOrEqual(0.5 * BB);
    expect(code(d)).toBe('OPEN_RANGE');
    expect(d.trace[0]?.data).toMatchObject({ hand: 'AA', behind: 5, openPct: 17, to: 250, bb: BB });
  });

  it('E2: 9 players, 100 bb, first to act (k = 8) with 7♣2♦: fold (FOLD_RANGE)', () => {
    const { d } = ask({ players: 9, hero: 3, hole: '7c 2d' });
    expect(d.action).toEqual({ type: 'fold' });
    expect(code(d)).toBe('FOLD_RANGE');
    expect(d.trace[0]?.data).toMatchObject({ hand: '72o', behind: 8 });
  });

  it('E3: 6 players, 100 bb, folded to the button (k = 2) with K♠10♦: raise to 2.5 bb', () => {
    const { d } = ask({ players: 6, hero: 0, hole: 'Ks Td', inputs: folds(3, 4, 5) });
    expect(d.kind).toBe('raise');
    expect(Math.abs(raisedTo(d) - 2.5 * BB)).toBeLessThanOrEqual(0.5 * BB);
    expect(code(d)).toBe('OPEN_RANGE');
  });

  it('E4: 3 players, the button folds, the small blind limps, the big blind has 7♣2♦: check', () => {
    const { d } = ask({ players: 3, hero: 2, hole: '7c 2d', inputs: [fold(0), call(1)] });
    expect(d.action).toEqual({ type: 'check' });
    expect(code(d)).toBe('CHECK_FREE');
  });

  it('E5: 9 players, 100 bb, folded to the small blind with 9♣4♦: fold, never complete', () => {
    const { d } = ask({ players: 9, hero: 1, hole: '9c 4d', inputs: folds(3, 4, 5, 6, 7, 8, 0) });
    expect(d.action).toEqual({ type: 'fold' });
    expect(code(d)).toBe('FOLD_RANGE');
  });

  it('E6: 6 players, 100 bb, a TAG opens 2.5 bb from the cutoff, the button has 6♣6♦: call (SET_MINING)', () => {
    const { d } = ask({
      players: 6,
      hero: 0,
      hole: '6c 6d',
      inputs: [fold(3), fold(4), raise(5, 250)],
      labels: { 5: 'tag' },
    });
    expect(d.action).toEqual({ type: 'call' });
    expect(code(d)).toBe('SET_MINING');
    expect(d.trace[0]?.data).toMatchObject({ hand: '66' });
    expect(d.trace[0]?.data.V).toBeCloseTo(27, 9);
  });

  it('E7: 6 players, the button (k = 2), 10 bb effective, unopened, A♣5♦: all-in (PUSH_FOLD)', () => {
    const { d, obs } = ask({ players: 6, bb: 10, hero: 0, hole: 'Ac 5d', inputs: folds(3, 4, 5) });
    expect(d.kind).toBe('allin');
    expect(d.action).toEqual({ type: 'raise', to: obs.legal.raise?.max });
    expect(code(d)).toBe('PUSH_FOLD');
    expect(d.trace[0]?.data).toMatchObject({ action: 'allin', S: 10, behind: 2, hand: 'A5o' });
  });

  it('E8: 6 players, 100 bb, UTG goes all-in, the big blind has A♥A♦: call', () => {
    const { d } = ask({
      players: 6,
      hero: 2,
      hole: 'Ah Ad',
      inputs: [raise(3, 100 * BB), fold(4), fold(5), fold(0), fold(1)],
    });
    expect(d.action).toEqual({ type: 'call' });
    expect(code(d)).toBe('CALL_ALLIN');
  });

  it('E18: 9 players, 8 bb effective, first to act (k = 8) with 9♠4♣: fold (PUSH_FOLD)', () => {
    const { d } = ask({ players: 9, bb: 8, hero: 3, hole: '9s 4c' });
    expect(d.action).toEqual({ type: 'fold' });
    expect(code(d)).toBe('PUSH_FOLD');
    expect(d.trace[0]?.data).toMatchObject({ action: 'fold', S: 8, behind: 8, hand: '94o' });
  });
});

describe('unopened pot (§8.3)', () => {
  it('raises exactly the hands with rankPct ≤ openPct(k): 6-max UTG opens 17%', () => {
    expect(rank('KTo')).toBeLessThanOrEqual(17);
    expect(rank('A5o')).toBeGreaterThan(17);
    expect(ask({ players: 6, hero: 3, hole: 'Kc Td' }).d.kind).toBe('raise');
    expect(ask({ players: 6, hero: 3, hole: 'Ac 5d' }).d.kind).toBe('fold');
    // On the button (43%) the same A5o opens.
    expect(ask({ players: 6, hero: 0, hole: 'Ac 5d', inputs: folds(3, 4, 5) }).d.kind).toBe(
      'raise',
    );
  });

  it('the small blind (3+ handed) opens to 3 bb; heads-up the button opens 80% to 2.5 bb', () => {
    const sb = ask({ players: 6, hero: 1, hole: 'Ac Kd', inputs: folds(3, 4, 5, 0) }).d;
    expect(raisedTo(sb)).toBe(3 * BB);
    expect(rank('K2o')).toBeLessThanOrEqual(80);
    const hu = ask({ players: 2, hero: 0, hole: 'Kc 2d' }).d;
    expect(raisedTo(hu)).toBe(2.5 * BB);
  });

  it('opens all-in when 2.5 bb is at least 35% of the chips (here 13 bb: 19%, so not)', () => {
    const d = ask({ players: 6, bb: 13, hero: 3, hole: 'As Ah' }).d;
    expect(d.kind).toBe('raise');
    expect(raisedTo(d)).toBe(2.5 * BB);
  });
});

describe('limpers only (§8.3)', () => {
  // UTG limps; the cutoff (k = 3, openPct 27) isolates the top 0.7 × 27 = 18.9%.
  const limp = [call(3), fold(4)];

  it('isolates with rankPct ≤ 0.7 × openPct(k), to 2.5 bb + 1 bb per limper', () => {
    const d = ask({ players: 6, hero: 5, hole: 'Kc Td', inputs: limp }).d;
    expect(code(d)).toBe('ISOLATE');
    expect(raisedTo(d)).toBe(3.5 * BB);
    expect(d.trace[0]?.data).toMatchObject({ limpers: 1, to: 350 });
  });

  it('folds the rest: never an over-limp', () => {
    expect(rank('A5o')).toBeGreaterThan(18.9);
    const d = ask({ players: 6, hero: 5, hole: 'Ac 5d', inputs: limp }).d;
    expect(d.action).toEqual({ type: 'fold' });
    expect(code(d)).toBe('FOLD_RANGE');
  });

  it('the big blind isolates only below 15% (heads-up 30%), else it checks', () => {
    const twoLimps = [call(3), fold(4), fold(5), fold(0), call(1)];
    const strong = ask({ players: 6, hero: 2, hole: 'Ac Kd', inputs: twoLimps }).d;
    expect(code(strong)).toBe('ISOLATE');
    expect(raisedTo(strong)).toBe(4.5 * BB);
    expect(rank('KTo')).toBeGreaterThan(15);
    const kto = ask({ players: 6, hero: 2, hole: 'Kc Td', inputs: twoLimps }).d;
    expect(kto.action).toEqual({ type: 'check' });
    expect(code(kto)).toBe('CHECK_FREE');
    // Heads-up the small blind limps: the big blind isolates up to 30% (KTo at 15% raises).
    const hu = ask({ players: 2, hero: 1, hole: 'Kc Td', inputs: [call(0)] }).d;
    expect(code(hu)).toBe('ISOLATE');
  });
});

describe('opening ranges by position (§8.3 ranking, audit #5)', () => {
  // 6-max (button 0): UTG seat 3 (k = 5, 17%), HJ 4 (21%), CO 5 (27%), BTN 0 (43%), SB 1 (40%).
  const SEATS = {
    UTG: { hero: 3, inputs: [] as EngineInput[] },
    HJ: { hero: 4, inputs: folds(3) },
    CO: { hero: 5, inputs: folds(3, 4) },
    BTN: { hero: 0, inputs: folds(3, 4, 5) },
    SB: { hero: 1, inputs: folds(3, 4, 5, 0) },
  } as const;
  type Seat = keyof typeof SEATS;
  const opens = (hole: string, seat: Seat): boolean =>
    ask({ players: 6, ...SEATS[seat], hole }).d.kind === 'raise';
  const where = (hole: string): Seat[] =>
    (Object.keys(SEATS) as Seat[]).filter((seat) => opens(hole, seat));

  it('opens the premiums everywhere and never 7-2 offsuit', () => {
    for (const hole of ['As Ah', 'Ks Kh', 'As Ks']) expect(where(hole), hole).toHaveLength(5);
    expect(where('7c 2d')).toEqual([]);
    const utg9 = (hole: string) => ask({ players: 9, hero: 3, hole }).d.kind;
    expect([utg9('As Ah'), utg9('Ks Kh'), utg9('As Ks'), utg9('7c 2d')]).toEqual([
      'raise',
      'raise',
      'raise',
      'fold',
    ]);
  });

  it('opens the small pairs from late position: 22–33 from the button and the small blind, 44 from the cutoff, 55 from the hijack', () => {
    // The audit: at 100 bb the coach folded 22/33 on the button and in the small blind, 44 in the
    // cutoff and 55 in the hijack (22 ranked at 54%, 33 at 45%).
    expect(where('2c 2d')).toEqual(['BTN', 'SB']);
    expect(where('3c 3d')).toEqual(['BTN', 'SB']);
    expect(where('4c 4d')).toEqual(['CO', 'BTN', 'SB']);
    expect(where('5c 5d')).toEqual(['HJ', 'CO', 'BTN', 'SB']);
    expect(where('6c 6d')).toHaveLength(5);
    // Nine-handed under the gun (11%): 77 and up.
    expect(ask({ players: 9, hero: 3, hole: '7c 7d' }).d.kind).toBe('raise');
    expect(ask({ players: 9, hero: 3, hole: '6c 6d' }).d.kind).toBe('fold');
  });

  it('opens the suited connectors late: 76s from the button and the small blind, 65s from the button', () => {
    expect(where('7h 6h')).toEqual(['BTN', 'SB']);
    expect(where('6h 5h')).toEqual(['BTN']);
    expect(where('Th 9h')).toEqual(['CO', 'BTN', 'SB']);
  });
});

describe('facing one raise (§8.3)', () => {
  // The cutoff opens 2.5 bb with a visible TAG label: V = openPct(3) × 1 = 27%.
  const coOpen = [fold(3), fold(4), raise(5, 250)];
  const tag = { 5: 'tag' } as const;

  it('3-bets for value with E ≥ 0.58: 3 × the open in position, 4 × out of position', () => {
    expect(equityVsTopOfClass(classByName('QQ'), 27)).toBeGreaterThanOrEqual(0.58);
    const ip = ask({ players: 6, hero: 0, hole: 'Qc Qd', inputs: coOpen, labels: tag }).d;
    expect(code(ip)).toBe('THREE_BET_VALUE');
    expect(raisedTo(ip)).toBe(750);
    const oop = ask({
      players: 6,
      hero: 1,
      hole: 'Qc Qd',
      inputs: [...coOpen, fold(0)],
      labels: tag,
    }).d;
    expect(raisedTo(oop)).toBe(1000);
  });

  it('+1 × the open per caller already in; E is then a weighted Monte Carlo over their ranges', () => {
    const inputs = [fold(3), raise(4, 250), call(5)];
    const { d, obs } = ask({ players: 6, hero: 0, hole: 'Ac Ad', inputs });
    expect(code(d)).toBe('THREE_BET_VALUE');
    expect(raisedTo(d)).toBe((3 + 1) * 250);
    const f = features(obs, COACH_LIKE, SEED);
    const E = rangeEquity({
      hole: obs.hole,
      board: [],
      ranges: f.ranges.filter((r) => r.seat === 4 || r.seat === 5).map((r) => r.weights),
      trials: 1500,
      seed: deriveSeed(coachSeed(obs), 'preflop'),
    });
    expect(d.trace[0]?.data.E).toBe(E);
  });

  it('calls with EV(call) > 0 inside min(50, 1.5·V); a small pair calls for a set', () => {
    expect(equityVsTopOfClass(classByName('88'), 27)).toBeLessThan(0.58);
    const eights = ask({ players: 6, hero: 0, hole: '8c 8d', inputs: coOpen, labels: tag }).d;
    expect(eights.action).toEqual({ type: 'call' });
    expect(code(eights)).toBe('SET_MINING');
    const ak = ask({ players: 6, hero: 0, hole: 'Ac Kd', inputs: coOpen, labels: tag }).d;
    expect(code(ak)).toBe('THREE_BET_VALUE'); // AKo: 0.634
    const kq = ask({ players: 6, hero: 0, hole: 'Kc Qd', inputs: coOpen, labels: tag }).d;
    expect(kq.action).toEqual({ type: 'call' });
    expect(code(kq)).toBe('CALL_PREFLOP');
  });

  it('folds outside min(50, 1.5·V) even with EV(call) > 0, except in the big blind', () => {
    // A TAG opens under the gun (V = 17%, cap 25.5%); 30 bb deep, where the set alone does not
    // pay for the call (the 15–20× rule), the button folds 2♣2♦ (33%) and the big blind calls.
    const utgOpen = [raise(3, 250), fold(4), fold(5)];
    const utgTag = { 3: 'tag' } as const;
    expect(rank('22')).toBeGreaterThan(1.5 * 17);
    const btn = ask({
      players: 6,
      bb: 30,
      hero: 0,
      hole: '2c 2d',
      inputs: utgOpen,
      labels: utgTag,
    }).d;
    expect(btn.action).toEqual({ type: 'fold' });
    expect(code(btn)).toBe('FOLD_VS_RAISE');
    expect(btn.trace[0]?.data.evCall as number).toBeGreaterThan(0);
    const bb = ask({
      players: 6,
      bb: 30,
      hero: 2,
      hole: '2c 2d',
      inputs: [...utgOpen, fold(0), fold(1)],
      labels: utgTag,
    }).d;
    expect(bb.action).toEqual({ type: 'call' });
    expect(code(bb)).toBe('SET_MINING');
  });

  it('set-mines outside the cap when the set alone pays: about 15 × the call behind (audit #6)', () => {
    // The audit: 22 never called a raise to set-mine. 100 bb deep against the same UTG open the
    // button calls 2♣2♦: 0.118 × (pot + call) + 0.118 × 0.4 × 97.5 bb ≥ the 2.5 bb call.
    const utgOpen = [raise(3, 250), fold(4), fold(5)];
    const deep = ask({
      players: 6,
      hero: 0,
      hole: '2c 2d',
      inputs: utgOpen,
      labels: { 3: 'tag' },
    }).d;
    expect(deep.action).toEqual({ type: 'call' });
    expect(code(deep)).toBe('SET_MINING');
    expect(deep.trace[0]?.data.V).toBeCloseTo(17, 9);
    // The edge: a 2.5 bb call into 4 bb pays from about 37.5 bb (0.118 × 6.5 + 0.0472 × 34.5 =
    // 2.40 < 2.5 at 37 bb; 2.54 at 40 bb).
    const at = (bb: number) =>
      ask({ players: 6, bb, hero: 0, hole: '2c 2d', inputs: utgOpen, labels: { 3: 'tag' } }).d;
    expect(at(37).action).toEqual({ type: 'fold' });
    expect(at(40).action).toEqual({ type: 'call' });
    // And against the cutoff's open, inside the cap now: 22 is in the top 33%, the cap 40.5%.
    const co = ask({ players: 6, hero: 0, hole: '2c 2d', inputs: coOpen, labels: tag }).d;
    expect(co.action).toEqual({ type: 'call' });
    expect(code(co)).toBe('SET_MINING');
  });

  it('folds when EV(call) ≤ 0 (FOLD_VS_RAISE)', () => {
    const d = ask({ players: 6, hero: 0, hole: '7c 2d', inputs: coOpen, labels: tag }).d;
    expect(d.action).toEqual({ type: 'fold' });
    expect(code(d)).toBe('FOLD_VS_RAISE');
    expect(d.trace[0]?.data.evCall as number).toBeLessThan(0);
  });

  it('data.callers: the callers already in that E counts besides the raiser (§8.3, §8.10)', () => {
    // The owner's spot: UTG opens, the hijack has K♠7♣; four players act after it, none counts.
    const alone = ask({ players: 6, hero: 4, hole: 'Ks 7c', inputs: [raise(3, 250)] }).d;
    expect(code(alone)).toBe('FOLD_VS_RAISE');
    expect(alone.trace[0]?.data).toMatchObject({ callers: 0 });
    // The hijack called: E counts the raiser and that caller, not the blinds still to act.
    const inputs = [raise(3, 250), call(4), fold(5)];
    const one = ask({ players: 6, hero: 0, hole: 'Ks 7c', inputs });
    expect(one.d.trace[0]?.data).toMatchObject({ callers: 1 });
    expect(preflopCallers(one.obs, features(one.obs, COACH_LIKE, SEED))).toBe(1);
    // Unopened there is no raise and no caller.
    const open = ask({ players: 6, hero: 3, hole: 'As Ah' });
    expect(preflopCallers(open.obs, features(open.obs, COACH_LIKE, SEED))).toBe(0);
  });

  it('shoves instead of a 3-bet that would be ≥ 35% of the chips (20 bb: 7.5 bb is 37.5%)', () => {
    const d = ask({ players: 6, bb: 20, hero: 0, hole: 'Qc Qd', inputs: coOpen, labels: tag }).d;
    expect(d.kind).toBe('allin');
    expect(code(d)).toBe('THREE_BET_VALUE');
  });

  it('reads the raiser by its looseness: an unknown Medium seat opens wider than a TAG', () => {
    const known = ask({ players: 6, hero: 0, hole: 'Kc Qd', inputs: coOpen, labels: tag }).d;
    const unknown = ask({ players: 6, hero: 0, hole: 'Kc Qd', inputs: coOpen }).d;
    expect(unknown.trace[0]?.data.V as number).toBeGreaterThan(known.trace[0]?.data.V as number);
  });

  it("Easy's 'random' model reads the raiser from the opening table, as 'static' does (§9.2)", () => {
    const h = playSpot({
      stacks: new Array<number>(6).fill(100 * BB),
      button: 0,
      holes: { 0: 'Kc Qd' },
      inputs: coOpen,
    });
    const obs = observeSpot(h, 0);
    const V = (model: RangeModel): unknown => {
      const f = features(obs, testProfile(model, 200), SEED);
      return preflopPolicy(obs, f, { rangeModel: model, seed: SEED }).trace[0]?.data.V;
    };
    // The cutoff's openPct(3) = 27%, not "any two cards" (chunk 5.11).
    expect(V('random')).toBeCloseTo(27, 9);
    expect(V('random')).toBe(V('static'));
  });
});

describe('facing a 3-bet and a 4-bet (§8.3)', () => {
  // The hero opens from the cutoff (27%); the button 3-bets to 7.5 bb: V = max(3, 0.25 × 27).
  const threeBet = [fold(3), fold(4), raise(5, 250), raise(0, 750), fold(1), fold(2)];

  it('V = max(3, 0.25 × the hero’s open range); 4-bets with E ≥ 0.58 to 2.3 × the 3-bet', () => {
    const d = ask({ players: 6, hero: 5, hole: 'Qc Qd', inputs: threeBet }).d;
    expect(d.trace[0]?.data.V).toBeCloseTo(6.75, 9);
    expect(code(d)).toBe('FOUR_BET_VALUE');
    expect(raisedTo(d)).toBe(1750); // 2.3 × 750 = 1,725, rounded to the small blind
  });

  it('calls with EV(call) > 0 inside 1.5·V, folds the rest', () => {
    const jj = ask({ players: 6, hero: 5, hole: 'Jc Jd', inputs: threeBet }).d;
    expect(jj.action).toEqual({ type: 'call' });
    expect(code(jj)).toBe('CALL_PREFLOP');
    const kj = ask({ players: 6, hero: 5, hole: 'Kc Jd', inputs: threeBet }).d;
    expect(kj.action).toEqual({ type: 'fold' });
    expect(code(kj)).toBe('FOLD_VS_RAISE');
  });

  it('facing a 4-bet: V = 2.5%, all-in with E ≥ 0.50, call with EV(call) > 0, else fold', () => {
    const fourBet = [
      fold(3),
      fold(4),
      raise(5, 250),
      raise(0, 750),
      fold(1),
      fold(2),
      raise(5, 1750),
    ];
    const kk = ask({ players: 6, hero: 0, hole: 'Kc Kd', inputs: fourBet }).d;
    expect(kk.trace[0]?.data.V).toBe(2.5);
    expect(kk.kind).toBe('allin');
    expect(code(kk)).toBe('FOUR_BET_VALUE');
    // QQ has 49.6% against the 2.5% range (its own column, audit #2): a call, not all-in.
    const qq = ask({ players: 6, hero: 0, hole: 'Qc Qd', inputs: fourBet }).d;
    expect(qq.trace[0]?.data.E as number).toBeLessThan(0.5);
    expect(qq.action).toEqual({ type: 'call' });
    const aks = ask({ players: 6, hero: 0, hole: 'Ac Kc', inputs: fourBet }).d;
    expect(aks.action).toEqual({ type: 'call' });
    const junk = ask({ players: 6, hero: 0, hole: '7c 2d', inputs: fourBet }).d;
    expect(junk.action).toEqual({ type: 'fold' });
  });

  it('JJ folds to a 100 bb 5-bet shove: 36% against the 2.5% range, 41% needed (audit #2, P25)', () => {
    // UTG opens, the button 3-bets, UTG 4-bets to 17.5 bb, the button shoves 100 bb.
    const fiveBet = [
      raise(3, 250),
      fold(4),
      fold(5),
      raise(0, 750),
      fold(1),
      fold(2),
      raise(3, 1750),
      raise(0, 100 * BB),
    ];
    const jj = ask({ players: 6, hero: 3, hole: 'Jc Jd', inputs: fiveBet }).d;
    expect(jj.action).toEqual({ type: 'fold' });
    expect(code(jj)).toBe('FOLD_ALLIN');
    const data = jj.trace[0]?.data as { E: number; need: number; V: number };
    expect(data.V).toBe(2.5);
    expect(data.E).toBeLessThan(0.38);
    expect(data.need).toBeGreaterThan(0.4);
    const aks = ask({ players: 6, hero: 3, hole: 'Ac Kc', inputs: fiveBet }).d;
    expect(aks.action).toEqual({ type: 'call' });
  });
});

describe('facing an all-in, deep (§8.3 with the §8.4 rule)', () => {
  it('calls when E ≥ need against the shover’s range, folds otherwise (FOLD_ALLIN)', () => {
    const shove = [raise(3, 100 * BB), fold(4), fold(5), fold(0), fold(1)];
    const d = ask({ players: 6, hero: 2, hole: '7c 2d', inputs: shove }).d;
    expect(d.action).toEqual({ type: 'fold' });
    expect(code(d)).toBe('FOLD_ALLIN');
    const data = d.trace[0]?.data as { E: number; need: number; callers: number };
    expect(data.E).toBeLessThan(data.need);
    expect(data.callers).toBe(0); // against the shover alone
  });
});

describe('push or fold with effBB ≤ 12 (§8.4)', () => {
  it('unopened: shoves the solver’s push set; with limpers only the top 0.8 × of it', () => {
    // On the button with 10 bb, A2o is in the set (its place in the push order is inside the
    // set's share) but not inside 0.8 × that share.
    const a2o = classByName('A2o');
    expect(inPushSet(2, 10, a2o)).toBe(true);
    expect(pushOrderPct(2, 10, a2o)).toBeLessThanOrEqual(pushSetPct(2, 10));
    expect(pushOrderPct(2, 10, a2o)).toBeGreaterThan(0.8 * pushSetPct(2, 10));
    const alone = ask({ players: 6, bb: 10, hero: 0, hole: 'Ac 2d', inputs: folds(3, 4, 5) }).d;
    expect(alone.kind).toBe('allin');
    const limped = ask({
      players: 6,
      bb: 10,
      hero: 0,
      hole: 'Ac 2d',
      inputs: [call(3), fold(4), fold(5)],
    }).d;
    expect(limped.action).toEqual({ type: 'fold' });
    expect(code(limped)).toBe('PUSH_FOLD');
    const strong = ask({
      players: 6,
      bb: 10,
      hero: 0,
      hole: 'Ac Kd',
      inputs: [call(3), fold(4), fold(5)],
    }).d;
    expect(strong.kind).toBe('allin');
  });

  it('the big blind facing limpers checks a hand it does not shove', () => {
    const d = ask({
      players: 6,
      bb: 10,
      hero: 2,
      hole: '7c 2d',
      inputs: [call(3), fold(4), fold(5), fold(0), call(1)],
    }).d;
    expect(d.action).toEqual({ type: 'check' });
    expect(code(d)).toBe('CHECK_FREE');
  });

  it('the push set is the solver’s, not the top pushPct% of the general ranking (audit #3)', () => {
    // The audit: with 10 bb on the button the coach folded 22–44 and A2o–A3o, which the app's own
    // solver shoves every time, and shoved K9o and J9o, which it folds; heads-up it folded K2o.
    const btn = (hole: string) =>
      ask({ players: 6, bb: 10, hero: 0, hole, inputs: folds(3, 4, 5) }).d;
    for (const hole of ['2c 2d', '3c 3d', '4c 4d', 'Ac 2d', 'Ac 3d']) {
      expect(btn(hole).kind, hole).toBe('allin');
    }
    for (const hole of ['Kc 9d', 'Jc 9d']) expect(btn(hole).action, hole).toEqual({ type: 'fold' });
    const hu = ask({ players: 2, bb: 10, hero: 0, hole: 'Kc 2d' }).d;
    expect(hu.kind).toBe('allin');
    expect(code(hu)).toBe('PUSH_FOLD');
    // The set holds about pushPct of the combos (the classes the solver mixes sit on its edge).
    for (const [k, S] of [
      [1, 10],
      [2, 10],
      [3, 10],
      [5, 10],
      [8, 12],
    ] as const) {
      expect(Math.abs(pushSetPct(k, S) - pushPct(k, S)), `${k} ${S}`).toBeLessThan(3);
    }
  });

  it('a looser bot shoves the set and the next hands of the general ranking (§9.4)', () => {
    // K9o is outside the button's 10 bb set; a 1.3 × threshold reaches it, 0.5 × drops A2o.
    const loose: PreflopStyle = { equityNoise: 0, thresholdFactor: 1.3, positionAwareness: 1 };
    const tight: PreflopStyle = { equityNoise: 0, thresholdFactor: 0.5, positionAwareness: 1 };
    const spot = { players: 6, bb: 10, hero: 0, inputs: folds(3, 4, 5) };
    expect(ask({ ...spot, hole: 'Kc 9d', style: loose }).d.kind).toBe('allin');
    expect(ask({ ...spot, hole: 'Ac 2d', style: tight }).d.action).toEqual({ type: 'fold' });
    expect(ask({ ...spot, hole: 'Ac Kd', style: tight }).d.kind).toBe('allin');
  });

  it('PUSH_FOLD says how often the players behind fold and the equity when called', () => {
    const d = ask({ players: 6, bb: 10, hero: 0, hole: 'Ac 5d', inputs: folds(3, 4, 5) }).d;
    const want = pushOutcome(classByName('A5o'), 2, 10, pushSetPct(2, 10));
    expect(d.trace[0]?.data).toMatchObject({ Pfold: want.pfold, E: want.eCalled });
    expect(want.pfold).toBeGreaterThan(0.3);
    expect(want.pfold).toBeLessThan(0.9);
  });

  it('facing a raise: only all-in or fold, by EV(shove) = Pfold·pot + (1 − Pfold)·(E·finalPot − risk)', () => {
    // 10 bb each; the cutoff opens to 2.5 bb (kV = 3, unknown Medium seat), the button decides.
    const inputs = [fold(3), fold(4), raise(5, 250)];
    const { d, obs } = ask({ players: 6, bb: 10, hero: 0, hole: 'Ac Qd', inputs });
    expect(d.kind).toBe('allin');
    expect(code(d)).toBe('PUSH_FOLD');
    const V = d.trace[0]?.data.V as number;
    const verdict = shoveVsRaise({
      cls: classByName('AQo'),
      effBB: 10,
      V,
      pot: obs.pot,
      risk: 1000,
      finalPot: obs.pot + 1000 + 750,
      equityNoise: 0,
    });
    expect(d.trace[0]?.data.ev).toBeCloseTo(verdict.ev, 9);
    const share = Math.min(1, callPct(10) / V);
    expect(d.trace[0]?.data.Pfold).toBeCloseTo(1 - share, 12);
    const junk = ask({ players: 6, bb: 10, hero: 0, hole: '7c 2d', inputs }).d;
    expect(junk.action).toEqual({ type: 'fold' });
    expect(code(junk)).toBe('PUSH_FOLD');
  });

  it('facing an all-in: calls when E against pushPct(kV, S) is at least the price', () => {
    // A TAG under the gun shoves 10 bb (kV = 5): the big blind calls with AKo, folds 7-2.
    const shove = [raise(3, 10 * BB), fold(4), fold(5), fold(0), fold(1)];
    const tag = { 3: 'tag' } as const;
    const ak = ask({ players: 6, bb: 10, hero: 2, hole: 'Ac Kd', inputs: shove, labels: tag }).d;
    expect(ak.action).toEqual({ type: 'call' });
    expect(code(ak)).toBe('CALL_ALLIN');
    expect(ak.trace[0]?.data.V).toBeCloseTo(pushPct(5, 10), 9);
    const junk = ask({ players: 6, bb: 10, hero: 2, hole: '7c 2d', inputs: shove, labels: tag }).d;
    expect(junk.action).toEqual({ type: 'fold' });
    expect(code(junk)).toBe('FOLD_ALLIN');
  });
});

describe('profile styles (§9.2, §9.4)', () => {
  it('preflopStyle: threshold factor = looseness × (1 + U), noise as drawn', () => {
    expect(
      preflopStyle({ looseness: 1.45, positionAwareness: 0.5 }, { noise: 0.03, jitter: -0.1 }),
    ).toEqual({ equityNoise: 0.03, thresholdFactor: 1.45 * 0.9, positionAwareness: 0.5 });
    expect(COACH_PREFLOP_STYLE).toEqual({
      equityNoise: 0,
      thresholdFactor: 1,
      positionAwareness: 1,
    });
  });

  it('a tighter factor folds a borderline open; no position awareness opens 21% everywhere', () => {
    const tight: PreflopStyle = { equityNoise: 0, thresholdFactor: 0.5, positionAwareness: 1 };
    expect(ask({ players: 6, hero: 3, hole: 'Kc Td', style: tight }).d.kind).toBe('fold');
    const blind: PreflopStyle = { equityNoise: 0, thresholdFactor: 1, positionAwareness: 0 };
    const btn = { players: 6, hero: 0, inputs: folds(3, 4, 5), style: blind };
    expect(ask({ ...btn, hole: 'Kc Td' }).d.kind).toBe('raise');
    expect(ask({ ...btn, hole: 'Ac 5d' }).d.kind).toBe('fold');
  });

  it('equity noise moves the value threshold: 77 3-bets the cutoff with +0.1', () => {
    const lucky: PreflopStyle = { equityNoise: 0.1, thresholdFactor: 1, positionAwareness: 1 };
    const spot = {
      players: 6,
      hero: 0,
      hole: '7c 7d',
      inputs: [fold(3), fold(4), raise(5, 250)],
      labels: { 5: 'tag' as const },
    };
    expect(code(ask(spot).d)).toBe('SET_MINING');
    expect(code(ask({ ...spot, style: lucky }).d)).toBe('THREE_BET_VALUE');
  });
});

describe('helpers', () => {
  it('realisation: 0.95 in position, 0.80 out, × 0.9 for offsuit hands gapped by 3 or more', () => {
    expect(realisation('IP', cards('Ac Kd') as [number, number])).toBe(0.95);
    expect(realisation('OOP', cards('Kc Td') as [number, number])).toBeCloseTo(0.72, 12);
    expect(realisation('IP', cards('Kc Ts') as [number, number])).toBeCloseTo(0.855, 12);
    expect(realisation('IP', cards('Kc Tc') as [number, number])).toBe(0.95);
    expect(realisation('OOP', cards('9c 9d') as [number, number])).toBe(0.8);
  });

  it('preflopRaises: levels, all-in flags and the players behind each raise', () => {
    const h = playSpot({
      stacks: new Array<number>(6).fill(10000),
      button: 0,
      inputs: [fold(3), raise(4, 250), fold(5), raise(0, 10000)],
    });
    expect(preflopRaises(observe(h, 1, extrasFor(6)))).toEqual([
      { seat: 4, level: 1, to: 250, allIn: false, k: 4 },
      { seat: 0, level: 2, to: 10000, allIn: true, k: 2 },
    ]);
  });

  it('refuses an observation after the flop', () => {
    const h = playSpot({
      stacks: [10000, 10000],
      button: 0,
      inputs: [call(0), { kind: 'act', seat: 1, action: { type: 'check' } }],
    });
    const obs = observe(h, 1, extrasFor(2));
    expect(() => preflopPolicy(obs, features(obs, COACH_LIKE, SEED))).toThrow(RangeError);
  });
});

describe('every recommendation is legal (C2) and deterministic (C3)', () => {
  // The policy reads the ranges, not eRange: a few trials keep the features cheap.
  const profile = testProfile('reweight+stats', 20, 'coach');
  it('at random preflop decision points of random hands', { timeout: 60_000 }, () => {
    let checked = 0;
    fc.assert(
      fc.property(handArb, ({ h, policySeed }) => {
        const rng = rngFromSeed(policySeed);
        let s: HandState = h;
        for (let i = 0; i < 40 && s.phase === 'betting' && s.street === 'preflop'; i++) {
          const seat = s.toAct as number;
          const obs = observe(s, seat, extrasFor(s.seats.length));
          const f = features(obs, profile, SEED);
          const d = preflopPolicy(obs, f);
          expect(() => step(s, { kind: 'act', seat, action: d.action })).not.toThrow();
          expect(preflopPolicy(JSON.parse(JSON.stringify(obs)) as Observation, f)).toEqual(d);
          expect(d.trace.length).toBeGreaterThan(0);
          checked++;
          s = step(s, randomInput(s, rng));
        }
      }),
      { seed: FC_SEED, numRuns: 150 },
    );
    expect(checked).toBeGreaterThan(150);
  });
});
