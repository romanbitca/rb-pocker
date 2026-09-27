import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EngineError } from '../../src/core/assert.ts';
import { formatCards, parseCards } from '../../src/core/cards.ts';
import {
  deriveSeed,
  randInt,
  rngFromSeed,
  seedFromWords,
  type Seed128,
} from '../../src/core/rng.ts';
import { deckFromSeed, startHand } from '../../src/engine/start.ts';
import { buttonForHand, createTable, nextTable, topUp } from '../../src/engine/table.ts';
import type { HandState, SeatState, TableState } from '../../src/engine/types.ts';
import { handAtStart } from './fixtures.ts';
import {
  FC_SEED,
  SEED,
  TABLE_SEED,
  checked,
  configFor,
  deal,
  dealOrderOf,
  finishAllIn,
  rigDeck,
  slotsFor,
  tableWith,
} from './helpers.ts';

const seat = (h: HandState, i: number): SeatState => h.seats[i] as SeatState;

/** Any 128-bit seed. */
const seedArb: fc.Arbitrary<Seed128> = fc
  .tuple(fc.nat(), fc.nat(), fc.nat(), fc.nat())
  .map(([a, b, c, d]) => seedFromWords(a, b, c, d));

function engineError(f: () => unknown): EngineError {
  try {
    f();
  } catch (e) {
    if (e instanceof EngineError) return e;
    throw e;
  }
  throw new Error('expected an EngineError');
}

function deepFreeze<T>(x: T): T {
  if (typeof x === 'object' && x !== null) {
    for (const v of Object.values(x)) deepFreeze(v);
    Object.freeze(x);
  }
  return x;
}

describe('deckFromSeed', () => {
  it('is the Appendix C.4 golden deck for the C.4 seed', () => {
    const deck = deckFromSeed(SEED);
    expect(formatCards(deck.slice(0, 12))).toBe('6h Kc 6d Qh 8h 4h Td 2h 2d 3s Ah 3h');
    expect(formatCards(deck.slice(48))).toBe('4s 7h As 7c');
    expect([...deck].sort((a, b) => a - b)).toEqual(Array.from({ length: 52 }, (_, i) => i));
  });
});

describe('startHand: shuffle and deal (§3.4)', () => {
  it('deals the C.4 golden deck: heads-up the big blind gets the first card', () => {
    const h = deal(tableWith([10000, 10000], { button: 0 }));
    expect(h.deck).toEqual(deckFromSeed(SEED));
    // Positions 0..3 = 6h Kc 6d Qh: BB (seat 1) gets 0 and 2, the button (seat 0) 1 and 3.
    expect(formatCards(seat(h, 1).hole as number[])).toBe('6h 6d');
    expect(formatCards(seat(h, 0).hole as number[])).toBe('Kc Qh');
    expect(h.deckPos).toBe(4);
    expect(h.board).toEqual([]);
  });

  it('deals one card at a time from the seat left of the button, two rounds', () => {
    const h = deal(tableWith([500, 500, 0, 500, 500, 500], { button: 3 }));
    expect(dealOrderOf(h)).toEqual([4, 5, 0, 1, 3]);
    dealOrderOf(h).forEach((s, j) => {
      expect(seat(h, s).hole).toEqual([h.deck[j], h.deck[5 + j]]);
    });
    expect(seat(h, 2).hole).toBeNull();
    expect(h.deckPos).toBe(10);
  });

  it('the same seed gives the same hand; another seed another deck', () => {
    const table = tableWith([10000, 7000, 3000, 10000], { button: 2 });
    const a = startHand(table, SEED);
    expect(startHand(table, SEED)).toStrictEqual(a);
    const other = startHand(table, deriveSeed(SEED, 'other'));
    expect(other.deck).not.toEqual(a.deck);
    expect({ ...other, deck: a.deck, seed: a.seed, seats: a.seats }).toStrictEqual(a);
  });

  it('records the seed, blinds, hand number and start stacks', () => {
    const table = tableWith([10000, 0, 30, 10000], { button: 3, nextHandSeq: 42 });
    const h = deal(table, SEED);
    expect(h).toMatchObject({
      schema: 1,
      seed: SEED,
      handSeq: 42,
      sb: 50,
      bb: 100,
      startStacks: [10000, 0, 30, 10000],
      startTotal: 20030,
      street: 'preflop',
      board: [],
      runout: false,
      revealed: [],
      undoneDecisions: [],
      result: null,
      lastAggressor: null,
      preflopAggressor: null,
      currentBet: 100,
      minRaiseInc: 100,
    });
  });

  it('rigDeck gives chosen hole cards and board, and the deal still checks out (I8)', () => {
    const h = rigDeck(deal(tableWith([10000, 10000, 10000], { button: 0 })), {
      holes: { 0: 'As Ks', 2: '7c 2d' },
      board: 'Ah Kd Qc Jh Ts',
    });
    expect(seat(h, 0).hole).toEqual(parseCards('As Ks'));
    expect(seat(h, 2).hole).toEqual(parseCards('7c 2d'));
    expect(formatCards([5, 6, 7, 9, 11].map((p) => h.deck[2 + p] as number))).toBe(
      'Ah Kd Qc Jh Ts',
    );
  });
});

