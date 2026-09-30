/**
 * Draws, outs, risky outs and "best possible hand" for the hero (PLAN §6.2–6.5, Appendix A.5,
 * D.2). Pure maths on the hero's cards and the board, never on game state. The `handInfo` job of
 * equity.worker combines `analyzeHand` with the chances by the river (§6.6, `chances.ts`).
 *
 * "Category" here is always one of the 10 display categories (`HAND_CATEGORIES`, royal flush
 * above straight flush), the same scale `OutCard.makes` and the chances use.
 */
import { isCard, makeCard, rankOf, suitOf, type Card } from '../core/cards.ts';
import { categoryOf, score7 } from '../eval/evaluate.ts';
import * as tables from '../eval/tables.ts';
import type { DrawKind, HandAnalysis, OutCard, RiskRule } from './types.ts';

// Module-local table reference: see the note in eval/evaluate.ts.
const STRAIGHT_HIGH = tables.STRAIGHT_HIGH;

// Display-category levels: the index in HAND_CATEGORIES.
const HIGH_CARD = 0;
const PAIR = 1;
const TWO_PAIR = 2;
const STRAIGHT = 4;
const FLUSH = 5;
const ROYAL_FLUSH = 9;

/** Score category code of a straight (PLAN §5.2), for building a straight's score. */
const STRAIGHT_CODE = 4;

type Draw = HandAnalysis['draws'][number];
type Beaters = NonNullable<HandAnalysis['beaters']>;

/** Display-category level of a score: the score category, royal flush = 9 (§5.2). */
function level(score: number): number {
  const code = score >> 20;
  return code === 8 && ((score >> 16) & 15) === 12 ? ROYAL_FLUSH : code;
}

/** 13-bit mask of the ranks among `cards`. */
function rankMask(cards: readonly Card[]): number {
  let mask = 0;
  for (const c of cards) mask |= 1 << rankOf(c);
  return mask;
}

function countSuit(cards: readonly Card[], suit: number): number {
  let n = 0;
  for (const c of cards) if (suitOf(c) === suit) n++;
  return n;
}

/** The mask of a 5-rank straight window by its high rank; the wheel (high = 3) is A-2-3-4-5. */
function windowMask(high: number): number {
  return high === 3 ? 0x100f : 0x1f << (high - 4);
}

function popcount(mask: number): number {
  let n = 0;
  for (let m = mask; m !== 0; m &= m - 1) n++;
  return n;
}

/** Everything the rules read about one hero hand. */
interface Hand {
  hole: readonly Card[];
  board: readonly Card[];
  cards: Card[]; // hole + board
  known: boolean[]; // by card: in the hole or on the board
  score: number;
  level: number;
}

function readHand(fn: string, hole: readonly Card[], board: readonly Card[]): Hand {
  if (hole.length !== 2) throw new RangeError(`${fn}: need 2 hole cards, got ${hole.length}`);
  if (![0, 3, 4, 5].includes(board.length)) {
    throw new RangeError(`${fn}: board must have 0, 3, 4 or 5 cards, got ${board.length}`);
  }
  const cards = [...hole, ...board];
  if (!cards.every(isCard) || new Set(cards).size !== cards.length) {
    throw new RangeError(`${fn}: cards must be distinct cards 0..51: ${cards.join(',')}`);
  }
  const known = new Array<boolean>(52).fill(false);
  for (const c of cards) known[c] = true;
  // Preflop there is no made hand to improve: nothing below reads the score then.
  const score = board.length === 0 ? 0 : score7(cards, cards.length);
  return { hole, board, cards, known, score, level: level(score) };
}

const drawStreet = (h: Hand): boolean => h.board.length === 3 || h.board.length === 4;

/**
 * Risky-out rules for the out `x` (§6.4, HEURISTIC and deterministic), judged on `next` = the
 * board plus `x`. `score`/`lv` are the hero's new score and level.
 */
