/**
 * The postflop policy (PLAN §8.5), one rule at a time, on synthetic decisions (real cards, chosen
 * numbers), plus the spot builder on observations of the real engine and the §9.4 hooks.
 */
import { describe, expect, it } from 'vitest';
import {
  callEV,
  handPercentile,
  impliedHitChance,
  impliedOdds,
  isCommitted,
  madeHand,
  mdfDefends,
  mdfFacing,
  postflopIntent,
  postflopPolicy,
  postflopRead,
  postflopSpot,
  realisation,
  sprBand,
  withEquity,
  type MadeHand,
} from '../../src/brain/postflopPolicy.ts';
import type { PolicyDecision } from '../../src/brain/types.ts';
import { describe as describeHand } from '../../src/eval/describe.ts';
import { cards } from '../helpers/cards.ts';
import { bet, call, check, raise } from '../engine/play.ts';
import { observeSpot, playSpot } from './fixtures.ts';
import { synth, type SynthSpec } from './postflopFixtures.ts';

const decide = (spec: SynthSpec, sizing?: Parameters<typeof postflopPolicy>[2]): PolicyDecision => {
  const { f, spot } = synth(spec);
  return postflopPolicy(f, spot, sizing);
};
const main = (d: PolicyDecision): string => d.trace[0]?.code ?? '';

function made(hole: string, board: string): ReturnType<typeof madeHand> {
  const h = cards(hole) as [number, number];
  const b = cards(board);
  return madeHand(h, b, describeHand(h, b));
}

describe('realisation R (§8.5 step 2)', () => {
  it('river and in position 1; out of position flop 0.85, turn 0.92; −0.05 multiway', () => {
    expect(realisation({ street: 'river', position: 'OOP', nOpp: 1 })).toBe(1);
    expect(realisation({ street: 'flop', position: 'IP', nOpp: 1 })).toBe(1);
    expect(realisation({ street: 'flop', position: 'OOP', nOpp: 1 })).toBe(0.85);
    expect(realisation({ street: 'turn', position: 'OOP', nOpp: 1 })).toBe(0.92);
    expect(realisation({ street: 'turn', position: 'OOP', nOpp: 2 })).toBeCloseTo(0.87, 12);
    expect(realisation({ street: 'river', position: 'IP', nOpp: 3 })).toBeCloseTo(0.95, 12);
  });
});

describe('implied odds (§8.5 step 3)', () => {
  it('a flush draw: 9 outs of 47 next card; implied = P_hit × 0.5 × min(stackBehind, pot + call)', () => {
    const { f, spot } = synth({ hole: 'Ah Kh', board: 'Qh 7h 2c', E: 0.4, pot: 800, toCall: 200 });
    expect(impliedHitChance(f, spot)).toBeCloseTo(9 / 47, 12);
    expect(impliedOdds(f, spot)).toBeCloseTo((9 / 47) * 0.5 * 1000, 9);
    const short = synth({
      hole: 'Ah Kh',
      board: 'Qh 7h 2c',
      E: 0.4,
      pot: 800,
      toCall: 200,
      stackBehind: 300,
    });
    expect(impliedOdds(short.f, short.spot)).toBeCloseTo((9 / 47) * 0.5 * 300, 9);
  });

  it('a straight draw counts only on a board with no pair and no three of a suit', () => {
    const clean = synth({ hole: 'Js Ts', board: '9c 8d 2h', E: 0.4, pot: 800, toCall: 200 });
    expect(impliedHitChance(clean.f, clean.spot)).toBeCloseTo(8 / 47, 12);
    const paired = synth({ hole: 'Js Ts', board: '9c 8d 8h', E: 0.4, pot: 800, toCall: 200 });
    expect(impliedHitChance(paired.f, paired.spot)).toBe(0);
    const suited = synth({ hole: 'Js Td', board: '9c 8c 2c', E: 0.4, pot: 800, toCall: 200 });
    expect(impliedHitChance(suited.f, suited.spot)).toBe(0);
  });

  it('a flush draw plus an open-ender counts the union of their outs (15)', () => {
    const { f, spot } = synth({ hole: 'Js Ts', board: 'Qs 9d 2s', E: 0.5, pot: 900, toCall: 300 });
    expect(impliedHitChance(f, spot)).toBeCloseTo(15 / 47, 12);
  });

  it('overcards, the river and nothing to draw give no implied odds', () => {
    const over = synth({ hole: 'Ac Kd', board: '9h 6s 2c', E: 0.4, pot: 800, toCall: 200 });
    expect(impliedOdds(over.f, over.spot)).toBe(0);
    const river = synth({ hole: 'Ah Kh', board: 'Qh 7h 2c 3s 4d', E: 0.2, pot: 800, toCall: 200 });
    expect(impliedHitChance(river.f, river.spot)).toBe(0);
  });

  it('EV(call) = E·R·(winPot + toCall) − toCall + implied', () => {
    expect(callEV({ eRange: 0.3, winPot: 800, toCall: 200 }, 0.85, 50)).toBeCloseTo(
      0.3 * 0.85 * 1000 - 200 + 50,
      9,
    );
  });
});

