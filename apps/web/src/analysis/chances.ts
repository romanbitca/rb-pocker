/**
 * The hero's chance to finish with each hand by the river (PLAN §6.6, Appendix C.5, D.3).
 * Always exact: every remaining board is enumerated, and the outs formulas are the exact
 * hypergeometric ones. Never the rule of 2 and 4 (pitfall 12).
 *
 * Percentages are 0–100. Categories are the 10 display categories (`HAND_CATEGORIES`, royal
 * flush above straight flush).
 */
import { isCard, rankOf, type Card } from '../core/cards.ts';
import { HAND_CATEGORIES, score7, type HandCategory } from '../eval/evaluate.ts';

export interface CategoryChance {
  /** % of remaining boards on which the hero finishes with exactly this category. */
  exactly: number;
  /** % finishing with this category or better. */
  atLeast: number;
  /** The board's own cards already make this category (a pair or better): everyone shares it. */
  boardShared: boolean;
}

/** `HandAnalysis.chances` (Appendix A.5). */
export type Chances = Record<HandCategory, CategoryChance>;

export interface FinalCounts {
  /** Boards finishing with exactly each display category, indexed like `HAND_CATEGORIES`. */
  counts: number[];
  /** All remaining boards: C(50,5) = 2,118,760 preflop, 1,081 on the flop, 46 on the turn, 1. */
  total: number;
}

const ROYAL_FLUSH = 9;

/** Display-category level of a score (§5.2: royal flush = straight flush with n0 = Ace). */
function level(score: number): number {
  const code = score >> 20;
  return code === 8 && ((score >> 16) & 15) === 12 ? ROYAL_FLUSH : code;
}

function checkHand(fn: string, hole: readonly Card[], board: readonly Card[]): void {
  if (hole.length !== 2) throw new RangeError(`${fn}: need 2 hole cards, got ${hole.length}`);
  if (![0, 3, 4, 5].includes(board.length)) {
    throw new RangeError(`${fn}: board must have 0, 3, 4 or 5 cards, got ${board.length}`);
  }
  const cards = [...hole, ...board];
  if (!cards.every(isCard) || new Set(cards).size !== cards.length) {
    throw new RangeError(`${fn}: cards must be distinct cards 0..51: ${cards.join(',')}`);
  }
}

/**
 * Exact enumeration of every way the board can finish: how many end with exactly each category
 * for the hero. Preflop this is all 2,118,760 five-card boards (the build-time `finals` table,
 * §7.5, is made from it; the app looks the table up instead), on the flop the 1,081 turn/river
 * pairs, on the turn the 46 rivers, and on the river the made hand.
 */
export function finalCounts(hole: readonly Card[], board: readonly Card[]): FinalCounts {
  checkHand('finalCounts', hole, board);
  const known = [...hole, ...board];
  const unseen: Card[] = [];
  for (let c = 0; c < 52; c++) if (!known.includes(c)) unseen.push(c);
  const cards = [...known, 0, 0, 0, 0, 0].slice(0, 7); // hero cards + the rest of the board
  const tally = new Int32Array(HAND_CATEGORIES.length);
  const u = unseen.length;
  switch (known.length) {
    case 7:
      tally[level(score7(cards, 7))]!++;
      break;
    case 6:
      for (let i = 0; i < u; i++) {
        cards[6] = unseen[i]!;
        tally[level(score7(cards, 7))]!++;
      }
      break;
    case 5:
      for (let i = 0; i < u; i++) {
        cards[5] = unseen[i]!;
        for (let j = i + 1; j < u; j++) {
          cards[6] = unseen[j]!;
          tally[level(score7(cards, 7))]!++;
        }
      }
      break;
    default:
      // Preflop: every 5-card board from the 50 unseen cards.
      for (let a = 0; a < u; a++) {
        cards[2] = unseen[a]!;
        for (let b = a + 1; b < u; b++) {
          cards[3] = unseen[b]!;
          for (let c = b + 1; c < u; c++) {
            cards[4] = unseen[c]!;
            for (let d = c + 1; d < u; d++) {
              cards[5] = unseen[d]!;
              for (let e = d + 1; e < u; e++) {
                cards[6] = unseen[e]!;
                tally[level(score7(cards, 7))]!++;
              }
            }
          }
        }
      }
  }
  const counts = Array.from(tally);
  return { counts, total: counts.reduce((a, b) => a + b, 0) };
}

/** The category the board's own cards make (3 or 4 cards: by rank counts), or −1 for none. */
function boardLevel(board: readonly Card[]): number {
  if (board.length === 5) return level(score7(board, 5));
  if (board.length === 0) return -1;
  const perRank = new Array<number>(13).fill(0);
  for (const c of board) perRank[rankOf(c)]!++;
  const most = Math.max(...perRank);
  const pairs = perRank.filter((k) => k === 2).length;
  if (most === 4) return HAND_CATEGORIES.indexOf('quads');
  if (most === 3) return HAND_CATEGORIES.indexOf('trips');
  if (pairs === 2) return HAND_CATEGORIES.indexOf('twoPair');
  return pairs === 1 ? HAND_CATEGORIES.indexOf('pair') : 0;
}

/**
 * §6.6 chances for every category: `exactly`, `atLeast` (this or better) and `boardShared`, by
 * exact enumeration (`finalCounts`). The "By river" column of the rankings panel shows `exactly`.
 */
export function chancesByRiver(hole: readonly Card[], board: readonly Card[]): Chances {
  const { counts, total } = finalCounts(hole, board);
  const shared = boardLevel(board);
  const out = {} as Chances;
  let atLeast = 0;
  for (let i = HAND_CATEGORIES.length - 1; i >= 0; i--) {
    atLeast += counts[i]!;
    out[HAND_CATEGORIES[i]!] = {
      exactly: (100 * counts[i]!) / total,
      atLeast: (100 * atLeast) / total,
      boardShared: i > 0 && i === shared,
    };
  }
  // Keys weakest first, like HAND_CATEGORIES.
  return Object.fromEntries(HAND_CATEGORIES.map((k) => [k, out[k]])) as Chances;
}

/** C(n, 2). */
const pairs = (n: number): number => (n * (n - 1)) / 2;

/**
 * The draw chip's numbers (§6.6, Appendix C.5) for `outs` out cards, exact: next card
 * `outs / unseen` (47 unseen on the flop, 46 on the turn); by the river from the flop
 * `1 − C(47 − outs, 2) / C(47, 2)`, from the turn the river is the next card. `null` preflop
 * and on the river, where there are no outs.
 */
export function outsChances(
  outs: number,
  boardLength: number,
): { nextCardPct: number | null; byRiverPct: number | null } {
  if (boardLength !== 3 && boardLength !== 4) return { nextCardPct: null, byRiverPct: null };
  const unseen = 50 - boardLength;
  if (!Number.isInteger(outs) || outs < 0 || outs > unseen) {
    throw new RangeError(`outsChances: outs must be 0..${unseen}, got ${outs}`);
  }
  const nextCardPct = (100 * outs) / unseen;
  if (boardLength === 4) return { nextCardPct, byRiverPct: nextCardPct };
  const misses = pairs(unseen - outs);
  return { nextCardPct, byRiverPct: (100 * (pairs(unseen) - misses)) / pairs(unseen) };
}
