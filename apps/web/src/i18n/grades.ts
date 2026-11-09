/**
 * The one name of each decision grade (PLAN Appendix F.4, 1.3.100): the grade chip, the mistake
 * feedback card's title and the Stats history all say these words, so a grade never has two names.
 * Its own tiny module: the chip and Stats load in lazy chunks, the card's words with `en.ts`.
 */
export const GRADE_WORDS = {
  best: 'Best move',
  good: 'Good',
  inaccuracy: 'Slightly off',
  mistake: 'Mistake',
  blunder: 'Big mistake',
} as const;
