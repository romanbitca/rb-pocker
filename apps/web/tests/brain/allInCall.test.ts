/**
 * A call that ends the hero's betting (PLAN §8.4, §8.5, §8.9; chunk 5.7): it puts the hero all-in,
 * or every live opponent is all-in. Nobody can bet the hero off its equity any more, so the
 * postflop policy reads it as §8.4 and the EV model do: `R = 1`, no implied odds. And a value raise
 * that cannot be made (the hero's chips do not cover a raise) is no reason to call: the price
 * decides, so a call is never explained as profitable (CALL_PROFITABLE) at a price its numbers
 * do not meet (found by chunk 5.6: "28% to win, 33% needed: calling is profitable").
 */
import { describe, expect, it } from 'vitest';
import { evModel } from '../../src/brain/ev.ts';
import { postflopPolicy, postflopRead, postflopSpot } from '../../src/brain/postflopPolicy.ts';
import { observe } from '../../src/engine/observe.ts';
import { bet, call, check, raise } from '../engine/play.ts';
import { extrasFor, playSpot } from './fixtures.ts';
import { synth, type SynthSpec } from './postflopFixtures.ts';

/**
 * Five opponents, a wet board, top pair: Strong per opponent at 28% against all five (§8.2:
 * `p = 5E / (1 + 4E)` = 0.66; the fair share is 17%).
 */
const SHORT: SynthSpec = {
  hole: 'Kd Qd',
  board: 'Qh Jh 4c',
  E: 0.28,
  nOpp: 5,
  pot: 2000, // the bet faced included
  toCall: 1000,
  heroStack: 1000, // the call is all-in: no raise is possible
  spr: 5, // 3 < SPR ≤ 6: no pot control, not committed (§8.5 step 6)
  facing: 'bet',
};

describe('a call that ends the betting', () => {
  it('a value raise the hero cannot make is decided by the price (R = 1): fold at 28% against 33%', () => {
    const { f, spot } = synth(SHORT);
    expect(f.bucket).toBe('strong');
    expect(f.texture).toBe('wet');
    expect(spot.legal.raise).toBeNull();
    expect(spot.callEndsBetting).toBe(true);
    expect(f.need).toBeCloseTo(1 / 3, 12);
    const d = postflopPolicy(f, spot);
    expect(d.action).toEqual({ type: 'fold' });
    expect(d.trace[0]?.code).toBe('FOLD_PRICE');
    expect(d.trace[0]?.data).toMatchObject({ E: 0.28, need: f.need });
  });

  it('…and calls when the price is right, saying so with numbers that agree', () => {
    const { f, spot } = synth({ ...SHORT, E: 0.4 });
    const d = postflopPolicy(f, spot);
    expect(d.action).toEqual({ type: 'call' });
    expect(d.trace[0]?.code).toBe('CALL_PROFITABLE');
    expect(d.trace[0]?.data.E as number).toBeGreaterThan(d.trace[0]?.data.need as number);
  });

  it('a committed hand calls only at a price it meets: nothing comes later (QA-2 item 4)', () => {
    // Committed (SPR 1.5, top pair) at 28% against a 33% price, and the call ends the betting:
    // "folding gives up too much" was false, nobody can bet later, the price alone decides.
    const { f, spot } = synth({ ...SHORT, spr: 1.5 });
    expect(postflopRead(f, spot).committed).toBe(true);
    const d = postflopPolicy(f, spot);
    expect(d.action).toEqual({ type: 'fold' });
    expect(d.trace[0]?.code).toBe('FOLD_PRICE');
    // At a price it meets, COMMITTED still explains the call (E13).
    const paid = postflopPolicy(synth({ ...SHORT, spr: 1.5, E: 0.4 }).f, spot);
    expect(paid.action).toEqual({ type: 'call' });
    expect(paid.trace[0]?.code).toBe('COMMITTED');
    // With chips behind after the call, commitment still means never fold (§8.5 step 6).
    const deep = synth({
      ...SHORT,
      spr: 1.5,
      heroStack: 3000,
      callEndsBetting: false,
      legal: { raise: null },
    });
    expect(postflopRead(deep.f, deep.spot)).toMatchObject({ committed: true, ends: false });
    expect(postflopRead(deep.f, deep.spot).ev).toBeLessThan(0);
    const kept = postflopPolicy(deep.f, deep.spot);
    expect(kept.action).toEqual({ type: 'call' });
    expect(kept.trace[0]?.code).toBe('COMMITTED');
  });

  it('QA-2 item 4 (seed 5eed2101, hand 21): J♠J♦ on 6♦4♥6♣, three opponents, an all-in at 25% against 36%', () => {
    // Pot commitment (SPR ≤ 3, an overpair multiway) called "Call all-in 1,580 · likely about
    // 25%" beside "need 36%", "folding gives up too much", graded Best.
    const { f, spot } = synth({
      hole: 'Jd Js',
      board: '6d 4h 6c',
      E: 0.255,
      nOpp: 3,
      pot: 2860,
      toCall: 1580,
      heroStack: 1580,
      spr: 1.6,
      facing: 'allin',
    });
    expect(postflopRead(f, spot).committed).toBe(true);
    expect(spot.callEndsBetting).toBe(true);
    const d = postflopPolicy(f, spot);
    expect(d.action).toEqual({ type: 'fold' });
    expect(d.trace[0]).toMatchObject({ code: 'FOLD_ALLIN', data: { E: 0.255, need: f.need } });
  });

  it('reads R = 1 and no implied odds, as the EV model values the same call', () => {
    // A flush draw out of position: R < 1 and implied odds while the betting can go on.
    const draw: SynthSpec = {
      hole: 'Ah 5h',
      board: 'Kh 9h 2c',
      E: 0.3,
      pot: 900,
      toCall: 300,
      position: 'OOP',
      heroStack: 10000,
    };
    const open = synth(draw);
    expect(open.spot.callEndsBetting).toBe(false);
    const live = postflopRead(open.f, open.spot);
    expect(live.r).toBeLessThan(1);
    expect(live.implied).toBeGreaterThan(0);
    const allIn = synth({ ...draw, heroStack: 300 });
    expect(allIn.spot.callEndsBetting).toBe(true);
    const ends = postflopRead(allIn.f, allIn.spot);
    expect(ends.r).toBe(1);
    expect(ends.implied).toBe(0);
    expect(ends.ev).toBeCloseTo(0.3 * (900 + 300) - 300, 9);
  });

  it('on a real hand: facing the all-in of the only opponent, the policy and the EV model agree', () => {
    // Heads-up turn: the villain shoves; the hero's call ends the betting.
    const h = playSpot({
      stacks: [5500, 5500],
      button: 0,
      holes: { 0: 'Qs Js' },
      board: 'Kh 8c 4d 2s',
      inputs: [raise(0, 300), call(1), check(1), bet(0, 1200), call(1), bet(1, 4000)],
    });
    const obs = observe(h, 0, extrasFor(2));
    const spot = postflopSpot(obs);
    expect(spot.callEndsBetting).toBe(true);
    const f = {
      ...synth({ hole: 'Qs Js', board: 'Kh 8c 4d 2s', E: 0.2, pot: obs.pot, toCall: 4000 }).f,
      winPot: obs.pot,
      toCall: obs.legal.callAmount,
    };
    const read = postflopRead(f, spot);
    const model = evModel({
      obs,
      f: { ...f, ranges: [] },
      R: read.r,
      implied: read.implied,
      seed: '0'.repeat(32),
    });
    expect(read.ev).toBeCloseTo(model.ev({ type: 'call' }), 9);
  });
});
