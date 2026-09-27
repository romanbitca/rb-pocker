/**
 * Independent settlement oracle (PLAN §18 Stage 2; "Testing strategy", Oracles: Settlement).
 *
 * Written only from the text of PLAN §3.8 (with §0.3, §3.9 and Appendix B), never from
 * `src/engine/settle.ts`, and on purpose with a different method. §3.8 walks the levels of the
 * live seats. This file cuts every seat's chips, folded seats included, into horizontal chip
 * layers. The differential test (Stage 2, acceptance criterion 3) compares the two, so a slip in
 * one shows up as a disagreement instead of being copied into both. It imports nothing from `src/`.
 *
 * Rules implemented (§3.8, paraphrased):
 *
 * R1  Uncalled chips (TDA r.15-B). Chips that no other seat matched go back to the seat that put
 *     them in, even if that seat folded (only possible with forced blinds, B34). Here: a chip
 *     layer with exactly one contributor is refunded to it. On hand totals this is §3.8's
 *     `top − second` rule (the largest total minus the largest of all the other seats). §3.8
 *     applies that rule to each street's `streetBet`; in legal play a refund can only happen on
 *     the last street that takes chips, so hand totals give the same refund. Running it twice
 *     changes nothing (idempotent).
 * R2  Side pots. Folded money stays in the pots at its own levels (pitfall 6), but only live seats
 *     can win. The layer between two consecutive contribution levels holds
 *     height × (number of contributors) chips. The live seats that reach its top can win it.
 *     Consecutive layers with the same eligible seats form one pot (§3.8 merges pots with equal
 *     eligible sets), even where a folded seat's chips end inside the pot. Pots are listed main
 *     pot first, then side pots from the lowest level up: the order §3.8's loop pushes them (the
 *     UI animates them in reverse). Σ pots + Σ refunds = Σ chips put in.
 * R3  Each pot is settled on its own (TDA r.21). A pot with one eligible seat is awarded without
 *     comparing hands. Otherwise the highest strength wins and equal strengths split (cards speak,
 *     §3.9).
 * R4  Odd chips (TDA r.20), for each pot independently (B44). share = floor(amount / k) and
 *     rem = amount % k for k winners. The winners are ordered clockwise starting from the first
 *     seat left of the button (seat button + 1; the button itself comes last), and the first rem
 *     winners get one extra chip each. The unit is one chip (chips are integers, §0.3), never a
 *     small blind. It never goes to seat 0 by default (pitfall 7).
 *
 * Contract: inputs that legal play can produce. The function throws on anything else, for
 * example no live seat, or chips above every live seat's total that two folded seats matched
 * (nobody could win them).
 */

/** One seat at the end of a hand. */
export interface OracleSeat {
  /**
   * Every chip the seat put in this hand: blinds, bets and calls. Totals from before the
   * engine's uncalled refunds and totals from after them give the same final stacks; in the
   * second case `refunds` is all zeros. A seat that was not dealt in is passed as
   * `{ contributed: 0, folded: true, strength: null }`.
   */
  readonly contributed: number;
  /** Folded, or not dealt in. A folded seat can get its own uncalled chips back but never wins a pot. */
  readonly folded: boolean;
  /**
   * Showdown strength: higher wins, equal values split. `null` when folded. A live seat may also
   * pass `null` when its hand is never compared (for example a hand won by folds).
   */
  readonly strength: number | null;
}

export interface OracleInput {
  /** Seats at the table, 2 to 9 (§3.1). Seats are numbered clockwise (§0.3). */
  readonly seatCount: number;
  /** The button seat. Odd chips start at the seat after it (R4). */
  readonly button: number;
  /** One entry per seat, indexed by seat number. */
  readonly seats: readonly OracleSeat[];
}

export interface OraclePot {
  /** Chips in this pot. */
  readonly amount: number;
  /** Live seats that can win it, in seat order. */
  readonly eligible: readonly number[];
  /** Seats that share it, in odd-chip order: clockwise from the first seat left of the button. */
  readonly winners: readonly number[];
  /** Chips for each winner, parallel to `winners`. */
  readonly shares: readonly number[];
}

export interface OracleSettlement {
  /** Uncalled chips given back, per seat (R1). At most one seat gets any. */
  readonly refunds: readonly number[];
  /** Main pot first, then the side pots from the lowest level up (R2). */
  readonly pots: readonly OraclePot[];
  /** Per seat: its refund plus its pot shares. Adds up to the chips put in. */
  readonly payouts: readonly number[];
}

