/**
 * PLAN §8.6, one rule at a time: combos, preflop reads and priors (soft edge, trap bands,
 * looseness), the EHS proxy (HS percentile + draw bonus), Loki re-weighting (μ/σ table, the
 * check rule, the AF shift) and the range-weighted equity (exact heads-up river, Monte Carlo with
 * card removal and the collision fallback).
 */
import { describe, expect, it } from 'vitest';
import { equity, runoutEquity } from '../../src/analysis/equity.ts';
import { emptySeatStats } from '../../src/brain/opponentStats.ts';
import {
  actionFactor,
  afShift,
  betMu,
  COMBO_CLASS,
  COMBO_HI,
  COMBO_LO,
  comboIndex,
  COMBOS,
  handStrengths,
  lokiFactor,
  opponentRanges,
  preflopReads,
  priorClassWeights,
  rangeEquity,
  softEdge,
  type OpponentRange,
} from '../../src/brain/ranges.ts';
import { openPct } from '../../src/brain/tunables.ts';
import { classCombos, classOf, type Card } from '../../src/core/cards.ts';
import type { Seed128 } from '../../src/core/rng.ts';
import type { Observation, PublicAction } from '../../src/engine/types.ts';
import { score7 } from '../../src/eval/evaluate.ts';
import { card, cards, hole } from '../helpers/cards.ts';
import { bet, call, check, fold, raise } from '../engine/play.ts';
import { TABLES, observeSpot, playSpot } from './fixtures.ts';

const SEED: Seed128 = '5eed0000000000000000000000000052';
const HUNDRED_BB = [10000, 10000, 10000, 10000, 10000, 10000];

const combo = (text: string): number => {
  const [a, b] = hole(text);
  return comboIndex(a, b);
};
const rangeOf = (ranges: OpponentRange[], seat: number): OpponentRange =>
  ranges.find((r) => r.seat === seat) as OpponentRange;
const weightOfClass = (r: OpponentRange, cls: number, visible: readonly Card[]): number => {
  for (let i = 0; i < COMBOS; i++) {
    if (COMBO_CLASS[i] !== cls) continue;
    if (visible.includes(COMBO_LO[i] as Card) || visible.includes(COMBO_HI[i] as Card)) continue;
    return r.weights[i] as number;
  }
  throw new Error('every combo of the class is blocked');
};
const deadOf = (list: readonly Card[]): Uint8Array => {
  const dead = new Uint8Array(52);
  for (const c of list) dead[c] = 1;
  return dead;
};

describe('combos', () => {
  it('indexes all 1,326 two-card combos once, in either card order', () => {
    const seen = new Set<number>();
    for (let a = 0; a < 52; a++) {
      for (let b = a + 1; b < 52; b++) {
        const i = comboIndex(a, b);
        expect(comboIndex(b, a)).toBe(i);
        expect([COMBO_LO[i], COMBO_HI[i]]).toEqual([a, b]);
        expect(COMBO_CLASS[i]).toBe(classOf(a, b));
        seen.add(i);
      }
    }
    expect(seen.size).toBe(COMBOS);
    const perClass = new Array<number>(169).fill(0);
    for (let i = 0; i < COMBOS; i++) {
      const cls = COMBO_CLASS[i] as number;
      perClass[cls] = (perClass[cls] as number) + 1;
    }
    perClass.forEach((n, cls) => expect(n).toBe(classCombos(cls)));
    expect(() => comboIndex(3, 3)).toThrow(RangeError);
    expect(() => comboIndex(-1, 3)).toThrow(RangeError);
    expect(() => comboIndex(3, 52)).toThrow(RangeError);
  });
});

