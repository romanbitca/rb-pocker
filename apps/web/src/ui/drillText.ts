/**
 * The hand drill's lines (PLAN §13.5): the prompt and hint of a question, and the two lines of its
 * answer. Pure, so it is tested without a DOM. The words are `i18n/drill.ts`; the ten hand names
 * and tips the rankings panel's (`data/rankings.ts`); card ranks `core/cards.ts`'s words; a hand's
 * own name `describe()`'s (it arrives in the question). `ui` may not run `drill/` (§2.1), so the
 * right answer is read from the question's own fields here.
 */
import { RANK_NAMES, RANK_PLURALS, type Rank } from '../core/cards.ts';
import { RANKINGS } from '../data/rankings.ts';
import type { TrapNote } from '../drill/deal.ts';
import type { Why } from '../drill/explain.ts';
import type { Position } from '../drill/ladder.ts';
import type { Picks, Question, QuestionType } from '../drill/questions.ts';
import { drillWords as W } from '../i18n/drill.ts';

/** A hand's name on the ladder: "Two pair". */
export const nameAt = (p: Position): string => RANKINGS[p - 1]?.name ?? '';
/** A hand's one-line tip (§13.2). */
export const tipAt = (p: Position): string => RANKINGS[p - 1]?.tip ?? '';

const one = (r: Rank): string => RANK_NAMES[r] ?? '';
const many = (r: Rank): string => RANK_PLURALS[r] ?? '';

/** The answer's two lines: `first` says right or wrong, `second` explains. */
export interface AnswerLines {
  readonly first: string;
  readonly second: string;
  /** The answer was a trap hand: the first line gets the "Trap" tag. */
  readonly trap: boolean;
}

export const promptOf = (q: Question): string => W.prompts[q.type as QuestionType];
export const hintOf = (q: Question): string => W.hints[q.type as QuestionType];

/** A trap's note. */
export function trapText(note: TrapNote): string {
  if (note.key === 'pairDoesNotPlay') return W.traps.pairDoesNotPlay(many(note.rank ?? 0));
  return W.traps[note.key];
}

/** Why one hand beats the other, or why they split (`drill/explain.ts` `Why`). */
export function whyText(why: Why): string {
  const y = W.why;
  if (why.kind === 'rows') {
    return y.rows(nameAt(why.winner), why.winner, nameAt(why.loser), why.loser);
  }
  if (why.kind === 'split') return y.split(why.name, why.sideCards);
  const { pos, step, a, b, main } = why;
  switch (pos) {
    case 2:
    case 6:
      return y.straight(pos === 2, one(a), one(b), b === 3);
    case 3:
      return step === 1 ? y.quads(many(a), many(b)) : y.quadsKicker(many(main), one(a), one(b));
    case 4:
      return step === 1
        ? y.fullHouse(many(a), many(b))
        : y.fullHousePair(many(main), many(a), many(b));
    case 7:
      return step === 1
        ? y.trips(many(a), many(b))
        : y.tripsKicker(many(main), step > 2, one(a), one(b));
    case 8:
      if (step === 1) return y.twoPair(many(a), many(b));
      return step === 2
        ? y.twoPairSecond(many(main), many(a), many(b))
        : y.twoPairKicker(one(a), one(b));
    case 9:
      return step === 1
        ? y.pair(many(a), many(b))
        : y.pairKicker(many(main), step > 2, one(a), one(b));
    default:
      // Flush (5) and high card (10): card by card from the top. (Two royal flushes always split.)
      return step === 1
        ? y.topCard(pos === 5, one(a), one(b))
        : y.nthCard(pos === 5, step, one(a), one(b));
  }
}

const join = (...parts: (string | false | null)[]): string => parts.filter(Boolean).join(' ');

/** Name the hand and Hold'em: the hand, then what the player said, then why. */
function cardLines(
  q: Extract<Question, { type: 'cards' | 'holdem' }>,
  picks: Picks,
  ok: boolean,
): AnswerLines {
  const A = W.answer;
  const { pos, name } = q.hand;
  const said = picks.name ?? pos;
  const at = picks.position ?? pos;
  const nameOk = said === pos;
  const posOk = at === pos;
  const detail = ok
    ? null
    : !nameOk && !posOk
      ? A.youSaid(nameAt(said), at)
      : !nameOk
        ? A.nameWrong(nameAt(said))
        : A.positionWrong(at);
  // Hold'em: your cards in the best five, kickers too (the Table's rule, §5.4 `holeUsed`).
  const uses = q.type === 'holdem' ? A.uses(q.hand.holeUsed) : null;
  return {
    first: ok ? A.right(nameAt(pos), pos) : A.itIs(nameAt(pos), pos),
    second: join(detail, `${name}.`, uses, q.trap !== null ? trapText(q.trap) : tipAt(pos)),
    trap: q.trap !== null,
  };
}

/** The two lines of an answered question. */
export function answerLines(q: Question, picks: Picks, ok: boolean): AnswerLines {
  const A = W.answer;
  switch (q.type) {
    case 'cards':
    case 'holdem':
      return cardLines(q, picks, ok);
    case 'pos2name':
    case 'name2pos': {
      const name = nameAt(q.pos);
      const detail = ok
        ? null
        : q.type === 'pos2name'
          ? A.pickedName(nameAt(picks.name ?? q.pos), picks.name ?? q.pos)
          : A.pickedPosition(picks.position ?? q.pos, nameAt(picks.position ?? q.pos));
      return {
        first: ok ? A.rightIsAt(name, q.pos) : A.isAt(name, q.pos),
        second: join(detail, tipAt(q.pos)),
        trap: false,
      };
    }
    case 'above':
    case 'below': {
      const target = nameAt(q.target);
      const name = nameAt(q.answer);
      const right = q.type === 'above' ? A.rightAbove(name, target) : A.rightBelow(name, target);
      const picked = picks.name ?? q.answer;
      return {
        first: ok ? right : A.itsName(name),
        second: join(
          A.both(target, q.target, name, q.answer),
          !ok && A.youPicked(nameAt(picked), picked),
        ),
        trap: false,
      };
    }
    case 'hl': {
      const [p1, p2] = q.options;
      const w = Math.min(p1, p2) as Position;
      const l = Math.max(p1, p2) as Position;
      return {
        first: ok ? A.rightRanksHigher(nameAt(w)) : A.ranksHigher(nameAt(w)),
        second: A.twoPositions(nameAt(w), w, nameAt(l), l),
        trap: false,
      };
    }
    case 'versus': {
      const result = q.answer === 'tie' ? A.splitPot : A.handWins(q.answer === 'a' ? 'A' : 'B');
      return { first: ok ? A.correct(result) : result, second: whyText(q.why), trap: false };
    }
    case 'showdown': {
      const result =
        q.answer === 'split' ? A.splitPot : q.answer === 'you' ? A.youWin : A.opponentWins;
      return { first: ok ? A.correct(result) : result, second: whyText(q.why), trap: false };
    }
  }
}

/** The label of an option button. */
export function optionLabel(q: Question, id: string): string {
  if (q.type === 'hl') return nameAt(Number(id) as Position);
  return (W.options as Readonly<Record<string, string>>)[id] ?? id;
}
