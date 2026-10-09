/**
 * Every Appendix E golden spot through the coach's `hint(obs, null)` (PLAN §8.11, §18 Stage 5
 * acceptance 2): the whole pipeline (features, policy, sizing, guardrails, EVs, the hint's
 * extras), not just the policy. Each spot is played by the real engine and observed with
 * `observe()` (the brain never runs the engine; the test does, so the observation is exactly what
 * the game builds), with labels visible or hidden as the spot says. Sizes are "raise to" amounts
 * in big blinds, ±0.5 bb unless the spot gives a range.
 *
 * The rendering checks of Appendix E belong to `explain.ts` (chunk 5.6); here the hint carries
 * what they need: `eRandom` is the HUD's own number, and E9, E13 and E16 carry RANGE_ADJUST with
 * both equities whenever they differ by 5 points or more.
 */
import { describe, expect, it } from 'vitest';
import { hint } from '../../src/brain/decide.ts';
import { hudEquity } from '../../src/brain/features.ts';
import type { Decision, ReasonCode } from '../../src/brain/types.ts';
import type { EngineInput, Observation, PersonalityId } from '../../src/engine/types.ts';
import { bet, call, check, fold, raise } from '../engine/play.ts';
import { observeSpot, playSpot, type ExtrasSpec } from './fixtures.ts';

const BB = 100;

interface Golden {
  obs: Observation;
  d: Decision;
}

/** Preflop spots: button 0, seat 1 the small blind, seat 2 the big blind, seat 3 first to act. */
function preflop(spec: {
  players: number;
  hero: number;
  hole: string;
  /** Stack of every seat in big blinds (100 unless given). */
  bbs?: number;
  inputs?: EngineInput[];
  labels?: Record<number, PersonalityId>;
}): Golden {
  const stacks = new Array<number>(spec.players).fill((spec.bbs ?? 100) * BB);
  const h = playSpot({
    stacks,
    button: 0,
    holes: { [spec.hero]: spec.hole },
    inputs: spec.inputs ?? [],
  });
  const labels = new Array<PersonalityId | null>(spec.players).fill(null);
  for (const [seat, id] of Object.entries(spec.labels ?? {})) labels[Number(seat)] = id;
  const obs = observeSpot(h, spec.hero, { labels });
  expect(obs.legal.seat).toBe(spec.hero);
  return { obs, d: hint(obs, null) };
}

/** Postflop spots: heads-up unless the stacks say otherwise. */
function postflop(
  spec: { stacks: number[]; hole: Record<number, string>; board: string; inputs: EngineInput[] },
  hero: number,
  extras: ExtrasSpec = {},
): Golden {
  const h = playSpot({
    stacks: spec.stacks,
    button: 0,
    holes: spec.hole,
    board: spec.board,
    inputs: spec.inputs,
  });
  const obs = observeSpot(h, hero, extras);
  expect(obs.legal.seat).toBe(hero);
  return { obs, d: hint(obs, null) };
}

const folds = (...seats: number[]): EngineInput[] => seats.map(fold);
const main = (d: Decision): ReasonCode | undefined => d.trace[0]?.code;
const raisedTo = (d: Decision): number =>
  d.action.type === 'raise' || d.action.type === 'bet' ? d.action.to : -1;
const codes = (d: Decision): ReasonCode[] => d.trace.map((r) => r.code);

/** What every hint must carry (§8.2, §8.10): the HUD number, the price, a legal recommendation. */
function expectHintShape({ obs, d }: Golden): void {
  expect(d.eRandom).toBe(hudEquity(obs));
  expect(Number.isFinite(d.eRange)).toBe(true);
  expect(d.trace.length).toBeGreaterThan(0);
  expect(Object.keys(d.ev).length).toBeGreaterThan(0);
  if (obs.legal.canCheck) expect(d.action.type).not.toBe('fold');
}

/** E9, E13, E16: both equities, labelled, whenever they differ by at least 5 points (§8.10). */
function expectRangeAdjust({ d }: Golden): void {
  const adjust = d.trace.find((r) => r.code === 'RANGE_ADJUST');
  if (Math.abs(d.eRange - d.eRandom) >= 0.05) {
    expect(adjust?.data).toMatchObject({ eRandom: d.eRandom, eRange: d.eRange });
  }
}

