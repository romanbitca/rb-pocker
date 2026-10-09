/**
 * The §8.10 strength meter against the advice (risk R18, pitfall 34): the meter shows the band of
 * the per-opponent strength `p` (§8.2), and it never argues against the move: next to a fold it
 * shows at most Decent, next to a bet or raise at least Marginal unless the main reason names a
 * bluff (SEMI_BLUFF, CBET_DRY, PUSH_FOLD). The two cases the owner reported are regressions here,
 * played by the real engine and asked through `hint()`. The property over 2,000 engine-built hints
 * is in `hint.property.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { BLUFF_REASONS, deliberate, hint, meterStrength } from '../../src/brain/decide.ts';
import { coachSeed } from '../../src/brain/features.ts';
import { COACH } from '../../src/brain/profiles.ts';
import type { Decision, ReasonCode } from '../../src/brain/types.ts';
import type { PlayerAction } from '../../src/engine/types.ts';
import { call, check } from '../engine/play.ts';
import { observeSpot, playSpot } from './fixtures.ts';

const FOLD: PlayerAction = { type: 'fold' };
const CHECK: PlayerAction = { type: 'check' };
const CALL: PlayerAction = { type: 'call' };
const BET: PlayerAction = { type: 'bet', to: 300 };
const RAISE: PlayerAction = { type: 'raise', to: 900 };

const S = (players: number): number[] => new Array<number>(players).fill(10000);

describe('meterStrength (§8.10): the band of p, never against the move', () => {
  const bands: [number, Decision['strength']][] = [
    [0.2, 'weak'],
    [0.4, 'marginal'],
    [0.5, 'decent'],
    [0.7, 'strong'],
    [0.9, 'monster'],
  ];

  it('checks and calls show the band of p', () => {
    for (const [p, band] of bands) {
      expect(meterStrength(p, CHECK, 'POT_CONTROL')).toBe(band);
      expect(meterStrength(p, CALL, 'CALL_PROFITABLE')).toBe(band);
    }
  });

  it('a fold shows at most Decent: the price or the seat says fold, not the hand', () => {
    expect(meterStrength(0.9, FOLD, 'FOLD_ALLIN')).toBe('decent');
    expect(meterStrength(0.7, FOLD, 'FOLD_PRICE')).toBe('decent');
    expect(meterStrength(0.5, FOLD, 'FOLD_RANGE')).toBe('decent');
    expect(meterStrength(0.4, FOLD, 'FOLD_RANGE')).toBe('marginal');
    expect(meterStrength(0.2, FOLD, 'FOLD_RANGE')).toBe('weak');
  });

  it('a value bet or raise shows at least Marginal; a bluff that says so may show Weak', () => {
    const value: ReasonCode[] = ['VALUE_BET', 'THIN_VALUE', 'OPEN_RANGE', 'NUTS', 'VALUE_RAISE'];
    for (const code of value) {
      expect(meterStrength(0.2, BET, code)).toBe('marginal');
      expect(meterStrength(0.2, RAISE, code)).toBe('marginal');
    }
    expect(meterStrength(0.2, RAISE, undefined)).toBe('marginal');
    expect([...BLUFF_REASONS].sort()).toEqual(['CBET_DRY', 'PUSH_FOLD', 'SEMI_BLUFF']);
    for (const code of BLUFF_REASONS) {
      expect(meterStrength(0.2, BET, code)).toBe('weak');
      expect(meterStrength(0.2, RAISE, code)).toBe('weak');
    }
    for (const [p, band] of bands.slice(1))
      expect(meterStrength(p, RAISE, 'VALUE_RAISE')).toBe(band);
  });
});

describe('the reported cases (risk R18)', () => {
  it('6 players, Q♠3♠ first to act (17%, the fair share): fold next to Decent, not Strong', () => {
    const obs = observeSpot(
      playSpot({ stacks: S(6), button: 0, holes: { 3: 'Qs 3s' }, inputs: [] }),
      3,
    );
    const { decision: d, f } = deliberate(obs, COACH, coachSeed(obs), null);
    expect(f.nOpp).toBe(5);
    expect(d.eRandom).toBeGreaterThan(0.16); // the HUD's 17%
    expect(d.eRandom).toBeLessThan(0.18);
    expect(d.action).toEqual(FOLD);
    expect(d.trace[0]?.code).toBe('FOLD_RANGE');
    expect(Math.abs(f.p - 0.5)).toBeLessThan(0.03); // was 0.70 with eRange^(1/nOpp)
    expect(d.strength).toBe('decent');
    expect(d).toEqual(hint(obs, null));
  });

  it('5 players, 8♣7♦ on A♥K♦9♠ checked to the hero (6%): Weak, not Decent', () => {
    const h = playSpot({
      stacks: S(5),
      button: 0,
      holes: { 0: '8c 7d' },
      board: 'Ah Kd 9s',
      inputs: [
        call(3),
        call(4),
        call(0),
        call(1),
        check(2),
        check(1),
        check(2),
        check(3),
        check(4),
      ],
    });
    const obs = observeSpot(h, 0);
    const { decision: d, f } = deliberate(obs, COACH, coachSeed(obs), null);
    expect(f.nOpp).toBe(4);
    expect(d.eRandom).toBeGreaterThan(0.05); // the HUD's 6%
    expect(d.eRandom).toBeLessThan(0.07);
    expect(f.eRange).toBeLessThan(0.08);
    expect(f.p).toBeLessThan(0.35); // was 0.49 with eRange^(1/nOpp)
    expect(d.action).toEqual(CHECK);
    expect(d.strength).toBe('weak');
  });

  it('9 players, 7♣2♦ first to act (E2, about 5%): fold next to Weak, not Strong', () => {
    const obs = observeSpot(
      playSpot({ stacks: S(9), button: 0, holes: { 3: '7c 2d' }, inputs: [] }),
      3,
    );
    const d = hint(obs, null);
    expect(d.action).toEqual(FOLD);
    expect(d.strength).toBe('weak');
  });

  it('6 players, A♠A♥ first to act (E1): a raise next to Strong', () => {
    const obs = observeSpot(
      playSpot({ stacks: S(6), button: 0, holes: { 3: 'As Ah' }, inputs: [] }),
      3,
    );
    const d = hint(obs, null);
    expect(d.kind).toBe('raise');
    expect(d.strength).toBe('strong');
  });
});
