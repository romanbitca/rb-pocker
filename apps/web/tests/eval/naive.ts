/**
 * Naive oracle (PLAN §5.5, "Testing strategy" → Oracles): an independent evaluator written from
 * the rules, not from `src/eval`. It scores each of the C(n, 5) five-card subsets the textbook way
 * (sort, group equal ranks, look for a flush and a run) and keeps the best. Slow on purpose: it
 * shares no tables, masks or tricks with the real evaluator.
 */
import { rankOf, suitOf, type Card } from '../../src/core/cards.ts';

/** Category codes as in PLAN §5.2 (0 high card … 8 straight flush). */
export interface NaiveHand {
  category: number;
  /** Tiebreak ranks, most important first (e.g. two pair: high pair, low pair, kicker). */
  ranks: number[];
}

const ACE = 12;

/** Value of exactly five cards. */
export function naive5(five: readonly Card[]): NaiveHand {
  if (five.length !== 5) throw new RangeError('naive5 needs five cards');
  const ranks = five.map(rankOf).sort((a, b) => b - a);
  const suit0 = suitOf(five[0] as Card);
  const isFlush = five.every((c) => suitOf(c) === suit0);

  // Groups of equal rank, biggest group first, then higher rank first.
  const groups: { rank: number; size: number }[] = [];
  for (const r of ranks) {
    const g = groups.find((x) => x.rank === r);
    if (g) g.size++;
    else groups.push({ rank: r, size: 1 });
  }
  groups.sort((a, b) => b.size - a.size || b.rank - a.rank);
  const shape = groups.map((g) => g.size).join('');
  const byGroup = groups.map((g) => g.rank);

  // A run of five distinct ranks; the Ace may also play low (A-2-3-4-5, five-high).
  let straightHigh = -1;
  if (groups.length === 5) {
    const [r0, r1, r2, r3, r4] = ranks as [number, number, number, number, number];
    if (r0 - r4 === 4) straightHigh = r0;
    else if (r0 === ACE && r1 === 3 && r2 === 2 && r3 === 1 && r4 === 0) straightHigh = 3;
  }

  if (isFlush && straightHigh >= 0) return { category: 8, ranks: [straightHigh] };
  if (shape === '41') return { category: 7, ranks: byGroup };
  if (shape === '32') return { category: 6, ranks: byGroup };
  if (isFlush) return { category: 5, ranks };
  if (straightHigh >= 0) return { category: 4, ranks: [straightHigh] };
  if (shape === '311') return { category: 3, ranks: byGroup };
  if (shape === '221') return { category: 2, ranks: byGroup };
  if (shape === '2111') return { category: 1, ranks: byGroup };
  return { category: 0, ranks };
}

/** > 0 when a is better, < 0 when b is better, 0 for a tie. */
export function compareNaive(a: NaiveHand, b: NaiveHand): number {
  if (a.category !== b.category) return a.category - b.category;
  const n = Math.max(a.ranks.length, b.ranks.length);
  for (let i = 0; i < n; i++) {
    const d = (a.ranks[i] ?? -1) - (b.ranks[i] ?? -1);
    if (d !== 0) return d;
  }
  return 0;
}

/** Best five-card hand among 5, 6 or 7 cards: tries every five-card subset. */
export function naiveBest(cards: readonly Card[]): NaiveHand {
  const n = cards.length;
  if (n < 5 || n > 7) throw new RangeError('naiveBest needs 5 to 7 cards');
  let best: NaiveHand | null = null;
  let subsets = 0;
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      for (let c = b + 1; c < n; c++) {
        for (let d = c + 1; d < n; d++) {
          for (let e = d + 1; e < n; e++) {
            const hand = naive5([a, b, c, d, e].map((i) => cards[i] as Card));
            subsets++;
            if (best === null || compareNaive(hand, best) > 0) best = hand;
          }
        }
      }
    }
  }
  if (best === null || subsets !== [1, 6, 21][n - 5]) throw new Error('subset enumeration broke');
  return best;
}
