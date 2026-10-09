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
import type { Decision } from '../brain/types.ts';
import type { HandState, LegalActions, PlayerAction, TableState } from '../engine/types.ts';
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
  const next = coachDataOf(s.game.mode, s.game.hand, s.game.legal, s.coach, s.settings.coachLevel);
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

/** The coach level (Settings): the strip, the sheet, the ring and the rankings tips follow it. */
export const selectCoachLevel = (s: AppState): CoachLevel => s.settings.coachLevel;
