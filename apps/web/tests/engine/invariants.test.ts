import { describe, expect, it } from 'vitest';
import { InvariantError } from '../../src/core/assert.ts';
import { parseCards } from '../../src/core/cards.ts';
import { checkInvariants } from '../../src/engine/invariants.ts';
import type { HandState, SeatState } from '../../src/engine/types.ts';
import {
  allInAtBlinds,
  allInShowdown,
  betTo,
  foldedToBigBlind,
  handAtStart,
  headsUpFlop,
} from './fixtures.ts';

/** Every broken-invariant message, or [] when the state passes. */
function broken(h: HandState, replayLog = false): string[] {
  try {
    checkInvariants(h, { replayLog });
    return [];
  } catch (e) {
    if (e instanceof InvariantError) return e.broken;
    throw e;
  }
}

/** The distinct invariant ids in the messages, e.g. ['I7']. */
const ids = (h: HandState, replayLog = false): string[] => [
  ...new Set(broken(h, replayLog).map((m) => m.split(' ')[0] as string)),
];

const seat = (h: HandState, i: number): SeatState => h.seats[i] as SeatState;

// Valid states for every phase, built by hand (fixtures.ts).
const headsUp = (): HandState => handAtStart({ stacks: [10000, 10000], button: 0 });
const threeHanded = (): HandState => handAtStart({ stacks: [10000, 10000, 10000], button: 0 });
/** Appendix B26: the SB (seat 1) has 30 and posts it all-in. */
const shortSmallBlind = (): HandState => handAtStart({ stacks: [10000, 30, 10000], button: 0 });
/** Engine mode: seat 1 has no chips and is not dealt in. */
const seatOut = (): HandState => handAtStart({ stacks: [10000, 0, 10000, 10000], button: 0 });
/** Heads-up, the BB is all-in for 30 < SB: the SB must still call or fold (B34, §3.7). */
const shortBigBlind = (): HandState => handAtStart({ stacks: [10000, 30], button: 0 });
const foldOver = (): HandState => foldedToBigBlind().roundOver;
const foldDone = (): HandState => foldedToBigBlind().complete;
/** The flop after a bet of 200 by the BB (seat 1); the button is to act. */
const flopBet = (): HandState => {
  const h = headsUpFlop();
  betTo(h, 1, 200);
  h.toAct = 0;
  return h;
};

const VALID: [string, () => HandState][] = [
  ['heads-up preflop', headsUp],
  ['three-handed preflop', threeHanded],
  ['short small blind all-in (B26)', shortSmallBlind],
  ['a seat not dealt in', seatOut],
  ['short all-in big blind, small blind to act (B34)', shortBigBlind],
  ['flop, first to act', headsUpFlop],
  ['flop after a bet', flopBet],
  ['folded to the BB, round over (B12)', foldOver],
  ['folded to the BB, complete (B12)', foldDone],
  ['both blinds all-in (B36)', () => allInAtBlinds()],
  ['run-out flop', () => allInShowdown().flop],
  ['run-out turn', () => allInShowdown().turn],
  ['run-out river', () => allInShowdown().river],
  ['showdown', () => allInShowdown().showdown],
  ['showdown, complete', () => allInShowdown().complete],
];

describe('checkInvariants: valid states pass', () => {
  it.each(VALID)('%s', (_, make) => {
    const h = make();
    expect(broken(h, true)).toEqual([]);
    expect(() => checkInvariants(h)).not.toThrow();
  });

  it('the fixtures are what they claim', () => {
    expect(headsUp().toAct).toBe(0); // heads-up the button acts first preflop
    expect(shortBigBlind()).toMatchObject({ phase: 'betting', toAct: 0 });
    expect(allInAtBlinds()).toMatchObject({ phase: 'roundComplete', toAct: null });
    expect(seat(allInAtBlinds(), 1)).toMatchObject({ stack: 40, totalBet: 40, allIn: false });
    expect(seat(foldDone(), 2).stack).toBe(10050);
    expect(allInShowdown().complete.result?.payouts).toEqual([80, 0]);
  });

  it('reshuffling the undealt stub keeps the deck valid (I8)', () => {
    const h = headsUpFlop();
    const stub = h.deck.slice(h.deckPos).reverse();
    h.deck.splice(h.deckPos, stub.length, ...stub);
    expect(broken(h, true)).toEqual([]);
  });

  it('checks a state in well under 0.1 ms (§4.4)', () => {
    const h = allInShowdown().complete;
    const runs = 2000;
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) checkInvariants(h);
    const perCheck = (performance.now() - t0) / runs;
    expect(perCheck).toBeLessThan(0.1);
  });
});

