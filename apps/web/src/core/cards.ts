/**
 * Cards (PLAN §0.3, Appendix A.1).
 *
 * `Card = rank * 4 + suit`: rank 0..12 = 2..A, suit 0..3 = clubs, diamonds, hearts, spades.
 * The text form is "Ah", "Tc" (logs, tests, replay records). ⚠️ The UI always shows "10", never
 * "T": card faces use `rankLabel`, screen readers use `cardAriaLabel`.
 *
 * `core` imports nothing (PLAN §2.1), so the card words live here instead of `i18n/en.ts`
 * (PLAN §0.3 "Strings"); `eval/describe.ts` builds the hand names from them.
 */

export type Card = number; // 0..51 = rank * 4 + suit
export type Rank = number; // 0..12 = 2..A
export type Suit = 0 | 1 | 2 | 3; // clubs, diamonds, hearts, spades

/** Text-form rank characters, indexed by rank ("T" = Ten; never shown to the player). */
export const RANK_CHARS = '23456789TJQKA';
/** Text-form suit characters, indexed by suit. */
export const SUIT_CHARS = 'cdhs';

/** Rank words (Appendix F.2). */
export const RANK_NAMES = [
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Jack',
  'Queen',
  'King',
  'Ace',
] as const;

/** Plural rank words (Appendix F.2): "Pair of Sixes". */
export const RANK_PLURALS = [
  'Twos',
  'Threes',
  'Fours',
  'Fives',
  'Sixes',
  'Sevens',
  'Eights',
  'Nines',
  'Tens',
  'Jacks',
  'Queens',
  'Kings',
  'Aces',
] as const;

/** Suit words for aria labels: "Ace of hearts". */
export const SUIT_NAMES = ['clubs', 'diamonds', 'hearts', 'spades'] as const;

/** What a card face shows for each rank. */
const RANK_LABELS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;

export const rankOf = (c: Card): Rank => c >> 2;
export const suitOf = (c: Card): Suit => (c & 3) as Suit;
export const makeCard = (rank: Rank, suit: Suit): Card => rank * 4 + suit;

export function isCard(c: unknown): c is Card {
  return typeof c === 'number' && Number.isInteger(c) && c >= 0 && c <= 51;
}

function checkCard(c: Card): void {
  if (!isCard(c)) throw new RangeError(`Not a card: ${String(c)}`);
}

function checkRank(r: Rank): void {
  if (!Number.isInteger(r) || r < 0 || r > 12) throw new RangeError(`Not a rank: ${String(r)}`);
}

/** The 52 cards in order 0..51 (a fresh array). */
export function newDeck(): Card[] {
  return Array.from({ length: 52 }, (_, i) => i);
}

const CARD_TEXT = /^(10|[2-9TJQKA])([cdhs])$/;

/** "Ah" → 50. Also accepts "10h" for the Ten. Throws `RangeError` on anything else. */
export function parseCard(s: string): Card {
  const m = CARD_TEXT.exec(s);
  if (m === null) throw new RangeError(`Not a card: "${s}"`);
  const rankText = m[1] as string;
  const rank = rankText === '10' ? 8 : RANK_CHARS.indexOf(rankText);
  return rank * 4 + SUIT_CHARS.indexOf(m[2] as string);
}

/** 50 → "Ah" (text form, "T" for the Ten). */
export function formatCard(c: Card): string {
  checkCard(c);
  return RANK_CHARS.charAt(rankOf(c)) + SUIT_CHARS.charAt(suitOf(c));
}

/** "Ah Kd 10c" → [50, 45, 32]; whitespace-separated; "" → []. */
export function parseCards(s: string): Card[] {
  const text = s.trim();
  return text === '' ? [] : text.split(/\s+/).map(parseCard);
}

/** [50, 45] → "Ah Kd". */
export function formatCards(cards: readonly Card[]): string {
  return cards.map(formatCard).join(' ');
}

/** What a card face shows: "2".."10", "J", "Q", "K", "A". Never "T". */
export function rankLabel(r: Rank): string {
  checkRank(r);
  return RANK_LABELS[r] as string;
}

/** 50 → "Ace of hearts". */
export function cardAriaLabel(c: Card): string {
  checkCard(c);
  return `${RANK_NAMES[rankOf(c)] as string} of ${SUIT_NAMES[suitOf(c)]}`;
}

/**
 * Starting-hand class 0..168 on the PLAN §7.5 grid: `row = 12 − highRank`, `col = 12 − lowRank`
 * for suited hands (above the diagonal), swapped for offsuit hands (below it), pairs on it;
 * index = row * 13 + col. AA = 0, AKs = 1, AKo = 13, 22 = 168.
 */
export function classOf(a: Card, b: Card): number {
  checkCard(a);
  checkCard(b);
  if (a === b) throw new RangeError(`Same card twice: ${formatCard(a)}`);
  const ra = rankOf(a);
  const rb = rankOf(b);
  const hi = Math.max(ra, rb);
  const lo = Math.min(ra, rb);
  if (hi === lo) return (12 - hi) * 14;
  return suitOf(a) === suitOf(b) ? (12 - hi) * 13 + (12 - lo) : (12 - lo) * 13 + (12 - hi);
}

/** 0 → "AA", 1 → "AKs", 13 → "AKo", 168 → "22" (text form: "T9o"). */
export function className(idx: number): string {
  if (!Number.isInteger(idx) || idx < 0 || idx > 168) {
    throw new RangeError(`Not a class index: ${String(idx)}`);
  }
  const row = Math.floor(idx / 13);
  const col = idx % 13;
  const rowRank = RANK_CHARS.charAt(12 - row);
  const colRank = RANK_CHARS.charAt(12 - col);
  if (row === col) return rowRank + rowRank;
  return row < col ? `${rowRank}${colRank}s` : `${colRank}${rowRank}o`;
}
