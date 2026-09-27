import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  settleOracle,
  type OracleInput,
  type OraclePot,
  type OracleSeat,
  type OracleSettlement,
} from './settle.oracle.ts';

// Self-tests of the independent settlement oracle (PLAN §3.8, §18 Stage 2). The engine's own
// settlement is compared with this oracle later (Stage 2, acceptance criterion 3).

/** A seat still in the hand. Leave `strength` out when its hand is never compared. */
function live(contributed: number, strength: number | null = null): OracleSeat {
  return { contributed, folded: false, strength };
}

/** A folded seat. `folded(0)`: folded before putting a chip in, or not dealt in. */
function folded(contributed: number): OracleSeat {
  return { contributed, folded: true, strength: null };
}

function table(button: number, seats: OracleSeat[]): OracleInput {
  return { seatCount: seats.length, button, seats };
}

function pot(amount: number, eligible: number[], winners: number[], shares: number[]): OraclePot {
  return { amount, eligible, winners, shares };
}

function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new RangeError(`no index ${index}`);
  return value;
}

const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);
const ascending = (a: number, b: number): number => a - b;

/** What each seat won or lost in the hand: payout minus chips put in. */
function net(input: OracleInput, result: OracleSettlement): number[] {
  return input.seats.map((seat, i) => at(result.payouts, i) - seat.contributed);
}

