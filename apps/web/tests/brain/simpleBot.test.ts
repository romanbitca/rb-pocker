/**
 * SimpleBot, the Stage 3 bot and now a scripted self-play baseline (PLAN §18 Stage 3, §0.1
 * `scripts/bots/`): every rule of its spec on real engine states (built with createTable +
 * startHand + step, observed with `observe`), and that it only ever picks legal actions (thousands
 * of seeded hands through `step`). Its think time is `brain/think.ts` (tests/brain/think.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { simpleBotAction } from '../../scripts/bots/simple.ts';
import { randInt, rngFromSeed, deriveSeed } from '../../src/core/rng.ts';
import { observe } from '../../src/engine/observe.ts';
import { startHand } from '../../src/engine/start.ts';
import { step } from '../../src/engine/step.ts';
import type { HandState, Observation, ObserveExtras } from '../../src/engine/types.ts';
import { deal, rigDeck, tableWith } from '../engine/helpers.ts';
import { ADVANCE, bet, call, check, play, raise } from '../engine/play.ts';
import { testSeed } from '../helpers/seed.ts';

const extras = (n: number): ObserveExtras => ({
  seatStats: new Array(n).fill(null),
  visiblePersonality: new Array(n).fill(null),
  seatLevels: new Array(n).fill('easy'),
});

const obsOf = (h: HandState, seat: number): Observation => observe(h, seat, extras(h.seats.length));

/**
 * Heads-up, blinds 50/100, 10,000 each. Seat 1 is the button (small blind) and the bot under test;
 * seat 0 is the big blind. Preflop seat 1 acts first.
 */
function headsUp(bot: string, board = '', stacks: [number, number] = [10000, 10000]): HandState {
  return rigDeck(deal(tableWith(stacks, { button: 1 })), { holes: { 1: bot, 0: '2c 3d' }, board });
}

/** Six seats, 50/100: seat 3 is UTG when the button is seat 0 (SB 1, BB 2). */
function sixMax(holes: Record<number, string>, stacks?: number[]): HandState {
  const table = tableWith(stacks ?? [10000, 10000, 10000, 10000, 10000, 10000], { button: 0 });
  return rigDeck(deal(table), { holes });
}

describe('SimpleBot preflop (§18 Stage 3)', () => {
  it('raises to 3 bb with a pocket pair', () => {
    const h = sixMax({ 3: '7c 7d' });
    expect(h.toAct).toBe(3);
    expect(simpleBotAction(obsOf(h, 3))).toEqual({ type: 'raise', to: 300 });
  });

  it('raises to 3 bb with two cards 10 or higher', () => {
    expect(simpleBotAction(obsOf(sixMax({ 3: 'Ah Td' }), 3))).toEqual({ type: 'raise', to: 300 });
    expect(simpleBotAction(obsOf(sixMax({ 3: 'Jh Qs' }), 3))).toEqual({ type: 'raise', to: 300 });
  });

  it('calls a cheap price (≤ 3 bb) without a pair or two cards ≥ 10', () => {
    // T9: the 9 is below 10. The price is the big blind: 100 ≤ 300.
    expect(simpleBotAction(obsOf(sixMax({ 3: 'Th 9h' }), 3))).toEqual({ type: 'call' });
  });

  it('calls instead of raising when 3 bb is below the minimum raise-to', () => {
    // UTG raises to 400: the next raise needs at least 700; 300 is too small → call.
    const h = play(sixMax({ 4: 'Kh Kd' }), raise(3, 400));
    expect(h.toAct).toBe(4);
    expect(obsOf(h, 4).legal.raise?.min).toBe(700);
    expect(simpleBotAction(obsOf(h, 4))).toEqual({ type: 'call' });
  });

  it('folds a weak hand to a price above 3 bb, and calls exactly 3 bb', () => {
    const big = play(sixMax({ 4: '8h 3d' }), raise(3, 400));
    expect(simpleBotAction(obsOf(big, 4))).toEqual({ type: 'fold' });
    const exact = play(sixMax({ 4: '8h 3d' }), raise(3, 300));
    expect(obsOf(exact, 4).legal.toCall).toBe(300);
    expect(simpleBotAction(obsOf(exact, 4))).toEqual({ type: 'call' });
  });

  it('checks the big blind option with a weak hand, raises it with a strong one', () => {
    // Everyone limps to the big blind (seat 2), who may check for free.
    const limps = (bb: string): HandState =>
      play(sixMax({ 2: bb }), call(3), call(4), call(5), call(0), call(1));
    const weak = limps('9c 4d');
    expect(weak.toAct).toBe(2);
    expect(simpleBotAction(obsOf(weak, 2))).toEqual({ type: 'check' });
    expect(simpleBotAction(obsOf(limps('Ac Kd'), 2))).toEqual({ type: 'raise', to: 300 });
  });

  it('calls instead when raising is not legal (the call is all-in)', () => {
    // Seat 4 has 350: after a raise to 400 it cannot raise, only call all-in.
    const h = play(sixMax({ 4: 'Qc Qd' }, [10000, 10000, 10000, 10000, 350, 10000]), raise(3, 400));
    expect(obsOf(h, 4).legal.raise).toBeNull();
    expect(simpleBotAction(obsOf(h, 4))).toEqual({ type: 'call' });
  });

  it('clamps the raise to its all-in maximum when the stack is short', () => {
    // Seat 3 (UTG) has 250: min raise-to 200, max 250 → 300 is clamped to 250.
    const h = sixMax({ 3: 'Ac Ad' }, [10000, 10000, 10000, 250, 10000, 10000]);
    expect(obsOf(h, 3).legal.raise).toEqual({ min: 200, max: 250 });
    expect(simpleBotAction(obsOf(h, 3))).toEqual({ type: 'raise', to: 250 });
  });
});