describe('preflop prior (§8.6 table)', () => {
  // 6 seats, button 0: SB 1, BB 2, then UTG 3, MP 4, CO 5 act first.
  it('an open raise from UTG reads as openPct(k = 5); players yet to act read as 100%', () => {
    const h = playSpot({ stacks: HUNDRED_BB, button: 0, inputs: [raise(3, 250)] });
    const obs = observeSpot(h, 4);
    const reads = preflopReads(obs);
    expect(reads[3]).toEqual({ kind: 'open', k: 5, pushBB: null });
    expect(reads[4]).toEqual({ kind: 'none', k: 0, pushBB: null });
    expect(reads[2]).toEqual({ kind: 'none', k: 0, pushBB: null });
    const ranges = opponentRanges(obs, 'static', TABLES);
    expect(ranges.map((r) => r.seat)).toEqual([0, 1, 2, 3, 5]);
    expect(rangeOf(ranges, 3)).toMatchObject({ prior: 'open', topPct: openPct(5, false) });
    expect(rangeOf(ranges, 5)).toMatchObject({ prior: 'none', topPct: 100 });
  });

  it('limps, a call of a raise, a 3-bet and a 4-bet (read by the LAST raise)', () => {
    const h = playSpot({
      stacks: HUNDRED_BB,
      button: 0,
      inputs: [call(3), raise(4, 400), call(5), raise(0, 1500), fold(1), fold(2), raise(3, 4000)],
    });
    const reads = preflopReads(observeSpot(h, 4));
    expect(reads[3]?.kind).toBe('fourBet'); // limped, then made the third raise
    expect(reads[4]).toEqual({ kind: 'open', k: 4, pushBB: null }); // iso-raise = first raise
    expect(reads[5]?.kind).toBe('call');
    expect(reads[0]?.kind).toBe('threeBet');
    const limps = preflopReads(
      observeSpot(playSpot({ stacks: HUNDRED_BB, button: 0, inputs: [call(3), call(4)] }), 5),
    );
    expect(limps[3]?.kind).toBe('limp');
    expect(limps[4]?.kind).toBe('limp');
  });

  it('an all-in raise of at most 15 bb is a push: pushPct(k, S); a bigger all-in is not', () => {
    const short = [10000, 10000, 10000, 1200, 10000, 10000];
    const h = playSpot({ stacks: short, button: 0, inputs: [raise(3, 1200)] });
    const obs = observeSpot(h, 4);
    expect(preflopReads(obs)[3]).toEqual({ kind: 'push', k: 5, pushBB: 12 });
    const r = rangeOf(opponentRanges(obs, 'static', TABLES), 3);
    expect(r.topPct).toBeCloseTo(TABLES.pushPct(5, 12), 12);

    const deep = [10000, 10000, 10000, 2000, 10000, 10000];
    const d = playSpot({ stacks: deep, button: 0, inputs: [raise(3, 2000)] });
    expect(preflopReads(observeSpot(d, 4))[3]).toEqual({ kind: 'open', k: 5, pushBB: null });
  });

  it('heads-up the button opens 80%', () => {
    const h = playSpot({ stacks: [10000, 10000], button: 0, inputs: [raise(0, 250)] });
    const r = rangeOf(opponentRanges(observeSpot(h, 1), 'static', TABLES), 0);
    expect(r).toMatchObject({ prior: 'open', topPct: 80 });
  });

  it('soft edge: 1 up to X, linear to 0.01 at 1.25·X, 0.01 beyond', () => {
    expect(softEdge(10, 20)).toBe(1);
    expect(softEdge(20, 20)).toBe(1);
    expect(softEdge(22.5, 20)).toBeCloseTo(0.505, 12);
    expect(softEdge(25, 20)).toBeCloseTo(0.01, 12);
    expect(softEdge(90, 20)).toBe(0.01);
    const w = priorClassWeights(20, 0, TABLES);
    for (let cls = 0; cls < 169; cls++) {
      expect(w[cls]).toBeCloseTo(softEdge(TABLES.rankPctOfClass(cls), 20), 12);
    }
  });

  it('call a raise: top 25%, its top 4% at 0.3; the big blind check: 100%, its top 15% at 0.3', () => {
    const h = playSpot({ stacks: HUNDRED_BB, button: 0, inputs: [raise(3, 250), call(4)] });
    const obs = observeSpot(h, 5);
    const caller = rangeOf(opponentRanges(obs, 'static', TABLES), 4);
    expect(caller).toMatchObject({ prior: 'call', topPct: 25 });
    const aa = classOf(card('As'), card('Ah'));
    const k72 = classOf(card('7c'), card('2d'));
    expect(TABLES.rankPctOfClass(aa)).toBeLessThanOrEqual(4);
    expect(weightOfClass(caller, aa, obs.hole)).toBeCloseTo(0.3, 12);
    expect(weightOfClass(caller, k72, obs.hole)).toBeCloseTo(0.01, 12);

    const w = playSpot({
      stacks: [10000, 10000, 10000],
      button: 0,
      inputs: [call(0), call(1), check(2)],
    });
    expect(w.street).toBe('flop');
    const flopObs = observeSpot(w, 0);
    const bb = rangeOf(opponentRanges(flopObs, 'static', TABLES), 2);
    expect(bb).toMatchObject({ prior: 'bbCheck', topPct: 100 });
    expect(weightOfClass(bb, aa, [...flopObs.hole, ...flopObs.board])).toBeCloseTo(0.3, 12);
    expect(weightOfClass(bb, k72, [...flopObs.hole, ...flopObs.board])).toBe(1);
    expect(rangeOf(opponentRanges(flopObs, 'static', TABLES), 1)).toMatchObject({
      prior: 'limp',
      topPct: 50,
    });
  });

  it('looseness from seat stats widens every range (reweight+stats only; cap 100%)', () => {
    const h = playSpot({ stacks: HUNDRED_BB, button: 0, inputs: [raise(3, 250), call(4)] });
    const labels = [null, null, null, 'station', 'maniac', null] as const;
    const obs = observeSpot(h, 5, { labels: [...labels] });
    const withStats = opponentRanges(obs, 'reweight+stats', TABLES);
    const station = rangeOf(withStats, 3);
    expect(station.looseness).toBeCloseTo(0.45 / 0.22, 12);
    expect(station.topPct).toBeCloseTo(17 * (0.45 / 0.22), 9);
    expect(rangeOf(withStats, 4).topPct).toBe(Math.min(100, 25 * (0.6 / 0.22)));
    // Generic priors ignore the labels.
    expect(rangeOf(opponentRanges(obs, 'reweight', TABLES), 3)).toMatchObject({
      looseness: 1,
      topPct: 17,
    });
    // 60 of 60 hands played: looseness hits the 3.0 cap.
    const loose = { ...emptySeatStats(), hands: 60, vpip: [60, 60] as [number, number] };
    const obs2 = observeSpot(h, 5, { stats: [null, null, null, loose, null, null] });
    expect(rangeOf(opponentRanges(obs2, 'reweight+stats', TABLES), 3).looseness).toBe(3);
  });

  it('random model: every unblocked combo alike; a face-up hand is known exactly', () => {
    const h = playSpot({ stacks: HUNDRED_BB, button: 0, inputs: [raise(3, 250)] });
    const obs = observeSpot(h, 4);
    const r = rangeOf(opponentRanges(obs, 'random', TABLES), 3);
    expect(r.prior).toBe('random');
    for (let i = 0; i < COMBOS; i++) {
      const blocked =
        obs.hole.includes(COMBO_LO[i] as Card) || obs.hole.includes(COMBO_HI[i] as Card);
      expect(r.weights[i]).toBe(blocked ? 0 : 1);
    }
    const shown: Observation = {
      ...obs,
      revealedHoles: obs.revealedHoles.map((x, s) => (s === 3 ? hole('Kd Qd') : x)),
    };
    const known = rangeOf(opponentRanges(shown, 'reweight+stats', TABLES), 3);
    expect(known.prior).toBe('known');
    expect(known.weights.reduce((a, b) => a + b, 0)).toBe(1);
    expect(known.weights[combo('Kd Qd')]).toBe(1);
    // A face-up hand is a visible card for every other range.
    const other = rangeOf(opponentRanges(shown, 'random', TABLES), 5);
    expect(other.weights[combo('Kd 2c')]).toBe(0);
  });
});

