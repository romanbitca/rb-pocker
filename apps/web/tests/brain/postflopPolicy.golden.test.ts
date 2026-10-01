/**
 * The postflop Appendix E golden spots (E9–E17) through the postflop policy: each spot is played
 * by the real engine (tests may run it; the brain never does), observed with `observe()`, and
 * decided with the coach's features (`COACH_LIKE`: 'reweight+stats', 4,000 trials, the seed from
 * `observationKey`) and the texture size set. Sizes are "raise to" amounts, ±0.5 bb unless the
 * spot gives a range. The full `hint(obs, null)` versions are chunk 5.7's.
 */
import { describe, expect, it } from 'vitest';
import { coachSeed, features } from '../../src/brain/features.ts';
import { postflopPolicy, postflopSpot } from '../../src/brain/postflopPolicy.ts';
import type { PolicyDecision } from '../../src/brain/types.ts';
import type { Observation } from '../../src/engine/types.ts';
import { bet, call, check, raise } from '../engine/play.ts';
import { COACH_LIKE, observeSpot, playSpot, type ExtrasSpec, type SpotSpec } from './fixtures.ts';

const BB = 100;

function coachAt(spec: SpotSpec, seat: number, extras: ExtrasSpec = {}): PolicyDecision {
  const obs: Observation = observeSpot(playSpot(spec), seat, extras);
  const f = features(obs, COACH_LIKE, coachSeed(obs));
  return postflopPolicy(f, postflopSpot(obs));
}

const main = (d: PolicyDecision): string => d.trace[0]?.code ?? '';

describe('Appendix E postflop golden spots (coach, §8.5 + §8.7)', () => {
  it('E9: heads-up flop in position, A♥K♥ on Q♥7♥2♣, 2 bb into 6 bb: call or raise, never fold', () => {
    const d = coachAt(
      {
        stacks: [10000, 10000],
        button: 0,
        holes: { 0: 'Ah Kh' },
        board: 'Qh 7h 2c',
        inputs: [raise(0, 300), call(1), bet(1, 200)],
      },
      0,
    );
    expect(['call', 'raise', 'allin']).toContain(d.kind);
    expect(d.action.type).not.toBe('fold');
  });

  it('E10: heads-up flop in position, J♠10♠ on Q♠9♦2♠, 3 bb into 6 bb: call or raise, never fold', () => {
    const d = coachAt(
      {
        stacks: [10000, 10000],
        button: 0,
        holes: { 0: 'Js Ts' },
        board: 'Qs 9d 2s',
        inputs: [raise(0, 300), call(1), bet(1, 300)],
      },
      0,
    );
    expect(['call', 'raise', 'allin']).toContain(d.kind);
    expect(d.action.type).not.toBe('fold');
  });

  it('E11: 7♠7♦ on K♣7♥2♦ (Dry), hero called preflop, checked to: bet 1/3 pot (2 bb), VALUE_BET', () => {
    // Heads-up: the hero (button) completes, the big blind raises to 3 bb, the hero calls.
    const d = coachAt(
      {
        stacks: [10000, 10000],
        button: 0,
        holes: { 0: '7s 7d' },
        board: 'Kc 7h 2d',
        inputs: [call(0), raise(1, 300), call(0), check(1)],
      },
      0,
    );
    expect(d.kind).toBe('bet');
    expect(d.action).toEqual({ type: 'bet', to: 2 * BB });
    expect(main(d)).toBe('VALUE_BET');
  });

  it('E12: 7♣2♦ on A♠K♠Q♠, checked to: check, never fold', () => {
    const d = coachAt(
      {
        stacks: [10000, 10000],
        button: 0,
        holes: { 0: '7c 2d' },
        board: 'As Ks Qs',
        inputs: [raise(0, 300), call(1), check(1)],
      },
      0,
    );
    expect(d.action).toEqual({ type: 'check' });
    expect(main(d)).toBe('CHECK_WEAK');
  });

  it('E13: A♠K♦ on K♥8♣4♦2♠, pot 30 bb, 40 bb behind (SPR 1.3), villain all-in: call, COMMITTED', () => {
    const d = coachAt(
      {
        stacks: [5500, 5500],
        button: 0,
        holes: { 0: 'As Kd' },
        board: 'Kh 8c 4d 2s',
        inputs: [raise(0, 300), call(1), check(1), bet(0, 1200), call(1), bet(1, 4000)],
      },
      0,
    );
    expect(d.action).toEqual({ type: 'call' });
    expect(main(d)).toBe('COMMITTED');
  });

  it('E14: river in position, A♥4♥ nut flush, pot 20 bb, 80 bb behind, checked to: bet 12–20 bb', () => {
    const d = coachAt(
      {
        stacks: [9000, 9000],
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
          bet(0, 500),
          call(1),
          check(1),
        ],
      },
      0,
    );
    expect(d.kind).toBe('bet');
    expect(d.action.type).toBe('bet');
    const to = d.action.type === 'bet' ? d.action.to : 0;
    expect(to).toBeGreaterThanOrEqual(12 * BB);
    expect(to).toBeLessThanOrEqual(20 * BB);
    expect(to).toBe(15 * BB); // 3/4 of the 20 bb pot
    expect(['NUTS', 'VALUE_BET']).toContain(main(d));
  });

  it('E15: river, A♠K♠ on Q♠J♠10♠4♦2♣ (royal flush), villain all-in: call', () => {
    const d = coachAt(
      {
        stacks: [10000, 10000],
        button: 0,
        holes: { 0: 'As Ks' },
        board: 'Qs Js Ts 4d 2c',
        inputs: [raise(0, 300), call(1), check(1), check(0), check(1), check(0), bet(1, 9700)],
      },
      0,
    );
    expect(d.action).toEqual({ type: 'call' });
  });

  it('E16: river, 5♥4♥ on A♠K♦9♣2♠J♦, a visible Rock bets 20 bb into 20 bb: fold, FOLD_PRICE', () => {
    const d = coachAt(
      {
        stacks: [10000, 10000],
        button: 0,
        holes: { 1: '5h 4h' },
        board: 'As Kd 9c 2s Jd',
        inputs: [
          raise(0, 300),
          call(1),
          check(1),
          bet(0, 200),
          call(1),
          check(1),
          bet(0, 500),
          call(1),
          check(1),
          bet(0, 2000),
        ],
      },
      1,
      { labels: ['rock', null], levels: ['medium', 'medium'] },
    );
    expect(d.action).toEqual({ type: 'fold' });
    expect(main(d)).toBe('FOLD_PRICE');
  });

  it('E17: river, 3♣2♦ on A♠K♦Q♣J♥9♠ (the board plays), villain bets pot: fold, BOARD_PLAYS', () => {
    const d = coachAt(
      {
        stacks: [10000, 10000],
        button: 0,
        holes: { 0: '3c 2d' },
        board: 'As Kd Qc Jh 9s',
        inputs: [raise(0, 300), call(1), check(1), check(0), check(1), check(0), bet(1, 600)],
      },
      0,
    );
    expect(d.action).toEqual({ type: 'fold' });
    expect(main(d)).toBe('BOARD_PLAYS');
  });
});
