/**
 * The words of the mistake feedback card (PLAN §12.6, Appendix F.4, F.5): its title, its reason
 * and the coach's move, from the store's `FeedbackView`. The reason is a chunk 5.6 line (the F.5
 * templates in `en.coach.templates`, rendered by `i18n/coach.ts`); the coach's move uses the
 * action bar's words and the player's amount unit ("Call 40", "Raise to 6 BB").
 */
import type { FeedbackView, MoveView } from '../app/store.ts';
import type { Line } from '../brain/explain.ts';
import { lineText } from '../i18n/coach.ts';
import { en } from '../i18n/en.ts';
import { formatAmount } from './actionBar.ts';

type AmountUnit = 'chips' | 'bb';

/** A move as the action bar names it: "Fold", "Check", "Call 40", "Raise to 120", "All-in 2,340". */
export function moveText(move: MoveView, unit: AmountUnit): string {
  const amount = (): string => formatAmount(move.amount ?? 0, move.bb, unit);
  switch (move.kind) {
    case 'fold':
      return en.actions.fold;
    case 'check':
      return en.actions.check;
    case 'call':
      return en.actions.call(amount());
    case 'callAllIn':
      return en.actions.callAllIn(amount());
    case 'bet':
      return en.actions.betTo(amount());
    case 'raise':
      return en.actions.raiseTo(amount());
    case 'allIn':
      return en.actions.allIn(amount());
  }
}

/** F.5's fallback row: "The coach's move wins more chips here: {alt}." */
export function fallbackLine(move: MoveView, unit: AmountUnit): Line {
  return {
    key: 'feedback.fallback',
    params: { alt: { kind: 'name', text: moveText(move, unit) } },
    glossary: [],
  };
}

/** Everything the card says. */
export interface FeedbackTexts {
  title: string;
  reason: string;
  coachMove: string;
}

export function feedbackTexts(view: FeedbackView, unit: AmountUnit): FeedbackTexts {
  return {
    title: en.feedback.title[view.grade],
    reason: lineText(view.reason ?? fallbackLine(view.coachMove, unit)),
    coachMove: en.feedback.coachMove(moveText(view.coachMove, unit)),
  };
}