describe('EHS proxy (§8.6)', () => {
  /** Naive HS percentile: (below + (equal − 1) / 2) / (N − 1) over the population. */
  function naiveHs(board: Card[], dead: Card[]): Map<number, number> {
    const scores = new Map<number, number>();
    for (let i = 0; i < COMBOS; i++) {
      const a = COMBO_LO[i] as Card;
      const b = COMBO_HI[i] as Card;
      if ([...board, ...dead].some((c) => c === a || c === b)) continue;
      scores.set(i, score7([a, b, ...board], 2 + board.length));
    }
    const all = [...scores.values()];
    const n = all.length;
    const hs = new Map<number, number>();
    for (const [i, s] of scores) {
      const below = all.filter((x) => x < s).length;
      const equal = all.filter((x) => x === s).length;
      hs.set(i, (below + (equal - 1) / 2) / (n - 1));
    }
    return hs;
  }

  it('on the river EHS = HS: the tie-aware percentile, mean exactly 0.5; blocked combos −1', () => {
    const board = cards('Ah Kd 9c 2s Jd');
    const dead = cards('5h 4h');
    const ehs = handStrengths(board, deadOf(dead));
    const naive = naiveHs(board, dead);
    let sum = 0;
    for (let i = 0; i < COMBOS; i++) {
      const expected = naive.get(i);
      if (expected === undefined) expect(ehs[i]).toBe(-1);
      else {
        expect(ehs[i]).toBeCloseTo(expected, 12);
        sum += expected;
      }
    }
    expect(naive.size).toBe(990); // C(45, 2) on the river
    expect(sum / naive.size).toBeCloseTo(0.5, 12);
  });

  const bonus = (boardText: string, holeText: string): number => {
    const board = cards(boardText);
    const ehs = handStrengths(board, deadOf([]));
    const hs = naiveHs(board, []).get(combo(holeText)) as number;
    return (ehs[combo(holeText)] as number) - hs;
  };

  it('draw bonus: flush +0.15, open-ended or double gutshot +0.12, gutshot +0.06, added up', () => {
    expect(bonus('Qh 7h 2c', 'Ah Kh')).toBeCloseTo(0.15, 12);
    expect(bonus('9c 8d 2s', 'Jh Td')).toBeCloseTo(0.12, 12);
    expect(bonus('9c 8d 2s', '7h 6d')).toBeCloseTo(0.12, 12);
    expect(bonus('9c 7d 5s', 'Jh 8h')).toBeCloseTo(0.12, 12); // double gutshot
    expect(bonus('9c 8d 2s', 'Th 6h')).toBeCloseTo(0.06, 12);
    expect(bonus('9h 8h 2s', 'Jh Th')).toBeCloseTo(0.27, 12);
    expect(bonus('9c 8d 2s', 'Ah Kh')).toBeCloseTo(0, 12);
  });

  it('draw bonus is halved on the turn, gone on the river, and never for a made hand', () => {
    expect(bonus('9h 8h 2s 3c', 'Jh Th')).toBeCloseTo(0.135, 12);
    expect(bonus('9h 8h 2s 3c 3d', 'Jh Th')).toBeCloseTo(0, 12);
    expect(bonus('9h 8h 2h', 'Ah Kh')).toBeCloseTo(0, 12); // a made flush
    expect(bonus('9c 8d 7s', 'Jh Th')).toBeCloseTo(0, 12); // a made straight
    // Four to a straight on the board: completing it does not use a hole card.
    expect(bonus('9c 8d 7s 6h', '2c 3d')).toBeCloseTo(0, 12);
  });
});