describe('settleOracle: Appendix B settlement vectors', () => {
  // Blinds 50/100 unless a vector says otherwise; amounts are hand totals per seat. Not here:
  // B1–B10, B21–B24, B26–B33, B35 and B37–B43 test betting, dealing, phases or the evaluator only.

  it('B11: a river bet that is folded to goes back to the bettor', () => {
    // Heads-up: A = seat 0 (button/SB), B = seat 1 (BB). 100 each preflop, flop and turn checked.
    // River: A bets 400, B folds.
    const input = table(0, [live(500), folded(100)]);
    const result = settleOracle(input);

    expect(result.refunds).toEqual([400, 0]);
    expect(result.pots).toEqual([pot(200, [0], [0], [200])]);
    expect(result.payouts).toEqual([600, 0]);
  });

  it('B12: all fold to the BB: the BB gets 50 back and wins 100 (net BB +50, SB −50)', () => {
    // Seat 0 button, 1 SB, 2 BB, 3 UTG. UTG, the button and the SB fold.
    const input = table(0, [folded(0), folded(50), live(100), folded(0)]);
    const result = settleOracle(input);

    expect(result.refunds).toEqual([0, 0, 50, 0]);
    expect(result.pots).toEqual([pot(100, [2], [2], [100])]);
    expect(net(input, result)).toEqual([0, -50, 50, 0]);
  });

  it('B13: a flop bet of 500 called all-in for 200: 300 goes back to the bettor', () => {
    // Heads-up: A = seat 0 (button/SB), B = seat 1 (BB), 100 each preflop.
    // Flop: A bets 500, B calls all-in for 200. B wins the run-out.
    const input = table(0, [live(600, 1), live(300, 2)]);
    const result = settleOracle(input);

    expect(result.refunds).toEqual([300, 0]);
    expect(result.pots).toEqual([pot(600, [0, 1], [1], [600])]);
    expect(result.payouts).toEqual([300, 600]);

    // A wins the run-out instead: the pot plus the refund.
    expect(settleOracle(table(0, [live(600, 2), live(300, 1)])).payouts).toEqual([900, 0]);
  });

  it('B14: totals 100 / 300 / 600: C gets 300 back; main 300 (A, B, C), side 400 (B, C)', () => {
    // Preflop all-ins: A = seat 0, B = seat 1, C = seat 2 (button). Equal hands here.
    const result = settleOracle(table(2, [live(100, 1), live(300, 1), live(600, 1)]));

    expect(result.refunds).toEqual([0, 0, 300]);
    expect(result.pots.map(({ amount, eligible }) => ({ amount, eligible }))).toEqual([
      { amount: 300, eligible: [0, 1, 2] },
      { amount: 400, eligible: [1, 2] },
    ]);
  });

  it('B15: folded money stays in: main 450 (B, C); side 100 to C without comparing hands', () => {
    // A = seat 0 folded after putting in 200; B = seat 1 all-in for 150; C = seat 2 put in 500.
    // B has the better hand but cannot win the side pot.
    const result = settleOracle(table(0, [folded(200), live(150, 2), live(500, 1)]));

    expect(result.refunds).toEqual([0, 0, 300]);
    expect(result.pots).toEqual([pot(450, [1, 2], [1], [450]), pot(100, [2], [2], [100])]);
    expect(result.payouts).toEqual([0, 450, 400]);
  });

  it('B16: as B14 with A best and B second: A wins 300, B wins 400, C wins 0', () => {
    const result = settleOracle(table(2, [live(100, 3), live(300, 2), live(600, 1)]));

    expect(result.pots).toEqual([pot(300, [0, 1, 2], [0], [300]), pot(400, [1, 2], [1], [400])]);
    // C wins nothing: it only gets its own 300 uncalled chips back.
    expect(result.refunds).toEqual([0, 0, 300]);
    expect(result.payouts).toEqual([300, 400, 300]);
  });

  it('B17: a 301-chip pot split two ways: 151 to the first winner after the button', () => {
    // Blinds 1/2. Seat 0 button, seat 1 SB (posts 1, folds), seat 2 BB. The button raises to 150,
    // the BB calls, equal hands. The first seat left of the button is seat 1, then seat 2.
    const result = settleOracle(table(0, [live(150, 7), folded(1), live(150, 7)]));

    expect(result.pots).toEqual([pot(301, [0, 2], [2, 0], [151, 150])]);
    expect(result.payouts).toEqual([150, 0, 151]);
  });

  it('B18: a 100-chip pot split three ways: 34 / 33 / 33, and a winning button comes last', () => {
    // Blinds 1/2. Seat 0 button, 1 SB (posts 1, folds), 2 BB, 3 UTG. UTG raises to 33, the
    // button and the BB call; three equal hands. Order: seat 2, seat 3, then the button.
    const result = settleOracle(table(0, [live(33, 5), folded(1), live(33, 5), live(33, 5)]));

    expect(result.pots).toEqual([pot(100, [0, 2, 3], [2, 3, 0], [34, 33, 33])]);
    expect(result.payouts).toEqual([33, 0, 34, 33]);
  });

  it('B19 (settlement side): when both play the board, the pot is split', () => {
    const result = settleOracle(table(1, [live(300, 4), live(300, 4)]));

    expect(result.pots).toEqual([pot(600, [0, 1], [0, 1], [300, 300])]);
  });

  it('B20 (settlement side): the better hand takes the whole pot', () => {
    const result = settleOracle(table(0, [live(300, 5), live(300, 4)]));

    expect(result.payouts).toEqual([600, 0]);
  });

  it('B25: a BB all-in for 60 is called for the full 100: the SB gets 40 back, 60 vs 60', () => {
    // Seat 0 button (folds), seat 1 SB (calls to 100), seat 2 BB (60, all-in).
    const bbWins = settleOracle(table(0, [folded(0), live(100, 1), live(60, 2)]));
    expect(bbWins.refunds).toEqual([0, 40, 0]);
    expect(bbWins.pots).toEqual([pot(120, [1, 2], [2], [120])]);
    expect(bbWins.payouts).toEqual([0, 40, 120]);

    const sbWins = settleOracle(table(0, [folded(0), live(100, 2), live(60, 1)]));
    expect(sbWins.payouts).toEqual([0, 160, 0]);
  });

  it('B34: the SB folds to a BB all-in for 30: the folded SB gets 20 back, the BB wins 60', () => {
    // Seat 0 button (folds), seat 1 SB (posts 50, folds), seat 2 BB (30, all-in).
    const input = table(0, [folded(0), folded(50), live(30)]);
    const result = settleOracle(input);

    expect(result.refunds).toEqual([0, 20, 0]);
    expect(result.pots).toEqual([pot(60, [2], [2], [60])]);
    expect(net(input, result)).toEqual([0, -30, 30]);
  });

  it('B36: heads-up blinds from stacks of 40 (SB) and 80 (BB): the BB gets 40 back', () => {
    // Seat 0 button/SB posts 40 (all-in), seat 1 BB posts 80 (all-in). Equal hands here.
    const result = settleOracle(table(0, [live(40, 3), live(80, 3)]));

    expect(result.refunds).toEqual([0, 40]);
    expect(result.pots).toEqual([pot(80, [0, 1], [1, 0], [40, 40])]);
    expect(result.payouts).toEqual([40, 80]);
  });

  it('B44: main pot 3 ways and side pot 2 ways, each odd chip to its own first winner', () => {
    // Button seat 4 (folded, 0), so the order starts at seat 0. Seat 0 all-in for 100; seats 1
    // and 3 put in 151; seat 2 folded after 125. Seats 0, 1 and 3 hold equal hands.
    // Main: 4 × 100 = 400, split 3 ways, remainder 1 → seat 0.
    // Side: 25 (seat 2's folded chips) + 2 × 51 = 127, split 2 ways, remainder 1 → seat 1.
    const result = settleOracle(
      table(4, [live(100, 5), live(151, 5), folded(125), live(151, 5), folded(0)]),
    );

    expect(result.refunds).toEqual([0, 0, 0, 0, 0]);
    expect(result.pots).toEqual([
      pot(400, [0, 1, 3], [0, 1, 3], [134, 133, 133]),
      pot(127, [1, 3], [1, 3], [64, 63]),
    ]);
    expect(result.payouts).toEqual([134, 197, 0, 196, 0]);
  });
});

