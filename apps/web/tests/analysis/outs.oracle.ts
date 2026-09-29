/**
 * Brute-force oracles for the hand analysis (PLAN "Testing strategy" → Oracles: "Outs and
 * chances: exact enumeration"). Written from the PLAN text, not from `src/analysis`: they share
 * no masks or tables with it.
 *
 * - Outs (§6.3): every unseen next card is dealt and judged with `describe()`, the three rules
 *   applied literally (rule 2 reads the new best five for a hole card).
 * - Risky rules (§6.4): straights found by scanning rank windows, flushes compared with the naive
 *   21-subset evaluator of the evaluator tests.
 * - Draws (§6.2): the definitions table, rank by rank.
 * - Beaters (§6.5): every unseen 2-card combo against the hero with the naive evaluator.
 */
import type { DrawKind, RiskRule } from '../../src/analysis/types.ts';
import { rankOf, suitOf, type Card } from '../../src/core/cards.ts';
import { describe } from '../../src/eval/describe.ts';
import { HAND_CATEGORIES, type HandCategory } from '../../src/eval/evaluate.ts';
import { compareNaive, naiveBest } from '../eval/naive.ts';

const levelOf = (c: HandCategory): number => HAND_CATEGORIES.indexOf(c);
const TWO_PAIR = levelOf('twoPair');
const STRAIGHT = levelOf('straight');

const unseenCards = (known: readonly Card[]): Card[] =>
  Array.from({ length: 52 }, (_, c) => c).filter((c) => !known.includes(c));

/**
 * The high rank (0 = Two … 12 = Ace; the wheel is 3) of the best straight among `ranks`, or −1.
 * Plain window scan; the Ace also plays low.
 */
export function bestStraight(ranks: Iterable<number>): number {
  const has = new Set(ranks);
  for (let high = 12; high >= 3; high--) {
    let run = true;
    for (let i = 0; i < 5 && run; i++) {
      const r = high - i;
      run = has.has(r < 0 ? 12 : r); // high 3: 5-4-3-2-A
    }
    if (run) return high;
  }
  return -1;
}

export interface OracleOut {
  makes: HandCategory;
  level: number;
}

/** §6.3, literally: card → the category it makes, for every out. */
export function oracleOuts(hole: readonly Card[], board: readonly Card[]): Map<Card, OracleOut> {
  const outs = new Map<Card, OracleOut>();
  if (board.length !== 3 && board.length !== 4) return outs;
  const h = hole as [Card, Card];
  const before = levelOf(describe(h, [...board]).category);
  const boardRanks = new Set(board.map(rankOf));
  const holeRanks = new Set(hole.map(rankOf));
  for (const x of unseenCards([...hole, ...board])) {
    const after = describe(h, [...board, x]);
    const level = levelOf(after.category);
    const rule1 = level > before;
    const rule2 = after.best5.some((c) => hole.includes(c));
    const pairsTheBoardOnly = boardRanks.has(rankOf(x)) && !holeRanks.has(rankOf(x));
    const rule3 = !(pairsTheBoardOnly && level <= TWO_PAIR);
    if (rule1 && rule2 && rule3) outs.set(x, { makes: after.category, level });
  }
  return outs;
}

/** §6.4, literally, for the out `x` that makes `makes`. */
export function oracleRisky(
  hole: readonly Card[],
  board: readonly Card[],
  x: Card,
  makes: HandCategory,
): RiskRule[] {
  const next = [...board, x];
  const mine = [...hole, ...next];
  const level = levelOf(makes);
  const unseen = unseenCards(mine);
  const risky: RiskRule[] = [];

  const suitCounts = [0, 1, 2, 3].map((s) => next.filter((c) => suitOf(c) === s).length);
  if (level <= STRAIGHT && Math.max(...suitCounts) >= 3) risky.push('R1');

  const paired = new Set(next.map(rankOf)).size < next.length;
  if ((makes === 'straight' || makes === 'flush') && paired) risky.push('R2');

  if (level <= STRAIGHT) {
    // Some two unseen cards make a straight with the board that beats the hero's new hand:
    // any straight beats less than a straight; against a straight it must be higher.
    const heroHigh = makes === 'straight' ? bestStraight(mine.map(rankOf)) : -1;
    const openRanks = [...new Set(unseen.map(rankOf))];
    const boardRanks = next.map(rankOf);
    let found = false;
    for (let i = 0; i < openRanks.length && !found; i++) {
      for (let j = i; j < openRanks.length && !found; j++) {
        // j === i: a pocket pair or one useful card (any second card).
        const high = bestStraight([...boardRanks, openRanks[i] as number, openRanks[j] as number]);
        found = high >= 0 && high > heroHigh;
      }
    }
    if (found) risky.push('R3');
  }

  if (makes === 'flush') {
    const suit = [0, 1, 2, 3].find((s) => mine.filter((c) => suitOf(c) === s).length >= 5);
    const top2 = unseen
      .filter((c) => suitOf(c) === suit)
      .sort((a, b) => rankOf(b) - rankOf(a))
      .slice(0, 2);
    const theirs = [...next.filter((c) => suitOf(c) === suit), ...top2];
    if (theirs.length >= 5 && compareNaive(naiveBest(theirs), naiveBest(mine)) > 0) {
      risky.push('R4');
    }
  }

  if (makes === 'pair') risky.push('R5');
  return risky;
}