describe('Loki re-weighting (§8.6)', () => {
  it('factor = clamp((EHS − μ + σ) / 2σ, 0.01, 1); bet μ = 0.5 + 0.3·min(B/pot, 1)', () => {
    expect(lokiFactor(0.9, 0.6, 0.2)).toBe(1);
    expect(lokiFactor(0.6, 0.6, 0.2)).toBeCloseTo(0.5, 12);
    expect(lokiFactor(0.1, 0.6, 0.2)).toBe(0.01);
    expect(betMu(200, 600, 0)).toBeCloseTo(0.6, 12);
    expect(betMu(1200, 600, 0)).toBeCloseTo(0.8, 12);
    expect(betMu(100, 0, 0)).toBeCloseTo(0.8, 12);
    expect(betMu(300, 600, -0.08)).toBeCloseTo(0.57, 12);
  });

  it('observed aggression moves only the bet/raise μ: AF > 3 → −0.08, AF < 1 → +0.08', () => {
    expect(afShift(null)).toBe(0);
    expect(afShift(5)).toBe(-0.08);
    expect(afShift(0.7)).toBe(0.08);
    expect(afShift(2.5)).toBe(0);
    const a = (type: PublicAction['type'], amountIn = 0, potBefore = 600): PublicAction => ({
      seat: 1,
      street: 'flop',
      type,
      to: null,
      amountIn,
      allIn: false,
      full: false,
      potBefore,
    });
    expect(actionFactor(a('bet', 200), 0.6, 0.08)).toBeCloseTo(lokiFactor(0.6, 0.68, 0.2), 12);
    expect(actionFactor(a('raise', 600), 0.7, 0)).toBeCloseTo(lokiFactor(0.7, 0.8, 0.2), 12);
    expect(actionFactor(a('call'), 0.3, 0.08)).toBeCloseTo(lokiFactor(0.3, 0.4, 0.2), 12);
    expect(actionFactor(a('check'), 0.81, 0)).toBe(0.6);
    expect(actionFactor(a('check'), 0.8, 0)).toBe(1);
    expect(actionFactor(a('fold'), 0.2, 0)).toBe(1);
  });

  /** Heads-up: the button (seat 0) opens, the BB (hero, seat 1) calls; flop Qh 7h 2c. */
  const flopSpot = (villainFlop: ReturnType<typeof bet>[], heroFirst = check(1)) =>
    playSpot({
      stacks: [10000, 10000],
      button: 0,
      holes: { 1: '5c 4c' },
      board: 'Qh 7h 2c 9s 3d',
      inputs: [raise(0, 300), call(1), heroFirst, ...villainFlop],
    });

  /** The expected re-weighted weights: prior × factor per action, scaled to max 1. */
  function expectFactors(obs: Observation, factors: (ehs: number) => number): void {
    const prior = rangeOf(opponentRanges(obs, 'static', TABLES), 0).weights;
    const after = rangeOf(opponentRanges(obs, 'reweight', TABLES), 0).weights;
    const ehs = handStrengths(obs.board.slice(0, 3), deadOf(obs.hole));
    const raw = prior.map((w, i) => (w > 0 ? w * factors(ehs[i] as number) : 0));
    const max = Math.max(...raw);
    for (let i = 0; i < COMBOS; i++) expect(after[i]).toBeCloseTo((raw[i] as number) / max, 12);
  }

  it('a flop bet of 1/3 pot multiplies each combo by the μ = 0.6 ramp', () => {
    const h = flopSpot([bet(0, 200)]);
    const obs = observeSpot(h, 1);
    expectFactors(obs, (e) => lokiFactor(e, 0.6, 0.2));
    // Static ranges do not narrow after the flop.
    expect(rangeOf(opponentRanges(obs, 'static', TABLES), 0).weights).toEqual(
      rangeOf(opponentRanges(observeSpot(flopSpot([]), 1), 'static', TABLES), 0).weights,
    );
  });

  it('a check keeps every combo except EHS > 0.8, which gets 0.6', () => {
    const h = flopSpot([check(0)]);
    expect(h.street).toBe('turn');
    expectFactors(observeSpot(h, 1), (e) => (e > 0.8 ? 0.6 : 1));
  });

  it('a call after the hero bets uses μ = 0.4', () => {
    const h = flopSpot([call(0)], bet(1, 200));
    expectFactors(observeSpot(h, 1), (e) => lokiFactor(e, 0.4, 0.2));
  });

  it('reweight+stats: a visible Maniac (AF 5) bets with more hands than a visible Rock', () => {
    const h = flopSpot([bet(0, 600)]);
    const maniac = rangeOf(
      opponentRanges(observeSpot(h, 1, { labels: [null, null] }), 'reweight', TABLES),
      0,
    );
    const withLabel = (label: 'maniac' | 'station') =>
      rangeOf(
        opponentRanges(observeSpot(h, 1, { labels: [label, null] }), 'reweight+stats', TABLES),
        0,
      );
    const m = withLabel('maniac');
    const s = withLabel('station');
    expect(m.af).toBeCloseTo(5, 9);
    expect(s.af).toBeCloseTo(0.7, 9);
    const mass = (w: Float64Array) => w.reduce((a, b) => a + b, 0);
    expect(mass(m.weights) / m.topPct).toBeGreaterThan(mass(s.weights) / s.topPct);
    expect(maniac.af).toBeNull();
  });
});

