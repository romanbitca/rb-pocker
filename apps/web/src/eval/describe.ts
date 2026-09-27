/**
 * `describe(hole, board)`: what the hero has, for the label, the highlight and the coach
 * (PLAN §5.4, §6.1, Appendix A.2, F.2–F.3). The UI path: allocation is fine here.
 *
 * `eval` imports only `core` (PLAN §2.1), so the hand names and sub-labels live in `HAND_TEXT`
 * below instead of `i18n/en.ts` (PLAN §0.3 "Strings").
 */
import {
  classOf,
  className,
  isCard,
  makeCard,
  RANK_NAMES,
  RANK_PLURALS,
  rankOf,
  suitOf,
  type Card,
  type Rank,
  type Suit,
} from '../core/cards.ts';
import { categoryOf, score7, scoreNibbles, type HandCategory } from './evaluate.ts';

export interface HandInfo {
  score: number; // 0 preflop
  category: HandCategory;
  name: string; // Appendix F.2
  subLabel: string | null; // §6.1 (null preflop); nuts suffix added by the UI from HandAnalysis
  preflopClass: string | null; // "AKs" preflop, else null
  best5: Card[]; // [] preflop
  core: Card[]; // cards forming the category
  kickers: Card[]; // best5 minus core
  holeUsed: 0 | 1 | 2;
  playsTheBoard: boolean; // §5.4
}

const one = (r: Rank): string => RANK_NAMES[r] as string;
const many = (r: Rank): string => RANK_PLURALS[r] as string;

/** Hand names (Appendix F.2) and sub-labels (§6.1, Appendix F.3). */
export const HAND_TEXT = {
  highCard: (r: Rank) => `${one(r)}-high`,
  pair: (r: Rank) => `Pair of ${many(r)}`,
  twoPair: (high: Rank, low: Rank) => `Two Pair, ${many(high)} and ${many(low)}`,
  trips: (r: Rank) => `Three of a Kind, ${many(r)}`,
  straight: (high: Rank) => `Straight, ${one(high)}-high`,
  flush: (high: Rank) => `Flush, ${one(high)}-high`,
  fullHouse: (trips: Rank, pair: Rank) => `Full House, ${many(trips)} full of ${many(pair)}`,
  quads: (r: Rank) => `Four of a Kind, ${many(r)}`,
  straightFlush: (high: Rank) => `Straight Flush, ${one(high)}-high`,
  royalFlush: 'Royal Flush',
  pocketPair: (r: Rank) => `Pocket ${many(r)}`,
  suited: (high: Rank, low: Rank) => `${one(high)}-${one(low)} suited`,
  offsuit: (high: Rank, low: Rank) => `${one(high)}-${one(low)} offsuit`,
  boardPlays: 'The board plays: everyone shares this hand',
  overpair: 'Overpair',
  topPair: (kicker: Rank) => `Top pair, ${one(kicker)} kicker`,
  secondPair: 'Second pair',
  weakPair: 'Weak pair',
  pairUnderBoard: 'Pocket pair under the board',
  pairOnBoard: 'The pair is on the board: everyone has it',
  bothCardsPair: 'Both your cards make pairs',
  bothPairsOnBoard: 'Both pairs are on the board: your kicker decides',
  onePairOnBoard: 'One pair is on the board',
  set: 'A set: well hidden and strong',
  trips1: 'Trips: others may share your card',
  tripsOnBoard: 'The three are on the board: everyone has them',
  uses: (n: number) => `Uses ${n} of your cards`,
} as const;

/** How many leading cards of `best5` form the category (the rest are kickers). */
const CORE_SIZE: Record<HandCategory, number> = {
  highCard: 1, // the high card itself (Appendix F.7: four kickers)
  pair: 2,
  twoPair: 4,
  trips: 3,
  straight: 5,
  flush: 5,
  fullHouse: 5,
  quads: 4,
  straightFlush: 5,
  royalFlush: 5,
};

