import { describe, expect, it } from 'vitest';
import { legalActions, raiseReopened } from '../../src/engine/legal.ts';
import type { HandState } from '../../src/engine/types.ts';
import { deal, tableWith } from './helpers.ts';
import { ADVANCE, bet, call, check, fold, legalOf, play, raise, seatOf } from './play.ts';

describe('legalActions (§3.5)', () => {
  it('is the full picture for the first decision preflop', () => {
    // 0 = BTN, 1 = SB, 2 = BB: the button acts first, facing the big blind.
    const h = deal(tableWith([10000, 10000, 10000], { button: 0 }));
    expect(legalActions(h)).toStrictEqual({
      seat: 0,
      toCall: 100,
      callAmount: 100,
      callIsAllIn: false,
      canFold: true,
      canCheck: false,
      canCall: true,
      bet: null,
      raise: { min: 200, max: 10000 },
    });
  });

  it('is null outside the betting phase', () => {
    const over = play(deal(tableWith([10000, 10000], { button: 0 })), call(0), check(1));
    expect(over.phase).toBe('roundComplete');
    expect(legalActions(over)).toBeNull();
    const won = play(deal(tableWith([10000, 10000], { button: 0 })), fold(0));
    expect(legalActions(won)).toBeNull();
  });

  it('a short stack calls all-in for what it has and cannot raise', () => {
    // 0 = BTN (60): faces 100 with 60.
    const h = deal(tableWith([60, 10000, 10000], { button: 0 }));
    expect(legalOf(h)).toMatchObject({
      toCall: 100,
      callAmount: 60,
      callIsAllIn: true,
      raise: null,
    });
    const after = play(h, call(0));
    expect(seatOf(after, 0)).toMatchObject({ stack: 0, allIn: true, streetBet: 60 });
    expect(after.currentBet).toBe(100); // a short call raises nothing
  });

  it('bets start at the big blind, or at the whole stack when that is less', () => {
    const flop = play(deal(tableWith([10000, 10000], { button: 0 })), call(0), check(1), ADVANCE);
    expect(legalOf(flop).bet).toEqual({ min: 100, max: 9900 });
    const short = play(deal(tableWith([150, 10000], { button: 0 })), call(0), check(1), ADVANCE);
    const facing = play(short, bet(1, 100));
    // The button has 50 left: calling 100 is all-in for 50, and it cannot raise.
    expect(legalOf(facing)).toMatchObject({ callAmount: 50, callIsAllIn: true, raise: null });
  });

  it('raiseReopened measures from the level where the seat last acted', () => {
    const h = play(
      deal(tableWith([10000, 10000, 10000, 10000], { button: 0 })),
      raise(3, 300), // UTG: minRaiseInc 200
    );
    const at = (s: HandState, seat: number): boolean => raiseReopened(s, seatOf(s, seat));
    expect(at(h, 0)).toBe(true); // has not acted
    expect(at(h, 3)).toBe(false); // acted at 300, the bet is still 300
    const reraised = play(h, raise(0, 500)); // exactly +200: a full raise
    expect(at(reraised, 3)).toBe(true);
  });
});