describe('SimpleBot postflop (§18 Stage 3)', () => {
  /** The flop after a limp and a check (pot 200); seat 0 (the BB) acts first and then `first`. */
  const flop = (bot: string, board: string, first: 'check' | number): HandState => {
    const h = play(headsUp(bot, board), call(1), check(0), ADVANCE);
    expect(h.street).toBe('flop');
    expect(h.toAct).toBe(0);
    return first === 'check' ? play(h, check(0)) : play(h, bet(0, first));
  };

  it('calls any bet with a pair or better', () => {
    expect(simpleBotAction(obsOf(flop('Ah 7d', 'As 9c 2d', 1000), 1))).toEqual({ type: 'call' });
    // A pair on the board counts too: the bot is simple on purpose.
    expect(simpleBotAction(obsOf(flop('Ah Kd', '9s 9c 2d', 1000), 1))).toEqual({ type: 'call' });
  });

  it('without a pair: folds when the bet is at least half the pot (§0.3 pot), else calls', () => {
    // Pot 200 before the bet. A bet of 200 makes the pot 400: 200 ≥ 400 / 2 → fold.
    expect(simpleBotAction(obsOf(flop('Ah Kd', 'Qs 9c 2d', 200), 1))).toEqual({ type: 'fold' });
    // A bet of 150 makes the pot 350: 150 < 175 → call.
    expect(simpleBotAction(obsOf(flop('Ah Kd', 'Qs 9c 2d', 150), 1))).toEqual({ type: 'call' });
  });

  it('bets half the pot with two pair or better, snapped to the small blind', () => {
    const twoPair = obsOf(flop('Ah 9d', 'As 9c 2d', 'check'), 1);
    expect(twoPair.pot).toBe(200);
    expect(simpleBotAction(twoPair)).toEqual({ type: 'bet', to: 100 });
    const set = obsOf(flop('9h 9d', 'As 9c 2d', 'check'), 1);
    expect(simpleBotAction(set)).toEqual({ type: 'bet', to: 100 });
  });

  it('checks with one pair or less when nobody has bet', () => {
    expect(simpleBotAction(obsOf(flop('Ah 7d', 'As 9c 2d', 'check'), 1))).toEqual({
      type: 'check',
    });
    expect(simpleBotAction(obsOf(flop('Kh 7d', 'As 9c 2d', 'check'), 1))).toEqual({
      type: 'check',
    });
  });

  it('snaps half a pot that is not a multiple of the small blind', () => {
    // Blinds 50/100 with a 3 bb open called: pot 600 → the bot bets 300 on a flop it hits twice.
    let h = play(headsUp('Ah 9d', 'As 9c 2d'), raise(1, 300), call(0), ADVANCE, check(0));
    expect(simpleBotAction(obsOf(h, 1))).toEqual({ type: 'bet', to: 300 });
    // An odd pot: 50/100, SB completes, BB raises to 250, SB calls → pot 500 → 250.
    h = play(headsUp('Ah 9d', 'As 9c 2d'), call(1), raise(0, 250), call(1), ADVANCE, check(0));
    expect(obsOf(h, 1).pot).toBe(500);
    expect(simpleBotAction(obsOf(h, 1))).toEqual({ type: 'bet', to: 250 });
  });
});

describe('SimpleBot always acts legally', () => {
  it('every seat run by SimpleBot finishes 2,000 seeded hands with no refused input', () => {
    const root = testSeed('51b0000000000000000000000000b075');
    const rng = rngFromSeed(root);
    for (let game = 0; game < 2000; game++) {
      const seats = 2 + randInt(rng, 8);
      const stacks = Array.from({ length: seats }, () => 200 + randInt(rng, 20000));
      let h = startHand(tableWith(stacks), deriveSeed(root, 'hand', game));
      for (let n = 0; h.phase !== 'complete'; n++) {
        expect(n).toBeLessThan(400);
        if (h.phase === 'betting') {
          const seat = h.toAct as number;
          h = step(h, { kind: 'act', seat, action: simpleBotAction(obsOf(h, seat)) });
        } else {
          h = step(h, { kind: 'advance' });
        }
      }
    }
  }, 60_000);
});