function riskRules(h: Hand, x: Card, next: Card[], score: number, lv: number): RiskRule[] {
  const risky: RiskRule[] = [];
  let maxSuit = 0;
  for (let s = 0; s < 4; s++) maxSuit = Math.max(maxSuit, countSuit(next, s));
  const nextRanks = rankMask(next);
  const paired = popcount(nextRanks) < next.length;
  if (lv <= STRAIGHT && maxSuit >= 3) risky.push('R1');
  if ((lv === STRAIGHT || lv === FLUSH) && paired) risky.push('R2');
  if (lv <= STRAIGHT && betterStraightPossible(h, x, nextRanks, score)) risky.push('R3');
  if (lv === FLUSH && higherFlushPossible(h, x, next, score)) risky.push('R4');
  if (lv === PAIR) risky.push('R5');
  return risky;
}

/**
 * R3: can some two unseen cards make a straight with the board that beats the hero's new hand?
 * A straight depends only on ranks, so it is enough to try every one or two ranks an opponent can
 * still hold (a rank with at least one unseen card; any other unseen card fills the second slot).
 */
function betterStraightPossible(h: Hand, x: Card, nextRanks: number, score: number): boolean {
  let open = 0; // ranks with an unseen card left
  for (let r = 0; r < 13; r++) {
    for (let s = 0; s < 4; s++) {
      const c = makeCard(r, s as 0 | 1 | 2 | 3);
      if (!h.known[c] && c !== x) {
        open |= 1 << r;
        break;
      }
    }
  }
  const beats = (mask: number): boolean => {
    const high = STRAIGHT_HIGH[mask]!;
    return high >= 0 && ((STRAIGHT_CODE << 20) | (high << 16)) > score;
  };
  for (let r1 = 0; r1 < 13; r1++) {
    if ((open & (1 << r1)) === 0) continue;
    const one = nextRanks | (1 << r1);
    if (beats(one)) return true;
    for (let r2 = r1 + 1; r2 < 13; r2++) {
      if ((open & (1 << r2)) !== 0 && beats(one | (1 << r2))) return true;
    }
  }
  return false;
}

/**
 * R4: an opponent holding the two highest unseen cards of the hero's flush suit would have a
 * higher flush (a straight flush of that suit counts as higher).
 */
function higherFlushPossible(h: Hand, x: Card, next: Card[], score: number): boolean {
  const mine = [...h.cards, x];
  let suit = 0;
  while (countSuit(mine, suit) < 5) suit++;
  const theirs = next.filter((c) => suitOf(c) === suit);
  for (let r = 12, taken = 0; r >= 0 && taken < 2; r--) {
    const c = makeCard(r, suit as 0 | 1 | 2 | 3);
    if (!h.known[c] && c !== x) {
      theirs.push(c);
      taken++;
    }
  }
  return theirs.length >= 5 && score7(theirs, theirs.length) > score;
}

/** §6.3 outs with their §6.4 risky rules: strongest category first, then card high to low. */
function outsOf(h: Hand): OutCard[] {
  const n = h.cards.length;
  const all = [...h.cards, 0]; // hero cards + x
  const next = [...h.board, 0]; // board + x
  const boardRanks = rankMask(h.board);
  const holeRanks = rankMask(h.hole);
  const found: { out: OutCard; lv: number }[] = [];
  for (let x = 51; x >= 0; x--) {
    if (h.known[x]) continue;
    all[n] = x;
    const score = score7(all, n + 1);
    const lv = level(score);
    // Rule 1: the category goes up.
    if (lv <= h.level) continue;
    next[h.board.length] = x;
    // Rule 2: the new best five uses a hole card. On the flop 4 board cards cannot fill a best
    // five, so it always does; on the turn it does unless board + x alone scores as high (then
    // the board plays, §5.4).
    if (next.length === 5 && score7(next, 5) === score) continue;
    // Rule 3: pairing the board alone is no improvement up to two pair (everyone gets it).
    const bit = 1 << rankOf(x);
    if ((boardRanks & bit) !== 0 && (holeRanks & bit) === 0 && lv <= TWO_PAIR) continue;
    found.push({
      out: { card: x, makes: categoryOf(score), risky: riskRules(h, x, next, score, lv) },
      lv,
    });
  }
  found.sort((a, b) => b.lv - a.lv || b.out.card - a.out.card);
  return found.map((f) => f.out);
}

