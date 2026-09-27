/**
 * Differential tests against the dev-only oracle libraries (PLAN §5.5, "Testing strategy"):
 * for random pairs of seven-card hands, "who wins or is it a tie" must agree every time, and so
 * must each hand's category. Shared by the unit (small) and slow (full size) projects.
 */
import { compare, evaluate } from '@poker-apprentice/hand-evaluator';
import pokersolver from 'pokersolver';
import type { Card } from '../../src/core/cards.ts';
import type { Seed128 } from '../../src/core/rng.ts';
import { categoryOf, HAND_CATEGORIES, score7 } from '../../src/eval/evaluate.ts';
import { CARD_TEXT, HandSource, independentPair, showdownPair } from './hands.ts';
import { naiveBest } from './naive.ts';

const { Hand } = pokersolver;

type Card7 = Parameters<typeof evaluate>[0]['holeCards'];

const text = (cards: readonly Card[]): string[] => cards.map((c) => CARD_TEXT[c] as string);

/** −1 when a wins, 1 when b wins, 0 for a tie (the oracles' convention). */
const order = (sa: number, sb: number): number => (sa > sb ? -1 : sa < sb ? 1 : 0);

/** Display category index 0..9 (royal = 9) of our score. */
const categoryIndex = (score: number): number => HAND_CATEGORIES.indexOf(categoryOf(score));

export interface DiffResult {
  pairs: number;
  /** How many pairs were ties (a sanity check that ties are exercised). */
  ties: number;
  failures: string[];
  failureCount: number;
}

function newResult(): DiffResult {
  return { pairs: 0, ties: 0, failures: [], failureCount: 0 };
}

function fail(r: DiffResult, message: string): void {
  r.failureCount++;
  if (r.failures.length < 10) r.failures.push(message);
}

/**
 * `pairs` random pairs: even ones share a board (a showdown), odd ones are independent hands.
 * `biased` draws from small decks to reach the rare categories.
 */
function* randomPairs(seed: Seed128, pairs: number, biased: boolean): Generator<[Card[], Card[]]> {
  const src = new HandSource(seed);
  for (let i = 0; i < pairs; i++) {
    yield i % 2 === 0 ? showdownPair(src, biased) : independentPair(src, biased);
  }
}

/** Order and category agreement with `@poker-apprentice/hand-evaluator` 4.3.0. */
export function diffHandEvaluator(seed: Seed128, pairs: number, biased: boolean): DiffResult {
  const r = newResult();
  for (const [a, b] of randomPairs(seed, pairs, biased)) {
    const sa = score7(a, 7);
    const sb = score7(b, 7);
    const ea = evaluate({ holeCards: text(a) as Card7 });
    const eb = evaluate({ holeCards: text(b) as Card7 });
    const ours = order(sa, sb);
    const theirs = compare(ea, eb);
    r.pairs++;
    if (ours === 0) r.ties++;
    if (ours !== theirs) {
      fail(r, `order ${text(a).join(' ')} vs ${text(b).join(' ')}: ours ${ours}, theirs ${theirs}`);
    }
    if (categoryIndex(sa) !== ea.strength || categoryIndex(sb) !== eb.strength) {
      fail(
        r,
        `category ${text(a).join(' ')} / ${text(b).join(' ')}: ours ${categoryOf(sa)}/${categoryOf(sb)}, theirs ${ea.strength}/${eb.strength}`,
      );
    }
  }
  return r;
}

/** Order and category agreement with `pokersolver` 2.1.4 (a second, slower oracle). */
export function diffPokersolver(seed: Seed128, pairs: number, biased: boolean): DiffResult {
  const r = newResult();
  for (const [a, b] of randomPairs(seed, pairs, biased)) {
    const sa = score7(a, 7);
    const sb = score7(b, 7);
    const ha = Hand.solve(text(a));
    const hb = Hand.solve(text(b));
    const winners = Hand.winners([ha, hb]);
    const theirs = winners.length === 2 ? 0 : winners[0] === ha ? -1 : 1;
    const ours = order(sa, sb);
    r.pairs++;
    if (ours === 0) r.ties++;
    if (ours !== theirs) {
      fail(r, `order ${text(a).join(' ')} vs ${text(b).join(' ')}: ours ${ours}, theirs ${theirs}`);
    }
    if ((sa >> 20) + 1 !== ha.rank || (sb >> 20) + 1 !== hb.rank) {
      fail(
        r,
        `category ${text(a).join(' ')} / ${text(b).join(' ')}: ours ${sa >> 20}/${sb >> 20}, theirs ${ha.rank - 1}/${hb.rank - 1}`,
      );
    }
  }
  return r;
}

/**
 * Identical category and tiebreak ranks as the naive 21-subset oracle for `hands` random hands of
 * `size` cards (5, 6 or 7).
 */
export function diffNaive(
  seed: Seed128,
  hands: number,
  size: 5 | 6 | 7,
  biased: boolean,
): DiffResult {
  const r = newResult();
  const src = new HandSource(seed);
  for (let i = 0; i < hands; i++) {
    const cards = biased ? src.biased(size) : src.uniform(size);
    const score = score7(cards, size);
    const naive = naiveBest(cards);
    const expected =
      (naive.category << 20) |
      [0, 1, 2, 3, 4].reduce((acc, k) => acc | ((naive.ranks[k] ?? 0) << (16 - 4 * k)), 0);
    r.pairs++;
    if (score !== expected) {
      fail(
        r,
        `${text(cards).join(' ')}: ours ${score.toString(16)}, naive ${expected.toString(16)}`,
      );
    }
  }
  return r;
}
