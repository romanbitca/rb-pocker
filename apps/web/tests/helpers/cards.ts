import { parseCard, type Card } from '../../src/core/cards.ts';

const SUIT_LETTER: Record<string, string> = { '♣': 'c', '♦': 'd', '♥': 'h', '♠': 's' };

/** One card in either notation: "Ah", "10h" or the PLAN's "A♥", "10♥". */
export function card(text: string): Card {
  return parseCard(text.replace(/[♣♦♥♠]/u, (s) => SUIT_LETTER[s] as string));
}

/** Space-separated cards in either notation; "" or "—" → []. */
export function cards(text: string): Card[] {
  const t = text.trim();
  return t === '' || t === '—' ? [] : t.split(/\s+/).map(card);
}

/** The two hole cards as the tuple `describe()` takes. */
export function hole(text: string): [Card, Card] {
  const cs = cards(text);
  if (cs.length !== 2) throw new RangeError(`hole needs 2 cards: "${text}"`);
  return [cs[0] as Card, cs[1] as Card];
}
