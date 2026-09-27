/**
 * Starting a hand (PLAN §3.3, §3.4, §3.7, §4.2): the shuffle, the deal and the blinds.
 */
import { EngineError } from '../core/assert.ts';
import { newDeck, type Card } from '../core/cards.ts';
import { deriveSeed, isSeed128, rngFromSeed, shuffleRange, type Seed128 } from '../core/rng.ts';
import { checkInvariants } from './invariants.ts';
import { blindSeats, dealOrder, firstToAct, put, roundComplete } from './rules.ts';
import { refundUncalled } from './settle.ts';
import { buttonForHand, validateTable } from './table.ts';
import { ENGINE_VERSION, type HandState, type SeatState, type TableState } from './types.ts';

/**
 * The hand's deck (§2.4, §5.6): the 52 cards in order, then one Fisher–Yates pass with the
 * `deriveSeed(handSeed, 'deck')` stream. Anyone holding the hand seed can re-create it (Review,
 * the provable shuffle of §16.3).
 */
export function deckFromSeed(handSeed: Seed128): Card[] {
  const deck = newDeck();
  shuffleRange(deck, 0, 51, rngFromSeed(deriveSeed(handSeed, 'deck')));
  return deck;
}

/**
 * Deals the next hand at `table` (§4.2). Seats with chips are dealt in; the button follows §3.3
 * (`buttonForHand`). Then, in this order:
 * 1. the deck from `deckFromSeed(handSeed)`;
 * 2. hole cards one at a time from the first dealt-in seat left of the button, two rounds, so
 *    deck positions 0..2k−1 (§3.4; heads-up the big blind gets the first card);
 * 3. the small blind, then the big blind, each `min(blind, stack)`: a short blind is all-in and
 *    `currentBet` is still the full big blind (§3.3). Posting is not acting: `lastActedAtBet`
 *    stays null, which gives the big blind its option;
 * 4. if the blinds already end the betting round (§3.7: nobody can act, or the only seat that
 *    can act faces no bet, e.g. heads-up with an all-in small blind) the uncalled part is
 *    refunded and the phase is 'roundComplete' (B36); otherwise 'betting', with the first active
 *    seat strictly after the big blind to act (heads-up: the button, who is the small blind).
 * `handSeq` is `table.nextHandSeq` (the controller raises it first, §14.3). The result passes
 * `checkInvariants`. Throws `EngineError` for a bad table or seed, `BAD_PHASE` with fewer than two
 * players with chips.
 */
export function startHand(table: TableState, handSeed: Seed128): HandState {
  if (!isSeed128(handSeed)) {
    throw new EngineError('ILLEGAL_ACTION', 'the hand seed must be 32 lowercase hex characters');
  }
  validateTable(table);
  const button = buttonForHand(table);
  const dealtIn = table.slots.map((slot) => slot.stack > 0);
  const { sbSeat, bbSeat } = blindSeats(dealtIn, button);
  const { sb, bb } = table.config;
  const deck = deckFromSeed(handSeed);
  const order = dealOrder(dealtIn, button);
  const k = order.length;

  const seats: SeatState[] = table.slots.map((slot) => ({
    dealtIn: slot.stack > 0,
    stack: slot.stack,
    hole: null,
    folded: false,
    allIn: false,
    streetBet: 0,
    totalBet: 0,
    lastActedAtBet: null,
  }));
  order.forEach((seat, j) => {
    (seats[seat] as SeatState).hole = [deck[j] as Card, deck[k + j] as Card];
  });
  const startStacks = table.slots.map((slot) => slot.stack);

  const h: HandState = {
    schema: 1,
    engineVersion: ENGINE_VERSION,
    handSeq: table.nextHandSeq,
    seed: handSeed,
    sb,
    bb,
    seats,
    button,
    sbSeat,
    bbSeat,
    street: 'preflop',
    phase: 'betting',
    board: [],
    deck,
    deckPos: 2 * k,
    currentBet: bb,
    minRaiseInc: bb,
    lastAggressor: null,
    preflopAggressor: null,
    toAct: null,
    runout: false,
    revealed: [],
    undoneDecisions: [],
    startTotal: startStacks.reduce((a, b) => a + b, 0),
    startStacks,
    log: [],
    result: null,
  };
  for (const [seat, blind, size] of [
    [sbSeat, 'sb', sb],
    [bbSeat, 'bb', bb],
  ] as const) {
    const s = seats[seat] as SeatState;
    const amount = put(s, size);
    h.log.push({ e: 'post', seat, blind, amount, allIn: s.allIn });
  }
  if (roundComplete(h)) {
    refundUncalled(h);
    h.phase = 'roundComplete';
  } else {
    h.toAct = firstToAct(h);
  }
  checkInvariants(h);
  return h;
}
