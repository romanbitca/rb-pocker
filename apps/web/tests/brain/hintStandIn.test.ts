// The stand-in coach hint (chunk 5.9, until chunk 5.7's `hint`): a pot-odds coach that returns a
// full Appendix A.5 `Decision` with §8.10 reason codes, always legal, from the observation and the
// HUD's win chance only.
import { describe, expect, it } from 'vitest';
import { needOf, standInHint, strengthOf, winPotOf } from '../../src/brain/hintStandIn.ts';
import { BUCKET_STRONG } from '../../src/brain/tunables.ts';
import type { Decision } from '../../src/brain/types.ts';
import { deriveSeed, rngFromSeed } from '../../src/core/rng.ts';
import { observe } from '../../src/engine/observe.ts';
import { step } from '../../src/engine/step.ts';
import type { HandState, Observation } from '../../src/engine/types.ts';
import { bet, call, check, raise } from '../engine/play.ts';
import { playRandomHand } from '../engine/random-play.ts';
import { extrasFor, observeSpot, playSpot } from './fixtures.ts';

const codes = (d: Decision): string[] => d.trace.map((r) => r.code);

/** Heads-up, 50/100 blinds; the flop is dealt and seat 1 bets `to` into the 200 pot. */
function facingFlopBet(to: number, stacks = [10_000, 10_000]): Observation {
  const h = playSpot({
    stacks,
    button: 0,
    holes: { 0: 'Ah Kd', 1: '7c 2d' },
    board: 'Ks 8h 3c',
    inputs: [call(0), check(1), bet(1, to)],
  });
  return observeSpot(h, 0);
}

/** Heads-up flop, checked to the hero (seat 0, the button). */
function checkedToHero(): Observation {
  const h = playSpot({
    stacks: [10_000, 10_000],
    button: 0,
    holes: { 0: 'Ah Kd', 1: '7c 2d' },
    board: 'Ks 8h 3c',
    inputs: [call(0), check(1), check(1)],
  });
  return observeSpot(h, 0);
}

describe('the price (§0.3)', () => {
  it('needs toCall / (winPot + toCall)', () => {
    const obs = facingFlopBet(100); // pot 200 + 100 bet; call 100
    expect(winPotOf(obs, 100)).toBe(300);
    expect(needOf(obs)).toBeCloseTo(100 / 400, 10);
  });

  it('caps the pot the hero can win when the call is a short all-in', () => {
    // The hero has 900 left behind after the blinds and a 100 call; a 2,000 bet is called for 900.
    const obs = facingFlopBet(2_000, [1_000, 10_000]);
    expect(obs.legal.callAmount).toBe(900);
    // Own 100 + the 900 call; from seat 1 at most 1,000 of its 2,100.
    expect(winPotOf(obs, 900)).toBe(100 + 1_000);
    expect(needOf(obs)).toBeCloseTo(900 / (1_100 + 900), 10);
  });
});

