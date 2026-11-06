// PLAN §13.5: every game of the hand drill makes valid questions whose right answer RB's
// evaluator confirms (and the standalone drill's own scoring, the oracle, agrees), every trap
// template makes the hand it claims, and the difficulty sets how often traps, kicker battles and
// split pots come up, with the standalone drill's weights.
import { describe, expect, it } from 'vitest';
import { isCard, parseCards, rankOf, type Card } from '../../src/core/cards.ts';
import { deriveSeed, rngFromSeed, ZERO_SEED, type Rng } from '../../src/core/rng.ts';
import { emptyHands } from '../../src/drill/data.ts';
import { runTemplate, TRAPS_5, TRAPS_7, type Template } from '../../src/drill/deal.ts';
import { facts5 } from '../../src/drill/explain.ts';
import { positionOfScore, type Position } from '../../src/drill/ladder.ts';
import {
  buildQuestion,
  CLOSE_RATE,
  complete,
  counted,
  DIFFICULTIES,
  gameFor,
  GAME_IDS,
  involved,
  isRight,
  NEIGHBOUR_RATE,
  NO_PICKS,
  optionsOf,
  rightName,
  rightOption,
  rightPosition,
  SHOWDOWN_KINDS,
  TRAP_RATE,
  VERSUS_KINDS,
  type BuildContext,
  type Difficulty,
  type GameId,
  type Question,
} from '../../src/drill/questions.ts';
import { score7 } from '../../src/eval/evaluate.ts';
import { testSeed } from '../helpers/seed.ts';
import { bestOf, cmp, score5 } from './oracle.ts';

const seedFor = (label: string) => testSeed(deriveSeed(ZERO_SEED, `test|drill|${label}`));
const rngFor = (label: string): Rng => rngFromSeed(seedFor(label));

const ctx = (difficulty: Difficulty): BuildContext => ({
  difficulty,
  hands: emptyHands(),
  last: null,
  lastTrap: { five: null, seven: null },
});

const ALL_TRAPS: readonly Template[] = [...TRAPS_5, ...TRAPS_7];
const trapExp = (key: string): readonly Position[] =>
  ALL_TRAPS.find((t) => t.note === key)?.exp ?? [];

const distinct = (cards: readonly Card[]): boolean =>
  cards.every(isCard) && new Set(cards).size === cards.length;
const sign = (x: number): number => (x > 0 ? 1 : x < 0 ? -1 : 0);
const isPos = (p: number): boolean => Number.isInteger(p) && p >= 1 && p <= 10;

/** Every check a question of any type must pass; returns problems as text. */
function problems(q: Question): string[] {
  const out: string[] = [];
  const want = (ok: boolean, what: string) => {
    if (!ok) out.push(`${q.type}: ${what}`);
  };
  switch (q.type) {
    case 'cards': {
      want(q.cards.length === 5 && distinct(q.cards), 'five distinct cards');
      const score = score7(q.cards, 5);
      want(q.hand.score === score, 'the score is the evaluator’s');
      want(q.hand.pos === positionOfScore(score), 'the position is the evaluator’s');
      want(score5(q.cards)[0] === q.hand.pos, 'the oracle agrees');
      want(
        q.hand.core.every((c) => q.cards.includes(c)),
        'the core is in the hand',
      );
      want(
        new Set(q.hand.best5).size === 5 && q.hand.best5.every((c) => q.cards.includes(c)),
        'best five',
      );
      if (q.trap)
        want(trapExp(q.trap.key).includes(q.hand.pos), `trap ${q.trap.key} made its hand`);
      break;
    }
    case 'holdem': {
      const seven = [...q.board, ...q.hole];
      want(q.board.length === 5 && q.hole.length === 2 && distinct(seven), 'seven distinct cards');
      const score = score7(seven, 7);
      want(q.hand.score === score && q.hand.pos === positionOfScore(score), 'the evaluator');
      want(bestOf(seven).score[0] === q.hand.pos, 'the oracle agrees');
      want(
        q.hand.best5.every((c) => seven.includes(c)),
        'the best five are among the seven',
      );
      want(
        q.hand.core.every((c) => q.hand.best5.includes(c)),
        'the core is in the best five',
      );
      if (q.trap)
        want(trapExp(q.trap.key).includes(q.hand.pos), `trap ${q.trap.key} made its hand`);
      break;
    }
    case 'showdown': {
      const nine = [...q.board, ...q.you, ...q.opp];
      want(q.board.length === 5 && q.you.length === 2 && q.opp.length === 2, 'card counts');
      want(distinct(nine), 'nine distinct cards');
      const a = score7([...q.board, ...q.you], 7);
      const b = score7([...q.board, ...q.opp], 7);
      want(q.hands[0].score === a && q.hands[1].score === b, 'scores');
      const answer = a > b ? 'you' : a < b ? 'opp' : 'split';
      want(q.answer === answer, `the answer is ${answer}`);
      const oracle = sign(
        cmp(bestOf([...q.board, ...q.you]).score, bestOf([...q.board, ...q.opp]).score),
      );
      want(oracle === sign(a - b), 'the oracle agrees');
      break;
    }
    case 'versus': {
      const [a, b] = q.cards;
      want(
        a.length === 5 && b.length === 5 && distinct([...a, ...b]),
        'two disjoint hands of five',
      );
      const sa = score7(a, 5);
      const sb = score7(b, 5);
      want(q.hands[0].score === sa && q.hands[1].score === sb, 'scores');
      want(q.answer === (sa > sb ? 'a' : sa < sb ? 'b' : 'tie'), 'the answer');
      want(sign(cmp(score5(a), score5(b))) === sign(sa - sb), 'the oracle agrees');
      break;
    }
    case 'hl': {
      const [p1, p2] = q.options;
      want(isPos(p1) && isPos(p2) && p1 !== p2, 'two different positions');
      want(q.answer === Math.min(p1, p2), 'the higher row wins');
      break;
    }
    case 'above':
    case 'below':
      want(isPos(q.target) && isPos(q.answer), 'positions');
      want(q.answer === (q.type === 'above' ? q.target - 1 : q.target + 1), 'one step');
      break;
    case 'pos2name':
    case 'name2pos':
      want(isPos(q.pos), 'a position');
      break;
  }
  return out;
}

