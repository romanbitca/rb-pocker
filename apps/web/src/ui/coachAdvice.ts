/**
 * What the coach's advice does to the action bar and the sizing tray (PLAN §10.2, §12.7), without
 * any of its words: the main bundle needs this at once, while the text (`ui/coach.ts`, the F.1
 * templates, the sheet) loads as a lazy chunk (§15.3).
 *
 * The advice is on show at Beginner, and at the other levels after "Hint" (§10.2 "Hint before you
 * act", `LEVEL_RULES`). While it is on show the recommended Row A button has the accent ring and
 * the "Coach" badge, and a bet or raise gives the tray its starting amount and the coach chip
 * (§12.7).
 */
import { LEVEL_RULES, type CoachData } from '../app/store.ts';
import type { Decision } from '../brain/types.ts';

/**
 * How the coach's words are laid out: Beginner's, or the "Hint" levels' (Intermediate, Advanced
 * and Exam: the sheet's "Why" starts with one sentence and "More").
 */
export type CoachUiLevel = 'beginner' | 'intermediate';

export const uiLevel = (level: CoachData['level']): CoachUiLevel =>
  level === 'beginner' ? 'beginner' : 'intermediate';

/** Row A's buttons (§12.7). */
export type BarSlot = 'fold' | 'middle' | 'right';

/** The recommended Row A button for an action (§12.7: the most aggressive on the right). */
export function slotOf(decision: Decision): BarSlot {
  switch (decision.action.type) {
    case 'fold':
      return 'fold';
    case 'check':
    case 'call':
      return 'middle';
    default:
      return 'right';
  }
}

export interface CoachAdvice {
  /** The advice is on show (Beginner, or after "Hint"). */
  readonly shown: boolean;
  /** Row A's recommended button while on show. */
  readonly ring: BarSlot | null;
  /** The coach's bet or raise: its kind and "to" amount, while on show. */
  readonly size: { readonly kind: 'bet' | 'raise'; readonly to: number } | null;
}

const NONE: CoachAdvice = { shown: false, ring: null, size: null };

/** The advice's effect on Row A and the tray for the coach data of this moment. */
export function coachAdvice(data: CoachData): CoachAdvice {
  if (data.state !== 'ready' || data.decision === null) return NONE;
  const shown = LEVEL_RULES[data.level].hint === 'always' || data.opened;
  if (!shown) return NONE;
  const a = data.decision.action;
  return {
    shown,
    ring: slotOf(data.decision),
    size: a.type === 'bet' || a.type === 'raise' ? { kind: a.type, to: a.to } : null,
  };
}