describe('made hand and commitment (§8.5 step 6)', () => {
  it('reads what the hero’s own cards make', () => {
    const cases: [string, string, MadeHand, boolean][] = [
      ['As Kd', 'Kh 8c 4d', 'topPair', true],
      ['Ks Qd', 'Kh 8c 4d', 'topPair', false],
      ['As Qd', 'Ah Kc 7d', 'topPair', true], // the King is on the board: the Queen is top kicker
      ['Qs Qd', 'Jh 7c 2d', 'overpair', false],
      ['5s 5d', 'Jh 7c 2d', 'weakPair', false],
      ['8s 9d', 'Kh 8c 4d', 'weakPair', false],
      ['As 5d', 'Kh Kc 7d', 'nothing', false],
      ['Ks 8d', 'Kh 8c 4d', 'twoPair', false],
      ['Ks Qd', 'Kh 8c 8d', 'topPair', false], // one pair is the board's
      ['Qs Qd', '8h 8c 3d', 'overpair', false],
      ['As Qd', '8h 8c 3d 3s', 'nothing', false], // both pairs on the board
      ['7s 7d', 'Kc 7h 2d', 'trips', false],
      ['7s Ad', '7c 7h 2d', 'trips', false],
      ['Ac Kd', '7c 7h 7d', 'nothing', false],
      ['Js Td', '9c 8d 7h', 'straightPlus', false],
      ['2s 3d', 'Ac Kd Qh Jc Ts', 'nothing', false], // the board plays
      ['Ac 2d', '9c 6d 4h', 'nothing', false],
    ];
    for (const [hole, board, kind, topKicker] of cases) {
      expect(made(hole, board), `${hole} on ${board}`).toEqual({ made: kind, topKicker });
    }
    const h = cards('As Kd') as [number, number];
    expect(madeHand(h, [], describeHand(h, [])).made).toBe('nothing');
  });

  it('SPR bands: ≤ 3, (3, 6], above 6', () => {
    expect(sprBand(3)).toBe(1);
    expect(sprBand(3.01)).toBe(2);
    expect(sprBand(6)).toBe(2);
    expect(sprBand(6.5)).toBe(3);
  });

  it('band 1: heads-up p ≥ 0.6, multiway top pair or better; band 2: two pair+, or overpair / TPTK on Dry', () => {
    const top = { made: 'topPair', topKicker: true } as const;
    const weak = { made: 'weakPair', topKicker: false } as const;
    expect(isCommitted({ spr: 2, nOpp: 1, p: 0.6, texture: 'wet' }, weak)).toBe(true);
    expect(isCommitted({ spr: 2, nOpp: 1, p: 0.59, texture: 'dry' }, top)).toBe(false);
    expect(isCommitted({ spr: 2, nOpp: 2, p: 0.3, texture: 'wet' }, top)).toBe(true);
    expect(isCommitted({ spr: 2, nOpp: 2, p: 0.9, texture: 'dry' }, weak)).toBe(false);
    expect(
      isCommitted(
        { spr: 5, nOpp: 1, p: 0.3, texture: 'wet' },
        { made: 'twoPair', topKicker: false },
      ),
    ).toBe(true);
    expect(isCommitted({ spr: 5, nOpp: 1, p: 0.9, texture: 'dry' }, top)).toBe(true);
    expect(isCommitted({ spr: 5, nOpp: 1, p: 0.9, texture: 'wet' }, top)).toBe(false);
    expect(
      isCommitted(
        { spr: 5, nOpp: 1, p: 0.9, texture: 'dry' },
        { made: 'overpair', topKicker: false },
      ),
    ).toBe(true);
    expect(
      isCommitted(
        { spr: 5, nOpp: 1, p: 0.9, texture: 'dry' },
        { made: 'topPair', topKicker: false },
      ),
    ).toBe(false);
    expect(
      isCommitted(
        { spr: 8, nOpp: 1, p: 0.99, texture: 'dry' },
        { made: 'straightPlus', topKicker: false },
      ),
    ).toBe(false);
  });
});

