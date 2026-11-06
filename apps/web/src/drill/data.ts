/**
 * What the drill keeps between visits, under its own key `pc.v1.drill` (PLAN §13.5, §14.2): the
 * game and difficulty last chosen, the best streak, how many questions were answered, and per hand
 * how often it was asked and missed (the Stats sheet, and "missed hands come up more often"). The
 * guard and the load and save paths are `persist/drill.ts` (Appendix H); it never touches the
 * profile or its commit protocol (§14.3).
 */
import { HAND_CATEGORIES, type HandCategory } from '../eval/evaluate.ts';
import type { Difficulty, GameId, HandStats } from './questions.ts';

export interface DrillData {
  readonly schema: 1;
  readonly game: GameId;
  readonly difficulty: Difficulty;
  /** The longest run of right answers. */
  readonly best: number;
  /** Questions answered in all. */
  readonly answered: number;
  /** Per hand (the evaluator's names): how often it was asked, and how often missed. */
  readonly hands: Readonly<Record<HandCategory, HandStats>>;
}

/** The `pc.v1.drill` schema this app reads and writes (Appendix H.2). */
export const DRILL_SCHEMA = 1;

/** Every hand asked 0 times. */
export function emptyHands(): Record<HandCategory, HandStats> {
  const hands = {} as Record<HandCategory, HandStats>;
  for (const category of HAND_CATEGORIES) hands[category] = { seen: 0, missed: 0 };
  return hands;
}

/** A first visit: Name the hand, Normal, no stats (the standalone drill's defaults). */
export function emptyDrillData(): DrillData {
  return {
    schema: DRILL_SCHEMA,
    game: 'cards',
    difficulty: 'normal',
    best: 0,
    answered: 0,
    hands: emptyHands(),
  };
}