describe('range-weighted equity (§8.2 eRange, §8.6 sampling)', () => {
  const uniform = (): Float64Array => new Float64Array(COMBOS).fill(1);
  const only = (...texts: string[]): Float64Array => {
    const w = new Float64Array(COMBOS);
    for (const t of texts) w[combo(t)] = 1;
    return w;
  };

  it('heads-up river is exact: the weighted mean of win (1), tie (½) and loss (0)', () => {
    const hero = hole('Ah Kh');
    const board = cards('Qh 7h 2c 3d 9s');
    // Ace-high: loses to QQ (a set) and 44 (weight 2), beats 6h5h (queen-high), ties AcKc.
    const w = only('Qc Qd', '6h 5h', 'Ac Kc');
    w[combo('4c 4d')] = 2;
    const exact = rangeEquity({ hole: hero, board, ranges: [w], trials: 1, seed: SEED });
    expect(exact).toBeCloseTo((0 + 1 + 0.5 + 2 * 0) / 5, 12);
    const beats = only('6c 5c', 'Jc Tc');
    expect(rangeEquity({ hole: hero, board, ranges: [beats], trials: 1, seed: SEED })).toBe(1);
  });

  it('against uniform ranges it matches the HUD equity (exact heads-up turn, 2-way flop)', () => {
    const hero = hole('Ah Kh');
    const turn = cards('Qh 7h 2c 3d');
    const exact = equity({ hero, board: turn, nOpp: 1 }).equity;
    const mc = rangeEquity({
      hole: hero,
      board: turn,
      ranges: [uniform()],
      trials: 4000,
      seed: SEED,
    });
    expect(Math.abs(mc - exact)).toBeLessThan(0.025);
    const flop = cards('Qh 7h 2c');
    const hud = equity({ hero, board: flop, nOpp: 2 }).equity;
    const two = rangeEquity({
      hole: hero,
      board: flop,
      ranges: [uniform(), uniform()],
      trials: 4000,
      seed: SEED,
    });
    expect(Math.abs(two - hud)).toBeLessThan(0.03);
  });

  it('card removal: weight on combos with a known card is ignored', () => {
    const hero = hole('Ah Kh');
    const board = cards('Qh 7h 2c');
    const w = only('Jc Jd');
    for (let c = 0; c < 52; c++) if (c !== card('Ah')) w[comboIndex(card('Ah'), c)] = 1000;
    w[combo('Qh 3s')] = 1000; // uses a board card
    const mc = rangeEquity({ hole: hero, board, ranges: [w], trials: 4000, seed: SEED });
    const exact = runoutEquity({ hands: [hero, hole('Jc Jd')], board })[0]?.equity as number;
    expect(Math.abs(mc - exact)).toBeLessThan(0.025);
  });

  it('20 collisions fall back to two free cards drawn uniformly (no card is dealt twice)', () => {
    const hero = hole('2c 3d');
    const same = only('As Ah');
    const e = rangeEquity({ hole: hero, board: [], ranges: [same, same], trials: 500, seed: SEED });
    expect(e).toBeGreaterThanOrEqual(0);
    expect(e).toBeLessThan(0.2);
    // Against AA and a random hand, 32o wins rarely; the same seed gives the same number.
    expect(
      rangeEquity({ hole: hero, board: [], ranges: [same, same], trials: 500, seed: SEED }),
    ).toBe(e);
  });

  it('is deterministic per seed, 1 with no opponent, and rejects impossible input', () => {
    const hero = hole('Ah Kh');
    const board = cards('Qh 7h 2c');
    const req = { hole: hero, board, ranges: [uniform()], trials: 300, seed: SEED };
    expect(rangeEquity(req)).toBe(rangeEquity({ ...req }));
    expect(rangeEquity({ ...req, seed: 'ffffffffffffffffffffffffffffffff' })).not.toBe(
      rangeEquity(req),
    );
    expect(rangeEquity({ ...req, ranges: [] })).toBe(1);
    expect(() => rangeEquity({ ...req, trials: 0 })).toThrow(RangeError);
    expect(() => rangeEquity({ ...req, ranges: [only('Ah Qs')] })).toThrow(RangeError);
    const river = cards('Qh 7h 2c 3d 9s');
    expect(() => rangeEquity({ ...req, board: river, ranges: [only('Ah Qs')] })).toThrow(
      RangeError,
    );
  });
});
