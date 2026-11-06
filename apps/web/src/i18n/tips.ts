/**
 * The first-table tips (PLAN §12.11, Appendix F.10; chunk 9.3), word for word. They load with the
 * Table's chunk (`ui/components/TipBubble.tsx`), never with the first screen.
 */
import type { TipId } from '../app/store.ts';

export const tipWords: Readonly<Record<TipId, string>> = {
  heroStrip: 'This is your hand. We show what you have and your chance to win.',
  coachStrip: 'Your coach. It tells you what to do, and why.',
  undo: 'Changed your mind? Undo takes back your last move.',
  handsTab: 'All poker hands, best to worst. Yours is highlighted.',
};