type Case = [id: string, what: string, make: () => HandState, mutate: (h: HandState) => void];

/**
 * One or more mutations per invariant. Each starts from a valid state and must break exactly that
 * invariant (the log replay I12 is off here; it has its own cases below).
 */
const CASES: Case[] = [
  ['I0', 'one seat', headsUp, (h) => h.seats.splice(1)],
  ['I0', 'schema 2', headsUp, (h) => ((h as { schema: number }).schema = 2)],
  ['I0', 'toAct off the table', headsUp, (h) => (h.toAct = 7)],
  ['I0', 'odd big blind', headsUp, (h) => ((h.bb = 101), (h.sb = 50.5))],
  ['I0', 'bad seed', headsUp, (h) => (h.seed = 'XYZ')],
  ['I0', 'unknown log event', headsUp, (h) => h.log.push({ e: 'oops' } as never)],
  ['I0', 'result without payouts', foldDone, (h) => h.result?.payouts.pop()],
  [
    'I1',
    'a chip moves between seats',
    headsUp,
    (h) => {
      seat(h, 0).stack -= 1;
      seat(h, 1).stack += 1;
    },
  ],
  ['I1', 'a chip disappears', headsUp, (h) => (seat(h, 1).stack -= 1)],
  ['I1', 'startTotal off by one', foldDone, (h) => (h.startTotal += 1)],
  [
    'I1',
    'a payout without chips',
    foldDone,
    (h) => {
      (h.result as NonNullable<HandState['result']>).payouts[2] = 101;
    },
  ],
  [
    'I1',
    'net does not match the payout',
    foldDone,
    (h) => {
      const r = h.result as NonNullable<HandState['result']>;
      r.net = [0, -49, 49];
    },
  ],
  ['I2', 'fractional minRaiseInc', headsUp, (h) => (h.minRaiseInc = 100.5)],
  [
    'I2',
    'fractional stacks that still add up',
    headsUp,
    (h) => {
      seat(h, 0).stack += 0.5;
      h.startStacks[0] = 10000.5;
      h.startTotal += 0.5;
    },
  ],
  ['I2', 'negative lastActedAtBet', headsUp, (h) => (seat(h, 1).lastActedAtBet = -5)],
  ['I2', 'unsafe currentBet', foldOver, (h) => (h.currentBet = 2 ** 53)],
  [
    'I3',
    'streetBet above totalBet',
    headsUp,
    (h) => {
      seat(h, 0).totalBet = 40;
      seat(h, 0).stack = 9960;
    },
  ],
  ['I4', 'currentBet above every bet', headsUp, (h) => (h.currentBet = 200)],
  ['I4', 'currentBet below the bet', flopBet, (h) => (h.currentBet = 150)],
  ['I5', 'minRaiseInc below the big blind', headsUp, (h) => (h.minRaiseInc = 99)],
  [
    'I6',
    'a folded seat keeps an uncalled bet',
    foldOver,
    (h) => {
      const sb = seat(h, 1); // folded
      sb.streetBet = 60;
      sb.totalBet = 60;
      sb.stack = 9940;
    },
  ],
  ['I7', 'allIn with chips behind', headsUp, (h) => (seat(h, 1).allIn = true)],
  ['I7', 'no allIn with an empty stack', shortSmallBlind, (h) => (seat(h, 1).allIn = false)],
  [
    'I8',
    'hole cards swapped between seats',
    headsUp,
    (h) => {
      const a = seat(h, 0).hole;
      seat(h, 0).hole = seat(h, 1).hole;
      seat(h, 1).hole = a;
    },
  ],
  ['I8', 'a card twice in the deck', headsUp, (h) => (h.deck[0] = h.deck[1] as number)],
  ['I8', 'deckPos off by one', headsUpFlop, (h) => (h.deckPos += 1)],
  [
    'I8',
    'a board card not from its position',
    headsUpFlop,
    (h) => (h.board[0] = h.deck[40] as number),
  ],
  ['I9', 'a card on the board preflop', headsUp, (h) => h.board.push(h.deck[5] as number)],
  ['I10', 'betting with nobody to act', headsUp, (h) => (h.toAct = null)],
  ['I10', 'a seat to act after the round', foldOver, (h) => (h.toAct = 2)],
  ['I10', 'an all-in seat to act', shortSmallBlind, (h) => (h.toAct = 1)],
  ['I10', 'a folded seat to act', foldOver, (h) => ((h.phase = 'betting'), (h.toAct = 0))],
  ['I10', 'the seat to act already acted', headsUpFlop, (h) => (seat(h, 1).lastActedAtBet = 0)],
  [
    'I10',
    'the round is over but still betting',
    headsUpFlop,
    (h) => {
      seat(h, 0).lastActedAtBet = 0;
      seat(h, 1).lastActedAtBet = 0;
    },
  ],
  [
    'I10',
    'short all-in BB: nobody left to act (§3.7)',
    () => handAtStart({ stacks: [10000, 10000, 30], button: 0 }),
    (h) => {
      // BTN and SB both fold and nobody is asked: the BB cannot act, so betting must be over.
      seat(h, 0).folded = true;
      seat(h, 1).folded = true;
      h.toAct = 2;
    },
  ],
  [
    'I11',
    'a folded seat eligible for the pot',
    foldDone,
    (h) => {
      const r = h.result as NonNullable<HandState['result']>;
      r.pots[0] = { amount: 100, eligible: [1, 2] };
    },
  ],
  [
    'I11',
    'a folded seat wins the pot',
    foldDone,
    (h) => {
      const r = h.result as NonNullable<HandState['result']>;
      r.pots[0] = { amount: 100, eligible: [0, 2] };
      r.potWinners[0] = [0];
    },
  ],
  ['I11', 'cards revealed while betting', headsUpFlop, (h) => h.revealed.push(1)],
  ['I11', 'a live hand hidden in a run-out', () => allInShowdown().flop, (h) => h.revealed.pop()],
  [
    'I13',
    'hole cards for a seat not dealt in',
    seatOut,
    (h) => (seat(h, 1).hole = parseCards('Ah Kh') as [number, number]),
  ],
  ['I13', 'a seat not dealt in folds', seatOut, (h) => (seat(h, 1).folded = true)],
  [
    'I13',
    'a seat not dealt in acts in the log',
    seatOut,
    (h) =>
      h.log.push({
        e: 'act',
        seat: 1,
        street: 'preflop',
        action: { type: 'fold' },
        amountIn: 0,
        allIn: false,
        full: false,
      }),
  ],
  [
    'I14',
    'a result before the end',
    headsUp,
    (h) =>
      (h.result = {
        endedBy: 'fold',
        pots: [],
        potWinners: [],
        payouts: [0, 0],
        net: [0, 0],
        shown: [],
      }),
  ],
  ['I14', 'complete without a result', foldDone, (h) => (h.result = null)],
  [
    'I14',
    'a fold win called a showdown',
    foldDone,
    (h) => ((h.result as NonNullable<HandState['result']>).endedBy = 'showdown'),
  ],
  [
    'I14',
    'a showdown hand not shown',
    () => allInShowdown().complete,
    (h) => (h.result as NonNullable<HandState['result']>).shown.pop(),
  ],
  [
    'I15',
    'blinds swapped',
    threeHanded,
    (h) => {
      h.sbSeat = 2;
      h.bbSeat = 1;
    },
  ],
  [
    'I15',
    'heads-up with the BB on the button (Known pitfall 3)',
    headsUp,
    (h) => {
      h.sbSeat = 1;
      h.bbSeat = 0;
    },
  ],
  ['I15', 'the button on a seat not dealt in', seatOut, (h) => (h.button = 1)],
];