/** Draw kinds with the out cards that complete each (§6.2), in the chip order. */
export function oracleDraws(
  hole: readonly Card[],
  board: readonly Card[],
  outs: ReadonlyMap<Card, OracleOut>,
): { kind: DrawKind; outs: number }[] {
  if (board.length !== 3 && board.length !== 4) return [];
  const cards = [...hole, ...board];
  const level = levelOf(describe(hole as [Card, Card], [...board]).category);
  const draws: { kind: DrawKind; outs: number }[] = [];
  const count = (completes: (c: Card) => boolean): number =>
    [...outs.keys()].filter(completes).length;
  const ofSuit = (cs: readonly Card[], s: number): number =>
    cs.filter((c) => suitOf(c) === s).length;

  // Flush draw: exactly 4 of a suit, one from the hand, no flush made.
  for (let s = 0; s < 4; s++) {
    if (level < levelOf('flush') && ofSuit(cards, s) === 4 && ofSuit(hole, s) > 0) {
      const notOnBoard = Array.from({ length: 13 }, (_, i) => (12 - i) * 4 + s).filter(
        (c) => !board.includes(c),
      );
      const nut = hole.includes(notOnBoard[0] as Card);
      draws.push({ kind: nut ? 'nutFlush' : 'flush', outs: count((c) => suitOf(c) === s) });
    }
  }

  // Straight draws: S = ranks whose card gives the hero a straight (none made yet) whose best
  // straight is not the board's own.
  const present = new Set(cards.map(rankOf));
  const boardRanks = board.map(rankOf);
  const S: number[] = [];
  if (level < STRAIGHT) {
    for (let r = 0; r < 13; r++) {
      if (present.has(r)) continue;
      const high = bestStraight([...present, r]);
      if (high >= 0 && bestStraight([...boardRanks, r]) < high) S.push(r);
    }
  }
  if (S.length > 0) {
    // "The hero's ranks contain 4 consecutive ranks open at both ends": on the line
    // A(low) 2 3 … K A(high), four present ranks with a rank on each side.
    const line = [12, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    let open = false;
    for (let p = 1; p + 4 < line.length; p++) {
      if (line.slice(p, p + 4).every((r) => present.has(r))) open = true;
    }
    const kind = S.length === 1 ? 'gutshot' : S.length === 2 && open ? 'oesd' : 'doubleGutshot';
    draws.push({ kind, outs: count((c) => S.includes(rankOf(c))) });
  }

  // Two overcards: both hole cards above every board card, and nothing made.
  const topBoard = Math.max(...boardRanks);
  if (level === 0 && hole.every((c) => rankOf(c) > topBoard)) {
    draws.push({
      kind: 'overcards',
      outs: count((c) => hole.some((h) => rankOf(h) === rankOf(c))),
    });
  }

  if (board.length === 3) {
    for (let s = 0; s < 4; s++) {
      if (level < levelOf('flush') && ofSuit(cards, s) === 3 && ofSuit(hole, s) > 0) {
        draws.push({ kind: 'backdoorFlush', outs: 0 });
      }
    }
    // 3 distinct ranks within one 5-rank window, including a hole rank the board lacks.
    const holeOnly = hole.map(rankOf).filter((r) => !boardRanks.includes(r));
    let backdoor = false;
    for (let high = 3; high <= 12 && level < STRAIGHT && S.length === 0; high++) {
      const window = [0, 1, 2, 3, 4].map((i) => (high - i < 0 ? 12 : high - i));
      const inWindow = window.filter((r) => present.has(r));
      if (inWindow.length >= 3 && holeOnly.some((r) => window.includes(r))) backdoor = true;
    }
    if (backdoor) draws.push({ kind: 'backdoorStraight', outs: 0 });
  }
  return draws;
}

/** §6.5 with the naive evaluator: unseen 2-card combos that beat the hero now. */
export function oracleBeaters(hole: readonly Card[], board: readonly Card[]): number {
  const hero = naiveBest([...hole, ...board]);
  const unseen = unseenCards([...hole, ...board]);
  let count = 0;
  for (let i = 0; i < unseen.length; i++) {
    for (let j = i + 1; j < unseen.length; j++) {
      const theirs = naiveBest([unseen[i] as Card, unseen[j] as Card, ...board]);
      if (compareNaive(theirs, hero) > 0) count++;
    }
  }
  return count;
}