describe('startHand: button and blinds (§3.3)', () => {
  it('first hand: the button is drawn from the table seed', () => {
    for (const n of [2, 3, 6, 9]) {
      for (let i = 0; i < 5; i++) {
        const tableSeed = deriveSeed(TABLE_SEED, 'first', n, i);
        const table = tableWith(new Array<number>(n).fill(10000), { tableSeed });
        const expected = randInt(rngFromSeed(deriveSeed(tableSeed, 'button')), n);
        expect(buttonForHand(table)).toBe(expected);
        expect(deal(table).button).toBe(expected);
      }
    }
  });

  it('first hand: a drawn seat without chips passes the button on (engine mode)', () => {
    for (let i = 0; i < 40; i++) {
      const tableSeed = deriveSeed(TABLE_SEED, 'skip', i);
      const drawn = randInt(rngFromSeed(deriveSeed(tableSeed, 'button')), 4);
      const table = tableWith([10000, 10000, 10000, 10000], { tableSeed });
      (table.slots[drawn] as { stack: number }).stack = 0;
      expect(deal(table).button).toBe((drawn + 1) % 4);
    }
  });

  it('B1: heads-up, the button posts the SB, acts first, and the BB gets the first card', () => {
    const h = deal(tableWith([10000, 10000], { button: 0 }));
    expect(h).toMatchObject({ button: 0, sbSeat: 0, bbSeat: 1, toAct: 0, phase: 'betting' });
    expect(h.log.slice(0, 2)).toEqual([
      { e: 'post', seat: 0, blind: 'sb', amount: 50, allIn: false },
      { e: 'post', seat: 1, blind: 'bb', amount: 100, allIn: false },
    ]);
    expect(seat(h, 0)).toMatchObject({ stack: 9950, streetBet: 50, totalBet: 50 });
    expect(seat(h, 1)).toMatchObject({ stack: 9900, streetBet: 100, totalBet: 100 });
    expect(seat(h, 1).hole?.[0]).toBe(h.deck[0]);
    expect(seat(h, 0).hole?.[1]).toBe(h.deck[3]);
  });

  it('heads-up rules hold for every button and stack depth', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1 }),
        fc.integer({ min: 101, max: 50000 }),
        fc.integer({ min: 101, max: 50000 }),
        seedArb,
        (button, a, b, seed) => {
          const h = deal(tableWith([a, b], { button }), seed);
          const other = 1 - button;
          expect(h.sbSeat).toBe(button);
          expect(h.bbSeat).toBe(other);
          expect(h.toAct).toBe(button);
          expect(seat(h, other).hole?.[0]).toBe(h.deck[0]);
          expect(seat(h, button).hole).toEqual([h.deck[1], h.deck[3]]);
        },
      ),
      { seed: FC_SEED, numRuns: 300 },
    );
  });

  it('B2 setup: 4 players, BTN A, SB B, BB C, UTG D: D acts first', () => {
    // Seats clockwise: A = 0 (button), B = 1, C = 2, D = 3.
    const h = deal(tableWith([10000, 10000, 10000, 10000], { button: 0 }));
    expect(h).toMatchObject({ button: 0, sbSeat: 1, bbSeat: 2, toAct: 3 });
  });

  it('B6 setup: UTG A, BTN B (450), SB C, BB D: A acts first', () => {
    // Seats clockwise from the button: B = 1, C = 2, D = 3, A = 0.
    const h = deal(tableWith([10000, 450, 10000, 10000], { button: 1 }));
    expect(h).toMatchObject({ button: 1, sbSeat: 2, bbSeat: 3, toAct: 0 });
    expect(seat(h, 1).stack).toBe(450);
  });

  it('B26: a small blind with 30 posts 30 and is all-in', () => {
    const h = deal(tableWith([10000, 30, 10000], { button: 0 }));
    expect(h.log[0]).toEqual({ e: 'post', seat: 1, blind: 'sb', amount: 30, allIn: true });
    expect(seat(h, 1)).toMatchObject({ stack: 0, allIn: true, streetBet: 30 });
    expect(h).toMatchObject({ phase: 'betting', toAct: 0, currentBet: 100 });
  });

  it('B25 setup: a big blind with 60 posts 60 all-in; currentBet stays 100, min raise-to 200', () => {
    const h = deal(tableWith([10000, 10000, 60], { button: 0 }));
    expect(h.log[1]).toEqual({ e: 'post', seat: 2, blind: 'bb', amount: 60, allIn: true });
    expect(h.currentBet).toBe(100);
    expect(h.currentBet + h.minRaiseInc).toBe(200);
    expect(h.toAct).toBe(0);
  });

  it('B34 setup: SB 50, BB all-in for 30: the others act first, then the SB still decides', () => {
    const three = deal(tableWith([10000, 10000, 30], { button: 0 }));
    expect(three).toMatchObject({ phase: 'betting', toAct: 0, currentBet: 100 });
    expect(seat(three, 2)).toMatchObject({ allIn: true, streetBet: 30 });
    // Heads-up the SB (the button) is the only one who can act and faces the full bb: it must
    // call or fold, the round is not over (§3.7).
    const headsUp = deal(tableWith([10000, 30], { button: 0 }));
    expect(headsUp).toMatchObject({ phase: 'betting', toAct: 0, currentBet: 100 });
    expect(headsUp.log.filter((ev) => ev.e === 'refund')).toEqual([]);
  });

  it('B35 setup: 3 players, both blinds all-in: the button acts alone against them', () => {
    const h = deal(tableWith([10000, 20, 60], { button: 0 }));
    expect(h).toMatchObject({ phase: 'betting', toAct: 0 });
    expect(seat(h, 1).allIn && seat(h, 2).allIn).toBe(true);
  });

  it('B36: heads-up SB 40 and BB 80: round over at once, BB refunded 40, 40 against 40', () => {
    const h = deal(tableWith([40, 80], { button: 0 }));
    expect(h).toMatchObject({ phase: 'roundComplete', toAct: null, currentBet: 100 });
    expect(h.log).toEqual([
      { e: 'post', seat: 0, blind: 'sb', amount: 40, allIn: true },
      { e: 'post', seat: 1, blind: 'bb', amount: 80, allIn: true },
      { e: 'refund', seat: 1, amount: 40 },
    ]);
    expect(seat(h, 0)).toMatchObject({ stack: 0, totalBet: 40, allIn: true });
    expect(seat(h, 1)).toMatchObject({ stack: 40, totalBet: 40, allIn: false });
  });

  it('heads-up with an all-in small blind: the big blind faces no bet, the round is over', () => {
    const h = deal(tableWith([40, 10000], { button: 0 }));
    expect(h).toMatchObject({ phase: 'roundComplete', toAct: null });
    expect(h.log[2]).toEqual({ e: 'refund', seat: 1, amount: 60 });
    expect(seat(h, 1)).toMatchObject({ totalBet: 40, stack: 9960 });
  });

  it('B30: the hero busts on the button; next hand the button moves to the next dealt-in seat', () => {
    // Engine mode: the controller would offer a reload first; the engine deals without the hero.
    let table = tableWith([10000, 10000, 10000, 10000], { button: 0 });
    let h = rigDeck(deal(table), {
      holes: { 0: '7c 2d', 1: 'As Ah', 2: 'Ks Kh', 3: 'Qs Qh' },
      board: '3c 4d 9h Js 8c',
    });
    const done = finishAllIn(h);
    expect(done.result?.payouts[0]).toBe(0);
    table = nextTable(table, done);
    expect(table.slots[0]?.stack).toBe(0);
    h = deal(table, deriveSeed(SEED, 'next'));
    expect(seat(h, 0).dealtIn).toBe(false);
    expect(h).toMatchObject({ button: 1, sbSeat: 2, bbSeat: 3, toAct: 1 });
    // After a reload the hero is dealt in again and the button moved on as usual.
    const reloaded = deal(topUp(table, 0, 10000), deriveSeed(SEED, 'next'));
    expect(reloaded).toMatchObject({ button: 1, sbSeat: 2, bbSeat: 3, toAct: 0 });
  });

  it('B30: a seat with no chips on the last button is skipped (engine mode)', () => {
    const table = tableWith([10000, 10000, 10000, 10000, 10000]);
    table.button = 2;
    (table.slots[2] as { stack: number }).stack = 0;
    (table.slots[3] as { stack: number }).stack = 0;
    const h = deal(table);
    expect(h).toMatchObject({ button: 4, sbSeat: 0, bbSeat: 1, toAct: 4 });
  });

  it('B31: 3 → 2 players, the previous BB still in: it gets the button and the SB (§3.3)', () => {
    // Last hand: button 1, SB 2, BB 0. Seat 1 busted; the normal move would give seat 2 the
    // button and make seat 0 post the BB twice in a row.
    const table = tableWith([10000, 10000, 10000], { button: 2 });
    table.button = 1;
    table.prevBB = 0;
    (table.slots[1] as { stack: number }).stack = 0;
    const h = deal(table);
    expect(h).toMatchObject({ button: 0, sbSeat: 0, bbSeat: 2, toAct: 0 });
  });

  it('B31 through nextTable: the hero busts on the button of a 3-seat table', () => {
    // Hand 1: button 0 (hero), SB 1, BB 2. All-in; the BB's aces win everything. Seat 1 is a
    // bot and is replaced; the hero stays out (engine mode, no reload), so 3 → 2.
    let table = tableWith([10000, 10000, 10000], { button: 0 });
    const h = rigDeck(deal(table), {
      holes: { 0: '7c 2d', 1: 'Ks Kh', 2: 'As Ah' },
      board: '3c 4d 9h Js 8c',
    });
    expect(h).toMatchObject({ button: 0, sbSeat: 1, bbSeat: 2 });
    table = nextTable(table, finishAllIn(h));
    expect(table.slots.map((s) => s.stack)).toEqual([0, 10000, 30000]);
    expect(table).toMatchObject({ button: 0, prevBB: 2 });
    // The moving button would go to seat 1 and make seat 2 post the BB again.
    expect(deal(table, deriveSeed(SEED, 'next'))).toMatchObject({
      button: 2,
      sbSeat: 2,
      bbSeat: 1,
      toAct: 2,
    });
  });

  it('keeps the heads-up alternation: the last BB gets the button', () => {
    const table = tableWith([10000, 10000], { button: 0 });
    table.button = 0;
    table.prevBB = 1;
    expect(deal(table)).toMatchObject({ button: 1, sbSeat: 1, bbSeat: 0 });
  });
});