/**
 * The ranks S of §6.2: adding the rank makes a straight that uses a hole card, when the hero has
 * no straight yet. "Uses a hole card" = the best straight after adding it is higher than the best
 * straight of the board plus that rank alone (on the turn, a board straight is not the hero's).
 */
function straightRanks(h: Hand): number[] {
  const present = rankMask(h.cards);
  const boardRanks = rankMask(h.board);
  const ranks: number[] = [];
  for (let r = 0; r < 13; r++) {
    const bit = 1 << r;
    if ((present & bit) !== 0) continue;
    const high = STRAIGHT_HIGH[present | bit]!;
    if (high >= 0 && STRAIGHT_HIGH[boardRanks | bit]! < high) ranks.push(r);
  }
  return ranks;
}

/** Rank at a position of the Ace-low-and-high line: 0 = Ace (low), 1 = Two … 13 = Ace. */
const rankAt = (pos: number): number => (pos === 0 ? 12 : pos - 1);

/**
 * Open-ended: `ranks` are the two open ends of 4 consecutive present ranks (both ends exist, so
 * A-2-3-4 and J-Q-K-A are one-ended; 2-3-4-5 is open to the Ace and the Six).
 */
function openEnded(present: number, ranks: readonly number[]): boolean {
  if (ranks.length !== 2) return false;
  for (let pos = 1; pos + 4 <= 13; pos++) {
    let run = true;
    for (let i = 0; i < 4 && run; i++) run = (present & (1 << rankAt(pos + i))) !== 0;
    if (!run) continue;
    const ends = [rankAt(pos - 1), rankAt(pos + 4)];
    if (ends.every((e) => ranks.includes(e))) return true;
  }
  return false;
}

/** The hero holds the highest card of `suit` that is not on the board. */
function holdsNutCard(h: Hand, suit: number): boolean {
  for (let r = 12; r >= 0; r--) {
    const c = makeCard(r, suit as 0 | 1 | 2 | 3);
    if (!h.board.includes(c)) return h.hole.includes(c);
  }
  return false;
}

/**
 * §6.2 draws, flop and turn only, each using at least one hole card; `outs` = how many of the
 * §6.3 outs complete that draw (a card can complete two draws; the hand's total is the union,
 * `outs.length`). Backdoor draws (flop only) complete only with two cards: `outs` 0.
 * Order: flush, straight, overcards, backdoor flush, backdoor straight.
 */