describe('settleOracle: multi-way all-ins with several side pots and ties', () => {
  it('six seats: four pots, a refund, split side pots and folded money between levels', () => {
    // Button seat 5, so the order starts at seat 0. Levels 50, 100, 101 (folded), 250, 400, 1000.
    const input = table(5, [
      live(50, 9), // best hand, but only for the main pot
      live(100, 5),
      folded(101),
      live(250, 7),
      live(400, 7),
      live(1000, 3), // nobody matched its last 600
    ]);
    const result = settleOracle(input);

    expect(result.refunds).toEqual([0, 0, 0, 0, 0, 600]);
    expect(result.pots).toEqual([
      pot(300, [0, 1, 3, 4, 5], [0], [300]),
      pot(250, [1, 3, 4, 5], [3, 4], [125, 125]),
      // 4 × 1 (seat 2's last chip) + 3 × 149 = 451; seat 3 is first clockwise, so it gets 226.
      pot(451, [3, 4, 5], [3, 4], [226, 225]),
      pot(300, [4, 5], [4], [300]),
    ]);
    expect(result.payouts).toEqual([300, 0, 0, 351, 650, 600]);
  });

  it('merges layers that the same live seats can win, even where folded chips end (§3.8)', () => {
    // Seats 3 and 4 tie with 250 each; seat 0 is all-in for 50 and loses; seats 2 and 7 folded
    // after 101, seat 6 after 250. Between 50 and 250 the layers are 5 × 51 = 255 and
    // 3 × 149 = 447, both won by seats 3 and 4, so they are one pot of 702 split 351 / 351.
    // Two separate pots would give 128 + 224 = 352 against 127 + 223 = 350 (payouts 502 / 500).
    const input = table(7, [
      live(50, 1),
      folded(0),
      folded(101),
      live(250, 4),
      live(250, 4),
      folded(0),
      folded(250),
      folded(101),
    ]);
    const result = settleOracle(input);

    expect(result.refunds).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(result.pots).toEqual([
      pot(300, [0, 3, 4], [3, 4], [150, 150]),
      pot(702, [3, 4], [3, 4], [351, 351]),
    ]);
    expect(result.payouts).toEqual([0, 0, 0, 501, 501, 0, 0, 0]);
  });

  it('nine seats: 4-, 3- and 2-way ties, two odd chips in two pots, a winning button last', () => {
    // Button seat 2, so the order is 3, 4, 5, 6, 7, 8, 0, 1, 2.
    const input = table(2, [
      live(30, 8),
      folded(50),
      live(200, 8), // the button
      live(75, 8),
      folded(10),
      live(200, 6),
      folded(120),
      live(500, 2), // nobody matched its last 300
      live(200, 8),
    ]);
    const result = settleOracle(input);

    expect(result.refunds).toEqual([0, 0, 0, 0, 0, 0, 0, 300, 0]);
    expect(result.pots).toEqual([
      // 9 × 10 + 8 × 20 = 250 = 4 × 62 + 2
      pot(250, [0, 2, 3, 5, 7, 8], [3, 8, 0, 2], [63, 63, 62, 62]),
      // 7 × 20 + 6 × 25 = 290 = 3 × 96 + 2
      pot(290, [2, 3, 5, 7, 8], [3, 8, 2], [97, 97, 96]),
      // 5 × 45 + 4 × 80 = 545 = 2 × 272 + 1
      pot(545, [2, 5, 7, 8], [8, 2], [273, 272]),
    ]);
    expect(result.payouts).toEqual([62, 0, 430, 160, 0, 0, 0, 300, 433]);
  });

  it('gives the odd chip by the button, never to seat 0 by default (pitfall 7)', () => {
    // 100 + 100 + 1 folded chip = 201, split between seats 0 and 1.
    const seats = [live(100, 1), live(100, 1), folded(1)];

    expect(settleOracle(table(0, seats)).payouts).toEqual([100, 101, 0]);
    expect(settleOracle(table(1, seats)).payouts).toEqual([101, 100, 0]);
    expect(settleOracle(table(2, seats)).payouts).toEqual([101, 100, 0]);
  });

  it('hands out odd chips one at a time: 302 in three ways is 101 / 101 / 100', () => {
    const seats = [live(100, 4), live(100, 4), live(100, 4), folded(2)];

    expect(settleOracle(table(3, seats)).pots).toEqual([
      pot(302, [0, 1, 2], [0, 1, 2], [101, 101, 100]),
    ]);
    expect(settleOracle(table(0, seats)).pots).toEqual([
      pot(302, [0, 1, 2], [1, 2, 0], [101, 101, 100]),
    ]);
  });
});

