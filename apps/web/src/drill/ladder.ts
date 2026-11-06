/**
 * The hand drill's ladder (PLAN §13.5): the ten hands numbered by position, 1 = royal flush (the
 * strongest) to 10 = high card (the weakest), the rows of the rankings panel (§13.2) in order. The
 * evaluator's categories are the one vocabulary (`eval/evaluate.ts`); a position is only how the
 * drill numbers them, the way the owner's standalone Hand Drill did.
 */
import { categoryOf, HAND_CATEGORIES, type HandCategory } from '../eval/evaluate.ts';

/** 1 = royal flush … 10 = high card. */
export type Position = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/** Strongest first. */
export const POSITIONS: readonly Position[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export function isPosition(x: unknown): x is Position {
  return typeof x === 'number' && Number.isInteger(x) && x >= 1 && x <= 10;
}

/** `HAND_CATEGORIES` is weakest first, so position p is entry 10 − p. */
export function categoryAt(p: Position): HandCategory {
  return HAND_CATEGORIES[10 - p] as HandCategory;
}

export function positionOf(category: HandCategory): Position {
  return (10 - HAND_CATEGORIES.indexOf(category)) as Position;
}

/** The position of an evaluator score (§5.2). */
export function positionOfScore(score: number): Position {
  return positionOf(categoryOf(score));
}