describe('checkInvariants: each invariant catches its own breakage', () => {
  it.each(CASES)('%s: %s', (id, _, make, mutate) => {
    const h = make();
    expect(broken(h, true)).toEqual([]);
    mutate(h);
    expect(ids(h)).toEqual([id]);
    const messages = broken(h);
    expect(messages.every((m) => m.startsWith(`${id} `))).toBe(true);
    let caught: unknown;
    try {
      checkInvariants(h);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InvariantError);
    expect((caught as InvariantError).message).toContain(id);
  });

  it('covers every invariant I0–I15 (I12 below)', () => {
    const covered = new Set(CASES.map((c) => c[0]));
    for (let i = 0; i <= 15; i++) if (i !== 12) expect(covered.has(`I${i}`), `I${i}`).toBe(true);
  });

  it('lists every broken invariant, not just the first', () => {
    const h = headsUp();
    h.minRaiseInc = 99;
    h.toAct = null;
    seat(h, 1).stack -= 1;
    expect(ids(h)).toEqual(['I1', 'I5', 'I10']);
  });

  it('messages name the invariant', () => {
    const h = shortSmallBlind();
    seat(h, 1).allIn = false;
    expect(broken(h)).toEqual(['I7 all-in flag: seat 1: allIn is false with stack 0']);
  });

  it('reports garbage as I0 instead of crashing', () => {
    for (const bad of [{}, { seats: null }, { seats: [{}, {}] }]) {
      const messages = broken(bad as unknown as HandState);
      expect(messages.length).toBeGreaterThan(0);
      expect(messages.every((m) => m.startsWith('I0 '))).toBe(true);
    }
  });
});