describe('facing a bet (§8.5 step 4)', () => {
  const facing = { pot: 800, toCall: 200, position: 'IP' } as const;

  it('Monster raises for value: 3 × the bet in position, 3.5 × out of position', () => {
    const ip = decide({ ...facing, hole: '7s 7d', board: 'Kc 7h 2d', E: 0.95 });
    expect(ip.action).toEqual({ type: 'raise', to: 600 });
    expect(main(ip)).toBe('VALUE_RAISE');
    const oop = decide({ ...facing, hole: '7s 7d', board: 'Kc 7h 2d', E: 0.95, position: 'OOP' });
    expect(oop.action).toEqual({ type: 'raise', to: 700 });
  });

  it('Strong raises on a Wet or Very wet board (RAISE_PROTECT) and calls on a Dry one', () => {
    const wet = decide({ ...facing, hole: 'Ks Kd', board: '9h 8h 2s', E: 0.7, spr: 5 });
    expect(wet.action).toEqual({ type: 'raise', to: 600 });
    expect(main(wet)).toBe('RAISE_PROTECT');
    const dry = decide({ ...facing, hole: 'Ks Qd', board: 'Kc 7h 2d', E: 0.7, spr: 5 });
    expect(dry.action).toEqual({ type: 'call' });
    expect(main(dry)).toBe('CALL_PROFITABLE');
  });

  it('calls when EV(call) > 0 and folds when not', () => {
    // need = 200 / 1000 = 20%; R = 1 in position.
    const yes = decide({ ...facing, hole: '8s 9d', board: 'Kh 8c 4d', E: 0.25 });
    expect(yes.action).toEqual({ type: 'call' });
    expect(yes.trace[0]).toEqual({
      code: 'CALL_PROFITABLE',
      data: { E: 0.25, need: 0.2, toCall: 200, pot: 800 },
    });
    const no = decide({ ...facing, hole: '8s 9d', board: 'Kh 8c 4d', E: 0.15 });
    expect(no.action).toEqual({ type: 'fold' });
    expect(no.trace[0]).toEqual({ code: 'FOLD_PRICE', data: { E: 0.15, need: 0.2 } });
  });

  it('out of position the realisation lowers EV(call)', () => {
    // 0.22 × 1000 − 200 > 0 in position; 0.22 × 0.85 × 1000 − 200 < 0 out of position.
    expect(decide({ ...facing, hole: '8s 9d', board: 'Kh 8c 4d', E: 0.22 }).kind).toBe('call');
    expect(
      decide({ ...facing, hole: '8s 9d', board: 'Kh 8c 4d', E: 0.22, position: 'OOP' }).kind,
    ).toBe('fold');
  });

  it('a draw that needs its implied odds calls with IMPLIED', () => {
    // 4♥5♥ on K♥8♥2♣: a flush draw (9 outs, Air below 8 outs? no: 9 outs, a Draw).
    const d = decide({ ...facing, hole: '4h 5h', board: 'Kh 8h 2c', E: 0.19, toCall: 200 });
    expect(d.action).toEqual({ type: 'call' });
    expect(main(d)).toBe('IMPLIED');
    expect(d.trace[0]?.data.draw).toBe('flush');
    expect(d.trace[0]?.data.needImplied as number).toBeLessThan(0.2);
  });

  it('facing an all-in: CALL_ALLIN and FOLD_ALLIN', () => {
    const allin = { ...facing, facing: 'allin', stackBehind: 0 } as const;
    expect(main(decide({ ...allin, hole: '8s 9d', board: 'Kh 8c 4d', E: 0.4 }))).toBe('CALL_ALLIN');
    const fold = decide({ ...allin, hole: '8s 9d', board: 'Kh 8c 4d', E: 0.1 });
    expect(fold.action).toEqual({ type: 'fold' });
    expect(main(fold)).toBe('FOLD_ALLIN');
  });

  it('a Monster that cannot raise calls', () => {
    const d = decide({
      ...facing,
      hole: '7s 7d',
      board: 'Kc 7h 2d',
      E: 0.95,
      facing: 'allin',
      legal: { raise: null },
    });
    expect(d.action).toEqual({ type: 'call' });
    expect(main(d)).toBe('CALL_ALLIN');
  });

  it('a hand that plays the board folds with BOARD_PLAYS', () => {
    const d = decide({ ...facing, hole: '3c 2d', board: 'As Kd Qc Jh 9s', E: 0.01 });
    expect(d.action).toEqual({ type: 'fold' });
    expect(d.trace).toEqual([{ code: 'BOARD_PLAYS', data: {} }]);
  });

  it('the nuts raise with NUTS', () => {
    const d = decide({ ...facing, hole: 'Ah 4h', board: 'Kh 9h 2c 7h', E: 0.97 });
    expect(d.kind).toBe('raise');
    expect(main(d)).toBe('NUTS');
  });
});

