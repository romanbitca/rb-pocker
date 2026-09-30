/**
 * PLAN §8.2 features on spots played through the real engine, plus the range checks of the
 * Appendix E spots that exercise RANGE_ADJUST (E9, E13, E16): the full hint is chunk 5.7; here
 * the coach's range settings must give an `eRange` that tells the policy the right thing and a
 * RANGE_ADJUST flag that follows the §8.10 rule.
 */
import { describe, expect, it } from 'vitest';
import { equity } from '../../src/analysis/equity.ts';
import { preflopEquity } from '../../src/analysis/preflop.ts';
import {
  bucketOf,
  coachSeed,
  facingOf,
  features,
  hudEquity,
  showsRangeAdjust,
  textureOf,
  textureScore,
} from '../../src/brain/features.ts';
import { rankPctOfClass } from '../../src/brain/rangesData.ts';
import { classOf } from '../../src/core/cards.ts';
import type { Seed128 } from '../../src/core/rng.ts';
import type { Observation } from '../../src/engine/types.ts';
import { cards } from '../helpers/cards.ts';
import { bet, call, check, fold, raise } from '../engine/play.ts';
import { COACH_LIKE, observeSpot, playSpot, testProfile } from './fixtures.ts';

const SEED: Seed128 = '0000000000000000000000000000feed';
const BOT = testProfile('reweight', 300);
const SIX = [10000, 10000, 10000, 10000, 10000, 10000];

