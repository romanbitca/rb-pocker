/**
 * The ten hand-ranking rows, strongest first (PLAN §13.2, Appendix F.7, copied exactly).
 * Static data, so the rankings panel and the Learn page work offline. The row text lives here, as
 * F.7 says, rather than in `i18n/en.ts`; the panel's own strings (header, captions, footer) are in
 * `en.ts`. Cards use the text form ("Ts" is the Ten; the UI shows "10").
 */
import type { HandCategory } from '../eval/evaluate.ts';

export interface RankingRow {
  readonly key: HandCategory;
  readonly name: string;
  /** The example hand, category-forming cards first. */
  readonly cards: readonly [string, string, string, string, string];
  /** How many trailing cards are drawn at 45% opacity (they do not form the hand). */
  readonly kickers: number;
  /** Percent of 7-card hands with exactly this category. */
  readonly rarity: number;
  /** The same as "1 in N". */
  readonly oneIn: number;
  readonly tip: string;
  readonly detail: string;
}

// Laid out exactly as Appendix F.7.
// prettier-ignore
export const RANKINGS = [
  { key: 'royalFlush',    name: 'Royal flush',     cards: ['As','Ks','Qs','Js','Ts'], kickers: 0, rarity: 0.0032, oneIn: 30900,
    tip: 'A-K-Q-J-10, all one suit. The best hand.',
    detail: 'The highest straight flush. It cannot be beaten. Two royal flushes split the pot.' },
  { key: 'straightFlush', name: 'Straight flush',  cards: ['9h','8h','7h','6h','5h'], kickers: 0, rarity: 0.0279, oneIn: 3600,
    tip: 'Five in a row, all one suit.',
    detail: 'The highest top card wins. A-2-3-4-5 of one suit is the lowest.' },
  { key: 'quads',         name: 'Four of a kind',  cards: ['Qc','Qd','Qh','Qs','7d'], kickers: 1, rarity: 0.168,  oneIn: 595,
    tip: 'Four cards of the same rank.',
    detail: 'Higher four of a kind wins. If equal, the fifth card (kicker) decides.' },
  { key: 'fullHouse',     name: 'Full house',      cards: ['Ks','Kh','Kd','4c','4h'], kickers: 0, rarity: 2.60,   oneIn: 39,
    tip: 'Three of one rank plus two of another.',
    detail: 'The higher three-of-a-kind wins. Kings full of Fours beats Queens full of Aces.' },
  { key: 'flush',         name: 'Flush',           cards: ['Ad','Jd','8d','5d','2d'], kickers: 0, rarity: 3.03,   oneIn: 33,
    tip: 'Any five cards of one suit.',
    detail: 'Compare the highest card, then the next. The suit itself never matters.' },
  { key: 'straight',      name: 'Straight',        cards: ['Tc','9d','8s','7h','6c'], kickers: 0, rarity: 4.62,   oneIn: 22,
    tip: 'Five in a row, mixed suits. A can be low: A-2-3-4-5.',
    detail: 'The highest top card wins. Q-K-A-2-3 is not a straight.' },
  { key: 'trips',         name: 'Three of a kind', cards: ['7s','7h','7c','Kd','2s'], kickers: 2, rarity: 4.83,   oneIn: 21,
    tip: 'Three cards of the same rank.',
    detail: 'Higher three-of-a-kind wins. If equal, the kickers decide.' },
  { key: 'twoPair',       name: 'Two pair',        cards: ['Jh','Jc','5s','5d','Ac'], kickers: 1, rarity: 23.5,   oneIn: 4,
    tip: 'Two different pairs.',
    detail: 'Compare the higher pair, then the lower pair, then the kicker.' },
  { key: 'pair',          name: 'One pair',        cards: ['Th','Ts','Kc','6d','3h'], kickers: 3, rarity: 43.8,   oneIn: 2,
    tip: 'Two cards of the same rank.',
    detail: 'Higher pair wins. If equal, the highest other card (kicker) decides.' },
  { key: 'highCard',      name: 'High card',       cards: ['Ac','Qd','9s','6h','3c'], kickers: 4, rarity: 17.4,   oneIn: 6,
    tip: 'No pair. Your highest card plays.',
    detail: 'Compare the highest card, then the next, down to the fifth. With 7 cards it is rarer than one pair, but it still ranks lowest.' },
] as const satisfies readonly RankingRow[];
// kickers = how many trailing cards are drawn at 45% opacity (they do not form the hand).
// Footer lines: §13.2.
