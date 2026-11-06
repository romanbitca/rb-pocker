/**
 * The drill's games, difficulty and questions (PLAN §13.5), ported from the owner's standalone
 * Hand Drill with its weights unchanged. A question carries everything the page shows after the
 * answer (the evaluator's facts, the reason a hand wins), so judging an answer needs no more
 * hand logic. Pure: the randomness is the `Rng` passed in.
 */
import type { Card } from '../core/cards.ts';
import type { Rng } from '../core/rng.ts';
import type { HandCategory } from '../eval/evaluate.ts';
import {
  makeHand,
  makeHoldem,
  makeShowdown,
  makeVersus,
  neighbourOf,
  pickTemplate,
  TRAPS_5,
  TRAPS_7,
  type MatchKind,
  type TrapNote,
} from './deal.ts';
import { facts5, facts7, why, type HandFacts, type Why } from './explain.ts';
import { categoryAt, POSITIONS, type Position } from './ladder.ts';
import { int, pickShare, shuffle, unit } from './random.ts';

// ---------------------------------------------------------------------------------------------
// Games and difficulty

export type GameId =
  'mixed' | 'cards' | 'holdem' | 'showdown' | 'versus' | 'order' | 'pos2name' | 'name2pos';

/** In the order the game list shows them. */
export const GAME_IDS: readonly GameId[] = [
  'mixed',
  'cards',
  'holdem',
  'showdown',
  'versus',
  'order',
  'pos2name',
  'name2pos',
];

export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

/** How often Name the hand and Hold'em deal a trap hand. */
export const TRAP_RATE: Readonly<Record<Difficulty, { cards: number; holdem: number }>> = {
  easy: { cards: 0, holdem: 0 },
  normal: { cards: 0.45, holdem: 0.5 },
  hard: { cards: 0.8, holdem: 0.85 },
};

/** Which wins: the shares of different types, the same type (kickers) and split pots. */
export const VERSUS_KINDS: Readonly<Record<Difficulty, readonly [number, number, number]>> = {
  easy: [0.85, 0.15, 0],
  normal: [0.45, 0.4, 0.15],
  hard: [0.2, 0.55, 0.25],
};

/** Showdown: the same three shares. */
export const SHOWDOWN_KINDS: Readonly<Record<Difficulty, readonly [number, number, number]>> = {
  easy: [0.7, 0.27, 0.03],
  normal: [0.35, 0.45, 0.2],
  hard: [0.15, 0.6, 0.25],
};

/** How often the second hand of a pair (or the second name) is the next rung: a close call. */
export const NEIGHBOUR_RATE: Readonly<Record<Difficulty, number>> = {
  easy: 0.15,
  normal: 0.45,
  hard: 0.75,
};

/** How often a same-type flush, two pair, pair or high card shares its top card. */
export const CLOSE_RATE: Readonly<Record<Difficulty, number>> = {
  easy: 0.5,
  normal: 0.5,
  hard: 0.75,
};

const KINDS: readonly MatchKind[] = ['diff', 'same', 'split'];

/** The question types of one game; Mixed deals all of them, with these shares. */
export type QuestionType =
  'cards' | 'holdem' | 'showdown' | 'versus' | 'hl' | 'above' | 'below' | 'pos2name' | 'name2pos';

const MIXED: readonly (readonly [Exclude<GameId, 'mixed'>, number])[] = [
  ['cards', 0.2],
  ['holdem', 0.22],
  ['showdown', 0.2],
  ['versus', 0.14],
  ['order', 0.1],
  ['pos2name', 0.07],
  ['name2pos', 0.07],
];

/** The game of the next question: the chosen one, or one of Mixed's by its share. */
export function gameFor(rng: Rng, game: GameId): Exclude<GameId, 'mixed'> {
  if (game !== 'mixed') return game;
  const i = pickShare(
    rng,
    MIXED.map(([, share]) => share),
  );
  return (MIXED[i] as (typeof MIXED)[number])[0];
}