describe('startHand: errors', () => {
  it('needs two players with chips (BAD_PHASE)', () => {
    const table = tableWith([10000, 10000]);
    (table.slots[1] as { stack: number }).stack = 0;
    expect(engineError(() => startHand(table, SEED)).code).toBe('BAD_PHASE');
  });

  it('rejects a bad seed or a broken table', () => {
    expect(engineError(() => startHand(tableWith([100, 100]), 'nope')).code).toBe('ILLEGAL_ACTION');
    const table = tableWith([10000, 10000]);
    table.button = 5;
    expect(engineError(() => startHand(table, SEED)).code).toBe('BAD_AMOUNT');
    const negative = tableWith([10000, 10000]);
    (negative.slots[0] as { stack: number }).stack = -5;
    expect(engineError(() => startHand(negative, SEED)).code).toBe('BAD_AMOUNT');
  });
});

// ---------------------------------------------------------------------------------------------
// Property: random tables (2–9 seats, stacks from 1 chip to 500 bb, some seats empty).

interface RandomTable {
  table: TableState;
  seed: Seed128;
}

const tableArb: fc.Arbitrary<RandomTable> = fc
  .record({
    seatCount: fc.integer({ min: 2, max: 9 }),
    halfBB: fc.oneof(fc.integer({ min: 1, max: 100 }), fc.integer({ min: 1, max: 50000 })),
    depth: fc.integer({ min: 10, max: 500 }),
    // Per seat: a shape code and an unbiased fraction in millionths (fast-check biases plain
    // numbers towards 0, which would make nearly every stack tiny).
    stackCodes: fc.array(
      fc.tuple(fc.integer({ min: 0, max: 9 }), fc.noBias(fc.integer({ min: 0, max: 1_000_000 }))),
      { minLength: 9, maxLength: 9 },
    ),
    buttonCode: fc.integer({ min: -1, max: 8 }),
    prevBBCode: fc.integer({ min: -1, max: 8 }),
    nextHandSeq: fc.integer({ min: 1, max: 2 ** 40 }),
    tableSeed: seedArb,
    seed: seedArb,
  })
  .map((r) => {
    const bb = r.halfBB * 2;
    const startingStack = Math.min(1_000_000, Math.max(200, bb * r.depth));
    // Stack shapes: an empty seat (engine mode, 1 in 10), tiny (1 chip to 1 bb), exactly the
    // small or the big blind (1 in 10 each), or 1 to 500 bb (6 in 10).
    const stacks = r.stackCodes.slice(0, r.seatCount).map(([code, millionths]) => {
      const x = millionths / 1_000_000;
      if (code === 0) return 0;
      if (code === 1) return 1 + Math.floor(x * (bb - 1));
      if (code === 2) return bb / 2;
      if (code === 3) return bb;
      return bb + Math.floor(x * 499 * bb);
    });
    if (stacks.filter((s) => s > 0).length < 2) {
      stacks[0] = startingStack;
      stacks[stacks.length - 1] = startingStack;
    }
    const table = createTable(
      configFor(r.seatCount, { sb: bb / 2, bb, startingStack }),
      slotsFor(stacks),
      r.tableSeed,
    );
    table.button = r.buttonCode < r.seatCount ? r.buttonCode : -1;
    table.prevBB = r.prevBBCode >= 0 && r.prevBBCode < r.seatCount ? r.prevBBCode : null;
    table.nextHandSeq = r.nextHandSeq;
    return { table, seed: r.seed };
  });