describe('SPR commitment (§8.5 step 6)', () => {
  const facing = { pot: 800, toCall: 200, position: 'IP' } as const;

  it('spr ≤ 3: a multiway top pair never folds (COMMITTED) even at a bad price', () => {
    const d = decide({ ...facing, hole: 'As Kd', board: 'Kh 8c 4d', E: 0.1, nOpp: 2, spr: 2 });
    expect(d.action).toEqual({ type: 'call' });
    expect(main(d)).toBe('COMMITTED');
    // The same hand at spr 8 folds.
    expect(
      decide({ ...facing, hole: 'As Kd', board: 'Kh 8c 4d', E: 0.1, nOpp: 2, spr: 8 }).kind,
    ).toBe('fold');
  });

  it('spr ≤ 3: a committed raise goes all-in', () => {
    const d = decide({
      ...facing,
      hole: '7s 7d',
      board: 'Kc 7h 2d',
      E: 0.95,
      spr: 2,
      effStack: 1300,
    });
    expect(d).toMatchObject({ action: { type: 'raise', to: 10000 }, kind: 'allin' });
    expect(d.trace.map((r) => r.code)).toEqual(['VALUE_RAISE', 'COMMITTED']);
  });

  it('3 < spr ≤ 6: two pair+ and Dry overpair / TPTK never fold; TPTK on a Wet board can', () => {
    const multi = { ...facing, E: 0.1, nOpp: 3, spr: 5 } as const;
    expect(main(decide({ ...multi, hole: 'Ks 8d', board: 'Kh 8c 4d' }))).toBe('COMMITTED');
    expect(main(decide({ ...multi, hole: 'As Kd', board: 'Kh 7c 2d' }))).toBe('COMMITTED');
    expect(main(decide({ ...multi, hole: 'Qs Qd', board: 'Jh 7c 2d' }))).toBe('COMMITTED');
    expect(decide({ ...multi, hole: 'As Kd', board: 'Kh Qh Jd' }).kind).toBe('fold');
  });

  it('spr > 6: one pair never raises (pot control), a set still does', () => {
    const d = decide({ ...facing, hole: 'Qs Qd', board: 'Jh 7c 2d', E: 0.9, spr: 15 });
    expect(d.action).toEqual({ type: 'call' });
    expect(decide({ ...facing, hole: '7s 7d', board: 'Kc 7h 2d', E: 0.9, spr: 15 }).kind).toBe(
      'raise',
    );
  });

  it('spr > 6: one pair bets for value on at most two streets', () => {
    const spec = { hole: 'As Kd', board: 'Kh 7c 2d 4s 9h', E: 0.9, pot: 600, spr: 8 } as const;
    expect(decide({ ...spec, heroBetStreets: 1 }).kind).toBe('bet');
    const capped = decide({ ...spec, heroBetStreets: 2 });
    expect(capped.action).toEqual({ type: 'check' });
    expect(main(capped)).toBe('POT_CONTROL');
    // A set is not one pair.
    expect(decide({ ...spec, hole: '7s 7d', heroBetStreets: 2 }).kind).toBe('bet');
  });
});