export function settleOracle(input: OracleInput): OracleSettlement {
  checkInput(input);
  const { seatCount, button, seats } = input;
  const seatNumbers = Array.from({ length: seatCount }, (_, seat) => seat);
  const seatAt = (seat: number): OracleSeat => {
    const found = seats[seat];
    if (found === undefined) throw new RangeError(`settleOracle: no seat ${seat}`);
    return found;
  };

  const refunds = new Array<number>(seatCount).fill(0);
  const groups: { amount: number; eligible: number[] }[] = [];

  // Walk the chip layers from the bottom. The levels are every seat's total, folded seats included.
  const levels = [...new Set(seats.map((s) => s.contributed))]
    .filter((chips) => chips > 0)
    .sort((a, b) => a - b);
  let below = 0;
  for (const level of levels) {
    const bottom = below;
    below = level;
    const contributors = seatNumbers.filter((seat) => seatAt(seat).contributed >= level);
    const amount = (level - bottom) * contributors.length;

    const [alone] = contributors;
    if (contributors.length === 1 && alone !== undefined) {
      // R1: no other seat reached this layer, so nobody called these chips.
      addTo(refunds, alone, amount);
      continue;
    }

    // R2: only live seats that reached the top of the layer can win it.
    const eligible = contributors.filter((seat) => !seatAt(seat).folded);
    if (eligible.length === 0) {
      throw new RangeError(
        `settleOracle: the chips from ${bottom} to ${level} were matched only by folded seats ` +
          `(${contributors.join(', ')}), so nobody can win them`,
      );
    }
    const last = groups.at(-1);
    if (last !== undefined && sameSeats(last.eligible, eligible)) last.amount += amount;
    else groups.push({ amount, eligible });
  }

  // R4: clockwise distance from the first seat left of the button (the button itself is last).
  const oddChipOrder = (seat: number): number => (seat - button - 1 + seatCount) % seatCount;

  const payouts = [...refunds];
  const pots = groups.map(({ amount, eligible }): OraclePot => {
    const winners = bestHands(eligible, seatAt).sort((a, b) => oddChipOrder(a) - oddChipOrder(b));
    const share = Math.floor(amount / winners.length);
    const rem = amount % winners.length;
    const shares = winners.map((_, place) => share + (place < rem ? 1 : 0));
    winners.forEach((seat, place) => addTo(payouts, seat, shares[place] ?? 0));
    return { amount, eligible, winners, shares };
  });

  if (total(payouts) !== total(seats.map((s) => s.contributed))) {
    throw new Error('settleOracle: chips are not conserved (oracle bug)');
  }
  return { refunds, pots, payouts };
}

/** R3: the eligible seats with the highest strength. One eligible seat wins without a comparison. */
function bestHands(eligible: readonly number[], seatAt: (seat: number) => OracleSeat): number[] {
  if (eligible.length === 1) return [...eligible];
  let best = -Infinity;
  for (const seat of eligible) {
    const { strength } = seatAt(seat);
    if (strength === null) {
      throw new RangeError(
        `settleOracle: seat ${seat} shares a pot with other live seats, so it needs a strength`,
      );
    }
    best = Math.max(best, strength);
  }
  return eligible.filter((seat) => seatAt(seat).strength === best);
}

function checkInput({ seatCount, button, seats }: OracleInput): void {
  if (!Number.isInteger(seatCount) || seatCount < 2 || seatCount > 9) {
    throw new RangeError(`settleOracle: seatCount must be 2 to 9, got ${seatCount}`);
  }
  if (!Number.isInteger(button) || button < 0 || button >= seatCount) {
    throw new RangeError(`settleOracle: button must be a seat from 0 to ${seatCount - 1}`);
  }
  if (seats.length !== seatCount) {
    throw new RangeError(`settleOracle: expected ${seatCount} seats, got ${seats.length}`);
  }
  seats.forEach(({ contributed, folded, strength }, seat) => {
    if (!Number.isSafeInteger(contributed) || contributed < 0) {
      throw new RangeError(`settleOracle: seat ${seat} must put in a whole number of chips ≥ 0`);
    }
    if (folded && strength !== null) {
      throw new RangeError(`settleOracle: seat ${seat} folded, so its strength must be null`);
    }
    if (strength !== null && !Number.isFinite(strength)) {
      throw new RangeError(`settleOracle: seat ${seat} has a strength that is not a number`);
    }
  });
  if (!Number.isSafeInteger(total(seats.map((s) => s.contributed)))) {
    throw new RangeError('settleOracle: too many chips for exact integer maths');
  }
  if (seats.every((s) => s.folded)) {
    throw new RangeError('settleOracle: at least one seat must still be in the hand');
  }
}

function sameSeats(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((seat, i) => seat === b[i]);
}

function addTo(perSeat: number[], seat: number, chips: number): void {
  perSeat[seat] = (perSeat[seat] ?? 0) + chips;
}

function total(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}
