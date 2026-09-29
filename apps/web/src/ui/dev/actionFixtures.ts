/**
 * Spots for the dev-only action bar preview (`?preview=actions`): one per row of the PLAN §12.7
 * table, plus a preflop open, a 3-bet and a deep stack. Blinds 10/20 unless noted. Written by
 * hand, because the UI may not run the engine (PLAN §2.1); the numbers follow §3.5 (the unit
 * tests drive the real engine instead).
 */
import type { ActionBarInput, SeatChips } from '../actionBar.ts';

const seat = (totalBet: number, state: 'live' | 'folded' | 'allIn' = 'live'): SeatChips => ({
  dealtIn: true,
  folded: state === 'folded',
  allIn: state === 'allIn',
  totalBet,
});

const BLINDS = { sb: 10, bb: 20 } as const;

export const ACTION_SPOTS = {
  /** Flop, nobody has bet: Fold disabled (checking is free), Check, Bet ▲. Pot 190. */
  check: {
    ...BLINDS,
    street: 'flop',
    currentBet: 0,
    seats: [seat(60), seat(60), seat(0, 'folded'), seat(10, 'folded'), seat(60), seat(0, 'folded')],
    legal: {
      seat: 0,
      toCall: 0,
      callAmount: 0,
      callIsAllIn: false,
      canFold: false,
      canCheck: true,
      canCall: false,
      bet: { min: 20, max: 1940 },
      raise: null,
    },
  },
  /** Turn, a bet of 120 to call: Fold, Call 120, Raise ▲. */
  facing: {
    ...BLINDS,
    street: 'turn',
    currentBet: 120,
    seats: [
      seat(60),
      seat(180),
      seat(0, 'folded'),
      seat(10, 'folded'),
      seat(60),
      seat(0, 'folded'),
    ],
    legal: {
      seat: 0,
      toCall: 120,
      callAmount: 120,
      callIsAllIn: false,
      canFold: true,
      canCheck: false,
      canCall: true,
      bet: null,
      raise: { min: 240, max: 1940 },
    },
  },
  /**
   * PLAN §0.3's example: 50 each in, the villain bets 500 more, the hero has 50 left. Call
   * all-in 50, "Pot you can win 150" (not 600), no raise.
   */
  shortCall: {
    ...BLINDS,
    street: 'turn',
    currentBet: 500,
    seats: [seat(50), seat(550), seat(0, 'folded')],
    legal: {
      seat: 0,
      toCall: 500,
      callAmount: 50,
      callIsAllIn: true,
      canFold: true,
      canCheck: false,
      canCall: true,
      bet: null,
      raise: null,
    },
  },
  /**
   * Flop: the hero bet 100, a short all-in made it 150 (not a full raise), a third player
   * called. The betting is not reopened for the hero: Raise is disabled and says why.
   */
  notReopened: {
    ...BLINDS,
    street: 'flop',
    currentBet: 150,
    seats: [seat(160), seat(210, 'allIn'), seat(0, 'folded'), seat(10, 'folded'), seat(210)],
    legal: {
      seat: 0,
      toCall: 50,
      callAmount: 50,
      callIsAllIn: false,
      canFold: true,
      canCheck: false,
      canCall: true,
      bet: null,
      raise: null,
    },
  },
  /** Flop, a bet of 100 and 150 behind: the only raise is all-in, one tap, no tray. */
  allInOnly: {
    ...BLINDS,
    street: 'flop',
    currentBet: 100,
    seats: [seat(60), seat(160), seat(0, 'folded'), seat(10, 'folded')],
    legal: {
      seat: 0,
      toCall: 100,
      callAmount: 100,
      callIsAllIn: false,
      canFold: true,
      canCheck: false,
      canCall: true,
      bet: null,
      raise: { min: 150, max: 150 },
    },
  },
  /** Preflop on the button, folded round: open presets 2.5 / 3 / 4 BB. */
  open: {
    ...BLINDS,
    street: 'preflop',
    currentBet: 20,
    seats: [seat(0), seat(0, 'folded'), seat(0, 'folded'), seat(10), seat(20)],
    legal: {
      seat: 0,
      toCall: 20,
      callAmount: 20,
      callIsAllIn: false,
      canFold: true,
      canCheck: false,
      canCall: true,
      bet: null,
      raise: { min: 40, max: 2000 },
    },
  },
  /** Preflop in the big blind facing a raise to 60: Min · 2.5× · 3× · Pot · All-in. */
  threeBet: {
    ...BLINDS,
    street: 'preflop',
    currentBet: 60,
    seats: [seat(20), seat(0, 'folded'), seat(60), seat(10, 'folded')],
    legal: {
      seat: 0,
      toCall: 40,
      callAmount: 40,
      callIsAllIn: false,
      canFold: true,
      canCheck: false,
      canCall: true,
      bet: null,
      raise: { min: 100, max: 2000 },
    },
  },
  /** Blinds 1,000/2,000, a 987,654 stack: the widest amounts the chips must fit. */
  deep: {
    sb: 1000,
    bb: 2000,
    street: 'flop',
    currentBet: 0,
    seats: [seat(40000), seat(40000), seat(40000), seat(0, 'folded')],
    legal: {
      seat: 0,
      toCall: 0,
      callAmount: 0,
      callIsAllIn: false,
      canFold: false,
      canCheck: true,
      canCall: false,
      bet: { min: 2000, max: 987654 },
      raise: null,
    },
  },
  /** A bot's turn: every button disabled at 40%, "Waiting…". */
  waiting: {
    ...BLINDS,
    street: 'turn',
    currentBet: 120,
    seats: [seat(60), seat(180), seat(0, 'folded'), seat(10, 'folded'), seat(60)],
    legal: null,
  },
} satisfies Record<string, Omit<ActionBarInput, 'amounts'>>;

export type ActionSpotId = keyof typeof ACTION_SPOTS;

export const ACTION_SPOT_IDS = Object.keys(ACTION_SPOTS) as ActionSpotId[];