/** The right picks for a question (what a player who knows the answer taps). */
function rightPicks(q: Question) {
  return {
    name: rightName(q),
    position: rightPosition(q),
    option: rightOption(q),
  };
}

describe('hand drill questions', () => {
  it(
    'every game and difficulty makes valid questions the evaluator confirms',
    { timeout: 60_000 },
    () => {
      const all: string[] = [];
      for (const game of GAME_IDS) {
        for (const difficulty of DIFFICULTIES) {
          const rng = rngFor(`${game}-${difficulty}`);
          const types = new Set<string>();
          for (let i = 0; i < 200; i++) {
            const { question } = buildQuestion(rng, gameFor(rng, game), ctx(difficulty));
            types.add(question.type);
            all.push(...problems(question));
            // The right picks are complete and right; a wrong pick is wrong.
            const picks = rightPicks(question);
            expect(complete(question, picks)).toBe(true);
            expect(isRight(question, picks)).toBe(true);
            expect(complete(question, NO_PICKS)).toBe(false);
            // Every hand the answer counts is a position, and the drawer marks at least those.
            for (const p of counted(question)) expect(involved(question)).toContain(p);
          }
          if (game === 'mixed') expect(types.size, `${difficulty}: Mixed deals every type`).toBe(9);
          if (game === 'order') expect([...types].sort()).toEqual(['above', 'below', 'hl']);
        }
      }
      expect(all.slice(0, 10)).toEqual([]);
    },
  );

  it('a wrong name, position or option is judged wrong', () => {
    const rng = rngFor('wrong');
    for (const game of GAME_IDS.filter((g): g is Exclude<GameId, 'mixed'> => g !== 'mixed')) {
      for (let i = 0; i < 30; i++) {
        const { question } = buildQuestion(rng, game, ctx('normal'));
        const right = rightPicks(question);
        const options = optionsOf(question);
        if (options.length > 0) {
          for (const id of options) {
            expect(isRight(question, { ...NO_PICKS, option: id })).toBe(id === right.option);
          }
          continue;
        }
        const otherName = (((right.name ?? 1) % 10) + 1) as Position;
        const otherPos = (((right.position ?? 1) % 10) + 1) as Position;
        if (right.name !== null)
          expect(isRight(question, { ...right, name: otherName })).toBe(false);
        if (right.position !== null) {
          expect(isRight(question, { ...right, position: otherPos })).toBe(false);
        }
      }
    }
  });

  it('every trap template makes the hand it claims, again and again', { timeout: 30_000 }, () => {
    const rng = rngFor('templates');
    for (const t of ALL_TRAPS) {
      for (let i = 0; i < 40; i++) {
        const made = runTemplate(rng, t);
        expect(made, t.note).not.toBeNull();
        if (made === null) continue;
        expect(t.exp, t.note).toContain(made.pos);
        expect(distinct(made.cards), t.note).toBe(true);
        expect(made.cards).toHaveLength(TRAPS_5.includes(t) ? 5 : 7);
        expect(positionOfScore(score7(made.cards, made.cards.length))).toBe(made.pos);
        if (t.check) expect(t.check(made.cards), t.note).toBe(true);
        if (t.note === 'pairDoesNotPlay') {
          // The player's own pair: both hole cards, the rank the note names.
          expect(made.note.rank).toBe(rankOf(made.cards[5] as Card));
          expect(rankOf(made.cards[6] as Card)).toBe(made.note.rank);
        }
      }
    }
  });

  it('describes a 5-card hand with the cards that make it first (the old keyIdx)', () => {
    // Pair of Kings with A, 9, 4: the core is the two Kings, the kickers the rest.
    const hand = parseCards('Kc Ah 9c Kh 4h');
    const facts = facts5(hand);
    expect(facts.pos).toBe(9);
    expect(facts.name).toBe('Pair of Kings');
    expect([...facts.core].sort()).toEqual(parseCards('Kc Kh').sort());
    expect(facts.best5.slice(2)).toEqual(parseCards('Ah 9c 4h'));
  });
});

