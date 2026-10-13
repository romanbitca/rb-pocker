/**
 * The coach's selectors (PLAN §10.2, §12.6): what the coach strip, the sheet and the action bar's
 * recommendation read from the store. Like `tableViews.ts`, the shapes are plain data for the UI
 * (`ui/coach.ts` builds the text); `app/store.ts` re-exports this module.
 *
 * - `coachKeyOf(hand)` names one hero decision: the hand and how far its log has gone. A hint
 *   (the `coach` slice, written by the controller's `HintJobs`) belongs to the decision of its key, so a reply
 *   that lands late, or a hint from before an action, is never shown for another decision.
 * - `selectCoach`: the strip's state for the hero's decision (pending, ready, failed) or, while
 *   someone else acts, 'waiting' (the strip narrates the last action, `selectNarration`).
 *
 * Every selector is memoized on the fields it reads and returns the same object while its view
 * is unchanged, so an equity write never re-renders the coach (pitfall 37).
 */
import type { Explanation } from '../brain/explain.ts';
import type { Decision, Grade } from '../brain/types.ts';
import type { HandState, LegalActions, PlayerAction, TableState } from '../engine/types.ts';
import { chipShows } from './levels.ts';
import {
  quizQuestions,
  quizScore,
  rightAnswers,
  type QuizQuestion,
  type QuizScore,
} from './quiz.ts';
import type { AppState, CoachSlice, ControllerMode } from './store.ts';

const HERO = 0;

type CoachLevel = AppState['settings']['coachLevel'];

/** One hero decision: the hand, and how far its log has gone (an action or a street moves it). */
export function coachKeyOf(hand: HandState): string {
  return `${hand.handSeq}:${hand.log.length}`;
}

/** The decision the hero has to make now, or null when it is not the hero's turn. */
export function heroDecisionKey(
  mode: ControllerMode,
  hand: HandState | null,
  legal: LegalActions | null,
): string | null {
  return mode === 'heroTurn' && hand !== null && legal !== null && hand.toAct === HERO
    ? coachKeyOf(hand)
    : null;
}

/**
 * What the coach strip shows (§12.6):
 * - 'off': no hand on the table, or it is over;
 * - 'waiting': someone else acts (or the cards are being dealt): the last action is narrated;
 * - 'pending': the hero's turn, the hint is on its way ("Coach is thinking…", a disabled "Hint");
 * - 'ready': the hero's turn, and `decision` is the coach's advice for it;
 * - 'failed': the coach could not answer (§12.11 "Coach is not available. Tap to try again.").
 */
export type CoachState = 'off' | 'waiting' | 'pending' | 'ready' | 'failed';

export interface CoachData {
  readonly level: CoachLevel;
  readonly state: CoachState;
  /** The hero decision's key ('pending', 'ready', 'failed'); null otherwise. */
  readonly key: string | null;
  /** The advice ('ready' only). */
  readonly decision: Decision | null;
  /** `explain()` of the advice (chunk 5.6), from the worker ('ready' only). */
  readonly explanation: Explanation | null;
  /** The player opened this decision's hint ("Hint", §10.2); a Beginner's is always on show. */
  readonly opened: boolean;
}

/** The last action of the current street, for the strip's narration ("Ben raises to 60."). */
export interface NarrationData {
  /** `handSeq:log index`: a new action is a new line. */
  readonly key: string;
  /** The hero's own action: "You call 40." */
  readonly hero: boolean;
  readonly name: string;
  readonly type: 'fold' | 'check' | 'call' | 'bet' | 'raise';
  /** bet / raise: the "to" amount; call: the chips the call put in; 0 for fold and check. */
  readonly amount: number;
  /** The action put the last chips in. */
  readonly allIn: boolean;
}

// ---------------------------------------------------------------------------------------------
// Builders (pure)

