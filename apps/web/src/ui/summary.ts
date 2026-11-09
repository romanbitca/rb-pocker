/**
 * The end-of-hand summary's view (PLAN §10.2, §12.9, §14.4; chunk 6.4): from the hand that just
 * ended and its decision records (A.7), the rows the sheet lists and, at Exam, the score, and each
 * row's words (`rowDid`, `rowNotes`). Pure. Review shows the same rows on the hero's steps (§12.10,
 * 1.3.101). The main bundle only decides whether the hand has a summary (the controller,
 * `summaryShows`: the banner's button, 1.3.92); this file loads with the two lazy screens.
 */
import { decisionScore, LEVEL_RULES, summaryShows, type AppState } from '../app/store.ts';
import type { Grade } from '../brain/types.ts';
import type { CoachLevel, PlayerAction, Street } from '../engine/types.ts';
import { summaryWords as W } from '../i18n/summary.ts';
import type { DecisionRecord } from '../persist/schema.ts';
import { percentText } from './equity.ts';

/** One hero decision of the hand, as the summary lists it. */
export interface SummaryRow {
  readonly decisionId: number;
  readonly street: Street;
  readonly taken: PlayerAction;
  /** The coach's move (the grade's recommendation). */
  readonly rec: PlayerAction;
  readonly grade: Grade | null;
  /** The HUD win chance when the hero acted, and the price (null with nothing to call). */
  readonly eRandom: number | null;
  readonly need: number | null;
  /**
   * The numbers the hint and the grade compared (`DecisionRecord.eRange`, `.R`): the hint's
   * "likely hands" number (§8.10's range number) and the call's realisation; null without them
   * (no grade, nothing to call, an older record).
   */
  readonly eRange: number | null;
  readonly R: number | null;
  /**
   * Whom `eRange` counts (`DecisionRecord.callers`, `.players`; QA-2 of 6 Nov 2026, item 3): the
   * raiser and `callers` callers already in when that is fewer than the `players` live opponents
   * the HUD's number counts; null or absent: every live opponent (or an older record).
   */
  readonly callers?: number | null;
  readonly players?: number | null;
  /**
   * The "to" of the hero's all-in bet or raise at the decision, and whether a call put the hero
   * all-in (`DecisionRecord.allInTo`, `.callAllIn`; QA-2 item 6): the row says "All-in 200" as the
   * action bar does. Absent in older records.
   */
  readonly allInTo?: number | null;
  readonly callAllIn?: boolean;
  /** Taken back with Undo (it still counts, §11.4). */
  readonly undone: boolean;
}

/** A move at the row's decision is an all-in: a bet or raise to the whole stack, or such a call. */
export function isAllInMove(row: SummaryRow, a: PlayerAction): boolean {
  if (a.type === 'call') return row.callAllIn === true;
  if (a.type === 'bet' || a.type === 'raise') return row.allInTo != null && a.to === row.allInTo;
  return false;
}

/**
 * The numbers of a row (§12.9; QA-1 of 6 Nov 2026), as fractions, each honest about the grade:
 * - `none`: no HUD number; `win`: "You had 45%." (nothing to call, or a price no number can
 *   explain);
 * - `price`: "You had 45%, needed 25%.", the HUD's number when it tells the grade's story;
 * - `likely`: the HUD's number and the grade's `eRange` labelled ("Any cards: 45%. Their likely
 *   hands: about 20%, needed 30%."), when they differ as §8.10's RANGE_ADJUST rule says (5 points,
 *   or the price between the two whole numbers), or when only the grade's number agrees; `whom`
 *   when the two count different players ("All 3 players: 34%. Raiser alone: about 56%, …");
 * - `later` (with `price` or `likely`): the realised `eRange × R` ("Counting later bets: about
 *   26%.") when only it explains a fold the price alone would not (the sheet's price bar, §12.6).
 * A comparison that would argue against the coach's move (a call at a price the numbers beat,
 * graded worse than the fold; or the reverse) is never shown: the price is left out instead.
 */
export type RowNumbers =
  | { readonly kind: 'none' }
  | { readonly kind: 'win'; readonly win: number }
  | {
      readonly kind: 'price';
      readonly win: number;
      readonly need: number;
      readonly later: number | null;
    }
  | {
      readonly kind: 'likelyOnly';
      readonly win: number;
      readonly likely: number;
      readonly whom: Whom | null;
    }
  | {
      readonly kind: 'likely';
      readonly win: number;
      readonly likely: number;
      readonly need: number;
      readonly later: number | null;
      readonly whom: Whom | null;
    };