// ---------------------------------------------------------------------------------------------
// Missed hands come up more often

/** How often a hand was asked and missed (the stats sheet's numbers). */
export interface HandStats {
  readonly seen: number;
  readonly missed: number;
}

export type HandsStats = Readonly<Record<HandCategory, HandStats>>;

/**
 * A hand's weight when a position is picked: 1 + 3 · (missed + 0.3) / (seen + 1). A hand never
 * seen weighs 1.9; one always missed tends to 4; one never missed tends to 1.
 */
export function missWeight(s: HandStats): number {
  return 1 + (3 * (s.missed + 0.3)) / (s.seen + 1);
}

/** The ten weights, strongest first; `avoid` (the last position asked) counts 0.15 of its weight. */
export function positionWeights(hands: HandsStats, avoid: Position | null = null): number[] {
  return POSITIONS.map((p) => missWeight(hands[categoryAt(p)]) * (p === avoid ? 0.15 : 1));
}

/** A position picked in proportion to its weight. */
export function weightedPosition(
  rng: Rng,
  hands: HandsStats,
  avoid: Position | null = null,
): Position {
  const weights = positionWeights(hands, avoid);
  let t = unit(rng) * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) {
    t -= weights[i] as number;
    if (t <= 0) return POSITIONS[i] as Position;
  }
  return 10;
}

// ---------------------------------------------------------------------------------------------
// Questions

/** The two players of a showdown, the two hands of Which wins, and a tie. */
export type ShowdownAnswer = 'you' | 'opp' | 'split';
export type VersusAnswer = 'a' | 'b' | 'tie';

export type Question =
  /** Name the hand: five cards; pick the name and the position. */
  | {
      readonly type: 'cards';
      readonly cards: readonly Card[];
      readonly hand: HandFacts;
      readonly trap: TrapNote | null;
    }
  /** Hold'em: five on the table, two in your hand; the best five of seven. */
  | {
      readonly type: 'holdem';
      readonly board: readonly Card[];
      readonly hole: readonly Card[];
      readonly hand: HandFacts;
      readonly trap: TrapNote | null;
    }
  /** Showdown: one table, you and an opponent. `hands` = [yours, theirs]. */
  | {
      readonly type: 'showdown';
      readonly board: readonly Card[];
      readonly you: readonly Card[];
      readonly opp: readonly Card[];
      readonly hands: readonly [HandFacts, HandFacts];
      readonly answer: ShowdownAnswer;
      readonly why: Why;
    }
  /** Which wins: hand A against hand B. */
  | {
      readonly type: 'versus';
      readonly cards: readonly [readonly Card[], readonly Card[]];
      readonly hands: readonly [HandFacts, HandFacts];
      readonly answer: VersusAnswer;
      readonly why: Why;
    }
  /** Higher or lower: which of two names ranks higher (`options` in the order shown). */
  | {
      readonly type: 'hl';
      readonly key: string;
      readonly options: readonly [Position, Position];
      readonly answer: Position;
    }
  /** Higher or lower: the hand one step above (stronger) or below (weaker) `target`. */
  | {
      readonly type: 'above' | 'below';
      readonly key: string;
      readonly target: Position;
      readonly answer: Position;
    }
  /** Position to hand: see a number, pick the name. */
  | { readonly type: 'pos2name'; readonly key: string; readonly pos: Position }
  /** Hand to position: see a name, pick the number. */
  | { readonly type: 'name2pos'; readonly key: string; readonly pos: Position };

/** What a question needs from the player: one or two pickers, or one of its options. */
export function needsName(q: Question): boolean {
  return (
    q.type === 'cards' ||
    q.type === 'holdem' ||
    q.type === 'above' ||
    q.type === 'below' ||
    q.type === 'pos2name'
  );
}

export function needsPosition(q: Question): boolean {
  return q.type === 'cards' || q.type === 'holdem' || q.type === 'name2pos';
}