describe('features (§8.2)', () => {
  it('pot, toCall, need, effective stack and SPR on a turn shove (E13 shape)', () => {
    const h = playSpot({
      stacks: [5500, 5500],
      button: 0,
      holes: { 0: 'As Kd', 1: '9c 9d' },
      board: 'Kh 8c 4d 2s 7h',
      inputs: [raise(0, 300), call(1), check(1), bet(0, 1200), call(1), bet(1, 4000)],
    });
    const f = features(observeSpot(h, 0), BOT, SEED, 0.5);
    expect(f).toMatchObject({ street: 'turn', pot: 7000, toCall: 4000, winPot: 7000 });
    expect(f.need).toBeCloseTo(4000 / 11000, 12);
    expect(f.effStack).toBe(4000);
    expect(f.effBB).toBe(40);
    expect(f.spr).toBeCloseTo(4000 / 3000, 12);
    expect(f.facing).toBe('allin');
    expect(f.position).toBe('IP');
    expect(f.nOpp).toBe(1);
    expect(f.wasPreflopAggressor).toBe(true);
    expect(f.k).toBe(0);
    expect(f.eRandom).toBe(0.5);
    expect(f.handInfo.category).toBe('pair');
  });

  it('winPot and need when the hero cannot cover the bet (the §0.3 example: 25%, not 8%)', () => {
    // 50 each in (pot 100), the villain bets 500 more (pot 600), the hero has 50 left.
    const h = playSpot({
      stacks: [100, 1100],
      button: 0,
      bb: 2,
      inputs: [raise(0, 50), call(1), check(1), check(0), check(1), check(0), bet(1, 500)],
    });
    const f = features(observeSpot(h, 0), BOT, SEED, 0.5);
    expect(f).toMatchObject({ pot: 600, toCall: 50, winPot: 150 });
    expect(f.need).toBeCloseTo(0.25, 12);
  });

  it('k counts players after the hero in preflop order who can still act', () => {
    const utg = features(
      observeSpot(playSpot({ stacks: SIX, button: 0, inputs: [] }), 3),
      BOT,
      SEED,
      0.5,
    );
    expect(utg).toMatchObject({
      k: 5,
      facing: 'none',
      street: 'preflop',
      bucket: null,
      texture: null,
    });
    const btn = playSpot({ stacks: SIX, button: 0, inputs: [fold(3), fold(4), fold(5)] });
    expect(features(observeSpot(btn, 0), BOT, SEED, 0.5).k).toBe(2);
    const sb = playSpot({ stacks: SIX, button: 0, inputs: [fold(3), fold(4), fold(5), fold(0)] });
    const f = features(observeSpot(sb, 1), BOT, SEED, 0.5);
    expect(f.k).toBe(1);
    expect(f.effStack).toBe(10000); // chips at the street's start: the posted blind counts
    expect(f.spr).toBeCloseTo(10000 / 150, 12); // preflop: effective stack ÷ the blinds
  });

  it('facing: limpers, open, 3-bet, 4-bet+, all-in preflop; bet and raise after the flop', () => {
    const at = (inputs: Parameters<typeof playSpot>[0]['inputs'], seat: number, stacks = SIX) =>
      facingOf(observeSpot(playSpot({ stacks, button: 0, inputs }), seat));
    expect(at([call(3)], 4)).toBe('limpers');
    expect(at([raise(3, 250)], 4)).toBe('open');
    expect(at([raise(3, 250), raise(4, 800)], 5)).toBe('3bet');
    expect(at([raise(3, 250), raise(4, 800), raise(5, 2000)], 0)).toBe('4bet+');
    expect(at([raise(3, 10000)], 4)).toBe('allin');
    const three = [10000, 10000, 10000];
    const flop = [raise(0, 250), fold(1), call(2)];
    expect(at(flop, 2, three)).toBe('none');
    expect(at([...flop, bet(2, 200)], 0, three)).toBe('bet');
    expect(at([...flop, bet(2, 200), raise(0, 600)], 2, three)).toBe('raise');
  });

  it('position: last to act after the flop among players who can act', () => {
    const h = playSpot({
      stacks: [10000, 10000, 10000],
      button: 0,
      inputs: [call(0), call(1), check(2)],
    });
    expect(features(observeSpot(h, 1), BOT, SEED, 0.5).position).toBe('OOP');
    const hu = playSpot({ stacks: [10000, 10000], button: 0, inputs: [call(0), check(1)] });
    expect(features(observeSpot(hu, 1), BOT, SEED, 0.5).position).toBe('OOP');
    expect(features(observeSpot(hu, 0), BOT, SEED, 0.5).position).toBe('IP');
  });

  it('texture W: suits, connected ranks (gap ≤ 2, at most 2), minus a pair', () => {
    expect(textureOf([])).toBeNull();
    expect(textureScore(cards('Kc 7h 2d'))).toBe(0); // E11: Dry
    expect(textureOf(cards('Qh 7h 2c'))).toBe('dry'); // two of a suit: W = 1
    expect(textureOf(cards('9h 8h 2s'))).toBe('wet'); // 1 + one connected pair
    expect(textureScore(cards('As Ks Qs'))).toBe(4); // monotone + 2 connected: Very wet
    expect(textureOf(cards('As Ks Qs'))).toBe('veryWet');
    expect(textureScore(cards('Kc Kd 7h'))).toBe(-1); // paired
    expect(textureScore(cards('9c 7d 5s 3h'))).toBe(2); // three gaps of 2, capped at 2
  });

  it('buckets from p (Loki thresholds); Draw only with ≥ 8 outs before the river', () => {
    expect(bucketOf(0.9, 0, 'flop')).toBe('monster');
    expect(bucketOf(0.85, 0, 'flop')).toBe('monster');
    expect(bucketOf(0.7, 0, 'turn')).toBe('strong');
    expect(bucketOf(0.5, 0, 'river')).toBe('medium');
    expect(bucketOf(0.3, 9, 'flop')).toBe('draw');
    expect(bucketOf(0.3, 7, 'flop')).toBe('air');
    expect(bucketOf(0.3, 9, 'river')).toBe('air');
    expect(bucketOf(0.9, 0, 'preflop')).toBeNull();
  });

  it('RANGE_ADJUST (§8.10): a 5-point gap, or need strictly between the rounded numbers', () => {
    expect(showsRangeAdjust(0.62, 0.35, 0.2)).toBe(true);
    expect(showsRangeAdjust(0.62, 0.57, 0.2)).toBe(true); // exactly 5 points
    expect(showsRangeAdjust(0.27, 0.24, 0.25)).toBe(true); // "win 27%, need 25%" would mislead
    expect(showsRangeAdjust(0.27, 0.24, 0.2)).toBe(false);
    expect(showsRangeAdjust(0.27, 0.24, 0)).toBe(false);
  });

  it('eRandom: the given value; the coach computes the HUD number; a bot uses eRange', () => {
    const h = playSpot({ stacks: SIX, button: 0, inputs: [raise(3, 250)] });
    const obs = observeSpot(h, 4);
    const coach = features(obs, COACH_LIKE, coachSeed(obs));
    expect(coach.eRandom).toBe(preflopEquity(obs.hole, 5).equity);
    expect(coach.eRandom).toBe(hudEquity(obs));
    const bot = features(obs, BOT, SEED);
    expect(bot.eRandom).toBe(bot.eRange);
    expect(features(obs, COACH_LIKE, SEED, 0.4).eRandom).toBe(0.4);
    expect(bot.rankPct).toBe(rankPctOfClass(classOf(obs.hole[0], obs.hole[1])));
  });

  it('hudEquity: the preflop table, else equity(); 1 when nobody is left', () => {
    const flop = playSpot({
      stacks: [10000, 10000, 10000],
      button: 0,
      inputs: [call(0), call(1), check(2)],
    });
    const obs = observeSpot(flop, 0);
    expect(hudEquity(obs)).toBe(equity({ hero: obs.hole, board: obs.board, nOpp: 2 }).equity);
    const alone: Observation = { ...obs, folded: [false, true, true] };
    expect(hudEquity(alone)).toBe(1);
    const f = features(alone, BOT, SEED);
    expect(f).toMatchObject({ nOpp: 0, eRange: 1, p: 1 });
  });

  it('coachSeed is §2.4 deriveSeed(ZERO_SEED, "coach|" + observationKey): stable per observation', () => {
    const h = playSpot({ stacks: SIX, button: 0, inputs: [raise(3, 250)] });
    const a = observeSpot(h, 4);
    expect(coachSeed(a)).toBe(coachSeed(JSON.parse(JSON.stringify(a)) as Observation));
    expect(coachSeed(a)).not.toBe(coachSeed(observeSpot(h, 5)));
  });
});