/**
 * Whom the two numbers count when they count different players (§8.10): the HUD's every one of
 * `players` live opponents, the likely-hands number the raiser and `callers` callers already in.
 */
export interface Whom {
  readonly players: number;
  readonly callers: number;
}

/** The row's `Whom`, or null when both numbers count every live opponent (or it is not known). */
function whomOf(row: SummaryRow): Whom | null {
  const { callers, players } = row;
  return callers == null || players == null ? null : { players, callers };
}

/** A fraction as the whole number the summary shows (the HUD's rounding). */
const whole = (x: number): number => Math.round(100 * x);

/** §8.10 RANGE_ADJUST's rule: 5 points apart, or the price strictly between the whole numbers. */
function differ(win: number, likely: number, need: number): boolean {
  if (Math.abs(likely - win) >= 0.05 - 1e-9) return true;
  const a = whole(win);
  const b = whole(likely);
  return Math.min(a, b) < 100 * need && 100 * need < Math.max(a, b);
}

/** The numbers a summary row shows (see `RowNumbers`). */
export function rowNumbers(row: SummaryRow): RowNumbers {
  const { eRandom: win, need, eRange: likely, R } = row;
  if (win === null) return { kind: 'none' };
  if (need === null) return { kind: 'win', win };
  // What the coach's move says about the price: call (or raise) when it pays, fold when not.
  const fold = row.rec.type === 'fold';
  const agrees = (x: number): boolean => (fold ? whole(x) < whole(need) : whole(x) >= whole(need));
  if (likely === null)
    return agrees(win) ? { kind: 'price', win, need, later: null } : { kind: 'win', win };
  const labelled = differ(win, likely, need) || (!agrees(win) && agrees(likely));
  const shown = labelled ? likely : win;
  let later: number | null = null;
  if (!agrees(shown)) {
    // A fold the price alone would pay: later bets decided it (§8.5 R, §8.3 R), as the sheet's bar.
    const realised = R === null ? null : likely * R;
    if (!fold || realised === null || !agrees(realised)) {
      return labelled
        ? { kind: 'likelyOnly', win, likely, whom: whomOf(row) }
        : { kind: 'win', win };
    }
    later = realised;
  }
  return labelled
    ? { kind: 'likely', win, likely, need, later, whom: whomOf(row) }
    : { kind: 'price', win, need, later };
}

export interface SummaryData {
  readonly handSeq: number;
  /** "Hand 12" (the top bar's number). */
  readonly handNumber: number;
  /** The hero's chips won or lost this hand. */
  readonly net: number;
  readonly bb: number;
  /** Exam: the "Exam result", with the score. */
  readonly exam: boolean;
  readonly rows: readonly SummaryRow[];
  /** The decision score of the hand (§14.4), Exam only; null when nothing was graded. */
  readonly score: number | null;
}

/** The hero's seat (§0.3). */
const HERO = 0;

/** A decision record (A.7) as a row (the hand summary's, and Review's, §12.10). */
export function rowOf(d: DecisionRecord): SummaryRow {
  return {
    decisionId: d.decisionId,
    street: d.street,
    taken: d.taken,
    rec: d.rec,
    grade: d.grade,
    eRandom: d.eRandom,
    need: d.need,
    eRange: d.eRange ?? null,
    R: d.R ?? null,
    callers: d.callers ?? null,
    players: d.players ?? null,
    allInTo: d.allInTo ?? null,
    callAllIn: d.callAllIn ?? false,
    undone: d.undone,
  };
}

/**
 * The summary of the hand that just ended, at the coach level in force (the hand's latest
 * decision's, §10), or null when there is none to show.
 */
export function summaryOf(game: AppState['game'], level: CoachLevel): SummaryData | null {
  const { mode, hand, table, decisions } = game;
  if (mode !== 'handEnd' || hand === null || hand.phase !== 'complete' || table === null) {
    return null;
  }
  const grades = decisions.map((d) => d.grade);
  if (!summaryShows(level, grades)) return null;
  const exam = LEVEL_RULES[level].exam;
  return {
    handSeq: hand.handSeq,
    handNumber: table.handsDealt + 1,
    net: hand.result?.net[HERO] ?? 0,
    bb: hand.bb,
    exam,
    rows: decisions.map(rowOf),
    score: exam ? decisionScore(grades) : null,
  };
}

