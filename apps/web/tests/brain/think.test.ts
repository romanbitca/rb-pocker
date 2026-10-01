/**
 * Bot think time (PLAN §9.8): `t = 450 ms + 900 ms × closeness + U(0, 400 ms)`, clamped to
 * 300–3,000 ms, all-in decisions ≥ 1,500 ms, `U` from the bot's decision seed. The stand-in
 * `decide` has no EVs, so its decisions are clear ones (closeness 0): the numbers SimpleBot's
 * think time always had.
 */
import { describe, expect, it } from 'vitest';
import { decide } from '../../src/brain/standIn.ts';
import {
  closeness,
  isAllInAction,
  thinkMs,
  THINK_ALL_IN_MS,
  THINK_MAX_MS,
  THINK_MIN_MS,
} from '../../src/brain/think.ts';
import type { Decision } from '../../src/brain/types.ts';
import { deriveSeed, type Seed128 } from '../../src/core/rng.ts';
import { observe } from '../../src/engine/observe.ts';
import type { HandState, Observation, ObserveExtras } from '../../src/engine/types.ts';
import { deal, rigDeck, tableWith } from '../engine/helpers.ts';

const extras = (n: number): ObserveExtras => ({
  seatStats: new Array(n).fill(null),
  visiblePersonality: new Array(n).fill(null),
  seatLevels: new Array(n).fill('easy'),
});

const obsOf = (h: HandState, seat: number): Observation => observe(h, seat, extras(h.seats.length));

/** Six seats, 50/100: seat 3 is UTG when the button is seat 0. */
function sixMax(holes: Record<number, string>, stacks?: number[]): HandState {
  const table = tableWith(stacks ?? [10000, 10000, 10000, 10000, 10000, 10000], { button: 0 });
  return rigDeck(deal(table), { holes });
}

const seed = (i: number): Seed128 => deriveSeed('0123456789abcdef0123456789abcdef', 'think', i);

/** A decision with the given candidate EVs (the rest is neutral). */
const withEv = (obs: Observation, ev: Decision['ev']): Decision => ({ ...decide(obs), ev });

describe('think time of the stand-in decide', () => {
  it('is 450 ms + U(0, 400 ms) for a clear decision, the same for the same seed', () => {
    const obs = obsOf(sixMax({ 3: '8h 3d' }), 3);
    const decision = decide(obs);
    expect(decision.action).toEqual({ type: 'call' });
    const times = Array.from({ length: 500 }, (_, i) => thinkMs(obs, decision, seed(i)));
    expect(Math.min(...times)).toBeGreaterThanOrEqual(450);
    expect(Math.max(...times)).toBeLessThanOrEqual(850);
    expect(new Set(times).size).toBeGreaterThan(100);
    expect(thinkMs(obs, decision, seed(7))).toBe(times[7]);
  });

  it('takes at least 1,500 ms for an all-in decision', () => {
    const h = sixMax({ 3: 'Ac Ad' }, [10000, 10000, 10000, 250, 10000, 10000]);
    const obs = obsOf(h, 3);
    const decision = decide(obs);
    expect(decision.action).toEqual({ type: 'raise', to: 250 });
    expect(decision.kind).toBe('allin');
    for (let i = 0; i < 50; i++) {
      expect(thinkMs(obs, decision, seed(i))).toBeGreaterThanOrEqual(THINK_ALL_IN_MS);
    }
  });
});

describe('isAllInAction', () => {
  it('is true for the bet, raise or call that puts every chip in', () => {
    const h = sixMax({ 3: 'Ac Ad' }, [10000, 10000, 10000, 250, 10000, 10000]);
    const { legal } = obsOf(h, 3);
    expect(isAllInAction(legal, { type: 'raise', to: 250 })).toBe(true);
    expect(isAllInAction(legal, { type: 'raise', to: 200 })).toBe(false);
    expect(isAllInAction(legal, { type: 'fold' })).toBe(false);
    expect(isAllInAction(legal, { type: 'check' })).toBe(false);
    // Facing the big blind with 90 chips left, the call is all-in; a deeper stack's is not.
    const short = obsOf(sixMax({ 3: '8h 3d' }, [10000, 10000, 10000, 90, 10000, 10000]), 3).legal;
    expect(short.callIsAllIn).toBe(true);
    expect(isAllInAction(short, { type: 'call' })).toBe(true);
    expect(isAllInAction(legal, { type: 'call' })).toBe(false);
    // A bet to its maximum, on a street where it is legal.
    expect(isAllInAction({ ...legal, bet: { min: 100, max: 900 } }, { type: 'bet', to: 900 })).toBe(
      true,
    );
    expect(isAllInAction({ ...legal, bet: null }, { type: 'bet', to: 900 })).toBe(false);
  });
});

describe('closeness (§9.8)', () => {
  it('is 0 for a decision with fewer than two EVs, and for a pot of 0', () => {
    expect(closeness({}, 200)).toBe(0);
    expect(closeness({ call: 40 }, 200)).toBe(0);
    expect(closeness({ call: 40, fold: 0 }, 0)).toBe(0);
    expect(closeness({ call: Number.NaN, fold: 0 }, 200)).toBe(0);
  });

  it('is 1 when the two best EVs are equal, 0 once they are 20% of the pot apart', () => {
    expect(closeness({ call: 25, 'raise:600': 25, fold: 0 }, 200)).toBe(1);
    expect(closeness({ call: 40, fold: 0 }, 200)).toBe(0);
    expect(closeness({ call: 100, fold: 0 }, 200)).toBe(0);
    // Half way: a gap of 10% of the pot.
    expect(closeness({ call: 20, 'bet:100': 0, fold: -30 }, 200)).toBeCloseTo(0.5, 10);
  });

  it('compares the best two candidates, whatever their order or sign', () => {
    expect(closeness({ fold: 0, check: -5, 'bet:100': -6 }, 200)).toBeCloseTo(0.875, 10);
    expect(closeness({ 'bet:100': 50, check: 10 }, 200)).toBe(0);
  });
});

describe('a close decision takes longer (§9.8)', () => {
  const obs = obsOf(sixMax({ 3: '8h 3d' }), 3);

  it('adds up to 900 ms to the same seed’s clear time', () => {
    for (let i = 0; i < 50; i++) {
      const clear = thinkMs(obs, withEv(obs, { call: 50, fold: 0 }), seed(i));
      const close = thinkMs(obs, withEv(obs, { call: 0, fold: 0 }), seed(i));
      expect(close - clear).toBe(900);
    }
  });

  it('stays between 300 and 3,000 ms for any EVs', () => {
    for (let i = 0; i < 200; i++) {
      const gap = (i % 20) * 7 - 40;
      const t = thinkMs(obs, withEv(obs, { call: gap, fold: 0, check: 5 }), seed(i));
      expect(t).toBeGreaterThanOrEqual(THINK_MIN_MS);
      expect(t).toBeLessThanOrEqual(THINK_MAX_MS);
      expect(Number.isInteger(t)).toBe(true);
    }
  });
});