describe('Appendix E golden spots through hint(obs, null)', () => {
  it('E1: 6 players, 100 bb, first to act (k = 5), A♠A♥: raise to 2.5 bb (OPEN_RANGE)', () => {
    const g = preflop({ players: 6, hero: 3, hole: 'As Ah' });
    expectHintShape(g);
    expect(g.d.kind).toBe('raise');
    expect(Math.abs(raisedTo(g.d) - 2.5 * BB)).toBeLessThanOrEqual(0.5 * BB);
    expect(main(g.d)).toBe('OPEN_RANGE');
  });

  it('E2: 9 players, 100 bb, first to act (k = 8), 7♣2♦: fold (FOLD_RANGE)', () => {
    const g = preflop({ players: 9, hero: 3, hole: '7c 2d' });
    expectHintShape(g);
    expect(g.d.action).toEqual({ type: 'fold' });
    expect(main(g.d)).toBe('FOLD_RANGE');
  });

  it('E3: 6 players, 100 bb, the button (k = 2), K♠10♦, folded to the hero: raise to 2.5 bb', () => {
    const g = preflop({ players: 6, hero: 0, hole: 'Ks Td', inputs: folds(3, 4, 5) });
    expectHintShape(g);
    expect(g.d.kind).toBe('raise');
    expect(Math.abs(raisedTo(g.d) - 2.5 * BB)).toBeLessThanOrEqual(0.5 * BB);
    expect(main(g.d)).toBe('OPEN_RANGE');
  });

  it('E4: 3 players, the big blind, button folds, small blind limps, 7♣2♦: check (CHECK_FREE)', () => {
    const g = preflop({ players: 3, hero: 2, hole: '7c 2d', inputs: [fold(0), call(1)] });
    expectHintShape(g);
    expect(g.d.action).toEqual({ type: 'check' });
    expect(main(g.d)).toBe('CHECK_FREE');
  });

  it('E5: 9 players, 100 bb, folded to the small blind, 9♣4♦: fold, never complete', () => {
    const g = preflop({ players: 9, hero: 1, hole: '9c 4d', inputs: folds(3, 4, 5, 6, 7, 8, 0) });
    expectHintShape(g);
    expect(g.d.action).toEqual({ type: 'fold' });
    expect(main(g.d)).toBe('FOLD_RANGE');
  });

  it('E6: 6 players, 100 bb, a TAG opens 2.5 bb from the cutoff, the button has 6♣6♦: call (SET_MINING)', () => {
    const g = preflop({
      players: 6,
      hero: 0,
      hole: '6c 6d',
      inputs: [fold(3), fold(4), raise(5, 250)],
      labels: { 5: 'tag' },
    });
    expectHintShape(g);
    expect(g.d.action).toEqual({ type: 'call' });
    expect(main(g.d)).toBe('SET_MINING');
  });

  it('E7: 6 players, the button (k = 2), 10 bb effective, unopened, A♣5♦: all-in (PUSH_FOLD)', () => {
    const g = preflop({ players: 6, bbs: 10, hero: 0, hole: 'Ac 5d', inputs: folds(3, 4, 5) });
    expectHintShape(g);
    expect(g.d.kind).toBe('allin');
    expect(g.d.action).toEqual({ type: 'raise', to: g.obs.legal.raise?.max });
    expect(main(g.d)).toBe('PUSH_FOLD');
  });

  it('E8: 6 players, 100 bb, UTG goes all-in, the big blind has A♥A♦: call', () => {
    const g = preflop({
      players: 6,
      hero: 2,
      hole: 'Ah Ad',
      inputs: [raise(3, 100 * BB), fold(4), fold(5), fold(0), fold(1)],
    });
    expectHintShape(g);
    expect(g.d.action).toEqual({ type: 'call' });
    expect(main(g.d)).toBe('CALL_ALLIN');
  });

  it('E9: heads-up flop in position, A♥K♥ on Q♥7♥2♣, 2 bb into 6 bb: call or raise, never fold', () => {
    const g = postflop(
      {
        stacks: [10000, 10000],
        hole: { 0: 'Ah Kh' },
        board: 'Qh 7h 2c',
        inputs: [raise(0, 300), call(1), bet(1, 200)],
      },
      0,
    );
    expectHintShape(g);
    expect(['call', 'raise', 'allin']).toContain(g.d.kind);
    expect(g.d.action.type).not.toBe('fold');
    expectRangeAdjust(g);
  });

  it('E10: heads-up flop in position, J♠10♠ on Q♠9♦2♠, 3 bb into 6 bb: call or raise, never fold', () => {
    const g = postflop(
      {
        stacks: [10000, 10000],
        hole: { 0: 'Js Ts' },
        board: 'Qs 9d 2s',
        inputs: [raise(0, 300), call(1), bet(1, 300)],
      },
      0,
    );
    expectHintShape(g);
    expect(['call', 'raise', 'allin']).toContain(g.d.kind);
    expect(g.d.action.type).not.toBe('fold');
  });

  it('E11: 7♠7♦ on K♣7♥2♦ (Dry), hero called preflop, checked to: bet 1/3 pot (2 bb), VALUE_BET', () => {
    // Heads-up: the hero (button) completes, the big blind raises to 3 bb, the hero calls.
    const g = postflop(
      {
        stacks: [10000, 10000],
        hole: { 0: '7s 7d' },
        board: 'Kc 7h 2d',
        inputs: [call(0), raise(1, 300), call(0), check(1)],
      },
      0,
    );
    expectHintShape(g);
    expect(g.d.kind).toBe('bet');
    expect(Math.abs(raisedTo(g.d) - 2 * BB)).toBeLessThanOrEqual(0.5 * BB);
    expect(main(g.d)).toBe('VALUE_BET');
  });

  it('E12: 7♣2♦ on A♠K♠Q♠, checked to the hero: check, never fold', () => {
    const g = postflop(
      {
        stacks: [10000, 10000],
        hole: { 0: '7c 2d' },
        board: 'As Ks Qs',
        inputs: [raise(0, 300), call(1), check(1)],
      },
      0,
    );
    expectHintShape(g);
    expect(g.d.action).toEqual({ type: 'check' });
  });

  it('E13: A♠K♦ on K♥8♣4♦2♠, pot 30 bb, 40 bb behind (SPR 1.3), villain all-in 40 bb: call (COMMITTED)', () => {
    const g = postflop(
      {
        stacks: [5500, 5500],
        hole: { 0: 'As Kd' },
        board: 'Kh 8c 4d 2s',
        inputs: [raise(0, 300), call(1), check(1), bet(0, 1200), call(1), bet(1, 4000)],
      },
      0,
    );
    expectHintShape(g);
    expect(g.obs.pot).toBe(7000); // 30 bb + the 40 bb shove
    expect(g.d.action).toEqual({ type: 'call' });
    expect(main(g.d)).toBe('COMMITTED');
    expectRangeAdjust(g);
  });

  it('E14: river in position, A♥4♥ nut flush, pot 20 bb, 80 bb behind, checked to: bet 12–20 bb', () => {
    const g = postflop(
      {
        stacks: [9000, 9000],
        hole: { 0: 'Ah 4h' },
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
    expectHintShape(g);
    expect(g.obs.pot).toBe(20 * BB);
    expect(g.d.kind).toBe('bet');
    expect(raisedTo(g.d)).toBeGreaterThanOrEqual(12 * BB);
    expect(raisedTo(g.d)).toBeLessThanOrEqual(20 * BB);
  });

  it('E15: river, A♠K♠ on Q♠J♠10♠4♦2♣ (royal flush), villain all-in: call', () => {
    const g = postflop(
      {
        stacks: [10000, 10000],
        hole: { 0: 'As Ks' },
        board: 'Qs Js Ts 4d 2c',
        inputs: [raise(0, 300), call(1), check(1), check(0), check(1), check(0), bet(1, 9700)],
      },
      0,
    );
    expectHintShape(g);
    expect(g.d.action).toEqual({ type: 'call' });
  });

  it('E16: river, 5♥4♥ on A♠K♦9♣2♠J♦, pot 20 bb, a visible Rock bets 20 bb: fold (FOLD_PRICE)', () => {
    const g = postflop(
      {
        stacks: [10000, 10000],
        hole: { 1: '5h 4h' },
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
    expectHintShape(g);
    expect(g.obs.pot - 2000).toBe(20 * BB);
    expect(g.d.action).toEqual({ type: 'fold' });
    expect(main(g.d)).toBe('FOLD_PRICE');
    expectRangeAdjust(g);
  });

  it('E17: river, A♠K♦Q♣J♥9♠, 3♣2♦ (the board plays), villain bets pot: fold (BOARD_PLAYS)', () => {
    const g = postflop(
      {
        stacks: [10000, 10000],
        hole: { 0: '3c 2d' },
        board: 'As Kd Qc Jh 9s',
        inputs: [raise(0, 300), call(1), check(1), check(0), check(1), check(0), bet(1, 600)],
      },
      0,
    );
    expectHintShape(g);
    expect(g.d.action).toEqual({ type: 'fold' });
    expect(main(g.d)).toBe('BOARD_PLAYS');
  });

  it('E18: 9 players, 8 bb effective, first to act (k = 8), 9♠4♣: fold (PUSH_FOLD)', () => {
    const g = preflop({ players: 9, bbs: 8, hero: 3, hole: '9s 4c' });
    expectHintShape(g);
    expect(g.d.action).toEqual({ type: 'fold' });
    expect(main(g.d)).toBe('PUSH_FOLD');
  });

  // E19–E22: multiway spots (risk R18). `p` is fair-share relative (§8.2), so a hand is Strong
  // only well above its share of the pot; the old eRange^(1/nOpp) bet E19 and E20 for value and
  // raised over E21's all-in "to protect" a draw.

  it('E19: 9 players limp, K♥10♥ on 7♦7♥3♦ checked to the button (8%): check, never a value bet', () => {
    const limps = [
      call(3),
      call(4),
      call(5),
      call(6),
      call(7),
      call(8),
      call(0),
      call(1),
      check(2),
    ];
    const g = postflop(
      {
        stacks: new Array<number>(9).fill(10000),
        hole: { 0: 'Kh Th' },
        board: '7d 7h 3d',
        inputs: [...limps, ...[1, 2, 3, 4, 5, 6, 7, 8].map(check)],
      },
      0,
    );
    expectHintShape(g);
    expect(g.d.action).toEqual({ type: 'check' });
    expect(['strong', 'monster']).not.toContain(g.d.strength); // 8% at a 9-handed table
  });

  it('E20: 4 players, UTG raises to 2.5 bb, three calls, 8♦7♠ on K♠8♣3♥ checked to the button: check (POT_CONTROL)', () => {
    const g = postflop(
      {
        stacks: [10000, 10000, 10000, 10000],
        hole: { 0: '8d 7s' },
        board: 'Ks 8c 3h',
        inputs: [raise(3, 250), call(0), call(1), call(2), check(1), check(2), check(3)],
      },
      0,
    );
    expectHintShape(g);
    expect(g.d.action).toEqual({ type: 'check' });
    expect(main(g.d)).toBe('POT_CONTROL');
  });

  it('E21: 5 players limp, Q♠J♥9♣, the short big blind goes all-in for 11 bb, A♦10♦ with two behind: fold (FOLD_ALLIN)', () => {
    const g = postflop(
      {
        stacks: [10000, 10000, 1200, 10000, 10000],
        hole: { 3: 'Ad Td' },
        board: 'Qs Jh 9c',
        inputs: [call(3), call(4), call(0), call(1), check(2), check(1), bet(2, 1100)],
      },
      3,
    );
    expectHintShape(g);
    expect(g.d.action).toEqual({ type: 'fold' });
    expect(main(g.d)).toBe('FOLD_ALLIN');
  });

  it('E22: 4 players limp, 8♥8♦ on 8♠7♠2♣ facing a bet and a call: raise (strong hands still raise multiway)', () => {
    const g = postflop(
      {
        stacks: [10000, 10000, 10000, 10000],
        hole: { 0: '8h 8d' },
        board: '8s 7s 2c',
        inputs: [call(3), call(0), call(1), check(2), check(1), bet(2, 300), call(3)],
      },
      0,
    );
    expectHintShape(g);
    expect(g.d.kind).toBe('raise');
    expect(main(g.d)).toBe('NUTS');
    expect(g.d.strength).toBe('monster');
  });

  it('the hint is the coach profile`s decide(): extras, EVs and a close alternative only when close', () => {
    const g = preflop({
      players: 6,
      hero: 0,
      hole: '6c 6d',
      inputs: [fold(3), fold(4), raise(5, 250)],
      labels: { 5: 'tag' },
    });
    expect(codes(g.d)).toContain('WHY_NOT_FOLD');
    expect(codes(g.d)).toContain('WHY_NOT_RAISE');
    expect(g.d.ev.call).toBeDefined();
    if (g.d.confidence !== 'close') expect(g.d.alt).toBeNull();
  });
});