export function coachDataOf(
  mode: ControllerMode,
  hand: HandState | null,
  legal: LegalActions | null,
  coach: CoachSlice,
  level: CoachLevel,
): CoachData {
  const off = (state: CoachState): CoachData => ({
    level,
    state,
    key: null,
    decision: null,
    explanation: null,
    opened: false,
  });
  if (hand === null || hand.phase === 'complete') return off('off');
  const key = heroDecisionKey(mode, hand, legal);
  if (key === null) return off('waiting');
  const opened = coach.opened === key;
  if (coach.key !== key || coach.status === 'idle') {
    return { level, state: 'pending', key, decision: null, explanation: null, opened };
  }
  if (coach.status === 'failed' || coach.decision === null || coach.explanation === null) {
    return { level, state: 'failed', key, decision: null, explanation: null, opened };
  }
  return {
    level,
    state: 'ready',
    key,
    decision: coach.decision,
    explanation: coach.explanation,
    opened,
  };
}

/** The narration of `hand`'s last action on its current street; null when there is none yet. */
export function narrationOf(
  hand: HandState,
  table: TableState,
  heroName: string,
): NarrationData | null {
  for (let i = hand.log.length - 1; i >= 0; i--) {
    const e = hand.log[i];
    if (e === undefined) continue;
    // A new street (or the reveal) ends the search: the last street's actions are old news.
    if (e.e === 'street' || e.e === 'reveal') return null;
    if (e.e !== 'act' || e.street !== hand.street) continue;
    const a: PlayerAction = e.action;
    const amount =
      a.type === 'bet' || a.type === 'raise' ? a.to : a.type === 'call' ? e.amountIn : 0;
    return {
      key: `${hand.handSeq}:${i}`,
      hero: e.seat === HERO,
      name: e.seat === HERO ? heroName : (table.slots[e.seat]?.name ?? ''),
      type: a.type,
      amount,
      allIn: e.allIn,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Selectors (memoized)

const sameData = (a: CoachData, b: CoachData): boolean =>
  a.level === b.level &&
  a.state === b.state &&
  a.key === b.key &&
  a.decision === b.decision &&
  a.opened === b.opened;

let lastCoach: CoachData | null = null;

/** The strip's state; the same object while nothing it shows has changed. */
export const selectCoach = (s: AppState): CoachData => {
  const next = coachDataOf(s.game.mode, s.game.hand, s.game.legal, s.coach, levelInForce(s));
  if (lastCoach !== null && sameData(lastCoach, next)) return lastCoach;
  lastCoach = next;
  return next;
};

const sameNarration = (a: NarrationData | null, b: NarrationData | null): boolean =>
  a === b || (a !== null && b !== null && a.key === b.key && a.name === b.name);

let lastNarration: NarrationData | null = null;

/** The strip's narration while others act; null when there is nothing to say. */
export const selectNarration = (s: AppState): NarrationData | null => {
  const { hand, table } = s.game;
  const next =
    hand === null || table === null || hand.phase === 'complete'
      ? null
      : narrationOf(hand, table, table.slots[HERO]?.name ?? '');
  if (sameNarration(lastNarration, next)) return lastNarration;
  lastNarration = next;
  return next;
};

/**
 * The coach level in force (§10, chunk 6.4): the hero's current (or latest) decision's, fixed when
 * that decision started; before the hero's first decision of a hand, the settings' level.
 */
export function levelInForce(s: Pick<AppState, 'game' | 'settings'>): CoachLevel {
  return s.game.coachLevel ?? s.settings.coachLevel;
}

/** The coach level in force: the strip, the sheet, the ring, the HUD and the rankings follow it. */
export const selectCoachLevel = (s: AppState): CoachLevel => levelInForce(s);

// ---------------------------------------------------------------------------------------------
// The Advanced quiz (§10.3)

/** The quiz of the hero's decision while it shows (Advanced, the hint ready, not skipped). */
export interface QuizData {
  readonly key: string;
  readonly questions: readonly QuizQuestion[];
  /** The answers so far, one per question in order. */
  readonly answers: readonly number[];
  /** Every question answered: the result shows until the hero acts, and the action bar works. */
  readonly done: boolean;
  /** Each question's right answers (two for the move in a Close spot). */
  readonly right: readonly (readonly number[])[];
  readonly score: QuizScore;
}

/** The quiz of the hero's current decision, or null (none, skipped, or not Advanced). */
export function quizDataOf(s: Pick<AppState, 'game' | 'coach' | 'settings'>): QuizData | null {
  const key = heroDecisionKey(s.game.mode, s.game.hand, s.game.legal);
  const { coach } = s;
  const quiz = coach.quiz;
  if (
    key === null ||
    levelInForce(s) !== 'advanced' ||
    quiz === null ||
    quiz.key !== key ||
    quiz.skipped ||
    coach.key !== key ||
    coach.status !== 'ready' ||
    coach.decision === null
  ) {
    return null;
  }
  const decision = coach.decision;
  const questions = quizQuestions(decision);
  return {
    key,
    questions,
    answers: quiz.answers,
    done: quiz.answers.length >= questions.length,
    right: questions.map((q) => rightAnswers(decision, q)),
    score: quizScore(decision, quiz.answers),
  };
}

let lastQuiz: QuizData | null = null;
/** The quiz as the coach's places show it; the same object while its answers are unchanged. */
export const selectQuiz = (s: AppState): QuizData | null => {
  const next = quizDataOf(s);
  if (next === null) return (lastQuiz = null);
  if (lastQuiz !== null && lastQuiz.key === next.key && lastQuiz.answers === next.answers) {
    return lastQuiz;
  }
  return (lastQuiz = next);
};

/** The quiz asks: Row A waits for the answers or "Skip" (§10.3). */
export const selectQuizAsking = (s: AppState): boolean => {
  const quiz = selectQuiz(s);
  return quiz !== null && !quiz.done;
};

/**
 * The win badge hides for the quiz (§10.3): from the start of a decision that rolled a quiz at
 * Advanced until its answers are in, or it is skipped (or the coach failed: no quiz then).
 */
export function quizHidesBadge(s: Pick<AppState, 'game' | 'coach' | 'settings'>): boolean {
  const key = heroDecisionKey(s.game.mode, s.game.hand, s.game.legal);
  const quiz = s.coach.quiz;
  if (key === null || quiz === null || quiz.key !== key || quiz.skipped) return false;
  if (levelInForce(s) !== 'advanced') return false;
  if (s.coach.key !== key) return true; // the hint is on its way: the quiz may start
  if (s.coach.status !== 'ready' || s.coach.decision === null) return s.coach.status !== 'failed';
  return quiz.answers.length < quizQuestions(s.coach.decision).length;
}

// ---------------------------------------------------------------------------------------------
// Grade chips (§10.2, §12.6)

/** The grade chip of the decision graded last, while the level shows it. */
export interface GradeChipData {
  /** `handSeq:record count`: a new record is a new chip. */
  readonly key: string;
  readonly grade: Grade;
}

let lastChip: GradeChipData | null = null;
/**
 * The newest decision record's grade chip (§12.6 "After the hero acts"), or null: none yet, it
 * was taken back with Undo, grading failed, or the level does not show this grade (Beginner: every
 * decision; Intermediate: Inaccuracy or worse; Advanced: Mistake or worse; Exam: none during the
 * hand). The strip shows it for 1.5 s after it arrives, also when it arrives late (§11.3 r5).
 */
export const selectGradeChip = (s: AppState): GradeChipData | null => {
  const { hand, decisions } = s.game;
  const last = decisions[decisions.length - 1];
  if (hand === null || last === undefined || last.undone || last.grade === null) return null;
  if (!chipShows(levelInForce(s), last.grade)) return null;
  const key = `${hand.handSeq}:${decisions.length}`;
  if (lastChip !== null && lastChip.key === key && lastChip.grade === last.grade) return lastChip;
  return (lastChip = { key, grade: last.grade });
};
