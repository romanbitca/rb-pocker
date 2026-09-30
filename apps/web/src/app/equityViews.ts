/**
 * The HUD numbers as data for the table (PLAN §6, §7.6, §10.2, §13.2): what the win badge, the
 * draw chips, the big-move line, the nuts suffix and the rankings panel's "By river" column show.
 * Data only (numbers, cards, categories, names); `ui/equity.ts` turns it into words. `app` may not
 * import `ui` (§2.1), so the shapes are declared here and the UI reaches them through
 * `app/store.ts`, which re-exports this module.
 *
 * Only the equity jobs (`app/equityJobs.ts`) write the `equity` slice (pitfall 37), which this
 * module reads as it is (`EquitySlice`). Every selector here is memoized on
 * the fields it reads and keeps its old object while its view did not change, so a progress
 * message re-renders the badge and nothing else (seats, board and action bar read the `game`
 * slice only).
 */
import type { DrawKind, EquityResult, HandAnalysis, OutCard } from '../analysis/types.ts';
import { outsChances } from '../analysis/chances.ts';
import { rankOf, suitOf, type Card } from '../core/cards.ts';
import type { HandCategory } from '../eval/evaluate.ts';
import { HAND_CATEGORIES } from '../eval/evaluate.ts';
import type { HandState, TableState } from '../engine/types.ts';
import type { AppState, EquitySlice, EquityStatus } from './store.ts';
import { heroInfo } from './tableViews.ts';
import { describe } from '../eval/describe.ts';

const HERO = 0;

// ---------------------------------------------------------------------------------------------
// The shapes

/** The win badge (§7.6). */
export interface WinBadgeData {
  /** `off`: no badge (no hand, not dealt in, the hand is over, "Show win chance" off, Exam). */
  readonly status: EquityStatus;
  /** Hand, board and live opponents of the estimate: a new key starts the hysteresis over. */
  readonly key: string;
  /** The latest estimate for `key` (progress, then final); null before the first one. */
  readonly result: EquityResult | null;
  /** Live opponents ("vs 3 players"). */
  readonly nOpp: number;
  /** An all-in run-out with the hands face up (§7.2): no random deals, no popover numbers. */
  readonly known: boolean;
}

/** One draw chip (§6.2, §6.3, §6.6, Appendix F.3). Backdoor draws never get a chip. */
export interface DrawChipData {
  readonly kind: Exclude<DrawKind, 'backdoorFlush' | 'backdoorStraight'>;
  readonly outs: number;
  /** The out cards that complete this draw, risky ones marked (§6.4). */
  readonly cards: readonly { readonly card: Card; readonly risky: boolean }[];
  /** Exact chance to hit, 0–100: by the river on the flop, the next card on the turn (§6.6). */
  readonly pct: number;
  readonly when: 'byRiver' | 'nextCard';
}

export interface DrawChipsData {
  readonly handSeq: number;
  /** Flush first, then straight, then overcards (§6.2). */
  readonly draws: readonly DrawChipData[];
  /** Exam shows the draw names only (§10.2). */
  readonly namesOnly: boolean;
}

/** The rankings panel's "By river" column (§6.6, §13.2); null = no column. */
export interface ByRiverData {
  readonly handSeq: number;
  /** % finishing with exactly each category; null until the hand analysis comes. */
  readonly exactly: Readonly<Record<HandCategory, number>> | null;
}

/** The big-move line (§7.6): why the final win chance moved by 8 points or more. */
export type BigMoveData =
  | { readonly key: string; readonly kind: 'fold'; readonly name: string }
  | {
      readonly key: string;
      readonly kind: 'improved';
      readonly card: Card;
      readonly handName: string;
    }
  | {
      readonly key: string;
      readonly kind: 'danger';
      readonly card: Card;
      readonly threat: 'flush' | 'straight' | 'fullHouse';
    }
  | { readonly key: string; readonly kind: 'blank'; readonly card: Card };

// ---------------------------------------------------------------------------------------------
// Builders (pure)

/** §7.6: the final win chance moved by at least this many points between two finals. */
export const BIG_MOVE_POINTS = 8;

const situationKey = (handSeq: number, board: readonly Card[], nOpp: number): string =>
  `${handSeq}|${board.join(',')}|${nOpp}`;

/**
 * The hand is being played (a betting round; not the showdown, where the cards decide) and the
 * hero is in it (dealt in, not folded).
 */
function heroLive(hand: HandState | null): boolean {
  if (hand === null || (hand.phase !== 'betting' && hand.phase !== 'roundComplete')) return false;
  const hero = hand.seats[HERO];
  return hero !== undefined && hero.dealtIn && hero.hole !== null && !hero.folded;
}

/**
 * The badge (§7.6, §10.2): hidden when "Show win chance" is off, at Exam while the hand is played
 * (the hand summary shows it there), and from the showdown on (the result banner speaks then).
 * Known hands (an all-in run-out) show the hero's own run-out number.
 */