describe('settleOracle: input checks', () => {
  const tenSeats = Array.from({ length: 10 }, () => live(10, 1));
  const foldedWithStrength: OracleSeat = { contributed: 10, folded: true, strength: 3 };
  const cases: [string, OracleInput, RegExp][] = [
    ['fewer than 2 seats', { seatCount: 1, button: 0, seats: [live(10, 1)] }, /2 to 9/],
    ['more than 9 seats', table(0, tenSeats), /2 to 9/],
    [
      'a button that is not a seat',
      { seatCount: 2, button: 2, seats: [live(10, 1), live(10, 1)] },
      /button/,
    ],
    [
      'a seat list of the wrong length',
      { seatCount: 3, button: 0, seats: [live(10, 1)] },
      /3 seats/,
    ],
    ['negative chips', table(0, [live(-1, 1), live(10, 1)]), /whole number/],
    ['fractional chips', table(0, [live(1.5, 1), live(10, 1)]), /whole number/],
    ['a folded seat with a strength', table(0, [foldedWithStrength, live(10, 1)]), /null/],
    [
      'a strength that is not a number',
      table(0, [live(10, Number.NaN), live(10, 1)]),
      /not a number/,
    ],
    ['nobody left in the hand', table(0, [folded(10), folded(10)]), /at least one seat/],
    [
      'chips matched only by folded seats',
      table(0, [folded(500), folded(500), live(100, 1)]),
      /from 100 to 500 were matched only by folded seats \(0, 1\)/,
    ],
    [
      'a live seat without a strength in a contested pot',
      table(0, [live(100), live(100, 1)]),
      /seat 0 .* needs a strength/,
    ],
  ];

  it.each(cases)('rejects %s', (_, input, reason) => {
    expect(() => settleOracle(input)).toThrow(RangeError);
    expect(() => settleOracle(input)).toThrow(reason);
  });
});