function drawsOf(h: Hand, outs: readonly OutCard[]): Draw[] {
  if (!drawStreet(h)) return [];
  const draws: Draw[] = [];
  const add = (kind: DrawKind, completes: (c: Card) => boolean): void => {
    draws.push({ kind, outs: outs.filter((o) => completes(o.card)).length });
  };

  if (h.level < FLUSH) {
    for (let suit = 0; suit < 4; suit++) {
      if (countSuit(h.cards, suit) === 4 && countSuit(h.hole, suit) > 0) {
        add(holdsNutCard(h, suit) ? 'nutFlush' : 'flush', (c) => suitOf(c) === suit);
      }
    }
  }

  const straight = h.level < STRAIGHT ? straightRanks(h) : [];
  if (straight.length > 0) {
    // |S| ≥ 3 cannot happen before the river: three completing ranks need 8 distinct ranks.
    const kind =
      straight.length === 1
        ? 'gutshot'
        : openEnded(rankMask(h.cards), straight)
          ? 'oesd'
          : 'doubleGutshot';
    add(kind, (c) => straight.includes(rankOf(c)));
  }

  const holeRanks = rankMask(h.hole);
  const topBoard = Math.max(...h.board.map(rankOf));
  if (h.level === HIGH_CARD && h.hole.every((c) => rankOf(c) > topBoard)) {
    add('overcards', (c) => (holeRanks & (1 << rankOf(c))) !== 0);
  }

  if (h.board.length === 3) {
    if (h.level < FLUSH) {
      for (let suit = 0; suit < 4; suit++) {
        if (countSuit(h.cards, suit) === 3 && countSuit(h.hole, suit) > 0) {
          draws.push({ kind: 'backdoorFlush', outs: 0 });
        }
      }
    }
    if (h.level < STRAIGHT && straight.length === 0) {
      // 3 distinct ranks in one 5-rank window, one of them a hole rank the board lacks (so the
      // straight would use a hole card). A window with 4 would be a straight draw.
      const present = rankMask(h.cards);
      const holeOnly = holeRanks & ~rankMask(h.board);
      for (let high = 3; high <= 12; high++) {
        const w = windowMask(high);
        if (popcount(present & w) >= 3 && (holeOnly & w) !== 0) {
          draws.push({ kind: 'backdoorStraight', outs: 0 });
          break;
        }
      }
    }
  }
  return draws;
}

/** §6.5: unseen 2-card combos whose hand beats the hero's current hand. */
function beatersOf(h: Hand): Beaters {
  const unseen: Card[] = [];
  for (let c = 0; c < 52; c++) if (!h.known[c]) unseen.push(c);
  const theirs = [0, 0, ...h.board];
  const n = theirs.length;
  let count = 0;
  for (let i = 0; i < unseen.length; i++) {
    theirs[0] = unseen[i]!;
    for (let j = i + 1; j < unseen.length; j++) {
      theirs[1] = unseen[j]!;
      if (score7(theirs, n) > h.score) count++;
    }
  }
  return { count, total: (unseen.length * (unseen.length - 1)) / 2 };
}

/**
 * Outs (§6.3) on the flop and turn, each with its risky rules (§6.4); `[]` preflop and on the
 * river. An unseen card is an out when (1) the category goes up, (2) the new best five uses a
 * hole card, and (3) it is not a board-pairing card that only makes two pair or less.
 */
export function findOuts(hole: readonly Card[], board: readonly Card[]): OutCard[] {
  const h = readHand('findOuts', hole, board);
  return drawStreet(h) ? outsOf(h) : [];
}

/** Draws (§6.2) on the flop and turn; `[]` preflop and on the river. */
export function findDraws(hole: readonly Card[], board: readonly Card[]): Draw[] {
  const h = readHand('findDraws', hole, board);
  return drawStreet(h) ? drawsOf(h, outsOf(h)) : [];
}

/**
 * Beaters (§6.5) from the flop on: of all `total` unseen 2-card combos (1,081 on the flop), how
 * many beat the hero's hand right now. `null` preflop.
 */
export function countBeaters(hole: readonly Card[], board: readonly Card[]): Beaters | null {
  const h = readHand('countBeaters', hole, board);
  return h.board.length === 0 ? null : beatersOf(h);
}

/**
 * The draws, outs, beaters and nuts parts of the `handInfo` result (§6.2–6.5). `nuts` = no
 * beaters from the flop on ("Best possible hand"). The chances by the river (`chances`,
 * `nextCardPct`, `byRiverPct`) come from `chances.ts`.
 */
export function analyzeHand(
  hole: readonly Card[],
  board: readonly Card[],
): Pick<HandAnalysis, 'draws' | 'outs' | 'beaters' | 'nuts'> {
  const h = readHand('analyzeHand', hole, board);
  const outs = drawStreet(h) ? outsOf(h) : [];
  const beaters = h.board.length === 0 ? null : beatersOf(h);
  return { draws: drawsOf(h, outs), outs, beaters, nuts: beaters !== null && beaters.count === 0 };
}