export function winBadgeOf(
  eq: EquitySlice,
  showEquity: boolean,
  coachLevel: AppState['settings']['coachLevel'],
  showdown = false,
): WinBadgeData {
  const off: WinBadgeData = { status: 'off', key: '', result: null, nOpp: 0, known: false };
  if (!showEquity || coachLevel === 'exam' || showdown || eq.status === 'off') return off;
  if (eq.status === 'folded') return { ...off, status: 'folded' };
  if (eq.mode === 'known') {
    const k = eq.known;
    const i = k === null ? -1 : k.seats.indexOf(HERO);
    if (k === null || i < 0) return { ...off, status: eq.status, known: true };
    const equity = k.perPlayer[i] ?? 0;
    return {
      status: eq.status,
      key: `${k.handSeq}|known|${k.seats.join(',')}`,
      result: {
        n: 0,
        win: equity,
        split: 0,
        equity,
        exact: k.exact,
        final: k.final,
        truncated: false,
      },
      nOpp: k.seats.length - 1,
      known: true,
    };
  }
  const sit = eq.situation;
  return {
    status: eq.status,
    key: sit === null ? '' : situationKey(sit.handSeq, sit.board, sit.nOpp),
    result: sit === null ? null : eq.result,
    nOpp: sit?.nOpp ?? 0,
    known: false,
  };
}

/**
 * A draw chip's number (§6.6, Appendix C.5), 0–100, exact (`outsChances`, chances.ts): by the
 * river on the flop (`1 − C(47 − outs, 2) / C(47, 2)`), the next card on the turn (`outs / 46`).
 * Never the rule of 2 and 4 (pitfall 12).
 */
export function outsPct(outs: number, boardLength: 3 | 4): number {
  const { nextCardPct, byRiverPct } = outsChances(outs, boardLength);
  return (boardLength === 3 ? byRiverPct : nextCardPct) ?? 0;
}

/**
 * An analysis from an older board: a card it counts as unseen is now on the board or in the hole.
 * (The game and equity slices change in separate writes; this keeps one render from mixing them.)
 */
function stale(analysis: HandAnalysis, seen: readonly Card[]): boolean {
  return analysis.outs.some((o) => seen.includes(o.card));
}

type ChipKind = DrawChipData['kind'];

/**
 * The out cards that complete one draw (§6.2 implementation notes), picked from the worker's outs
 * with no evaluation: a flush draw's are the outs of its suit (the suit with 4 cards, one or more
 * in the hole), a straight draw's the outs whose rank makes a straight (the ranks of `S`: with no
 * straight made yet, every unseen card of such a rank is an out, and those off the flush suit make
 * exactly a straight), two overcards' the outs that pair a hole card. The main thread runs no
 * analysis code (§2.2), and the count must match the worker's own `outs` for the draw.
 */
export function drawCards(
  kind: ChipKind,
  hole: readonly Card[],
  board: readonly Card[],
  outs: readonly OutCard[],
): OutCard[] {
  switch (kind) {
    case 'flush':
    case 'nutFlush': {
      const all = [...hole, ...board];
      const count = (s: number): number => all.filter((c) => suitOf(c) === s).length;
      const suit = [0, 1, 2, 3].find((s) => count(s) === 4 && hole.some((c) => suitOf(c) === s));
      return outs.filter((o) => suitOf(o.card) === suit);
    }
    case 'oesd':
    case 'doubleGutshot':
    case 'gutshot': {
      const ranks = new Set(outs.filter((o) => o.makes === 'straight').map((o) => rankOf(o.card)));
      return outs.filter((o) => ranks.has(rankOf(o.card)));
    }
    case 'overcards': {
      const ranks = new Set(hole.map(rankOf));
      return outs.filter((o) => ranks.has(rankOf(o.card)));
    }
  }
}

/** The draw chips (§6.2, §6.3, §6.6, §10.2): flop and turn only, non-backdoor draws. */
export function drawChipsOf(
  hand: HandState | null,
  analysis: HandAnalysis | null,
  coachLevel: AppState['settings']['coachLevel'],
): DrawChipsData | null {
  if (!heroLive(hand) || hand === null || analysis === null) return null;
  const board = hand.board;
  if (board.length !== 3 && board.length !== 4) return null;
  const hole = hand.seats[HERO]?.hole as [Card, Card];
  if (stale(analysis, [...hole, ...board])) return null;
  const draws: DrawChipData[] = [];
  for (const d of analysis.draws) {
    if (d.kind === 'backdoorFlush' || d.kind === 'backdoorStraight' || d.outs === 0) continue;
    const cards = drawCards(d.kind, hole, board, analysis.outs);
    if (cards.length !== d.outs) return null; // not this hand's analysis
    draws.push({
      kind: d.kind,
      outs: d.outs,
      cards: cards.map((o) => ({ card: o.card, risky: o.risky.length > 0 })),
      pct: outsPct(d.outs, board.length),
      when: board.length === 3 ? 'byRiver' : 'nextCard',
    });
  }
  if (draws.length === 0) return null;
  return { handSeq: hand.handSeq, draws, namesOnly: coachLevel === 'exam' };
}

