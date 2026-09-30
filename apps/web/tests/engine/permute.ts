/**
 * The §9.6.3 re-deal used by the non-cheating tests (`observe`, the brain): a copy of a hand in
 * which every card one seat cannot see is dealt differently.
 */
import type { Card } from '../../src/core/cards.ts';
import { rngFromSeed, shuffleRange, type Seed128 } from '../../src/core/rng.ts';
import type { HandState } from '../../src/engine/types.ts';
import { seatOf } from './play.ts';

/**
 * A deep copy of `h` in which every card `seat` cannot see is dealt differently: the deck
 * positions holding other seats' unrevealed hole cards (folded seats' included), the burn cards
 * and the undealt stub are permuted among themselves with `seed`, and each of those seats' hole
 * cards is re-read from its deck position. The board, `seat`'s own cards and every revealed hole
 * stay exactly where they are (§4.8, §9.6.3).
 */
export function permuteHidden(h: HandState, seat: number, seed: Seed128): HandState {
  const c = JSON.parse(JSON.stringify(h)) as HandState;
  const hiddenSeats = c.seats.flatMap((s, i) =>
    i !== seat && s.hole !== null && !c.revealed.includes(i) ? [i] : [],
  );
  const visible = new Set<Card>(c.board);
  c.seats.forEach((s, i) => {
    if (s.hole !== null && !hiddenSeats.includes(i)) for (const card of s.hole) visible.add(card);
  });
  const positionOf = new Map(c.deck.map((card, pos) => [card, pos]));
  const hidden = c.deck.flatMap((card, pos) => (visible.has(card) ? [] : [pos]));
  const values = hidden.map((pos) => c.deck[pos] as Card);
  shuffleRange(values, 0, values.length - 1, rngFromSeed(seed));
  hidden.forEach((pos, j) => (c.deck[pos] = values[j] as Card));
  for (const i of hiddenSeats) {
    const s = seatOf(c, i);
    const [a, b] = s.hole as [Card, Card];
    s.hole = [
      c.deck[positionOf.get(a) as number] as Card,
      c.deck[positionOf.get(b) as number] as Card,
    ];
  }
  return c;
}
