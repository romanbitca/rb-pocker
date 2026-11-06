/**
 * What the drill shows about a hand once it is answered (PLAN §13.5): its name, the cards that make
 * it and, for two hands, why one wins. Everything comes from the evaluator and `describe()`
 * (§5.3, §5.4), the single source of truth: the drill keeps no hand logic of its own (its old
 * `score5` / `cmp` / `bestOf` survive only as the test oracle, `tests/drill/oracle.ts`).
 *
 * The standalone drill's `keyIdx` (the cards that make the hand) is `describe().core`, and its
 * `whyWins` text is `why()` below: a reason code that `ui/drillText.ts` puts into words
 * (`i18n/drill.ts`), the way the coach's reasons are words only in the UI (§0.3 "Strings").
 */
import type { Card, Rank } from '../core/cards.ts';
import { describe } from '../eval/describe.ts';
import { scoreNibbles } from '../eval/evaluate.ts';
import { positionOf, type Position } from './ladder.ts';

/** One hand as the evaluator sees it. */
export interface HandFacts {
  /** The evaluator's score (§5.2): a higher score wins, equal scores split. */
  readonly score: number;
  readonly pos: Position;
  /** `describe().name` (Appendix F.2): "Two Pair, Kings and Fives". */
  readonly name: string;
  /** The best five cards, the ones that make the hand first, then the kickers (§5.4). */
  readonly best5: readonly Card[];
  /** The cards that make the hand (the old drill's `keyIdx`); the rest of `best5` are kickers. */
  readonly core: readonly Card[];
}

function factsOf(hole: [Card, Card], board: Card[]): HandFacts {
  const info = describe(hole, board);
  return {
    score: info.score,
    pos: positionOf(info.category),
    name: info.name,
    best5: info.best5,
    core: info.core,
  };
}

/** Exactly five cards (all of them play). */
export function facts5(cards: readonly Card[]): HandFacts {
  if (cards.length !== 5) throw new RangeError(`facts5: need 5 cards, got ${cards.length}`);
  return factsOf([cards[0] as Card, cards[1] as Card], cards.slice(2));
}

/** Two cards in the hand and five on the table: the best five of seven. */
export function facts7(hole: readonly Card[], board: readonly Card[]): HandFacts {
  if (hole.length !== 2 || board.length !== 5) {
    throw new RangeError(`facts7: need 2 + 5 cards, got ${hole.length} + ${board.length}`);
  }
  return factsOf([hole[0] as Card, hole[1] as Card], [...board]);
}

/**
 * Why one hand beats another, or why they split (the old drill's `whyWins`):
 * - `rows`: different hands; the higher row wins ("Flush (#5) beats straight (#6).").
 * - `split`: the same score; `sideCards` when the hand has kickers ("…with the same side cards").
 * - `cards`: the same row; the first card that differs decides. `step` is which one, counted as
 *   the evaluator orders them (§5.2: 1 = the main rank, e.g. the pair; 2, 3… the next ones);
 *   `a` beats `b` there; `main` is the winner's main rank ("Same pair of Kings. Kicker…").
 */
export type Why =
  | { readonly kind: 'rows'; readonly winner: Position; readonly loser: Position }
  | {
      readonly kind: 'split';
      readonly pos: Position;
      readonly name: string;
      readonly sideCards: boolean;
    }
  | {
      readonly kind: 'cards';
      readonly pos: Position;
      readonly step: number;
      readonly a: Rank;
      readonly b: Rank;
      readonly main: Rank;
    };

/** The reason for two hands, whichever order they come in. */
export function why(x: HandFacts, y: HandFacts): Why {
  const [w, l] = x.score >= y.score ? [x, y] : [y, x];
  if (w.pos !== l.pos) return { kind: 'rows', winner: w.pos, loser: l.pos };
  const nw = scoreNibbles(w.score);
  const nl = scoreNibbles(l.score);
  const i = nw.findIndex((n, k) => n !== nl[k]);
  if (i < 0) return { kind: 'split', pos: w.pos, name: w.name, sideCards: w.core.length < 5 };
  return {
    kind: 'cards',
    pos: w.pos,
    step: i + 1,
    a: nw[i] as Rank,
    b: nl[i] as Rank,
    main: nw[0],
  };
}
