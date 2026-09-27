/**
 * Random hands for the evaluator tests, drawn with the project's own seeded RNG (tested in
 * `tests/core`). `uniform` samples the real deck; `biased` samples small decks (few suits, a
 * window of ranks that may wrap past the Ace) so flushes, straight flushes, wheels, Q-K-A-2-3,
 * quads, two trips and three pairs come up far more often than in play.
 */
import { formatCard, makeCard, type Card, type Suit } from '../../src/core/cards.ts';
import { randInt, rngFromSeed, type Rng, type Seed128 } from '../../src/core/rng.ts';

export const CARD_TEXT = Array.from({ length: 52 }, (_, c) => formatCard(c));

/** k distinct cards from `pool` (partial Fisher–Yates; `pool` is reordered in place). */
function draw(rng: Rng, pool: Card[], k: number): Card[] {
  const out: Card[] = [];
  for (let i = 0; i < k; i++) {
    const j = i + randInt(rng, pool.length - i);
    const t = pool[i] as Card;
    pool[i] = pool[j] as Card;
    pool[j] = t;
    out.push(pool[i] as Card);
  }
  return out;
}

export class HandSource {
  private readonly rng: Rng;
  private readonly deck: Card[] = Array.from({ length: 52 }, (_, c) => c);

  constructor(seed: Seed128) {
    this.rng = rngFromSeed(seed);
  }

  /** k distinct cards from the full deck. */
  uniform(k: number): Card[] {
    return draw(this.rng, this.deck, k);
  }

  /** k distinct cards from a random small deck (at least k cards). */
  biased(k: number): Card[] {
    for (;;) {
      const suitCount = 1 + randInt(this.rng, 4);
      const width = 5 + randInt(this.rng, 9); // 5..13 ranks
      if (suitCount * width < k) continue;
      const suits = draw(this.rng, [0, 1, 2, 3], suitCount) as Suit[];
      const start = randInt(this.rng, 13);
      const pool: Card[] = [];
      for (let i = 0; i < width; i++) {
        for (const s of suits) pool.push(makeCard((start + i) % 13, s));
      }
      return draw(this.rng, pool, k);
    }
  }

  /** A random integer 0..n-1 from the same stream. */
  int(n: number): number {
    return randInt(this.rng, n);
  }
}

/** Two seven-card hands that share a five-card board, as at a showdown. */
export function showdownPair(src: HandSource, biased: boolean): [Card[], Card[]] {
  const nine = biased ? src.biased(9) : src.uniform(9);
  const board = nine.slice(0, 5);
  return [
    [...nine.slice(5, 7), ...board],
    [...nine.slice(7, 9), ...board],
  ];
}

/** Two independent seven-card hands (they may share cards: each is scored on its own). */
export function independentPair(src: HandSource, biased: boolean): [Card[], Card[]] {
  return biased ? [src.biased(7), src.biased(7)] : [src.uniform(7), src.uniform(7)];
}
