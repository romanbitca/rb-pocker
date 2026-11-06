/**
 * The drill's hands (PLAN §13.5), ported from the owner's standalone Hand Drill: clean hands of a
 * chosen position, trap hands (the templates `TRAPS_5` and `TRAPS_7`), and two-hand matchups.
 * Cards are RB cards (`core/cards.ts`: rank 0..12 = 2..A); every random choice comes from the
 * session's seeded stream; and the evaluator (§5.3) decides what a hand is, so a generator can
 * only miss its target, never mislabel a hand: each one checks its result and tries again.
 */
import {
  makeCard,
  newDeck,
  rankOf,
  suitOf,
  type Card,
  type Rank,
  type Suit,
} from '../core/cards.ts';
import type { Rng } from '../core/rng.ts';
import { score7 } from '../eval/evaluate.ts';
import { facts7 } from './explain.ts';
import { positionOfScore, type Position } from './ladder.ts';
import { int, pick, shuffle, unit } from './random.ts';

const ACE: Rank = 12;
const KING: Rank = 11;
const FIVE: Rank = 3;
const ALL_RANKS: readonly Rank[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const ALL_SUITS: readonly Suit[] = [0, 1, 2, 3];

const card = (rank: Rank, suit: Suit): Card => makeCard(rank, suit);
const anySuit = (rng: Rng): Suit => int(rng, 4) as Suit;
const otherSuit = (rng: Rng, s: Suit): Suit => ((s + 1 + int(rng, 3)) % 4) as Suit;

/** `n` different ranks, none of them in `except`. */
function ranks(rng: Rng, n: number, except: readonly Rank[] = []): Rank[] {
  return shuffle(
    rng,
    ALL_RANKS.filter((r) => !except.includes(r)),
  ).slice(0, n);
}

/** `n` different suits. */
const suits = (rng: Rng, n: number): Suit[] => shuffle(rng, [...ALL_SUITS]).slice(0, n);

/** The ranks of the straight to `high`, highest first; the wheel (to the Five) starts with its Ace. */
export function straightRanks(high: Rank): Rank[] {
  return high === FIVE ? [ACE, 0, 1, 2, 3] : [high, high - 1, high - 2, high - 3, high - 4];
}

/** The score of 5, 6 or 7 distinct cards. */
export const scoreOf = (cards: readonly Card[]): number => score7(cards, cards.length);

/** The position of 5, 6 or 7 distinct cards. */
export const positionOfCards = (cards: readonly Card[]): Position =>
  positionOfScore(scoreOf(cards));

const allDistinct = (cards: readonly Card[]): boolean => new Set(cards).size === cards.length;

/** No card in both hands. */
export const disjoint = (a: readonly Card[], b: readonly Card[]): boolean =>
  !a.some((c) => b.includes(c));

/**
 * A random card that is not in `cards` and passes `ok`. After 400 random tries (the old drill's
 * limit) it takes the first such card in deck order, then any card not in `cards`: the caller
 * checks the hand it builds anyway.
 */
function filler(rng: Rng, cards: readonly Card[], ok: (c: Card) => boolean = () => true): Card {
  for (let i = 0; i < 400; i++) {
    const c = card(int(rng, 13), anySuit(rng));
    if (!cards.includes(c) && ok(c)) return c;
  }
  const free = newDeck().filter((c) => !cards.includes(c));
  return free.find(ok) ?? (free[0] as Card);
}

// ---------------------------------------------------------------------------------------------
// Clean hands: one maker per position (it may miss, e.g. a "flush" that is a straight flush)

const CLEAN: Readonly<Record<Position, (rng: Rng) => Card[]>> = {
  1: (rng) => {
    const s = anySuit(rng);
    return straightRanks(ACE).map((r) => card(r, s));
  },
  2: (rng) => {
    const s = anySuit(rng);
    return straightRanks((FIVE + int(rng, 9)) as Rank).map((r) => card(r, s)); // to the King
  },
  3: (rng) => {
    const [r, k] = ranks(rng, 2) as [Rank, Rank];
    return [...ALL_SUITS.map((s) => card(r, s)), card(k, anySuit(rng))];
  },
  4: (rng) => {
    const [a, b] = ranks(rng, 2) as [Rank, Rank];
    return [...suits(rng, 3).map((s) => card(a, s)), ...suits(rng, 2).map((s) => card(b, s))];
  },
  5: (rng) => {
    const s = anySuit(rng);
    return ranks(rng, 5).map((r) => card(r, s));
  },
  6: (rng) => straightRanks((FIVE + int(rng, 10)) as Rank).map((r) => card(r, anySuit(rng))),
  7: (rng) => {
    const [r, k1, k2] = ranks(rng, 3) as [Rank, Rank, Rank];
    return [
      ...suits(rng, 3).map((s) => card(r, s)),
      card(k1, anySuit(rng)),
      card(k2, anySuit(rng)),
    ];
  },
  8: (rng) => {
    const [a, b, k] = ranks(rng, 3) as [Rank, Rank, Rank];
    return [
      ...suits(rng, 2).map((s) => card(a, s)),
      ...suits(rng, 2).map((s) => card(b, s)),
      card(k, anySuit(rng)),
    ];
  },
  9: (rng) => {
    const [p, ...kickers] = ranks(rng, 4) as [Rank, Rank, Rank, Rank];
    return [...suits(rng, 2).map((s) => card(p, s)), ...kickers.map((r) => card(r, anySuit(rng)))];
  },
  10: (rng) => ranks(rng, 5).map((r) => card(r, anySuit(rng))),
};

/** Five cards that make exactly `pos`, in random order. */
export function makeHand(rng: Rng, pos: Position): Card[] {
  for (let i = 0; i < 500; i++) {
    const hand = CLEAN[pos](rng);
    if (positionOfCards(hand) === pos) return shuffle(rng, hand);
  }
  return shuffle(rng, CLEAN[1](rng)); // never reached in practice; the caller scores it anyway
}

/**
 * Seven cards whose best five make exactly `pos`: a clean five plus two more. The first five are
 * not always the table: the question deals the seven to the table and the hand at random.
 */
export function makeHoldem(rng: Rng, pos: Position): Card[] {
  for (let i = 0; i < 4000; i++) {
    const five = CLEAN[pos](rng);
    if (positionOfCards(five) !== pos) continue;
    const first = filler(rng, five);
    const seven = shuffle(rng, [...five, first, filler(rng, [...five, first])]);
    if (positionOfCards(seven) === pos) return seven;
  }
  const royal = CLEAN[1](rng);
  const other = ((suitOf(royal[0] as Card) + 1) % 4) as Suit;
  return [...royal, card(0, other), card(1, other)];
}

// ---------------------------------------------------------------------------------------------
// Trap hands (the old drill's T5 and T7): what a learner often gets wrong

/** Which trap a question shows; `ui/drillText.ts` turns it into its note (`i18n/drill.ts`). */
export type TrapKey =
  // Five cards
  | 'wrapAround'
  | 'wheel'
  | 'mixedRoyal'
  | 'fourFlush'
  | 'gap'
  | 'suitedGap'
  | 'steelWheel'
  | 'kingHighStraightFlush'
  | 'oneOffSuit'
  | 'fourInARowAndPair'
  | 'fourSuitedAndPair'
  | 'tripsNotFull'
  | 'missingTen'
  // Seven cards
  | 'boardStraight'
  | 'pairDoesNotPlay'
  | 'threePairs'
  | 'twoTriples'
  | 'fourSuitedBoard'
  | 'fourSuitedNoFlush'
  | 'boardPairAndYourCard'
  | 'fillTheMiddle'
  | 'sixInARow'
  | 'straightAndFlush'
  | 'boardPair'
  | 'boardTripsAndYourPair'
  | 'aceLow'
  | 'quadsWithYourPair'
  | 'flushBoard';

/** A trap's note; `rank` fills "Your pair of Sixes does not play." */
export interface TrapNote {
  readonly key: TrapKey;
  readonly rank?: Rank;
}

export interface Template {
  /** The positions the hand may make (a template that makes another is tried again). */
  readonly exp: readonly Position[];
  readonly note: TrapKey;
  /** Five cards, or seven: indices 0–4 the table, 5–6 the player's own cards. */
  readonly make: (rng: Rng) => Card[];
  /** An extra condition on the seven cards (e.g. "both your cards make the straight"). */
  readonly check?: (cards: readonly Card[]) => boolean;
}

/** A run of six ranks from `lo` with one of its four middle ranks taken out: one gap. */
function gapRanks(rng: Rng): Rank[] {
  const lo = int(rng, 8);
  const six = [lo, lo + 1, lo + 2, lo + 3, lo + 4, lo + 5];
  six.splice(1 + int(rng, 4), 1);
  return six;
}

const rainbow = (rng: Rng, rs: readonly Rank[]): Card[] => rs.map((r) => card(r, anySuit(rng)));

/** Five-card traps (Name the hand). */
export const TRAPS_5: readonly Template[] = [
  {
    exp: [10],
    note: 'wrapAround',
    make: (rng) =>
      rainbow(
        rng,
        pick(rng, [
          [9, 10, KING, ACE, 0],
          [10, KING, ACE, 0, 1],
          [KING, ACE, 0, 1, 2],
        ]),
      ),
  },
  { exp: [6], note: 'wheel', make: (rng) => rainbow(rng, straightRanks(FIVE)) },
  { exp: [6], note: 'mixedRoyal', make: (rng) => rainbow(rng, straightRanks(ACE)) },
  {
    exp: [10],
    note: 'fourFlush',
    make: (rng) => {
      const s = anySuit(rng);
      return ranks(rng, 5).map((r, i) => card(r, i < 4 ? s : otherSuit(rng, s)));
    },
  },
  { exp: [10], note: 'gap', make: (rng) => rainbow(rng, gapRanks(rng)) },
  {
    exp: [5],
    note: 'suitedGap',
    make: (rng) => {
      const s = anySuit(rng);
      return gapRanks(rng).map((r) => card(r, s));
    },
  },
  {
    exp: [2],
    note: 'steelWheel',
    make: (rng) => {
      const s = anySuit(rng);
      return straightRanks(FIVE).map((r) => card(r, s));
    },
  },
  {
    exp: [2],
    note: 'kingHighStraightFlush',
    make: (rng) => {
      const s = anySuit(rng);
      return straightRanks(KING).map((r) => card(r, s));
    },
  },
  {
    exp: [6],
    note: 'oneOffSuit',
    make: (rng) => {
      const s = anySuit(rng);
      const off = int(rng, 5);
      return straightRanks((FIVE + int(rng, 10)) as Rank).map((r, i) =>
        card(r, i === off ? otherSuit(rng, s) : s),
      );
    },
  },
  {
    exp: [9],
    note: 'fourInARowAndPair',
    make: (rng) => {
      const lo = int(rng, 10);
      const run = [lo, lo + 1, lo + 2, lo + 3];
      return rainbow(rng, [...run, pick(rng, run)]);
    },
  },
  {
    exp: [9],
    note: 'fourSuitedAndPair',
    make: (rng) => {
      const s = anySuit(rng);
      const [p, a, b, c] = ranks(rng, 4) as [Rank, Rank, Rank, Rank];
      return [card(p, s), card(p, otherSuit(rng, s)), card(a, s), card(b, s), card(c, s)];
    },
  },
  {
    exp: [7],
    note: 'tripsNotFull',
    make: (rng) => {
      const [t, a, b] = ranks(rng, 3) as [Rank, Rank, Rank];
      return [
        ...suits(rng, 3).map((s) => card(t, s)),
        card(a, anySuit(rng)),
        card(b, anySuit(rng)),
      ];
    },
  },
  { exp: [10], note: 'missingTen', make: (rng) => rainbow(rng, [ACE, KING, 10, 9, 7]) },
];

/** The best five of seven (indices 0–4 the table, 5–6 the player's cards). */
const factsOfSeven = (cs: readonly Card[]) => facts7(cs.slice(5), cs.slice(0, 5));
const onTable = (cs: readonly Card[], c: Card): boolean => cs.indexOf(c) < 5;

/** Seven-card traps (Hold'em: your hand). */
export const TRAPS_7: readonly Template[] = [
  {
    exp: [6],
    note: 'boardStraight',
    check: (cs) => factsOfSeven(cs).core.every((c) => onTable(cs, c)),
    make: (rng) => {
      const hi = (4 + int(rng, 8)) as Rank; // a Six- to a King-high straight
      const board = rainbow(rng, straightRanks(hi));
      const higher = (c: Card) => rankOf(c) !== hi + 1;
      const h1 = filler(rng, board, higher);
      return [...board, h1, filler(rng, [...board, h1], higher)];
    },
  },
  {
    exp: [8],
    note: 'pairDoesNotPlay',
    check: (cs) => {
      const facts = factsOfSeven(cs);
      return facts.best5.every((c) => onTable(cs, c));
    },
    make: (rng) => {
      const four = ranks(rng, 4).sort((x, y) => y - x);
      const low = four[3] as Rank;
      const [a, b, k] = shuffle(rng, four.slice(0, 3)) as [Rank, Rank, Rank];
      const [s1, s2] = suits(rng, 2) as [Suit, Suit];
      const [s3, s4] = suits(rng, 2) as [Suit, Suit];
      const [s5, s6] = suits(rng, 2) as [Suit, Suit];
      return [
        card(a, s1),
        card(a, s2),
        card(b, s3),
        card(b, s4),
        card(k, anySuit(rng)),
        card(low, s5),
        card(low, s6),
      ];
    },
  },
  {
    exp: [8],
    note: 'threePairs',
    make: (rng) => {
      const [a, b, c, k] = ranks(rng, 4) as [Rank, Rank, Rank, Rank];
      const pair = (r: Rank) => suits(rng, 2).map((s) => card(r, s));
      return shuffle(rng, [...pair(a), ...pair(b), ...pair(c), card(k, anySuit(rng))]);
    },
  },
  {
    exp: [4],
    note: 'twoTriples',
    make: (rng) => {
      const [t1, t2] = ranks(rng, 2) as [Rank, Rank];
      const x = ranks(rng, 1, [t1, t2])[0] as Rank;
      const sa = suits(rng, 3) as [Suit, Suit, Suit];
      const sb = suits(rng, 3) as [Suit, Suit, Suit];
      return [
        card(t1, sa[0]),
        card(t1, sa[1]),
        card(t2, sb[0]),
        card(t2, sb[1]),
        card(x, anySuit(rng)),
        card(t1, sa[2]),
        card(t2, sb[2]),
      ];
    },
  },
  {
    exp: [5],
    note: 'fourSuitedBoard',
    check: (cs) => factsOfSeven(cs).core.some((c) => !onTable(cs, c)),
    make: (rng) => {
      const s = anySuit(rng);
      const rs = ranks(rng, 5);
      const board = rs.slice(0, 4).map((r) => card(r, s));
      board.push(filler(rng, board, (c) => suitOf(c) !== s));
      const h1 = card(rs[4] as Rank, s);
      return [...board, h1, filler(rng, [...board, h1])];
    },
  },
  {
    exp: [7, 8, 9, 10],
    note: 'fourSuitedNoFlush',
    make: (rng) => {
      const s = anySuit(rng);
      const offSuit = (c: Card) => suitOf(c) !== s;
      const board = ranks(rng, 4).map((r) => card(r, s));
      board.push(filler(rng, board, offSuit));
      const h1 = filler(rng, board, offSuit);
      return [...board, h1, filler(rng, [...board, h1], offSuit)];
    },
  },
  {
    exp: [7],
    note: 'boardPairAndYourCard',
    check: (cs) => factsOfSeven(cs).core.some((c) => !onTable(cs, c)),
    make: (rng) => {
      const [p, x, y, z, w] = ranks(rng, 5) as [Rank, Rank, Rank, Rank, Rank];
      const ss = suits(rng, 3) as [Suit, Suit, Suit];
      return [
        card(p, ss[0]),
        card(p, ss[1]),
        card(x, anySuit(rng)),
        card(y, anySuit(rng)),
        card(z, anySuit(rng)),
        card(p, ss[2]),
        card(w, anySuit(rng)),
      ];
    },
  },
  {
    exp: [6],
    note: 'fillTheMiddle',
    check: (cs) => {
      const core = factsOfSeven(cs).core;
      return core.includes(cs[5] as Card) && core.includes(cs[6] as Card);
    },
    make: (rng) => {
      const hi = (4 + int(rng, 9)) as Rank; // a Six- to an Ace-high straight
      const rs = straightRanks(hi);
      const middle = shuffle(rng, [1, 2, 3]).slice(0, 2);
      const hole = middle.map((i) => card(rs[i] as Rank, anySuit(rng)));
      const board = rs.filter((_, i) => !middle.includes(i)).map((r) => card(r, anySuit(rng)));
      const ok = (c: Card) => rankOf(c) !== hi + 1 && !rs.includes(rankOf(c));
      board.push(filler(rng, [...board, ...hole], ok));
      board.push(filler(rng, [...board, ...hole], ok));
      return [...shuffle(rng, board), ...hole];
    },
  },
  {
    exp: [6],
    note: 'sixInARow',
    make: (rng) => {
      const lo = int(rng, 8);
      const six = rainbow(rng, [lo, lo + 1, lo + 2, lo + 3, lo + 4, lo + 5]);
      const apart = (c: Card) => rankOf(c) !== lo + 6 && rankOf(c) !== lo - 1;
      return shuffle(rng, [...six, filler(rng, six, apart)]);
    },
  },
  {
    exp: [5],
    note: 'straightAndFlush',
    make: (rng) => {
      const s = anySuit(rng);
      const hi = (4 + int(rng, 9)) as Rank;
      const rs = straightRanks(hi);
      const suited = shuffle(rng, [0, 1, 2, 3, 4]).slice(0, 3);
      const straight = rs.map((r, i) => card(r, suited.includes(i) ? s : otherSuit(rng, s)));
      const extra = ranks(rng, 2, [...rs, hi + 1, hi - 5]).map((r) => card(r, s));
      return shuffle(rng, [...straight, ...extra]);
    },
  },
  {
    exp: [9],
    note: 'boardPair',
    check: (cs) => factsOfSeven(cs).core.every((c) => onTable(cs, c)),
    make: (rng) => {
      const [p, x, y, z, a, b] = ranks(rng, 6) as [Rank, Rank, Rank, Rank, Rank, Rank];
      const ss = suits(rng, 2) as [Suit, Suit];
      return [
        card(p, ss[0]),
        card(p, ss[1]),
        ...rainbow(rng, [x, y, z]),
        card(a, anySuit(rng)),
        card(b, anySuit(rng)),
      ];
    },
  },
  {
    exp: [4],
    note: 'boardTripsAndYourPair',
    make: (rng) => {
      const [t, p, x, y] = ranks(rng, 4) as [Rank, Rank, Rank, Rank];
      const ts = suits(rng, 3) as [Suit, Suit, Suit];
      const ps = suits(rng, 2) as [Suit, Suit];
      return [
        card(t, ts[0]),
        card(t, ts[1]),
        card(t, ts[2]),
        card(x, anySuit(rng)),
        card(y, anySuit(rng)),
        card(p, ps[0]),
        card(p, ps[1]),
      ];
    },
  },
  {
    exp: [6],
    note: 'aceLow',
    check: (cs) => factsOfSeven(cs).core.some((c) => !onTable(cs, c) && rankOf(c) === ACE),
    make: (rng) => {
      const board = rainbow(rng, [0, 1, 2]);
      const ok = (c: Card) => ![FIVE, 4, ACE].includes(rankOf(c));
      board.push(filler(rng, board, ok));
      board.push(filler(rng, board, ok));
      return [...shuffle(rng, board), card(ACE, anySuit(rng)), card(FIVE, anySuit(rng))];
    },
  },
  {
    exp: [3],
    note: 'quadsWithYourPair',
    make: (rng) => {
      const [p, x, y, z] = ranks(rng, 4) as [Rank, Rank, Rank, Rank];
      const ss = shuffle(rng, [...ALL_SUITS]) as [Suit, Suit, Suit, Suit];
      return [
        card(p, ss[0]),
        card(p, ss[1]),
        ...rainbow(rng, [x, y, z]),
        card(p, ss[2]),
        card(p, ss[3]),
      ];
    },
  },
  {
    exp: [5],
    note: 'flushBoard',
    make: (rng) => {
      const s = anySuit(rng);
      const board = ranks(rng, 5).map((r) => card(r, s));
      const h1 = filler(rng, board);
      return [...board, h1, filler(rng, [...board, h1])];
    },
  },
];

/** A trap hand that came out as its template says. */
export interface TrapHand {
  /** As made: five cards, or seven with the table first. */
  readonly cards: Card[];
  readonly pos: Position;
  readonly note: TrapNote;
}

/** Makes `t` until it comes out right (400 tries, as before), or null. */
export function runTemplate(rng: Rng, t: Template): TrapHand | null {
  for (let i = 0; i < 400; i++) {
    const cards = t.make(rng);
    if (!allDistinct(cards)) continue;
    const pos = positionOfCards(cards);
    if (!t.exp.includes(pos)) continue;
    if (t.check !== undefined && !t.check(cards)) continue;
    const note: TrapNote =
      t.note === 'pairDoesNotPlay'
        ? { key: t.note, rank: rankOf(cards[5] as Card) }
        : { key: t.note };
    return { cards, pos, note };
  }
  return null;
}

/**
 * A trap from `list`, not the one shown last time from it (`last`, an index into `list`):
 * eight tries at random templates. Null if none came out (never seen in practice).
 */
export function pickTemplate(
  rng: Rng,
  list: readonly Template[],
  last: number | null,
): { hand: TrapHand; index: number } | null {
  for (let k = 0; k < 8; k++) {
    let index = int(rng, list.length);
    while (list.length > 1 && index === last) index = int(rng, list.length);
    const hand = runTemplate(rng, list[index] as Template);
    if (hand !== null) return { hand, index };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Matchups: two 5-card hands (Which wins), and a showdown on one table

/** Different hand types, the same type (kickers decide), or a split pot. */
export type MatchKind = 'diff' | 'same' | 'split';

/** For a "different types" pair: the first hand's position, and how often the second is next to it. */
export interface DiffChoice {
  first: Position;
  /** The chance that the second hand is one rung away (a close call). */
  neighbour: number;
}

/** The rung above or below (the ends have one neighbour). */
export function neighbourOf(rng: Rng, p: Position): Position {
  if (p === 10) return 9;
  if (p === 1) return 2;
  return (p + (int(rng, 2) === 1 ? 1 : -1)) as Position;
}

function otherPosition(rng: Rng, p: Position): Position {
  let q = p;
  while (q === p) q = (1 + int(rng, 10)) as Position;
  return q;
}

/** The categories a "same type" pair is dealt from (never two royal flushes: they always tie). */
const SAME_TYPES: readonly Position[] = [2, 3, 4, 5, 6, 7, 8, 9, 10];
/** The hands whose kicker battles are made close (the same top card): flush, two pair, pair, high card. */
const CLOSE_TYPES: readonly Position[] = [5, 8, 9, 10];
/** The categories a split pot is dealt from (straights, pairs and high cards are the usual ones). */
const SPLIT_TYPES: readonly Position[] = [1, 2, 5, 6, 6, 8, 9, 9, 10, 10];

/**
 * Two 5-card hands with no card in common, of the kind asked for.
 * - `same`: one type (not royal), different scores; a flush, two pair, pair or high card is made a
 *   close call (the same top card) with probability `close`.
 * - `split`: the same ranks again in other suits, so the scores tie.
 * - `diff` (also when the others do not come out): `choice()` gives the first position and how
 *   often the second is its neighbour on the ladder.
 */
export function makeVersus(
  rng: Rng,
  kind: MatchKind,
  close: number,
  choice: () => DiffChoice,
): [Card[], Card[]] {
  if (kind === 'same') {
    const pos = pick(rng, SAME_TYPES);
    const tight = CLOSE_TYPES.includes(pos) && unit(rng) < close;
    for (let t = 0; t < 4000; t++) {
      const a = makeHand(rng, pos);
      const b = makeHand(rng, pos);
      if (!disjoint(a, b)) continue;
      const sa = scoreOf(a);
      const sb = scoreOf(b);
      if (sa === sb) continue;
      if (tight && ((sa >> 16) & 15) !== ((sb >> 16) & 15)) continue; // the same top card (§5.2 n0)
      return [a, b];
    }
  }
  if (kind === 'split') {
    const pos = pick(rng, SPLIT_TYPES);
    for (let t = 0; t < 4000; t++) {
      const a = makeHand(rng, pos);
      const suited = pos <= 2 || pos === 5;
      const s2 = otherSuit(rng, suitOf(a[0] as Card));
      const b = a.map((c) => card(rankOf(c), suited ? s2 : anySuit(rng)));
      if (!disjoint(a, b) || !allDistinct(b)) continue;
      if (scoreOf(a) !== scoreOf(b)) continue;
      return [a, shuffle(rng, b)];
    }
  }
  const { first, neighbour } = choice();
  const second = unit(rng) < neighbour ? neighbourOf(rng, first) : otherPosition(rng, first);
  for (;;) {
    const a = makeHand(rng, first);
    for (let i = 0; i < 300; i++) {
      const b = makeHand(rng, second);
      if (disjoint(a, b)) return [a, b];
    }
  }
}

/** A showdown: one table, your two cards and the opponent's. */
export interface ShowdownDeal {
  readonly board: Card[];
  readonly you: Card[];
  readonly opp: Card[];
}

/**
 * Deals from a shuffled deck until the result is of `kind` (3,000 tries, then any different-type
 * result). When both players have only a high card, three deals in four are thrown back: those
 * are the least useful to practise.
 */
export function makeShowdown(rng: Rng, kind: MatchKind): ShowdownDeal {
  let deal: ShowdownDeal | null = null;
  for (let t = 0; t < 3000; t++) {
    const deck = shuffle(rng, newDeck());
    deal = { board: deck.slice(0, 5), you: deck.slice(5, 7), opp: deck.slice(7, 9) };
    const a = scoreOf([...deal.board, ...deal.you]);
    const b = scoreOf([...deal.board, ...deal.opp]);
    const pa = positionOfScore(a);
    const pb = positionOfScore(b);
    const k: MatchKind = a === b ? 'split' : pa === pb ? 'same' : 'diff';
    if (k !== kind) continue;
    if (k !== 'split' && pa === 10 && pb === 10 && int(rng, 4) !== 0) continue;
    return deal;
  }
  return kind === 'diff' && deal !== null ? deal : makeShowdown(rng, 'diff');
}