// ---------------------------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------------------------

/**
 * A fixed seed, so every CI run checks the same cases (like the statistical tests in PLAN
 * "Testing strategy → Rules"). A failure prints the seed and path that replay it.
 */
const RUNS = { seed: 20_260_928, numRuns: 2_000 } as const;

/** Chip totals: small values collide often (shared levels), large ones check the scale. */
const chipsArb = fc.oneof(
  { weight: 4, arbitrary: fc.integer({ min: 0, max: 12 }) },
  { weight: 3, arbitrary: fc.integer({ min: 0, max: 400 }) },
  { weight: 1, arbitrary: fc.integer({ min: 0, max: 50_000_000 }) },
);

interface RawSeat {
  contributed: number;
  folded: boolean;
  strength: number;
}

interface RawTable {
  seatCount: number;
  button: number;
  /** A seat that is kept in the hand, so at least one seat is live. */
  keeper: number;
  seats: RawSeat[];
}

const rawTableArb: fc.Arbitrary<RawTable> = fc.integer({ min: 2, max: 9 }).chain((seatCount) =>
  fc.record({
    seatCount: fc.constant(seatCount),
    button: fc.nat({ max: seatCount - 1 }),
    keeper: fc.nat({ max: seatCount - 1 }),
    seats: fc.array(
      fc.record({
        contributed: chipsArb,
        folded: fc.boolean(),
        strength: fc.integer({ min: 0, max: 3 }), // few values, so ties are common
      }),
      { minLength: seatCount, maxLength: seatCount },
    ),
  }),
);

/**
 * Makes a random table fit the oracle's contract, which is the shape legal play leaves at
 * settlement: the keeper stays live, and the live seat with the most chips reaches at least the
 * second-largest total, so every chip that two seats matched can be won by someone. Folded seats
 * get no strength.
 */
function withinContract({ seatCount, button, keeper, seats }: RawTable): OracleInput {
  const kept = seats.map((s, seat) => ({ ...s, folded: s.folded && seat !== keeper }));
  const second = kept.map((s) => s.contributed).sort((a, b) => b - a)[1] ?? 0;
  const liveMost = Math.max(...kept.filter((s) => !s.folded).map((s) => s.contributed));
  const richestLive = kept.findIndex((s) => !s.folded && s.contributed === liveMost);
  return {
    seatCount,
    button,
    seats: kept.map((s, seat) => ({
      contributed: seat === richestLive && liveMost < second ? second : s.contributed,
      folded: s.folded,
      strength: s.folded ? null : s.strength,
    })),
  };
}

const tableArb = rawTableArb.map(withinContract);

/** Only the keeper is live, and its hand is never shown (a hand won by folds). */
const loneLiveArb = rawTableArb
  .map((raw) =>
    withinContract({
      ...raw,
      seats: raw.seats.map((s, seat) => ({ ...s, folded: seat !== raw.keeper })),
    }),
  )
  .map((input) => ({ ...input, seats: input.seats.map((s) => ({ ...s, strength: null })) }));

/** A table where seat `b` is a copy of seat `a` (same chips, same fold, same strength). */
const twinsArb = rawTableArb
  .chain((raw) =>
    fc.record({
      raw: fc.constant(raw),
      a: fc.nat({ max: raw.seatCount - 1 }),
      step: fc.integer({ min: 1, max: raw.seatCount - 1 }),
    }),
  )
  .map(({ raw, a, step }) => {
    const b = (a + step) % raw.seatCount;
    const seats = raw.seats.map((s, seat) => (seat === b ? { ...at(raw.seats, a) } : s));
    return { input: withinContract({ ...raw, seats }), a, b };
  });

/**
 * §3.8's side-pot pseudo-code transcribed line by line, after the uncalled refund on hand
 * totals. Used only to check that the oracle's chip layers group into the same pots.
 */