function checkInput(hole: readonly Card[], board: readonly Card[]): void {
  if (hole.length !== 2) throw new RangeError(`describe: need 2 hole cards, got ${hole.length}`);
  if (![0, 3, 4, 5].includes(board.length)) {
    throw new RangeError(`describe: board must have 0, 3, 4 or 5 cards, got ${board.length}`);
  }
  const all = [...hole, ...board];
  if (!all.every(isCard) || new Set(all).size !== all.length) {
    throw new RangeError(`describe: cards must be distinct cards 0..51: ${all.join(',')}`);
  }
}

/** Ranks of a straight from its high card, highest first; the wheel ends with the Ace. */
function straightRanks(high: Rank): Rank[] {
  return [0, 1, 2, 3, 4].map((i) => (high - i + 13) % 13);
}

/** The suit that holds five or more of `cards` (a flush), if any. */
function flushSuit(cards: readonly Card[]): Suit {
  for (let s = 0; s < 4; s++) {
    if (cards.filter((c) => suitOf(c) === s).length >= 5) return s as Suit;
  }
  throw new Error('describe: a flush score without five cards of one suit');
}

/**
 * The best five cards for `score`, category-forming cards first, then kickers by rank (§5.4).
 * Flush and straight flush: the flush suit's cards of the scored ranks. Otherwise, for each
 * scored rank, the needed cards of that rank are chosen preferring hole cards, then the higher
 * suit (s > h > d > c); within a rank they are listed higher suit first.
 */
function buildBest5(score: number, hole: readonly Card[], board: readonly Card[]): Card[] {
  const cards = [...hole, ...board];
  const [n0, n1, n2, n3, n4] = scoreNibbles(score);
  const code = score >> 20;
  const available = (c: Card): boolean => cards.includes(c);

  if (code === 8 || code === 5) {
    const suit = flushSuit(cards);
    const ranks = code === 8 ? straightRanks(n0) : [n0, n1, n2, n3, n4];
    const five = ranks.map((r) => makeCard(r, suit));
    if (!five.every(available)) throw new Error('describe: flush cards not found');
    return five;
  }

  const used = new Set<Card>();
  const take = (rank: Rank, count: number): Card[] => {
    const holeFirst = (c: Card): number => (hole.includes(c) ? 1 : 0);
    const chosen = cards
      .filter((c) => rankOf(c) === rank && !used.has(c))
      .sort((a, b) => holeFirst(b) - holeFirst(a) || suitOf(b) - suitOf(a))
      .slice(0, count);
    if (chosen.length !== count) throw new Error('describe: score does not match the cards');
    for (const c of chosen) used.add(c);
    return chosen.sort((a, b) => suitOf(b) - suitOf(a));
  };

  switch (code) {
    case 7:
      return [...take(n0, 4), ...take(n1, 1)];
    case 6:
      return [...take(n0, 3), ...take(n1, 2)];
    case 4:
      return straightRanks(n0).flatMap((r) => take(r, 1));
    case 3:
      return [...take(n0, 3), ...take(n1, 1), ...take(n2, 1)];
    case 2:
      return [...take(n0, 2), ...take(n1, 2), ...take(n2, 1)];
    case 1:
      return [...take(n0, 2), ...take(n1, 1), ...take(n2, 1), ...take(n3, 1)];
    default:
      return [n0, n1, n2, n3, n4].flatMap((r) => take(r, 1));
  }
}

function handName(score: number, category: HandCategory): string {
  const [n0, n1] = scoreNibbles(score);
  switch (category) {
    case 'highCard':
      return HAND_TEXT.highCard(n0);
    case 'pair':
      return HAND_TEXT.pair(n0);
    case 'twoPair':
      return HAND_TEXT.twoPair(n0, n1);
    case 'trips':
      return HAND_TEXT.trips(n0);
    case 'straight':
      return HAND_TEXT.straight(n0);
    case 'flush':
      return HAND_TEXT.flush(n0);
    case 'fullHouse':
      return HAND_TEXT.fullHouse(n0, n1);
    case 'quads':
      return HAND_TEXT.quads(n0);
    case 'straightFlush':
      return HAND_TEXT.straightFlush(n0);
    case 'royalFlush':
      return HAND_TEXT.royalFlush;
  }
}

