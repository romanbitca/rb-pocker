/**
 * The words of the end-of-hand summary and the Exam result (PLAN §10.2, §12.9, Appendix F.10;
 * chunk 6.4). They load with the summary's lazy chunk (`ui/summaryEntry.ts`, §15.3).
 */
export const summaryWords = {
  /** "Hand 12: +160" (a real minus sign for a loss). */
  title: (hand: string, net: string) => `Hand ${hand}: ${net}`,
  /** Exam's heading above the title (§10.2). */
  exam: 'Exam result',
  /** "Your score: 82 of 100" (the decision score of the hand, §14.4). */
  score: (score: number) => `Your score: ${score} of 100`,
  streets: {
    preflop: 'Before the flop',
    flop: 'Flop',
    turn: 'Turn',
    river: 'River',
  },
  /** What you did. */
  did: {
    fold: 'You folded',
    check: 'You checked',
    call: 'You called',
    bet: (x: string) => `You bet ${x}`,
    raise: (x: string) => `You raised to ${x}`,
  },
  /** The coach's move, when it was another. */
  coach: {
    fold: 'Coach: Fold',
    check: 'Coach: Check',
    call: 'Coach: Call',
    bet: (x: string) => `Coach: Bet ${x}`,
    raise: (x: string) => `Coach: Raise to ${x}`,
  },
  /** The numbers at the decision: "You had 45%, needed 25%." (each with its % sign). */
  numbers: (win: string, need: string) => `You had ${win}, needed ${need}.`,
  win: (win: string) => `You had ${win}.`,
  /** A decision taken back with Undo (it still counts, §11.4). */
  undone: 'Taken back with Undo',
  /** Grading failed for this decision (§11.3 r5). */
  noGrade: 'No grade',
  review: 'Review hand',
  next: 'Next hand ›',
  close: 'Close',
} as const;