describe('checkInvariants: I12 log replay (only with replayLog)', () => {
  const LOG_CASES: [what: string, make: () => HandState, mutate: (h: HandState) => void][] = [
    ['a post of the wrong size', headsUp, (h) => ((h.log[0] as { amount: number }).amount = 49)],
    ['the flop missing from the log', headsUpFlop, (h) => h.log.splice(h.log.length - 1, 1)],
    [
      'an action the state does not show',
      threeHanded,
      (h) =>
        h.log.push({
          e: 'act',
          seat: 0,
          street: 'preflop',
          action: { type: 'fold' },
          amountIn: 0,
          allIn: false,
          full: false,
        }),
    ],
    [
      'a reshuffle the state does not show',
      headsUpFlop,
      (h) => h.log.push({ e: 'reshuffle', decisionId: 3, undoIndex: 0 }),
    ],
    [
      'an award that does not match the payouts',
      foldDone,
      (h) => ((h.log[h.log.length - 1] as { amounts: number[] }).amounts = [99]),
    ],
    [
      'a refund to the wrong seat',
      foldOver,
      (h) => ((h.log[h.log.length - 1] as { seat: number }).seat = 1),
    ],
    [
      'a bet marked as an incomplete raise',
      flopBet,
      (h) => ((h.log[h.log.length - 1] as { full: boolean }).full = false),
    ],
    ['blinds posted in the wrong order', threeHanded, (h) => h.log.reverse()],
  ];

  it.each(LOG_CASES)('%s', (_, make, mutate) => {
    const h = make();
    mutate(h);
    expect(broken(h)).toEqual([]); // the other invariants do not read the log this way
    expect(ids(h, true)).toContain('I12');
  });

  it('a matching reshuffle replays', () => {
    const h = headsUpFlop();
    h.log.push({ e: 'reshuffle', decisionId: 3, undoIndex: 0 });
    h.undoneDecisions.push(3);
    expect(broken(h, true)).toEqual([]);
  });

  it('a raise that lowers currentBet breaks I4 in the replay', () => {
    const h = flopBet();
    const bet = h.log[h.log.length - 1] as { action: { type: string; to: number } };
    bet.action = { type: 'bet', to: 0 };
    expect(ids(h, true)).toContain('I4');
  });
});