describe('Appendix E spots with RANGE_ADJUST (E9, E13, E16): the coach’s range view', () => {
  it('E9: A♥K♥ on Q♥7♥2♣ facing 2 bb into 6 bb: eRange clears the price (never fold)', () => {
    const h = playSpot({
      stacks: [10000, 10000],
      button: 0,
      holes: { 0: 'Ah Kh' },
      board: 'Qh 7h 2c',
      inputs: [raise(0, 300), call(1), bet(1, 200)],
    });
    const obs = observeSpot(h, 0);
    const f = features(obs, COACH_LIKE, coachSeed(obs));
    expect(f.need).toBeCloseTo(0.2, 12);
    expect(f.eRange).toBeGreaterThan(f.need + 0.15);
    expect(f.eRange).toBeLessThan(f.eRandom); // a bettor holds better hands than random ones
    expect(f.rangeAdjust).toBe(showsRangeAdjust(f.eRandom, f.eRange, f.need));
  });

  it('E13: A♠K♦ on K♥8♣4♦2♠, villain all-in 40 bb into 30 bb: the range is stronger than random', () => {
    const h = playSpot({
      stacks: [5500, 5500],
      button: 0,
      holes: { 0: 'As Kd' },
      board: 'Kh 8c 4d 2s',
      inputs: [raise(0, 300), call(1), check(1), bet(0, 1200), call(1), bet(1, 4000)],
    });
    const obs = observeSpot(h, 0);
    const f = features(obs, COACH_LIKE, coachSeed(obs));
    expect(f.eRandom - f.eRange).toBeGreaterThanOrEqual(0.05);
    expect(f.rangeAdjust).toBe(true);
    expect(f.spr).toBeLessThanOrEqual(3); // committed territory (§8.5 step 6)
  });

  it('E16: 5♥4♥ on A♠K♦9♣2♠J♦, a visible Rock bets pot on the river: eRange is below need', () => {
    const h = playSpot({
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
    });
    const obs = observeSpot(h, 1, { labels: ['rock', null], levels: ['medium', 'medium'] });
    const f = features(obs, COACH_LIKE, coachSeed(obs));
    expect(f.pot).toBe(4000);
    expect(f.need).toBeCloseTo(1 / 3, 12);
    expect(f.eRange).toBeLessThan(f.need);
    expect(f.eRange).toBeLessThanOrEqual(f.eRandom);
    expect(f.rangeAdjust).toBe(showsRangeAdjust(f.eRandom, f.eRange, f.need));
  });
});