// ---------------------------------------------------------------------------------------------
// A row in words (§12.9): the sheet's and Review's

const sameMove = (a: PlayerAction, b: PlayerAction): boolean =>
  a.type === b.type &&
  (a.type === 'bet' || a.type === 'raise' ? a.to === (b as { to: number }).to : true);

/** The words for each move: "You called" (`did`), "Coach: Call" (`coach`), "Calling" (`doing`)… */
type MoveWords = typeof W.did | typeof W.coach | typeof W.doing | typeof W.coachDoing;

/**
 * A move of the row in one of the word sets; an all-in says so, as the action bar does ("All-in
 * 200", "Call all-in"; QA-2 of 6 Nov 2026, item 6).
 */
function moveText(
  row: SummaryRow,
  a: PlayerAction,
  words: MoveWords,
  money: (x: number) => string,
): string {
  const allIn = isAllInMove(row, a);
  switch (a.type) {
    case 'fold':
    case 'check':
      return words[a.type];
    case 'call':
      return allIn ? words.callAllIn : words.call;
    case 'bet':
      return allIn ? words.allIn(money(a.to)) : words.bet(money(a.to));
    case 'raise':
      return allIn ? words.allIn(money(a.to)) : words.raise(money(a.to));
  }
}

/** The row's first line after the street: "You called", "You went all-in for 200". */
export function rowDid(row: SummaryRow, money: (x: number) => string): string {
  return moveText(row, row.taken, W.did, money);
}

/** The numbers of a row in words (`rowNumbers`: the ones that tell the grade's story). */
function numbersText(row: SummaryRow): string | null {
  const pct = (x: number): string => percentText(100 * x);
  const n = rowNumbers(row);
  const later = (x: number | null): string => (x === null ? '' : ` ${W.later(pct(x))}`);
  switch (n.kind) {
    case 'none':
      return null;
    case 'win':
      return W.win(pct(n.win));
    case 'price':
      return W.numbers(pct(n.win), pct(n.need)) + later(n.later);
    case 'likelyOnly':
      return n.whom === null
        ? W.likelyOnly(pct(n.win), pct(n.likely))
        : W.whomOnly(W.whom(n.whom.players, pct(n.win), n.whom.callers, pct(n.likely)));
    case 'likely':
      return (
        (n.whom === null
          ? W.likely(pct(n.win), pct(n.likely), pct(n.need))
          : W.whomPrice(
              W.whom(n.whom.players, pct(n.win), n.whom.callers, pct(n.likely)),
              pct(n.need),
            )) + later(n.later)
      );
  }
}

const isPassive = (a: PlayerAction): boolean => a.type === 'check' || a.type === 'call';
const isAggressive = (a: PlayerAction): boolean => a.type === 'bet' || a.type === 'raise';

/**
 * The second line of a row: the coach's move when it was another, then the numbers. A Best grade
 * for another move says it was as good ("Calling was as good as folding here."), never "Best move"
 * next to a bare "Coach: Fold" (§8.9: the close alternative, or a loss of at most 1% of the pot).
 * A check or a call graded Slightly off or worse where the coach bet or raised says the coach's
 * move wins more ("Raising to 2,100 wins more here."; §8.9 "value missed", QA-2 item 1).
 */
export function rowNotes(row: SummaryRow, money: (x: number) => string): string {
  const notes: string[] = [];
  if (!sameMove(row.taken, row.rec)) {
    if (row.grade === 'best') {
      notes.push(
        W.asGood(
          moveText(row, row.taken, W.doing, money),
          moveText(row, row.rec, W.coachDoing, money),
        ),
      );
    } else if (
      row.grade !== null &&
      row.grade !== 'good' &&
      isPassive(row.taken) &&
      isAggressive(row.rec)
    ) {
      notes.push(W.winsMore(moveText(row, row.rec, W.doing, money)));
    } else {
      notes.push(moveText(row, row.rec, W.coach, money));
    }
  }
  const numbers = numbersText(row);
  if (numbers !== null) notes.push(numbers);
  return notes.join(' · ');
}