/** Sub-label after the flop when the board does not play (§6.1; first matching row wins). */
function subLabel(
  score: number,
  category: HandCategory,
  hole: readonly Card[],
  board: readonly Card[],
  holeUsed: number,
): string | null {
  const [n0, n1] = scoreNibbles(score);
  const holeRanks = hole.map(rankOf);
  const inHole = (r: Rank): number => holeRanks.filter((h) => h === r).length;
  const boardRanks = [...new Set(board.map(rankOf))].sort((a, b) => b - a);
  switch (category) {
    case 'highCard':
      return null;
    case 'pair': {
      if (inHole(n0) === 2) {
        return n0 > (boardRanks[0] as Rank) ? HAND_TEXT.overpair : HAND_TEXT.pairUnderBoard;
      }
      if (inHole(n0) === 1) {
        // The board is unpaired here (a board pair plus this pair would be two pair).
        if (n0 === boardRanks[0]) {
          const kicker = holeRanks.find((r) => r !== n0) as Rank;
          return HAND_TEXT.topPair(kicker);
        }
        return n0 === boardRanks[1] ? HAND_TEXT.secondPair : HAND_TEXT.weakPair;
      }
      return HAND_TEXT.pairOnBoard;
    }
    case 'twoPair': {
      // A scored pair has exactly two cards in all, so a hole card of that rank is in best5.
      // Both scored pairs hold a hole card only when each hole card pairs the board; a pocket
      // pair is one pair from the hand and one on the board.
      const holePairs = [n0, n1].filter((r) => inHole(r) > 0).length;
      if (holePairs === 2) return HAND_TEXT.bothCardsPair;
      return holePairs === 1 ? HAND_TEXT.onePairOnBoard : HAND_TEXT.bothPairsOnBoard;
    }
    case 'trips': {
      const k = inHole(n0);
      return k === 2 ? HAND_TEXT.set : k === 1 ? HAND_TEXT.trips1 : HAND_TEXT.tripsOnBoard;
    }
    default:
      return HAND_TEXT.uses(holeUsed);
  }
}

function describePreflop(hole: readonly [Card, Card]): HandInfo {
  const [a, b] = hole;
  const ra = rankOf(a);
  const rb = rankOf(b);
  const high = Math.max(ra, rb);
  const low = Math.min(ra, rb);
  const pair = ra === rb;
  const name = pair
    ? HAND_TEXT.pocketPair(high)
    : suitOf(a) === suitOf(b)
      ? HAND_TEXT.suited(high, low)
      : HAND_TEXT.offsuit(high, low);
  return {
    score: 0,
    category: pair ? 'pair' : 'highCard',
    name,
    subLabel: null,
    preflopClass: className(classOf(a, b)),
    best5: [],
    core: [],
    kickers: [],
    holeUsed: 0,
    playsTheBoard: false,
  };
}

/**
 * Describes the hero's hand: 2 hole cards and a board of 0 (preflop), 3, 4 or 5 cards.
 * ⚠️ `playsTheBoard` compares scores (board of 5 and `score7(board) == score7(hole + board)`),
 * never `holeUsed`: with A-K-Q-J-10 on the board and a 10 in hand, the board still plays.
 */
export function describe(hole: [Card, Card], board: Card[]): HandInfo {
  checkInput(hole, board);
  if (board.length === 0) return describePreflop(hole);

  const all = [...hole, ...board];
  const score = score7(all, all.length);
  const category = categoryOf(score);
  const playsTheBoard = board.length === 5 && score7(board, 5) === score;
  const best5 = playsTheBoard ? buildBest5(score, [], board) : buildBest5(score, hole, board);
  const coreSize = CORE_SIZE[category];
  const holeUsed = best5.filter((c) => hole.includes(c)).length as 0 | 1 | 2;
  return {
    score,
    category,
    name: handName(score, category),
    subLabel: playsTheBoard
      ? HAND_TEXT.boardPlays
      : subLabel(score, category, hole, board, holeUsed),
    preflopClass: null,
    best5,
    core: best5.slice(0, coreSize),
    kickers: best5.slice(coreSize),
    holeUsed,
    playsTheBoard,
  };
}
