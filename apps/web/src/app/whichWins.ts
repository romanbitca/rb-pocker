/**
 * "Which hand wins?" (PLAN §13.2, §10.2 Advanced and Exam; chunk 6.4), the pure part: two random
 * 5-card hands that do not tie, scored by the evaluator (§5). The quiz itself is a lazy chunk
 * (`ui/components/WhichHandWins.tsx`); the UI reaches this through `app/store.ts` (§2.1).
 */
import { newDeck, type Card } from '../core/cards.ts';
import { randomSeed, rngFromSeed, shuffleRange, type Rng } from '../core/rng.ts';
import { categoryOf, score5, type HandCategory } from '../eval/evaluate.ts';

/** Two hands of five cards with different scores; `winner` is the index of the better one. */
export interface WhichPair {
  readonly hands: readonly [readonly Card[], readonly Card[]];
  readonly categories: readonly [HandCategory, HandCategory];
  readonly winner: 0 | 1;
}

/** Ten cards of a shuffled deck, dealt again until the two hands differ (a tie has no winner). */
export function dealPair(rng: Rng = rngFromSeed(randomSeed())): WhichPair {
  for (;;) {
    const deck = newDeck();
    shuffleRange(deck, 0, deck.length - 1, rng); // `hi` is inclusive (§5.6)
    const a = deck.slice(0, 5);
    const b = deck.slice(5, 10);
    const sa = score5(a);
    const sb = score5(b);
    if (sa !== sb) {
      return {
        hands: [a, b],
        categories: [categoryOf(sa), categoryOf(sb)],
        winner: sa > sb ? 0 : 1,
      };
    }
  }
}