describe('startHand: property over random tables', () => {
  it('always passes every invariant (log replay included) and matches the hand-built deal', () => {
    fc.assert(
      fc.property(tableArb, ({ table, seed }) => {
        const h = startHand(table, seed);
        checked(h);
        const stacks = table.slots.map((s) => s.stack);
        const expected = handAtStart({
          stacks,
          button: buttonForHand(table),
          sb: table.config.sb,
          bb: table.config.bb,
          deck: deckFromSeed(seed),
          seed,
          handSeq: table.nextHandSeq,
        });
        expect(h).toStrictEqual(expected);
      }),
      { seed: FC_SEED, numRuns: 3000 },
    );
  });

  it('is plain JSON, deterministic, and leaves its (deep-frozen) table untouched', () => {
    fc.assert(
      fc.property(tableArb, ({ table, seed }) => {
        const before = JSON.stringify(table);
        const frozen = deepFreeze(table);
        const h = startHand(frozen, seed);
        expect(JSON.stringify(frozen)).toBe(before);
        expect(JSON.parse(JSON.stringify(h))).toStrictEqual(h);
        expect(startHand(frozen, seed)).toStrictEqual(h);
      }),
      { seed: FC_SEED, numRuns: 1000 },
    );
  });

  it('posts min(blind, stack) and deals every seat with chips, only them', () => {
    fc.assert(
      fc.property(tableArb, ({ table, seed }) => {
        const h = startHand(table, seed);
        const withChips = table.slots.flatMap((s, i) => (s.stack > 0 ? [i] : []));
        expect(h.seats.flatMap((s, i) => (s.dealtIn ? [i] : []))).toEqual(withChips);
        expect(h.deckPos).toBe(2 * withChips.length);
        const [sbPost, bbPost] = h.log;
        expect(sbPost).toMatchObject({
          seat: h.sbSeat,
          amount: Math.min(h.sb, table.slots[h.sbSeat]?.stack ?? 0),
        });
        expect(bbPost).toMatchObject({
          seat: h.bbSeat,
          amount: Math.min(h.bb, table.slots[h.bbSeat]?.stack ?? 0),
        });
      }),
      { seed: FC_SEED, numRuns: 1000 },
    );
  });

  it('the random tables reach every edge case (so the properties above mean something)', () => {
    const seen = {
      firstHand: 0,
      seatNotDealtIn: 0,
      headsUp: 0,
      smallBlindAllIn: 0,
      bigBlindAllIn: 0,
      bigBlindBelowSmallBlind: 0,
      headsUpSmallBlindToActAgainstShortBB: 0,
      roundOverAtOnce: 0,
      refundAtOnce: 0,
      nineSeats: 0,
    };
    const runs = 3000;
    for (const { table, seed } of fc.sample(tableArb, { seed: FC_SEED, numRuns: runs })) {
      const h = startHand(table, seed);
      const k = h.seats.filter((s) => s.dealtIn).length;
      const sb = seat(h, h.sbSeat);
      const bb = seat(h, h.bbSeat);
      if (table.button === -1) seen.firstHand++;
      if (k < h.seats.length) seen.seatNotDealtIn++;
      if (k === 2) seen.headsUp++;
      if (sb.allIn) seen.smallBlindAllIn++;
      if (bb.allIn) seen.bigBlindAllIn++;
      if (bb.allIn && bb.streetBet < sb.streetBet) seen.bigBlindBelowSmallBlind++;
      if (k === 2 && h.toAct === h.sbSeat && bb.allIn) seen.headsUpSmallBlindToActAgainstShortBB++;
      if (h.phase === 'roundComplete') seen.roundOverAtOnce++;
      if (h.log.some((ev) => ev.e === 'refund')) seen.refundAtOnce++;
      if (h.seats.length === 9) seen.nineSeats++;
    }
    for (const [what, count] of Object.entries(seen)) {
      expect(count, what).toBeGreaterThanOrEqual(10);
      expect(count, what).toBeLessThan(runs);
    }
  });
});