describe('checked to the hero (§8.5 step 5)', () => {
  const free = { pot: 600, spr: 16, position: 'IP' } as const;

  it('Monster and Strong bet by texture (VALUE_BET); the nuts say NUTS', () => {
    const d = decide({ ...free, hole: '7s 7d', board: 'Kc 7h 2d', E: 0.95 });
    expect(d.action).toEqual({ type: 'bet', to: 200 });
    expect(d.trace[0]).toEqual({
      code: 'VALUE_BET',
      data: {
        handName: d.trace[0]?.data.handName as string,
        category: 'trips',
        E: 0.95,
        size: 200,
        sizeBB: 2,
      },
    });
    expect(decide({ ...free, hole: 'Ks Kd', board: '9h 8h 2s', E: 0.7 }).action).toEqual({
      type: 'bet',
      to: 400,
    });
    expect(main(decide({ ...free, hole: 'Ah 4h', board: 'Kh 9h 2c 7h 3s', E: 1, spr: 4 }))).toBe(
      'NUTS',
    );
  });

  it('Medium checks (POT_CONTROL) unless thin value applies', () => {
    const oop = decide({ ...free, hole: '8s 9d', board: 'Kh 8c 4d', E: 0.5, position: 'OOP' });
    expect(oop.action).toEqual({ type: 'check' });
    expect(main(oop)).toBe('POT_CONTROL');
    // In position, heads-up, Dry: 1/3 pot.
    const thin = decide({ ...free, hole: '8s 9d', board: 'Kh 8c 4d', E: 0.5 });
    expect(thin.action).toEqual({ type: 'bet', to: 200 });
    expect(main(thin)).toBe('THIN_VALUE');
    // Multiway on a Wet flop: check; on the river in position with p ≥ 0.6: 1/3. Against two
    // opponents p = 2E / (1 + E) (§8.2): E 0.45 is p 0.62, E 0.3 is p 0.46.
    expect(decide({ ...free, hole: '8s 9d', board: 'Kh 8h 7d', E: 0.3, nOpp: 2 }).kind).toBe(
      'check',
    );
    const river = decide({ ...free, hole: '8s 9d', board: 'Kh 8h 7d 2c 2s', E: 0.45, nOpp: 2 });
    expect(river.action).toEqual({ type: 'bet', to: 200 });
    expect(decide({ ...free, hole: '8s 9d', board: 'Kh 8h 7d 2c 2s', E: 0.3, nOpp: 2 }).kind).toBe(
      'check',
    );
  });

  it('a Draw semi-bluffs heads-up in position or as the aggressor: 1/2 Dry, 2/3 Wet', () => {
    const dry = decide({ ...free, hole: 'Ah 5h', board: 'Kh 8h 2c', E: 0.4 });
    expect(dry.action).toEqual({ type: 'bet', to: 300 });
    expect(dry.trace[0]?.code).toBe('SEMI_BLUFF');
    // 15 outs: the 9 hearts and the 6 cards that pair a hole card.
    expect(dry.trace[0]?.data).toMatchObject({ draw: 'nutFlush', outs: 15 });
    expect(dry.trace[0]?.data.hitNext as number).toBeCloseTo(15 / 47, 12);
    const wet = decide({ ...free, hole: 'Qs 8s', board: 'Js Td 4s', E: 0.4 }); // W = 2
    expect(wet.action).toEqual({ type: 'bet', to: 400 });
    const agg = decide({
      ...free,
      hole: 'Ah 5h',
      board: 'Kh 8h 2c',
      E: 0.4,
      position: 'OOP',
      aggressor: true,
    });
    expect(agg.kind).toBe('bet');
  });

  it('a Draw checks out of position without the initiative, and multiway', () => {
    const oop = decide({ ...free, hole: 'Ah 5h', board: 'Kh 8h 2c', E: 0.4, position: 'OOP' });
    expect(oop.action).toEqual({ type: 'check' });
    expect(main(oop)).toBe('CHECK_WEAK');
    expect(decide({ ...free, hole: 'Ah 5h', board: 'Kh 8h 2c', E: 0.3, nOpp: 2 }).kind).toBe(
      'check',
    );
  });

  it('Air checks; the flop continuation bet (1/3) as the aggressor, heads-up, on a Dry board', () => {
    const cbet = decide({ ...free, hole: '6c 5d', board: 'Kh 9c 2d', E: 0.2, aggressor: true });
    expect(cbet.action).toEqual({ type: 'bet', to: 200 });
    expect(main(cbet)).toBe('CBET_DRY');
    expect(decide({ ...free, hole: '6c 5d', board: 'Kh 9c 2d', E: 0.2 }).kind).toBe('check');
    const turn = decide({ ...free, hole: '6c 5d', board: 'Kh 9c 2d Jh', E: 0.2, aggressor: true });
    expect(main(turn)).toBe('CHECK_WEAK');
    const river = decide({ ...free, hole: '6c 5d', board: 'Kh 9c 2d Jh Qs', E: 0.1 });
    expect(river.action).toEqual({ type: 'check' });
    expect(main(river)).toBe('CHECK_FREE');
    expect(
      decide({ ...free, hole: '6c 5d', board: 'Kh 9c 2d', E: 0.04, nOpp: 2, aggressor: true }).kind,
    ).toBe('check');
  });

  it('with nobody left to call a bet, a value hand checks (CHECK_FREE)', () => {
    const d = decide({ ...free, hole: '7s 7d', board: 'Kc 7h 2d', E: 0.95, legal: { bet: null } });
    expect(d.action).toEqual({ type: 'check' });
    expect(main(d)).toBe('CHECK_FREE');
  });

  it('size sets: Easy bets 1/2 pot, Medium a pot on a Very wet board', () => {
    expect(decide({ ...free, hole: '7s 7d', board: 'Kc 7h 2d', E: 0.95 }, 'half').action).toEqual({
      type: 'bet',
      to: 300,
    });
    expect(decide({ ...free, hole: 'Ks Kd', board: 'Ts 9s 8s', E: 0.9 }, 'two').action).toEqual({
      type: 'bet',
      to: 600,
    });
  });

  it('preflop is not this policy', () => {
    const { f, spot } = synth({ hole: '7s 7d', board: 'Kc 7h 2d', E: 0.5, pot: 600 });
    expect(() => postflopPolicy({ ...f, street: 'preflop' }, spot)).toThrow(RangeError);
  });
});

