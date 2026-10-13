/**
 * The words of the Advanced quiz (PLAN §10.3, Appendix F.10; chunk 6.4). They load with the quiz's
 * lazy chunk (`ui/quizEntry.ts`, §15.3), never with the first paint.
 */
export const quizWords = {
  /** The quiz's name for screen readers. */
  title: 'Quiz',
  questions: {
    win: 'Your win chance is about…',
    need: 'You need about…',
    move: 'Best move?',
  },
  /** The choices of each question, in order (the bands' lower bounds are inclusive). */
  choices: {
    win: ['Under 25%', '25–50%', '50–75%', 'Over 75%'],
    need: ['Under 20%', '20–35%', '35–50%', 'Over 50%'],
    move: ['Fold', 'Check/Call', 'Bet/Raise'],
  },
  /** "Question 2 of 3" */
  step: (i: number, n: number) => `Question ${i} of ${n}`,
  skip: 'Skip',
  /** "2 of 3 correct" */
  score: (correct: number, of: number) => `${correct} of ${of} correct`,
  /** The right answers under the score. */
  right: {
    win: (band: string) => `Win chance: ${band}.`,
    need: (band: string) => `You need: ${band}.`,
    move: (moves: string) => `Best move: ${moves}.`,
  },
  /** Joins two right moves in a close spot: "Check/Call or Bet/Raise". */
  or: ' or ',
  hint: 'Hint',
} as const;