describe('standInHint', () => {
  it('calls when the win chance covers the price, and says why not fold', () => {
    const obs = facingFlopBet(100);
    const d = standInHint(obs, 0.5);
    expect(d.action).toEqual({ type: 'call' });
    expect(d.kind).toBe('call');
    expect(codes(d)).toEqual(['CALL_PROFITABLE', 'WHY_NOT_FOLD']);
    expect(d.trace[0]?.data).toMatchObject({ E: 0.5, need: 0.25, toCall: 100, pot: 300 });
    expect(d.eRandom).toBe(0.5);
    expect(d.eRange).toBe(0.5); // no range model: never RANGE_ADJUST
    expect(d.need).toBeCloseTo(0.25, 10);
    expect(d.confidence).toBe('clear');
    expect(d.alt).toBeNull();
  });

  it('folds when it does not, and says why not call', () => {
    const d = standInHint(facingFlopBet(100), 0.1);
    expect(d.action).toEqual({ type: 'fold' });
    expect(codes(d)).toEqual(['FOLD_PRICE', 'WHY_NOT_CALL']);
    expect(d.confidence).toBe('clear');
    // Five points from the price: not clear, not close.
    expect(standInHint(facingFlopBet(100), 0.2).confidence).toBe('normal');
  });

  it('marks a close spot with the other action as the alternative', () => {
    const call = standInHint(facingFlopBet(100), 0.26);
    expect(call.action).toEqual({ type: 'call' });
    expect(call.confidence).toBe('close');
    expect(call.alt).toEqual({ type: 'fold' });
    expect(codes(call)).toContain('CLOSE_SPOT');
    const fold = standInHint(facingFlopBet(100), 0.24);
    expect(fold.action).toEqual({ type: 'fold' });
    expect(fold.alt).toEqual({ type: 'call' });
  });

  it('raises a bet with a big edge, to a legal amount', () => {
    const obs = facingFlopBet(100);
    const d = standInHint(obs, 0.9);
    expect(d.action.type).toBe('raise');
    expect(codes(d)).toEqual(['VALUE_RAISE']);
    const to = d.action.type === 'raise' ? d.action.to : 0;
    const bounds = obs.legal.raise;
    expect(bounds).not.toBeNull();
    expect(to).toBeGreaterThanOrEqual(bounds?.min ?? Infinity);
    expect(to).toBeLessThanOrEqual(bounds?.max ?? 0);
    expect(to % obs.sb).toBe(0);
  });

  it('bets half the pot with a Strong hand when nothing is to call', () => {
    const obs = checkedToHero();
    const d = standInHint(obs, BUCKET_STRONG); // heads-up: p = E
    expect(d.action).toEqual({ type: 'bet', to: 100 }); // ½ × 200
    expect(codes(d)).toEqual(['VALUE_BET', 'WHY_NOT_CHECK']);
    expect(d.trace[0]?.data).toMatchObject({
      handName: 'Pair of Kings',
      category: 'pair',
      size: 100,
      sizeBB: 1,
    });
  });

  it('checks a Medium hand for pot control, the words agreeing with the strength meter', () => {
    const d = standInHint(checkedToHero(), 0.5);
    expect(d.action).toEqual({ type: 'check' });
    expect(codes(d)).toEqual(['POT_CONTROL', 'WHY_NOT_BET']);
    expect(d.trace[0]?.data).toEqual({ handName: 'Pair of Kings' });
    expect(d.strength).toBe('decent');
  });

  it('checks otherwise: weak on the flop, free on the river', () => {
    const d = standInHint(checkedToHero(), 0.4);
    expect(d.action).toEqual({ type: 'check' });
    expect(codes(d)).toEqual(['CHECK_WEAK', 'WHY_NOT_BET']);
    expect(d.strength).toBe('marginal');
    const river = playSpot({
      stacks: [10_000, 10_000],
      button: 0,
      holes: { 0: 'Ah Kd', 1: '7c 2d' },
      board: 'Ks 8h 3c 4d 9s',
      inputs: [call(0), check(1), check(1), check(0), check(1), check(0), check(1)],
    });
    expect(codes(standInHint(observeSpot(river, 0), 0.4))).toEqual(['CHECK_FREE', 'WHY_NOT_BET']);
  });

  it('calls a small pocket pair before the flop to hit a set (SET_MINING)', () => {
    const h = playSpot({
      stacks: [10_000, 10_000, 10_000],
      button: 2,
      holes: { 0: '5c 5d', 1: 'Kc Qd', 2: 'Ah Kh' },
      inputs: [raise(2, 200)],
    });
    const d = standInHint(observeSpot(h, 0), 0.4);
    expect(d.action).toEqual({ type: 'call' });
    expect(codes(d)).toEqual(['SET_MINING', 'WHY_NOT_FOLD']);
    // A big pair calls for the price, as any other hand.
    const big = playSpot({
      stacks: [10_000, 10_000, 10_000],
      button: 2,
      holes: { 0: 'Jc Jd', 1: 'Kc Qd', 2: 'Ah Kh' },
      inputs: [raise(2, 200)],
    });
    expect(codes(standInHint(observeSpot(big, 0), 0.4))[0]).toBe('CALL_PROFITABLE');
  });

  it('only checks its big-blind option before the flop', () => {
    const h = playSpot({ stacks: [10_000, 10_000], button: 0, inputs: [call(0)] });
    const d = standInHint(observeSpot(h, 1), 0.85);
    expect(d.action).toEqual({ type: 'check' });
    expect(codes(d)).toEqual(['CHECK_FREE']);
    expect(d.bucket).toBeNull(); // preflop
  });

  it('labels the strength with the §8.10 meter bands (lower bounds inclusive)', () => {
    expect(strengthOf(0.34)).toBe('weak');
    expect(strengthOf(0.35)).toBe('marginal');
    expect(strengthOf(0.45)).toBe('decent');
    expect(strengthOf(0.65)).toBe('strong');
    expect(strengthOf(0.85)).toBe('monster');
  });

  it('always returns a legal action (random hands, every decision, any win chance)', () => {
    let decisions = 0;
    for (let i = 0; i < 60; i++) {
      const rng = rngFromSeed(deriveSeed('5eed0000000000000000000000005900', 'stand-in', i));
      const states: HandState[] = [];
      playRandomHand(rng, (before) => {
        if (before.phase === 'betting' && before.toAct !== null) states.push(before);
      });
      for (const h of states) {
        const seat = h.toAct as number;
        const obs = observe(h, seat, extrasFor(h.seats.length));
        for (const E of [0, 0.1, 0.33, 0.5, 0.61, 0.8, 1]) {
          const d = standInHint(obs, E);
          expect(() => step(h, { kind: 'act', seat, action: d.action })).not.toThrow();
          decisions++;
        }
      }
    }
    expect(decisions).toBeGreaterThan(1_000);
  }, 30_000);
});