describe('postflopIntent and postflopRead', () => {
  it('the intent names the row; the read carries R, EV(call) and the commitment', () => {
    const { f, spot } = synth({ hole: '8s 9d', board: 'Kh 8c 4d', E: 0.25, pot: 800, toCall: 200 });
    const read = postflopRead(f, spot);
    expect(read).toMatchObject({ r: 1, implied: 0, band: 3, committed: false, potControl: true });
    expect(read.ev).toBeCloseTo(50, 9);
    expect(postflopIntent(f, spot)).toEqual({ kind: 'call', purpose: null, allIn: false });
  });
});

describe('§9.4 hooks: perceived equity and MDF defence', () => {
  it('withEquity moves p and the bucket with the equity (clamped to [0, 1])', () => {
    const { f } = synth({ hole: '8s 9d', board: 'Kh 8c 4d', E: 0.5, pot: 600, nOpp: 2 });
    // §8.2: p = 2E / (1 + E) against two opponents (0.895), a Monster.
    const seen = withEquity(f, 0.81);
    expect(seen).toMatchObject({ eRange: 0.81, bucket: 'monster' });
    expect(seen.p).toBeCloseTo(1.62 / 1.81, 12);
    expect(withEquity(f, -1)).toMatchObject({ eRange: 0, p: 0, bucket: 'air' });
    expect(withEquity(f, 2).eRange).toBe(1);
    expect(withEquity({ ...f, nOpp: 0 }, 0.2).p).toBe(1);
  });

  it('a bot defends when 1 − handPct ≤ MDF × defenseFactor', () => {
    expect(mdfDefends(0.6, 0.5, 0.85)).toBe(true); // 0.4 ≤ 0.425
    expect(mdfDefends(0.5, 0.5, 0.85)).toBe(false);
  });

  it('handPct: the nuts near 1, the worst hand near 0', () => {
    expect(handPercentile(cards('Ah 4h'), cards('Kh 9h 2c 7h 3s'))).toBeGreaterThan(0.99);
    expect(handPercentile(cards('3c 2d'), cards('As Kd 9c 7h 5s'))).toBeLessThan(0.05);
  });

  it('mdfFacing reads the last bet or raise of the street', () => {
    const h = playSpot({
      stacks: [10000, 10000],
      button: 0,
      inputs: [raise(0, 300), call(1), bet(1, 200), raise(0, 600)],
    });
    const obs = observeSpot(h, 1);
    expect(mdfFacing(obs)).toBeCloseTo(800 / 1400, 12); // 600 into a pot of 800
    const quiet = observeSpot(
      playSpot({ stacks: [10000, 10000], button: 0, inputs: [raise(0, 300), call(1)] }),
      1,
    );
    expect(mdfFacing(quiet)).toBe(1);
  });
});

