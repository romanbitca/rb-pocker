/**
 * The hand drill's differential check (PLAN §13.5): RB's evaluator (§5.3) against the standalone
 * drill's own `score5` / `bestOf` (`oracle.ts`). For random pairs of 5-card and of 7-card hands it
 * compares each hand's category and the result of each pair (who wins, or a split). Half of the
 * pairs come from a small deck of 29 cards (`SMALL`), so the rare hands (royal and straight
 * flushes, quads, full houses) are well covered.
 */
import { newDeck, rankOf, suitOf, type Card } from '../../src/core/cards.ts';
import { rngFromSeed, shuffleRange, type Seed128 } from '../../src/core/rng.ts';
import { positionOfScore } from '../../src/drill/ladder.ts';
import { score7 } from '../../src/eval/evaluate.ts';
import { bestOf, cmp, score5 } from './oracle.ts';

export interface DiffResult {
  hands: number;
  pairs: number;
  /** Hands per drill position (1 = royal flush … 10 = high card), as RB scored them. */
  byPosition: number[];
  ties: number;
  failures: string[];
}

const sign = (x: number): number => (x > 0 ? 1 : x < 0 ? -1 : 0);

/**
 * J, Q, K and A in all four suits, 7 to 10 in two suits (clubs, diamonds), 2 to 6 in spades only:
 * many quads, full houses and straights, royal flushes in clubs and diamonds, and the 2-to-6 and
 * A-to-5 straight flushes in spades.
 */
const SMALL: readonly Card[] = newDeck().filter((c) => {
  const r = rankOf(c);
  return r >= 5 ? suitOf(c) <= 1 || r >= 9 : suitOf(c) === 3;
});

/**
 * `pairs` pairs of `size`-card hands (5 or 7), dealt without repeats from one shuffled deck per
 * pair: every other pair from the full deck, the rest from the small one.
 */
export function differential(seed: Seed128, pairs: number, size: 5 | 7): DiffResult {
  const rng = rngFromSeed(seed);
  const result: DiffResult = {
    hands: 0,
    pairs: 0,
    byPosition: Array.from({ length: 11 }, () => 0),
    ties: 0,
    failures: [],
  };
  const full = newDeck();
  const small = [...SMALL];
  for (let i = 0; i < pairs; i++) {
    const deck = i % 2 === 0 ? full : small;
    shuffleRange(deck, 0, deck.length - 1, rng);
    const a = deck.slice(0, size);
    const b = deck.slice(size, 2 * size);
    const ours = [a, b].map((h) => score7(h, size));
    const theirs = [a, b].map((h) => (size === 5 ? score5(h) : bestOf(h).score));
    for (let k = 0; k < 2; k++) {
      const pos = positionOfScore(ours[k] as number);
      result.byPosition[pos] = (result.byPosition[pos] as number) + 1;
      if (pos !== (theirs[k] as number[])[0] && result.failures.length < 20) {
        result.failures.push(
          `category: ${[a, b][k]?.join(',')} RB #${pos}, drill #${theirs[k]?.[0]}`,
        );
      }
    }
    const want = sign(cmp(theirs[0] as number[], theirs[1] as number[]));
    const got = sign((ours[0] as number) - (ours[1] as number));
    if (got === 0) result.ties++;
    if (got !== want && result.failures.length < 20) {
      result.failures.push(`compare: ${a.join(',')} vs ${b.join(',')}: RB ${got}, drill ${want}`);
    }
    result.hands += 2;
    result.pairs++;
  }
  return result;
}