function pseudoCodePots(input: OracleInput): {
  refunds: number[];
  pots: { amount: number; eligible: number[] }[];
} {
  const totalBet = input.seats.map((s) => s.contributed);
  const refunds = totalBet.map(() => 0);
  const topSeat = totalBet.indexOf(Math.max(...totalBet));
  const top = at(totalBet, topSeat);
  const second = Math.max(0, ...totalBet.filter((_, seat) => seat !== topSeat));
  if (top > second) {
    totalBet[topSeat] = second;
    refunds[topSeat] = top - second;
  }

  const live = input.seats.flatMap((s, seat) => (s.folded ? [] : [seat]));
  const levels = [...new Set(live.map((seat) => at(totalBet, seat)))].sort(ascending);
  let prev = 0;
  const pots: { amount: number; eligible: number[] }[] = [];
  for (const level of levels) {
    const amount = sum(totalBet.map((t) => Math.min(t, level) - Math.min(t, prev)));
    const eligible = live.filter((seat) => at(totalBet, seat) >= level);
    if (amount > 0) {
      const last = pots.at(-1);
      if (last !== undefined && last.eligible.join() === eligible.join()) last.amount += amount;
      else pots.push({ amount, eligible });
    }
    prev = level;
  }
  return { refunds, pots };
}

