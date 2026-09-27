import { describe, expect, it } from 'vitest';
import {
  blindSeats,
  dealOrder,
  firstToAct,
  isActive,
  isLive,
  nextSeat,
  put,
  roundComplete,
} from '../../src/engine/rules.ts';
import { refundUncalled } from '../../src/engine/settle.ts';
import type { HandState, SeatState } from '../../src/engine/types.ts';
import { clone, handAtStart, headsUpFlop } from './fixtures.ts';
import { checked } from './helpers.ts';

const seat = (h: HandState, i: number): SeatState => h.seats[i] as SeatState;

const seatState = (over: Partial<SeatState> = {}): SeatState => ({
  dealtIn: true,
  stack: 1000,
  hole: null,
  folded: false,
  allIn: false,
  streetBet: 0,
  totalBet: 0,
  lastActedAtBet: null,
  ...over,
});

describe('rules: seats', () => {
  it('live = dealt in and not folded; active = live and not all-in (§3.7)', () => {
    expect(isLive(seatState())).toBe(true);
    expect(isLive(seatState({ folded: true }))).toBe(false);
    expect(isLive(seatState({ dealtIn: false }))).toBe(false);
    expect(isLive(seatState({ allIn: true }))).toBe(true);
    expect(isActive(seatState({ allIn: true }))).toBe(false);
    expect(isActive(seatState())).toBe(true);
  });

  it('nextSeat goes clockwise strictly after a seat, wrapping, the seat itself last', () => {
    expect(nextSeat(6, 4, () => true)).toBe(5);
    expect(nextSeat(6, 5, () => true)).toBe(0);
    expect(nextSeat(6, 2, (s) => s === 2)).toBe(2);
    expect(nextSeat(6, 2, () => false)).toBeNull();
  });

  it('dealOrder starts left of the button and ends on it (§3.4)', () => {
    expect(dealOrder([true, true, true, true], 1)).toEqual([2, 3, 0, 1]);
    expect(dealOrder([true, false, true, true, false], 3)).toEqual([0, 2, 3]);
    expect(dealOrder([true, true], 0)).toEqual([1, 0]); // heads-up: the BB first
  });

  it('blindSeats: heads-up the button is the SB; otherwise the next two dealt-in seats', () => {
    expect(blindSeats([true, true], 1)).toEqual({ sbSeat: 1, bbSeat: 0 });
    expect(blindSeats([true, true, true], 2)).toEqual({ sbSeat: 0, bbSeat: 1 });
    expect(blindSeats([true, false, true, false, true], 4)).toEqual({ sbSeat: 0, bbSeat: 2 });
    expect(blindSeats([false, true, false, true], 1)).toEqual({ sbSeat: 1, bbSeat: 3 });
    expect(() => blindSeats([true, false, false], 0)).toThrow(RangeError);
    expect(() => blindSeats([true, false, true], 1)).toThrow(RangeError);
  });

  it('put moves at most the stack and marks the seat all-in when it runs out (§4.3)', () => {
    const s = seatState({ stack: 70, streetBet: 30, totalBet: 130 });
    expect(put(s, 50)).toBe(50);
    expect(s).toMatchObject({ stack: 20, streetBet: 80, totalBet: 180, allIn: false });
    expect(put(s, 500)).toBe(20);
    expect(s).toMatchObject({ stack: 0, streetBet: 100, totalBet: 200, allIn: true });
  });
});

describe('rules: betting round and first to act (§3.7)', () => {
  it('preflop the first active seat after the BB acts first; heads-up that is the button', () => {
    expect(firstToAct(handAtStart({ stacks: [1000, 1000], button: 0 }))).toBe(0);
    expect(firstToAct(handAtStart({ stacks: [1000, 1000, 1000, 1000], button: 0 }))).toBe(3);
    // A seat that cannot act (here flagged all-in) is skipped.
    const h = handAtStart({ stacks: [1000, 1000, 1000, 1000], button: 0 });
    seat(h, 3).allIn = true;
    expect(firstToAct(h)).toBe(0);
  });

  it('after the flop the first active seat after the button acts first', () => {
    const h = headsUpFlop();
    expect(firstToAct(h)).toBe(1); // heads-up: the BB, the button acts last
    seat(h, 1).allIn = true;
    expect(firstToAct(h)).toBe(0);
    seat(h, 0).allIn = true;
    expect(firstToAct(h)).toBeNull();
  });

  it('two or more active seats: over when all acted and matched the bet', () => {
    const h = headsUpFlop();
    expect(roundComplete(h)).toBe(false);
    seat(h, 1).lastActedAtBet = 0;
    expect(roundComplete(h)).toBe(false);
    seat(h, 0).lastActedAtBet = 0;
    expect(roundComplete(h)).toBe(true);
    h.currentBet = 100;
    seat(h, 1).streetBet = 100;
    expect(roundComplete(h)).toBe(false); // seat 0 has not matched
  });

  it('one active seat: over once it faces no bet (B34: a short all-in BB still gets called or folded to)', () => {
    const shortBB = handAtStart({ stacks: [10000, 30], button: 0 });
    expect(roundComplete(shortBB)).toBe(false); // SB 50 < currentBet 100
    // Heads-up with an all-in SB of 40: right after the blinds the BB (100 in) faces no bet.
    // (handAtStart has already refunded the BB's uncalled 60; put it back to see the blinds.)
    const shortSB = handAtStart({ stacks: [40, 10000], button: 0 });
    seat(shortSB, 1).streetBet = 100;
    expect(roundComplete(shortSB)).toBe(true);
  });

  it('no active seat: over', () => {
    // Both blinds all-in for 40: nothing is uncalled, nobody can act.
    const h = handAtStart({ stacks: [40, 40], button: 0 });
    expect(h.seats.every((s) => s.allIn)).toBe(true);
    expect(roundComplete(h)).toBe(true);
  });
});

describe('settle: refundUncalled (§3.8)', () => {
  it('returns the uncalled part to the top bettor, logs it, and is idempotent', () => {
    const h = handAtStart({ stacks: [10000, 10000, 10000], button: 0 });
    seat(h, 0).folded = true;
    seat(h, 1).folded = true;
    refundUncalled(h);
    expect(seat(h, 2)).toMatchObject({ streetBet: 50, totalBet: 50, stack: 9950 });
    expect(h.log[h.log.length - 1]).toEqual({ e: 'refund', seat: 2, amount: 50 });
    const once = clone(h);
    refundUncalled(h);
    expect(h).toStrictEqual(once);
  });

  it('refunds a folded small blind that has more in than a short all-in BB (B34)', () => {
    const h = handAtStart({ stacks: [10000, 10000, 30], button: 0 });
    seat(h, 0).folded = true;
    seat(h, 1).folded = true;
    refundUncalled(h);
    expect(seat(h, 1)).toMatchObject({ folded: true, streetBet: 30, totalBet: 30, stack: 9970 });
    expect(h.log[h.log.length - 1]).toEqual({ e: 'refund', seat: 1, amount: 20 });
  });

  it('gives an all-in seat its chips back and clears allIn (I7)', () => {
    const h = handAtStart({ stacks: [40, 80], button: 0 });
    expect(seat(h, 1)).toMatchObject({ allIn: false, stack: 40, totalBet: 40 });
    checked(h);
  });

  it('does nothing when the bets are level or nobody has bet', () => {
    const h = headsUpFlop();
    const before = clone(h);
    refundUncalled(h);
    expect(h).toStrictEqual(before);
  });
});
