/**
 * Random hero hands for the analysis property tests (fast-check). Half are uniform deals; half
 * come from small decks (few suits, a window of ranks that may wrap past the Ace), so flush and
 * straight draws, made flushes, straight flushes and paired boards come up often.
 */
import fc from 'fast-check';
import { makeCard, type Card, type Suit } from '../../src/core/cards.ts';
import { seedWords } from '../../src/core/rng.ts';
import { testSeed } from '../helpers/seed.ts';

/** The fast-check seed of the analysis property tests: fixed, so CI is deterministic. */
export const FC_SEED = (seedWords(testSeed('20260930000000000000000000004100'))[0] as number) | 0;

const DECK: Card[] = Array.from({ length: 52 }, (_, c) => c);

function smallDeck(k: number): fc.Arbitrary<Card[]> {
  return fc
    .record({
      suits: fc.shuffledSubarray([0, 1, 2, 3] as Suit[], { minLength: 1, maxLength: 4 }),
      start: fc.integer({ min: 0, max: 12 }),
      width: fc.integer({ min: 5, max: 13 }),
    })
    .filter((d) => d.suits.length * d.width >= k)
    .chain(({ suits, start, width }) => {
      const pool: Card[] = [];
      for (let i = 0; i < width; i++) {
        for (const s of suits) pool.push(makeCard((start + i) % 13, s));
      }
      return fc.shuffledSubarray(pool, { minLength: k, maxLength: k });
    });
}

export interface HeroHand {
  hole: Card[];
  board: Card[];
}

/** Two hole cards and a board of `boardLength` cards, all distinct. */
export function heroHand(boardLength: number): fc.Arbitrary<HeroHand> {
  const k = 2 + boardLength;
  return fc
    .oneof(fc.shuffledSubarray(DECK, { minLength: k, maxLength: k }), smallDeck(k))
    .map((cs) => ({ hole: cs.slice(0, 2), board: cs.slice(2) }));
}