/** The answer options of an option question, in the order shown (keys 1, 2, 3); [] otherwise. */
export function optionsOf(q: Question): readonly string[] {
  if (q.type === 'showdown') return ['you', 'opp', 'split'];
  if (q.type === 'versus') return ['a', 'b', 'tie'];
  if (q.type === 'hl') return q.options.map(String);
  return [];
}

/** The right name (as its position) of a name question, else null. */
export function rightName(q: Question): Position | null {
  switch (q.type) {
    case 'cards':
    case 'holdem':
      return q.hand.pos;
    case 'above':
    case 'below':
      return q.answer;
    case 'pos2name':
      return q.pos;
    default:
      return null;
  }
}

/** The right position of a position question, else null. */
export function rightPosition(q: Question): Position | null {
  switch (q.type) {
    case 'cards':
    case 'holdem':
      return q.hand.pos;
    case 'name2pos':
      return q.pos;
    default:
      return null;
  }
}

/** The right option of an option question, else null. */
export function rightOption(q: Question): string | null {
  if (q.type === 'showdown' || q.type === 'versus') return q.answer;
  if (q.type === 'hl') return String(q.answer);
  return null;
}

/** The player's choices so far. */
export interface Picks {
  readonly name: Position | null;
  readonly position: Position | null;
  readonly option: string | null;
}

export const NO_PICKS: Picks = { name: null, position: null, option: null };

/** Every needed choice is made. */
export function complete(q: Question, picks: Picks): boolean {
  if (optionsOf(q).length > 0) return picks.option !== null;
  return (!needsName(q) || picks.name !== null) && (!needsPosition(q) || picks.position !== null);
}

/** Right when every needed choice is right. */
export function isRight(q: Question, picks: Picks): boolean {
  if (optionsOf(q).length > 0) return picks.option === rightOption(q);
  return (
    (!needsName(q) || picks.name === rightName(q)) &&
    (!needsPosition(q) || picks.position === rightPosition(q))
  );
}

/**
 * The hands an answer counts for in the stats: each hand shown, so two hands of one type count
 * twice; a step question counts for the hand it names.
 */
export function counted(q: Question): Position[] {
  switch (q.type) {
    case 'cards':
    case 'holdem':
      return [q.hand.pos];
    case 'showdown':
    case 'versus':
      return [q.hands[0].pos, q.hands[1].pos];
    case 'hl':
      return [...q.options];
    case 'above':
    case 'below':
      return [q.target];
    case 'pos2name':
    case 'name2pos':
      return [q.pos];
  }
}

/** The hands the All hands drawer marks "This round" once a question is answered. */
export function involved(q: Question): Position[] {
  return q.type === 'above' || q.type === 'below' ? [q.target, q.answer] : counted(q);
}

/** The position a question asked about (asked less often next time), if it has one. */
export function askedPosition(q: Question): Position | null {
  if (q.type === 'cards' || q.type === 'holdem') return q.hand.pos;
  if (q.type === 'pos2name' || q.type === 'name2pos') return q.pos;
  return null;
}

/** A question's repeat key (the order and position games); null for dealt cards. */
export function keyOf(q: Question): string | null {
  return 'key' in q ? q.key : null;
}

/** What building a question needs besides the random stream. */
export interface BuildContext {
  readonly difficulty: Difficulty;
  readonly hands: HandsStats;
  /** The position asked last (asked less often next). */
  readonly last: Position | null;
  /** The trap templates shown last, by list (not shown twice in a row). */
  readonly lastTrap: { readonly five: number | null; readonly seven: number | null };
}

/** A new question, and the trap template it used (to avoid it next time). */
export interface Built {
  readonly question: Question;
  readonly trap: { readonly list: 'five' | 'seven'; readonly index: number } | null;
}

const otherThan = (rng: Rng, p: Position): Position => {
  let q = p;
  while (q === p) q = (1 + int(rng, 10)) as Position;
  return q;
};