describe('settleOracle: properties', () => {
  it('conserves chips exactly', () => {
    fc.assert(
      fc.property(tableArb, (input) => {
        const result = settleOracle(input);
        const chipsIn = sum(input.seats.map((s) => s.contributed));

        expect(sum(result.payouts)).toBe(chipsIn);
        expect(sum(result.pots.map((p) => p.amount)) + sum(result.refunds)).toBe(chipsIn);
        const rebuilt = [...result.refunds];
        for (const p of result.pots) {
          expect(sum(p.shares)).toBe(p.amount);
          p.winners.forEach((seat, place) => {
            rebuilt[seat] = at(rebuilt, seat) + at(p.shares, place);
          });
        }
        expect(result.payouts).toEqual(rebuilt);
      }),
      RUNS,
    );
  });

  it('never lets a folded seat win: it only gets its own uncalled chips back', () => {
    fc.assert(
      fc.property(tableArb, (input) => {
        const result = settleOracle(input);
        input.seats.forEach((s, seat) => {
          if (!s.folded) return;
          for (const p of result.pots) {
            expect(p.eligible).not.toContain(seat);
            expect(p.winners).not.toContain(seat);
          }
          expect(at(result.payouts, seat)).toBe(at(result.refunds, seat));
        });
      }),
      RUNS,
    );
  });

  it('gives a lone live seat every pot without comparing hands', () => {
    fc.assert(
      fc.property(loneLiveArb, (input) => {
        const result = settleOracle(input);
        const lone = input.seats.findIndex((s) => !s.folded);
        const folds = input.seats.flatMap((s, seat) => (s.folded ? [seat] : []));

        for (const p of result.pots) {
          expect(p.eligible).toEqual([lone]);
          expect(p.winners).toEqual([lone]);
        }
        // Everything, except uncalled chips that go back to a folded seat (B34).
        const chipsIn = sum(input.seats.map((s) => s.contributed));
        const refundedToFolds = sum(folds.map((seat) => at(result.refunds, seat)));
        expect(at(result.payouts, lone)).toBe(chipsIn - refundedToFolds);
      }),
      RUNS,
    );
  });

  it('refunds exactly the chips nobody matched, to the seat that put them in (R1)', () => {
    fc.assert(
      fc.property(tableArb, (input) => {
        const totals = input.seats.map((s) => s.contributed);
        const top = Math.max(...totals);
        const holders = totals.flatMap((t, seat) => (t === top ? [seat] : []));
        const second = Math.max(0, ...totals.filter((t) => t !== top));
        const expected = totals.map((_, seat) =>
          holders.length === 1 && seat === holders[0] ? top - second : 0,
        );

        expect(settleOracle(input).refunds).toEqual(expected);
      }),
      RUNS,
    );
  });

  it('finds nothing more to refund after a refund (idempotent, §3.8)', () => {
    fc.assert(
      fc.property(tableArb, (input) => {
        const first = settleOracle(input);
        const again = settleOracle({
          ...input,
          seats: input.seats.map((s, seat) => ({
            ...s,
            contributed: s.contributed - at(first.refunds, seat),
          })),
        });

        expect(again.refunds.every((chips) => chips === 0)).toBe(true);
        expect(again.pots).toEqual(first.pots);
        expect(again.payouts).toEqual(first.payouts.map((p, seat) => p - at(first.refunds, seat)));
      }),
      RUNS,
    );
  });

  it('builds pots whose eligible seats shrink from the main pot up and pays the best hands', () => {
    fc.assert(
      fc.property(tableArb, (input) => {
        let previous: readonly number[] | null = null;
        for (const p of settleOracle(input).pots) {
          expect(p.amount).toBeGreaterThan(0);
          expect(p.eligible.length).toBeGreaterThan(0);
          expect([...p.eligible].sort(ascending)).toEqual(p.eligible);
          for (const seat of p.eligible) expect(at(input.seats, seat).folded).toBe(false);
          if (previous !== null) {
            expect(p.eligible.length).toBeLessThan(previous.length);
            for (const seat of p.eligible) expect(previous).toContain(seat);
          }
          previous = p.eligible;

          const strengthOf = (seat: number): number => at(input.seats, seat).strength ?? -Infinity;
          const best = Math.max(...p.eligible.map(strengthOf));
          const expected =
            p.eligible.length === 1 ? p.eligible : p.eligible.filter((s) => strengthOf(s) === best);
          expect([...p.winners].sort(ascending)).toEqual(expected);
        }
      }),
      RUNS,
    );
  });

  it('makes the same refunds and pots as a literal reading of the §3.8 pseudo-code', () => {
    fc.assert(
      fc.property(tableArb, (input) => {
        const oracle = settleOracle(input);
        const literal = pseudoCodePots(input);

        expect(oracle.refunds).toEqual(literal.refunds);
        expect(oracle.pots.map(({ amount, eligible }) => ({ amount, eligible }))).toEqual(
          literal.pots,
        );
      }),
      RUNS,
    );
  });

  it('lets a seat win at most min(its chips, theirs) from each seat, the lone best hand exactly', () => {
    fc.assert(
      fc.property(tableArb, (input) => {
        const result = settleOracle(input);
        const inPots = input.seats.map((s, seat) => s.contributed - at(result.refunds, seat));
        const liveSeats = input.seats.flatMap((s, seat) => (s.folded ? [] : [seat]));
        const strengthOf = (seat: number): number => at(input.seats, seat).strength ?? -Infinity;
        const best = Math.max(...liveSeats.map(strengthOf));
        const bestSeats = liveSeats.filter((seat) => strengthOf(seat) === best);

        for (const seat of liveSeats) {
          const cap = sum(inPots.map((chips) => Math.min(chips, at(inPots, seat))));
          const won = at(result.payouts, seat) - at(result.refunds, seat);
          if (bestSeats.length === 1 && bestSeats[0] === seat) expect(won).toBe(cap);
          else expect(won).toBeLessThanOrEqual(cap);
        }
      }),
      RUNS,
    );
  });

  it('is symmetric under turning the table: seats and button rotate together', () => {
    fc.assert(
      fc.property(tableArb, fc.nat({ max: 8 }), (input, turn) => {
        const n = input.seatCount;
        const to = (seat: number): number => (seat + turn) % n;
        const from = (seat: number): number => (((seat - turn) % n) + n) % n;
        const turned: OracleInput = {
          seatCount: n,
          button: to(input.button),
          seats: input.seats.map((_, seat) => at(input.seats, from(seat))),
        };
        const before = settleOracle(input);
        const after = settleOracle(turned);
        const turnPerSeat = (perSeat: readonly number[]): number[] =>
          perSeat.map((_, seat) => at(perSeat, from(seat)));

        expect(after.refunds).toEqual(turnPerSeat(before.refunds));
        expect(after.payouts).toEqual(turnPerSeat(before.payouts));
        expect(after.pots).toEqual(
          before.pots.map((p) => ({
            amount: p.amount,
            eligible: p.eligible.map(to).sort(ascending),
            winners: p.winners.map(to),
            shares: p.shares,
          })),
        );
      }),
      RUNS,
    );
  });

  it('depends only on the order of the strengths, not on their values', () => {
    fc.assert(
      fc.property(
        tableArb,
        fc.integer({ min: 1, max: 1_000 }),
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        (input, scale, shift) => {
          const relabelled = {
            ...input,
            seats: input.seats.map((s) => ({
              ...s,
              strength: s.strength === null ? null : s.strength * scale + shift,
            })),
          };

          expect(settleOracle(relabelled)).toEqual(settleOracle(input));
        },
      ),
      RUNS,
    );
  });

  it('treats two seats in the same spot alike, up to one odd chip per pot', () => {
    fc.assert(
      fc.property(twinsArb, ({ input, a, b }) => {
        const seatA = at(input.seats, a);
        const seatB = at(input.seats, b);
        fc.pre(
          seatA.contributed === seatB.contributed &&
            seatA.folded === seatB.folded &&
            seatA.strength === seatB.strength,
        );
        const result = settleOracle(input);

        expect(at(result.refunds, a)).toBe(0);
        expect(at(result.refunds, b)).toBe(0);
        for (const p of result.pots) {
          expect(p.eligible.includes(a)).toBe(p.eligible.includes(b));
          expect(p.winners.includes(a)).toBe(p.winners.includes(b));
        }
        const gap = Math.abs(at(result.payouts, a) - at(result.payouts, b));
        expect(gap).toBeLessThanOrEqual(result.pots.length);
      }),
      RUNS,
    );
  });

  it('hands out odd chips one at a time, clockwise from the first seat left of the button', () => {
    fc.assert(
      fc.property(tableArb, (input) => {
        const { seatCount, button } = input;
        const afterButton = (seat: number): number => (seat - button - 1 + seatCount) % seatCount;
        for (const p of settleOracle(input).pots) {
          const order = p.winners.map(afterButton);
          expect(order).toEqual([...order].sort(ascending));

          const low = Math.floor(p.amount / p.winners.length);
          for (const share of p.shares) expect([low, low + 1]).toContain(share);
          p.shares.forEach((share, place) => {
            if (place > 0) expect(share).toBeLessThanOrEqual(at(p.shares, place - 1));
          });
          expect(p.shares.filter((share) => share > low)).toHaveLength(p.amount % p.winners.length);
        }
      }),
      RUNS,
    );
  });

  it('uses the button only to decide who gets odd chips', () => {
    fc.assert(
      fc.property(tableArb, fc.nat({ max: 8 }), (input, otherButton) => {
        const moved = { ...input, button: otherButton % input.seatCount };
        const here = settleOracle(input);
        const there = settleOracle(moved);

        expect(there.refunds).toEqual(here.refunds);
        expect(there.pots.map(({ amount, eligible }) => ({ amount, eligible }))).toEqual(
          here.pots.map(({ amount, eligible }) => ({ amount, eligible })),
        );
        here.pots.forEach((p, i) => {
          expect([...at(there.pots, i).winners].sort(ascending)).toEqual(
            [...p.winners].sort(ascending),
          );
        });
        input.seats.forEach((_, seat) => {
          const gap = Math.abs(at(there.payouts, seat) - at(here.payouts, seat));
          expect(gap).toBeLessThanOrEqual(here.pots.length);
        });
      }),
      RUNS,
    );
  });

  it('does not change its input and gives the same answer twice', () => {
    fc.assert(
      fc.property(tableArb, (input) => {
        const copy = structuredClone(input);
        const frozen: OracleInput = Object.freeze({
          ...input,
          seats: Object.freeze(input.seats.map((s) => Object.freeze({ ...s }))),
        });

        expect(settleOracle(frozen)).toEqual(settleOracle(copy));
        expect(frozen).toEqual(copy);
      }),
      RUNS,
    );
  });
});
