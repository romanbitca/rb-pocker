/**
 * Settlement (PLAN §3.8, §3.9): the uncalled-bet refund at the end of every betting round, and at
 * the last `advance` of a hand the side pots, the showdown, the odd chips and the payouts.
 *
 * ⚠️ Financial code (R1 in the risk register): a slip here pays the wrong player. It is checked
 * three ways: the invariants after every step (I1, I6, I7, I11, I14, and I12 in the tests), the
 * Appendix B vectors, and a differential test against the independent chip-layer oracle
 * (`tests/engine/settle.oracle.ts`, written from §3.8 alone) on random multi-way all-ins.
 */
import { makeCard, rankOf, suitOf, type Card, type Rank, type Suit } from '../core/cards.ts';
import { categoryOf, score5, score7, scoreNibbles } from '../eval/evaluate.ts';
import { isLive } from './rules.ts';
import type { HandResult, HandState, LogEvent, Pot, SeatState } from './types.ts';

/**
 * §3.8 uncalled refund (TDA r.15-B): `top` = the largest `streetBet` of any dealt-in seat (folded
 * seats included), `second` = the largest among all the others. If `top > second`, the difference
 * goes back from that seat's `streetBet` and `totalBet` to its stack, even if it folded (only
 * possible with forced blinds, B34), and a `refund` event is logged. A seat that gets chips back
 * is no longer all-in (I7). Idempotent: a second call finds `top == second` and does nothing.
 * Mutates `h`, which must be a fresh state or a clone (§4.2).
 */
export function refundUncalled(h: HandState): void {
  let top = 0;
  let topSeat = -1;
  let second = 0;
  h.seats.forEach((s, i) => {
    if (!s.dealtIn) return;
    if (s.streetBet > top) {
      second = top;
      top = s.streetBet;
      topSeat = i;
    } else if (s.streetBet > second) {
      second = s.streetBet;
    }
  });
  if (topSeat < 0 || top === second) return;
  const s = h.seats[topSeat] as SeatState;
  const amount = top - second;
  s.streetBet -= amount;
  s.totalBet -= amount;
  s.stack += amount;
  s.allIn = !s.folded && s.stack === 0;
  h.log.push({ e: 'refund', seat: topSeat, amount });
}

/**
 * §3.8 side pots, main pot first. The levels are the live seats' hand totals, lowest first; the
 * pot of a level takes from every dealt-in seat, folded ones included (Known pitfall 6), what it
 * put in between the previous level and this one; the live seats that reached the level can win
 * it. Eligible seats are listed in seat order.
 *
 * §3.8 also merges a pot into the previous one when both have the same eligible seats. With the
 * levels taken from live seats only that never happens here: each level leaves out the live
 * seat(s) whose total is the level below it. (The oracle, which cuts at every seat's total,
 * needs that merge.) After the refunds no seat has more in than the top live seat (I6), so the
 * pots hold every chip: Σ pots = Σ totalBet.
 */
export function sidePots(h: HandState): Pot[] {
  const live = seatsWhere(h, isLive);
  const levels = [...new Set(live.map((i) => seat(h, i).totalBet))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const s of h.seats) {
      if (s.dealtIn) amount += Math.min(s.totalBet, level) - Math.min(s.totalBet, prev);
    }
    if (amount > 0) {
      pots.push({ amount, eligible: live.filter((i) => seat(h, i).totalBet >= level) });
    }
    prev = level;
  }
  return pots;
}

/**
 * §3.8 odd chips (TDA r.20): the seats in clockwise order starting from the first seat left of
 * the button, so a winning button comes last (never "seat 0 first", Known pitfall 7).
 */
export function oddChipOrder(h: HandState, seats: readonly number[]): number[] {
  const n = h.seats.length;
  const place = (s: number): number => (s - h.button - 1 + n) % n;
  return [...seats].sort((a, b) => place(a) - place(b));
}

/**
 * A pot split between `k` winners already in odd-chip order: `floor(amount / k)` each, and the
 * first `amount % k` of them one chip more (§3.8, per pot independently, B44).
 */
export function splitPot(amount: number, k: number): number[] {
  const share = Math.floor(amount / k);
  const rem = amount % k;
  return Array.from({ length: k }, (_, j) => share + (j < rem ? 1 : 0));
}

/**
 * The last `advance` of a hand (§3.8, §3.9, §4.3): builds the pots, finds each pot's winners
 * (cards speak: the best `score7` among the pot's eligible seats; a pot with one eligible seat
 * is awarded without comparing hands, and a hand won by folds shows nothing), splits ties with
 * the odd chips clockwise from the first seat left of the button, pays the winners, and sets
 * `result` and phase 'complete'. `streetBet` and `totalBet` stay as they are; a seat that gets
 * chips is no longer all-in (I7). The log gets one `award` per pot, side pots first and the main
 * pot last, as they are pushed to the winners (§3.8: side pots before the main pot).
 * Mutates `h` (the reducer's clone).
 */
