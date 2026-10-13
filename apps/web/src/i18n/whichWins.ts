/**
 * The words of the "Which hand wins?" quiz (PLAN §13.2, §10.2, Appendix F.10; chunk 6.4). They load
 * with its lazy chunk; the button that opens it says `en.rankings.whichWins`.
 */
export const whichWinsWords = {
  ask: 'Tap the hand that wins.',
  /** "First hand: Ace of spades, …" for screen readers. */
  hand: (n: number, cards: string) => `${n === 1 ? 'First' : 'Second'} hand: ${cards}`,
  right: 'Right!',
  wrong: 'Not this time.',
  /** Different rows: "Flush beats straight." (then the footer's first line). */
  beats: (winner: string, loser: string) => `${winner} beats ${loser}.`,
  /** The same row: "Both are one pair." (then the footer's second line). */
  same: (name: string) => `Both are ${name}.`,
  /** "3 of 4 right" (kept in memory for this visit only). */
  score: (right: number, asked: number) => `${right} of ${asked} right`,
  next: 'Next hands',
  close: 'Close',
} as const;
