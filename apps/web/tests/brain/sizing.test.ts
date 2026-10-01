/**
 * Bet sizing (PLAN §8.7): every row of the texture table, the formulas, the all-in row, the
 * small-blind rounding and the clamp to legal bounds, and the bot size sets (§9.2).
 */
import { describe, expect, it } from 'vitest';
import {
  allInAction,
  allInByRule,
  betFraction,
  fourToAStraight,
  raiseTarget,
  sizeIntent,
  sizingTexture,
  snapToLegal,
  textureBetFraction,
} from '../../src/brain/sizing.ts';
import type { PolicyIntent } from '../../src/brain/types.ts';
import { cards } from '../helpers/cards.ts';
import { synth, synthLegal } from './postflopFixtures.ts';

const flop = { street: 'flop', texture: 'dry', bucket: 'strong', spr: 10 } as const;
const value: PolicyIntent = { kind: 'bet', purpose: 'value', allIn: false };
const raiseValue: PolicyIntent = { kind: 'raise', purpose: 'value', allIn: false };

describe('texture rows (§8.7)', () => {
  it('four to a straight: four distinct ranks in a five-rank window, the Ace low and high', () => {
    expect(fourToAStraight(cards('9c 8d 7h 6s'))).toBe(true);
    expect(fourToAStraight(cards('9c 8d 7h 5s'))).toBe(true);
    expect(fourToAStraight(cards('Ac 2d 3h 4s'))).toBe(true);
    expect(fourToAStraight(cards('Ac Kd Qh Js'))).toBe(true);
    expect(fourToAStraight(cards('Ac 2d 3h 9s'))).toBe(false);
    expect(fourToAStraight(cards('Kc 9d 5h 2s 7c'))).toBe(false);
  });

  it('the Very wet row covers monotone boards and four to a straight even when W says Wet', () => {
    expect(sizingTexture(cards('Ks 7s 2s'), 'wet')).toBe('veryWet'); // W = 2
    expect(sizingTexture(cards('9c 8d 7h 6s'), 'wet')).toBe('veryWet'); // W = 2
    expect(sizingTexture(cards('Kc 7h 2d'), 'dry')).toBe('dry');
    expect(sizingTexture(cards('Qh 7h 2c'), 'dry')).toBe('dry');
    expect(sizingTexture(cards('As Ks Qs'), 'veryWet')).toBe('veryWet');
    expect(sizingTexture([], 'dry')).toBe('dry');
  });

  it('flop/turn value: Dry 1/3 (turn 1/2), Wet 2/3, Very wet 3/4', () => {
    const board = cards('Kc 7h 2d');
    expect(textureBetFraction('value', flop, board)).toBeCloseTo(1 / 3, 12);
    expect(textureBetFraction('value', { ...flop, street: 'turn' }, board)).toBe(0.5);
    expect(textureBetFraction('value', { ...flop, texture: 'wet' }, cards('9h 8h 2s'))).toBeCloseTo(
      2 / 3,
      12,
    );
    expect(textureBetFraction('value', { ...flop, texture: 'veryWet' }, cards('As Ks Qs'))).toBe(
      0.75,
    );
    expect(textureBetFraction('value', { ...flop, texture: 'wet' }, cards('Ks 7s 2s'))).toBe(0.75);
  });

  it('river value: Monster 3/4 (a pot when spr ≤ 1.5); Strong by texture, Dry 1/2', () => {
    const board = cards('Kc 7h 2d 4s 9c');
    const river = { street: 'river', texture: 'dry', bucket: 'monster', spr: 4 } as const;
    expect(textureBetFraction('value', river, board)).toBe(0.75);
    expect(textureBetFraction('value', { ...river, spr: 1.5 }, board)).toBe(1);
    expect(textureBetFraction('value', { ...river, bucket: 'strong' }, board)).toBe(0.5);
    expect(
      textureBetFraction('value', { ...river, bucket: 'strong', texture: 'wet' }, board),
    ).toBeCloseTo(2 / 3, 12);
  });

  it('thin value 1/3, continuation bet 1/3, semi-bluff 1/2 Dry and 2/3 Wet, bot river bluff 2/3', () => {
    const board = cards('Kc 7h 2d');
    expect(textureBetFraction('thinValue', { ...flop, street: 'river' }, board)).toBeCloseTo(
      1 / 3,
      12,
    );
    expect(textureBetFraction('cbet', flop, board)).toBeCloseTo(1 / 3, 12);
    expect(textureBetFraction('semiBluff', flop, board)).toBe(0.5);
    expect(textureBetFraction('semiBluff', { ...flop, texture: 'veryWet' }, board)).toBeCloseTo(
      2 / 3,
      12,
    );
    expect(textureBetFraction('bluff', { ...flop, street: 'river' }, board)).toBeCloseTo(2 / 3, 12);
    expect(textureBetFraction('bluff', { ...flop, street: 'turn' }, board)).toBeCloseTo(1 / 3, 12);
  });

  it('bot size sets (§9.2): half always 1/2; two a pot from 3/4 up, else 1/2', () => {
    const board = cards('As Ks Qs');
    const wet = { ...flop, texture: 'veryWet' } as const;
    expect(betFraction('value', wet, board, 'half')).toBe(0.5);
    expect(betFraction('value', wet, board, 'two')).toBe(1);
    expect(betFraction('value', flop, cards('Kc 7h 2d'), 'two')).toBe(0.5);
    expect(betFraction('value', wet, board, 'texture')).toBe(0.75);
    expect(betFraction('value', wet, board, 'texture+exploit')).toBe(0.75);
  });
});