describe('hand drill difficulty (the standalone drill’s weights)', () => {
  it('keeps the weights of the standalone drill', () => {
    expect(TRAP_RATE).toEqual({
      easy: { cards: 0, holdem: 0 },
      normal: { cards: 0.45, holdem: 0.5 },
      hard: { cards: 0.8, holdem: 0.85 },
    });
    expect(VERSUS_KINDS).toEqual({
      easy: [0.85, 0.15, 0],
      normal: [0.45, 0.4, 0.15],
      hard: [0.2, 0.55, 0.25],
    });
    expect(SHOWDOWN_KINDS).toEqual({
      easy: [0.7, 0.27, 0.03],
      normal: [0.35, 0.45, 0.2],
      hard: [0.15, 0.6, 0.25],
    });
    expect(NEIGHBOUR_RATE).toEqual({ easy: 0.15, normal: 0.45, hard: 0.75 });
    expect(CLOSE_RATE).toEqual({ easy: 0.5, normal: 0.5, hard: 0.75 });
  });

  /** The share of `n` questions of `game` for which `pick` says yes. */
  function share(
    game: Exclude<GameId, 'mixed'>,
    difficulty: Difficulty,
    n: number,
    pick: (q: Question) => boolean,
  ) {
    const rng = rngFor(`share-${game}-${difficulty}`);
    let yes = 0;
    for (let i = 0; i < n; i++) if (pick(buildQuestion(rng, game, ctx(difficulty)).question)) yes++;
    return yes / n;
  }
  const trap = (q: Question) => (q.type === 'cards' || q.type === 'holdem') && q.trap !== null;

  it(
    'deals traps as often as the difficulty says (Name the hand, Hold’em)',
    { timeout: 60_000 },
    () => {
      for (const d of DIFFICULTIES) {
        expect(share('cards', d, 1500, trap), `cards ${d}`).toBeCloseTo(TRAP_RATE[d].cards, 1);
        expect(share('holdem', d, 1500, trap), `holdem ${d}`).toBeCloseTo(TRAP_RATE[d].holdem, 1);
      }
      expect(share('cards', 'easy', 500, trap)).toBe(0);
    },
  );

  /** A pair's kind: a split pot, the same hand type (the kickers decide), or different types. */
  function kind(q: Question): 'diff' | 'same' | 'split' {
    if (q.type !== 'versus' && q.type !== 'showdown') throw new Error(q.type);
    if (q.hands[0].score === q.hands[1].score) return 'split';
    return q.hands[0].pos === q.hands[1].pos ? 'same' : 'diff';
  }

  it(
    'deals kicker battles and split pots as often as the difficulty says',
    { timeout: 120_000 },
    () => {
      for (const d of DIFFICULTIES) {
        for (const [game, weights] of [
          ['versus', VERSUS_KINDS[d]],
          ['showdown', SHOWDOWN_KINDS[d]],
        ] as const) {
          const n = 1200;
          const rng = rngFor(`kinds-${game}-${d}`);
          const counts = { diff: 0, same: 0, split: 0 };
          for (let i = 0; i < n; i++) counts[kind(buildQuestion(rng, game, ctx(d)).question)]++;
          // Within 4 points of the weight (1,200 draws: a standard error of at most 1.5 points).
          expect(Math.abs(counts.diff / n - weights[0]), `${game} ${d} diff`).toBeLessThan(0.04);
          expect(Math.abs(counts.same / n - weights[1]), `${game} ${d} same`).toBeLessThan(0.04);
          expect(Math.abs(counts.split / n - weights[2]), `${game} ${d} split`).toBeLessThan(0.04);
        }
      }
    },
  );

  it(
    'makes close kicker battles (the same top card) more often at Hard',
    { timeout: 60_000 },
    () => {
      const close = (d: Difficulty) => {
        const rng = rngFor(`close-${d}`);
        let same = 0;
        let tight = 0;
        while (same < 600) {
          const q = buildQuestion(rng, 'versus', ctx(d)).question;
          if (q.type !== 'versus' || kind(q) !== 'same' || ![5, 8, 9, 10].includes(q.hands[0].pos))
            continue;
          same++;
          if (((q.hands[0].score >> 16) & 15) === ((q.hands[1].score >> 16) & 15)) tight++;
        }
        return tight / same;
      };
      expect(close('hard')).toBeGreaterThan(close('normal') + 0.1);
    },
  );
});