/** One question of `game` (a game id other than Mixed). */
export function buildQuestion(rng: Rng, game: Exclude<GameId, 'mixed'>, ctx: BuildContext): Built {
  const d = ctx.difficulty;
  const weighted = (avoid: Position | null = null) => weightedPosition(rng, ctx.hands, avoid);

  if (game === 'cards') {
    if (unit(rng) < TRAP_RATE[d].cards) {
      const t = pickTemplate(rng, TRAPS_5, ctx.lastTrap.five);
      if (t !== null) {
        const cards = shuffle(rng, [...t.hand.cards]);
        return {
          question: { type: 'cards', cards, hand: facts5(cards), trap: t.hand.note },
          trap: { list: 'five', index: t.index },
        };
      }
    }
    const cards = makeHand(rng, weighted(ctx.last));
    return { question: { type: 'cards', cards, hand: facts5(cards), trap: null }, trap: null };
  }

  if (game === 'holdem') {
    let seven: Card[] | null = null;
    let trap: TrapNote | null = null;
    let used: Built['trap'] = null;
    if (unit(rng) < TRAP_RATE[d].holdem) {
      const t = pickTemplate(rng, TRAPS_7, ctx.lastTrap.seven);
      if (t !== null) {
        seven = t.hand.cards;
        trap = t.hand.note;
        used = { list: 'seven', index: t.index };
      }
    }
    seven ??= makeHoldem(rng, weighted(ctx.last));
    const board = shuffle(rng, seven.slice(0, 5));
    const hole = shuffle(rng, seven.slice(5));
    return {
      question: { type: 'holdem', board, hole, hand: facts7(hole, board), trap },
      trap: used,
    };
  }

  if (game === 'showdown') {
    const kind = KINDS[pickShare(rng, SHOWDOWN_KINDS[d])] as MatchKind;
    const { board, you, opp } = makeShowdown(rng, kind);
    const mine = facts7(you, board);
    const theirs = facts7(opp, board);
    const answer: ShowdownAnswer =
      mine.score > theirs.score ? 'you' : mine.score < theirs.score ? 'opp' : 'split';
    return {
      question: {
        type: 'showdown',
        board,
        you,
        opp,
        hands: [mine, theirs],
        answer,
        why: why(mine, theirs),
      },
      trap: null,
    };
  }

  if (game === 'versus') {
    const kind = KINDS[pickShare(rng, VERSUS_KINDS[d])] as MatchKind;
    let [a, b] = makeVersus(rng, kind, CLOSE_RATE[d], () => ({
      first: weighted(),
      neighbour: NEIGHBOUR_RATE[d],
    }));
    if (int(rng, 2) === 1) [a, b] = [b, a];
    const fa = facts5(a);
    const fb = facts5(b);
    const answer: VersusAnswer = fa.score > fb.score ? 'a' : fa.score < fb.score ? 'b' : 'tie';
    return {
      question: { type: 'versus', cards: [a, b], hands: [fa, fb], answer, why: why(fa, fb) },
      trap: null,
    };
  }

  if (game === 'order') {
    const x = unit(rng);
    if (x < 0.5) {
      const p1 = weighted();
      const p2 = unit(rng) < NEIGHBOUR_RATE[d] ? neighbourOf(rng, p1) : otherThan(rng, p1);
      const options = shuffle(rng, [p1, p2]) as [Position, Position];
      const hi = Math.min(p1, p2) as Position;
      const lo = Math.max(p1, p2);
      return { question: { type: 'hl', key: `hl${hi}-${lo}`, options, answer: hi }, trap: null };
    }
    const above = x < 0.75;
    let target = weighted();
    while (above ? target === 1 : target === 10) target = weighted();
    const answer = (above ? target - 1 : target + 1) as Position;
    return {
      question: {
        type: above ? 'above' : 'below',
        key: `${above ? 'ab' : 'be'}${target}`,
        target,
        answer,
      },
      trap: null,
    };
  }

  const pos = weighted(ctx.last);
  if (game === 'pos2name')
    return { question: { type: 'pos2name', key: `pn${pos}`, pos }, trap: null };
  return { question: { type: 'name2pos', key: `np${pos}`, pos }, trap: null };
}