describe('raise sizes (§8.7)', () => {
  const f = { pot: 800, toCall: 200, position: 'IP', bucket: 'monster' } as const;
  it('texture sets: 3 × the bet in position, 3.5 × out of position', () => {
    expect(raiseTarget('value', f, 200, 'texture')).toBe(600);
    expect(raiseTarget('value', { ...f, position: 'OOP' }, 200, 'texture')).toBe(700);
    expect(raiseTarget('protect', f, 200, 'texture+exploit')).toBe(600);
  });
  it('raise fractions: to = currentBet + f × (pot + toCall); two raises a pot with a Monster', () => {
    expect(raiseTarget('value', f, 200, 'half')).toBe(200 + 0.5 * 1000);
    expect(raiseTarget('value', f, 200, 'two')).toBe(200 + 1000);
    expect(raiseTarget('protect', f, 200, 'two')).toBe(200 + 0.5 * 1000);
    expect(raiseTarget('value', { ...f, bucket: 'strong' }, 200, 'two')).toBe(700);
  });
});

describe('the all-in row and snapping (§8.7)', () => {
  it('all-in when spr ≤ 1, or when the bet leaves < 25% of the pot (after a call) behind', () => {
    expect(allInByRule(100, { pot: 600, effStack: 600, spr: 1 }, 0, 0)).toBe(true);
    // 1/3 pot into 600 with 9,700 behind: far from all-in.
    expect(allInByRule(200, { pot: 600, effStack: 9700, spr: 16 }, 0, 0)).toBe(false);
    // 750 into 1,000 with 1,200: 450 behind against a 2,500 pot (18%).
    expect(allInByRule(750, { pot: 1000, effStack: 1200, spr: 1.2 }, 0, 0)).toBe(true);
    // 667 into 1,000 with 2,000: 1,333 behind against 2,334 (57%).
    expect(allInByRule(667, { pot: 1000, effStack: 2000, spr: 2 }, 0, 0)).toBe(false);
    // A raise: the pot after it counts the hero's added chips and the caller's.
    expect(allInByRule(600, { pot: 800, effStack: 900, spr: 1.5 }, 0, 200)).toBe(true);
  });

  it('rounds to a multiple of the small blind, then clamps to the legal bounds', () => {
    const legal = synthLegal(0, 9700, 0, 0, 100);
    expect(snapToLegal(233.3, legal, 50, 0)).toEqual({
      action: { type: 'bet', to: 250 },
      kind: 'bet',
    });
    expect(snapToLegal(224.9, legal, 50, 0).action).toEqual({ type: 'bet', to: 200 });
    expect(snapToLegal(60, legal, 50, 0).action).toEqual({ type: 'bet', to: 100 }); // the min bet
    expect(snapToLegal(20000, legal, 50, 0)).toEqual({
      action: { type: 'bet', to: 9700 },
      kind: 'allin',
    });
  });

  it('at or below the call amount the action becomes a call (a check when nothing is to call)', () => {
    expect(snapToLegal(10, synthLegal(0, 9700, 0, 0, 100), 50, 0).action).toEqual({
      type: 'check',
    });
    const facing = synthLegal(200, 9700, 0, 200, 100);
    expect(snapToLegal(220, facing, 50, 0).action).toEqual({ type: 'call' });
    expect(snapToLegal(260, facing, 50, 0).action).toEqual({ type: 'raise', to: 400 }); // min raise
    expect(snapToLegal(Number.NaN, facing, 50, 0).action).toEqual({ type: 'call' });
    // No raise is legal (the call is all-in): call.
    expect(snapToLegal(900, synthLegal(500, 300, 0, 500, 100), 50, 0).action).toEqual({
      type: 'call',
    });
  });

  it('an odd all-in amount stays legal; allInAction is the legal maximum', () => {
    const legal = synthLegal(200, 1234, 0, 200, 100);
    expect(snapToLegal(5000, legal, 50, 0)).toEqual({
      action: { type: 'raise', to: 1234 },
      kind: 'allin',
    });
    expect(allInAction(legal)).toEqual({ action: { type: 'raise', to: 1234 }, kind: 'allin' });
    expect(allInAction(synthLegal(0, 777, 0, 0, 100)).action).toEqual({ type: 'bet', to: 777 });
    expect(allInAction(synthLegal(500, 300, 0, 500, 100))).toEqual({
      action: { type: 'call' },
      kind: 'call',
    });
  });
});