describe('postflopSpot (from an observation)', () => {
  it('collects the bet faced, the stacks, the hero’s earlier bets and the nuts', () => {
    const h = playSpot({
      stacks: [10000, 6000],
      button: 0,
      holes: { 0: 'Ah 4h' },
      board: 'Kh 9h 2c 7h 3s',
      inputs: [
        raise(0, 300),
        call(1),
        check(1),
        bet(0, 200),
        call(1),
        check(1),
        check(0),
        bet(1, 900),
      ],
    });
    const spot = postflopSpot(observeSpot(h, 0));
    expect(spot).toMatchObject({
      sb: 50,
      bb: 100,
      currentBet: 900,
      heroStreetBet: 0,
      heroStack: 9500,
      stackBehind: 4600, // the villain's 4,600 behind; the hero has 8,600 after calling
      heroBetStreets: 1, // the flop bet
      nuts: true,
      outCards: [],
    });
    const flop = postflopSpot(
      observeSpot(
        playSpot({
          stacks: [10000, 10000],
          button: 0,
          holes: { 0: 'Ah Kh' },
          board: 'Qh 7h 2c',
          inputs: [raise(0, 300), call(1), bet(1, 200)],
        }),
        0,
      ),
    );
    expect(flop.outCards).toHaveLength(15);
    expect(flop.nuts).toBe(false);
  });

  it('throws before the flop and for a seat that is not to act', () => {
    const pre = playSpot({ stacks: [10000, 10000], button: 0, inputs: [] });
    expect(() => postflopSpot(observeSpot(pre, 0))).toThrow(RangeError);
    const flop = playSpot({ stacks: [10000, 10000], button: 0, inputs: [raise(0, 300), call(1)] });
    expect(() => postflopSpot(observeSpot(flop, 0))).toThrow(RangeError);
  });
});