/**
 * Does the "By river" column show (§13.2, §10.2)? While the hero plays the hand, from the deal to
 * the river, not at Exam, and not in an all-in run-out (the run-out shows the equity bars, §7.6).
 */
export function byRiverShown(
  hand: HandState | null,
  coachLevel: AppState['settings']['coachLevel'],
): boolean {
  return coachLevel !== 'exam' && heroLive(hand) && hand !== null && !hand.runout;
}

/** The hero's `nuts` from the hand analysis (§6.5): " · Best possible hand". */
export function nutsOf(hand: HandState | null, analysis: HandAnalysis | null): boolean {
  if (!heroLive(hand) || hand === null || analysis === null || !analysis.nuts) return false;
  const hole = hand.seats[HERO]?.hole as [Card, Card];
  return hand.board.length >= 3 && !stale(analysis, [...hole, ...hand.board]);
}

/** Four board ranks inside one 5-rank window (the Ace low and high): one card makes a straight. */
function fourToStraight(board: readonly Card[]): boolean {
  let ranks = 0;
  for (const c of board) ranks |= 1 << rankOf(c);
  // Position 0 = the Ace below the Two, 1..13 = Two..Ace.
  const bits = (ranks << 1) | ((ranks >> 12) & 1);
  for (let low = 0; low + 5 <= 14; low++) {
    let n = 0;
    for (let p = low; p < low + 5; p++) if ((bits >> p) & 1) n++;
    if (n >= 4) return true;
  }
  return false;
}

/** The EQ_DANGER threats (Appendix F.3) the board shows, strongest first. */
export function boardThreats(board: readonly Card[]): ('fullHouse' | 'flush' | 'straight')[] {
  const threats: ('fullHouse' | 'flush' | 'straight')[] = [];
  const ranks = new Set(board.map(rankOf));
  if (ranks.size < board.length) threats.push('fullHouse');
  const suits = [0, 0, 0, 0];
  for (const c of board) suits[suitOf(c)]!++;
  if (suits.some((n) => n >= 3)) threats.push('flush');
  if (fourToStraight(board)) threats.push('straight');
  return threats;
}

/**
 * The §7.6 big-move line, when the final win chance moved by `BIG_MOVE_POINTS` or more since the
 * previous final of the hand:
 * - the same board and exactly one opponent fewer (and the number went up) → EQ_FOLD, naming the
 *   last bot that folded;
 * - one new card (turn or river): up with a better hand category → EQ_IMPROVED; down with a new
 *   threat on the board (paired → a full house, 3 of a suit → a flush, 4 to a straight → a
 *   straight; the strongest new one) → EQ_DANGER; down otherwise → EQ_BLANK_DROP.
 * Anything else (the flop's three cards, two folds at once, both a card and a fold) has no line.
 */
export function bigMoveOf(
  eq: EquitySlice,
  hand: HandState | null,
  table: TableState | null,
): BigMoveData | null {
  const { situation: sit, result, previous: prev } = eq;
  if (eq.mode !== 'random' || sit === null || result === null || prev === null) return null;
  if (!result.final || hand === null || hand.handSeq !== sit.handSeq || !heroLive(hand)) {
    return null;
  }
  const delta = 100 * (result.equity - prev.equity);
  if (Math.abs(delta) < BIG_MOVE_POINTS) return null;
  const key = situationKey(sit.handSeq, sit.board, sit.nOpp);
  const sameBoard =
    sit.board.length === prev.board.length && sit.board.every((c, i) => c === prev.board[i]);
  if (sameBoard) {
    if (prev.nOpp - sit.nOpp !== 1 || delta < 0) return null;
    for (let i = hand.log.length - 1; i >= 0; i--) {
      const e = hand.log[i];
      if (e?.e === 'act' && e.action.type === 'fold' && e.seat !== HERO) {
        return { key, kind: 'fold', name: table?.slots[e.seat]?.name ?? '' };
      }
    }
    return null;
  }
  if (sit.nOpp !== prev.nOpp || sit.board.length !== prev.board.length + 1) return null;
  if (!prev.board.every((c, i) => c === sit.board[i])) return null;
  const card = sit.board[sit.board.length - 1] as Card;
  const hole = hand.seats[HERO]?.hole as [Card, Card];
  const before = describe(hole, [...prev.board]);
  const now = heroInfo(hand) ?? describe(hole, [...sit.board]);
  const improved = HAND_CATEGORIES.indexOf(now.category) > HAND_CATEGORIES.indexOf(before.category);
  if (delta > 0) return improved ? { key, kind: 'improved', card, handName: now.name } : null;
  const old = boardThreats(prev.board);
  const threat = boardThreats(sit.board).find((t) => !old.includes(t));
  if (threat !== undefined) return { key, kind: 'danger', card, threat };
  return improved ? null : { key, kind: 'blank', card };
}