describe('sizeIntent (§8.7 pipeline)', () => {
  it('E11 shape: a Dry flop value bet of 1/3 pot is 2 bb', () => {
    const { f, spot } = synth({ hole: '7s 7d', board: 'Kc 7h 2d', E: 0.95, pot: 600, spr: 16 });
    expect(sizeIntent(value, f, spot)).toEqual({ action: { type: 'bet', to: 200 }, kind: 'bet' });
  });

  it('fold only when there is something to call; check and call are passive', () => {
    const free = synth({ hole: '7c 2d', board: 'As Ks Qs', E: 0.1, pot: 600 });
    const fold: PolicyIntent = { kind: 'fold', purpose: null, allIn: false };
    expect(sizeIntent(fold, free.f, free.spot).action).toEqual({ type: 'check' }); // C6
    const facing = synth({ hole: '7c 2d', board: 'As Ks Qs', E: 0.1, pot: 800, toCall: 200 });
    expect(sizeIntent(fold, facing.f, facing.spot)).toEqual({
      action: { type: 'fold' },
      kind: 'fold',
    });
    const call: PolicyIntent = { kind: 'call', purpose: null, allIn: false };
    expect(sizeIntent(call, facing.f, facing.spot).action).toEqual({ type: 'call' });
    const check: PolicyIntent = { kind: 'check', purpose: null, allIn: false };
    expect(sizeIntent(check, free.f, free.spot).kind).toBe('check');
  });

  it('a bet or raise with no legal bet or raise becomes passive', () => {
    const { f, spot } = synth({
      hole: '7s 7d',
      board: 'Kc 7h 2d',
      E: 0.95,
      pot: 600,
      legal: { bet: null },
    });
    expect(sizeIntent(value, f, spot).action).toEqual({ type: 'check' });
  });

  it('a committed raise goes all-in; a raise uses 3× / 3.5× the bet', () => {
    const s = synth({ hole: 'Ks Kd', board: 'Kc 7h 2d', E: 0.95, pot: 800, toCall: 200 });
    expect(sizeIntent(raiseValue, s.f, s.spot).action).toEqual({ type: 'raise', to: 600 });
    expect(sizeIntent({ ...raiseValue, allIn: true }, s.f, s.spot)).toEqual({
      action: { type: 'raise', to: 10000 },
      kind: 'allin',
    });
    const oop = synth({
      hole: 'Ks Kd',
      board: 'Kc 7h 2d',
      E: 0.95,
      pot: 800,
      toCall: 200,
      position: 'OOP',
    });
    expect(sizeIntent(raiseValue, oop.f, oop.spot).action).toEqual({ type: 'raise', to: 700 });
  });

  it('texture sets apply the all-in row; half and two do not', () => {
    const low = synth({ hole: 'Ks Kd', board: 'Kc 7h 2d', E: 0.95, pot: 600, spr: 0.9 });
    expect(sizeIntent(value, low.f, low.spot).kind).toBe('allin');
    expect(sizeIntent(value, low.f, low.spot, 'half').action).toEqual({ type: 'bet', to: 300 });
    expect(sizeIntent(value, low.f, low.spot, 'two').action).toEqual({ type: 'bet', to: 300 });
  });

  it('a bet without a purpose sizes as value', () => {
    const { f, spot } = synth({ hole: '7s 7d', board: 'Kc 7h 2d', E: 0.95, pot: 600 });
    const bare: PolicyIntent = { kind: 'bet', purpose: null, allIn: false };
    expect(sizeIntent(bare, f, spot).action).toEqual({ type: 'bet', to: 200 });
  });
});