export function settle(h: HandState): void {
  const n = h.seats.length;
  const live = seatsWhere(h, isLive);
  const endedBy: HandResult['endedBy'] = live.length === 1 ? 'fold' : 'showdown';
  const scores = new Map<number, number>();
  if (endedBy === 'showdown') {
    for (const i of live) scores.set(i, score7([...holeOf(h, i), ...h.board], 7));
  }
  const pots = sidePots(h);
  const potWinners = pots.map((pot) => {
    if (pot.eligible.length === 1) return [...pot.eligible];
    const best = Math.max(...pot.eligible.map((i) => scores.get(i) as number));
    return oddChipOrder(
      h,
      pot.eligible.filter((i) => scores.get(i) === best),
    );
  });

  const payouts = new Array<number>(n).fill(0);
  const awards: LogEvent[] = pots.map((pot, p) => {
    const winners = potWinners[p] as number[];
    const amounts = splitPot(pot.amount, winners.length);
    winners.forEach((i, j) => {
      payouts[i] = (payouts[i] as number) + (amounts[j] as number);
    });
    return { e: 'award', pot: p, seats: [...winners], amounts };
  });
  h.log.push(...awards.reverse());

  h.seats.forEach((s, i) => {
    s.stack += payouts[i] as number;
    s.allIn = s.dealtIn && !s.folded && s.stack === 0;
  });
  h.result = {
    endedBy,
    pots,
    potWinners,
    payouts,
    net: h.seats.map((s, i) => (payouts[i] as number) - s.totalBet),
    shown:
      endedBy === 'fold'
        ? []
        : h.revealed.map((i) => {
            const score = scores.get(i) as number;
            return {
              seat: i,
              score,
              category: categoryOf(score),
              best5: bestFive(holeOf(h, i), h.board, score),
            };
          }),
  };
  h.phase = 'complete';
  h.toAct = null;
}

/**
 * The five cards that make `score` from these hole cards and a five-card board, in the order of
 * §5.4 (the same rule as `describe().best5` in eval/describe.ts): if the board alone scores the
 * same, the five board cards (the board plays; never a hole card that merely ties, pitfall 10);
 * a flush or straight flush is the flush suit's cards of the scored ranks; otherwise, rank by
 * scored rank (category cards first, then kickers), the needed cards of that rank, chosen
 * preferring hole cards and then the higher suit (s > h > d > c), listed higher suit first.
 */
export function bestFive(hole: readonly Card[], board: readonly Card[], score: number): Card[] {
  const own = score5(board) === score ? [] : hole;
  const cards = [...own, ...board];
  const [n0, n1, n2, n3, n4] = scoreNibbles(score);
  const code = score >> 20;
  const straight = (high: Rank): Rank[] => [0, 1, 2, 3, 4].map((d) => (high - d + 13) % 13);
  if (code === 8 || code === 5) {
    // Straight flush or flush: five or more of the seven cards share one suit.
    const suit = ([0, 1, 2, 3] as const).find(
      (x) => cards.filter((c) => suitOf(c) === x).length >= 5,
    ) as Suit;
    const ranks = code === 8 ? straight(n0) : [n0, n1, n2, n3, n4];
    return ranks.map((r) => makeCard(r, suit));
  }
  const used = new Set<Card>();
  const fromHand = (c: Card): number => (own.includes(c) ? 1 : 0);
  const take = (rank: Rank, count: number): Card[] => {
    const chosen = cards
      .filter((c) => rankOf(c) === rank && !used.has(c))
      .sort((a, b) => fromHand(b) - fromHand(a) || suitOf(b) - suitOf(a))
      .slice(0, count);
    for (const c of chosen) used.add(c);
    return chosen.sort((a, b) => suitOf(b) - suitOf(a));
  };
  switch (code) {
    case 7:
      return [...take(n0, 4), ...take(n1, 1)];
    case 6:
      return [...take(n0, 3), ...take(n1, 2)];
    case 4:
      return straight(n0).flatMap((r) => take(r, 1));
    case 3:
      return [...take(n0, 3), ...take(n1, 1), ...take(n2, 1)];
    case 2:
      return [...take(n0, 2), ...take(n1, 2), ...take(n2, 1)];
    case 1:
      return [...take(n0, 2), ...take(n1, 1), ...take(n2, 1), ...take(n3, 1)];
    default:
      return [n0, n1, n2, n3, n4].flatMap((r) => take(r, 1));
  }
}

const seat = (h: HandState, i: number): SeatState => h.seats[i] as SeatState;

const holeOf = (h: HandState, i: number): Card[] => [...(seat(h, i).hole as [Card, Card])];

function seatsWhere(h: HandState, ok: (s: SeatState) => boolean): number[] {
  return h.seats.flatMap((s, i) => (ok(s) ? [i] : []));
}