// ---------------------------------------------------------------------------------------------
// Memoized selectors

/** A one-slot cache: the last result for the same inputs (compared with `===`). */
function memo<A extends readonly unknown[], R>(f: (...args: A) => R): (...args: A) => R {
  let last: { args: A; result: R } | null = null;
  return (...args: A): R => {
    if (last !== null && last.args.every((x, i) => x === args[i])) return last.result;
    const result = f(...args);
    last = { args, result };
    return result;
  };
}

const sameBadge = (a: WinBadgeData, b: WinBadgeData): boolean =>
  a.status === b.status &&
  a.key === b.key &&
  a.result === b.result &&
  a.nOpp === b.nOpp &&
  a.known === b.known;

let lastBadge: WinBadgeData | null = null;
const badgeMemo = memo(
  (
    slice: EquitySlice,
    showEquity: boolean,
    coachLevel: AppState['settings']['coachLevel'],
    showdown: boolean,
  ): WinBadgeData => {
    const badge = winBadgeOf(slice, showEquity, coachLevel, showdown);
    // A slice write that changes nothing the badge shows keeps the old object: no render.
    if (lastBadge === null || !sameBadge(lastBadge, badge)) lastBadge = badge;
    return lastBadge;
  },
);
/** The win badge. Changes only with the equity slice, two settings and the showdown. */
export const selectWinBadge = (s: AppState): WinBadgeData => {
  const phase = s.game.hand?.phase;
  const showdown = phase === 'showdown' || phase === 'complete';
  return badgeMemo(s.equity, s.settings.showEquity, s.settings.coachLevel, showdown);
};

const analysisOf = (s: AppState): HandAnalysis | null => s.equity.analysis;

let drawsHand: HandState | null = null;
const drawsMemo = memo(
  (
    _key: string,
    analysis: HandAnalysis | null,
    coachLevel: AppState['settings']['coachLevel'],
  ): DrawChipsData | null => drawChipsOf(drawsHand, analysis, coachLevel),
);
/**
 * The draw chips; null = none. Memoized on the hand's cards (`_key`), not on the hand state, so a
 * bet does not re-render them.
 */
export const selectDrawChips = (s: AppState): DrawChipsData | null => {
  const hand = s.game.hand;
  drawsHand = hand;
  const key = heroLive(hand) && hand !== null ? `${hand.handSeq}|${hand.board.join(',')}` : '';
  return drawsMemo(key, analysisOf(s), s.settings.coachLevel);
};

/** The `exactly` numbers of the §6.6 chances. */
function exactlyOf(chances: HandAnalysis['chances']): Record<HandCategory, number> | null {
  if (chances === null) return null;
  const out = {} as Record<HandCategory, number>;
  for (const k of HAND_CATEGORIES) out[k] = chances[k].exactly;
  return out;
}

const byRiverMemo = memo(
  (shown: boolean, handSeq: number, analysis: HandAnalysis | null): ByRiverData | null =>
    shown ? { handSeq, exactly: exactlyOf(analysis?.chances ?? null) } : null,
);
/**
 * The "By river" column; null = no column. Memoized on primitives and the analysis, so a bot's
 * action (a new hand state) does not re-render the rankings panel.
 */
export const selectByRiver = (s: AppState): ByRiverData | null => {
  const hand = s.game.hand;
  const shown = byRiverShown(hand, s.settings.coachLevel);
  return byRiverMemo(shown, hand?.handSeq ?? -1, shown ? analysisOf(s) : null);
};

/** " · Best possible hand" after the sub-label (§6.1, §6.5). */
export const selectNuts = (s: AppState): boolean => nutsOf(s.game.hand, analysisOf(s));

let lastMove: BigMoveData | null = null;
const moveMemo = memo(
  (slice: EquitySlice, hand: HandState | null, table: TableState | null): BigMoveData | null => {
    const move = bigMoveOf(slice, hand, table);
    // Same move, same object: the line's 4 s run once per move.
    if (move !== null && lastMove !== null && move.key === lastMove.key) return lastMove;
    lastMove = move;
    return move;
  },
);
/** The big-move line; null = none (also when the badge is hidden: it explains the badge). */
export const selectBigMove = (s: AppState): BigMoveData | null =>
  !s.settings.showEquity || s.settings.coachLevel === 'exam'
    ? null
    : moveMemo(s.equity, s.game.hand, s.game.table);
