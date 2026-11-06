/**
 * The keyboard shortcuts' words (PLAN §12.5, Appendix F.10; chunk 9.3): the "?" list and the Menu
 * item that opens it. They load with the Table's chunk and the list's own lazy chunk, never with
 * the first screen.
 */
export const shortcutWords = {
  /** The list's title, and the Menu item on devices with a mouse or a trackpad. */
  title: 'Keyboard shortcuts',
  /** Each row: the keys, then what they do. */
  rows: [
    ['F', 'Fold'],
    ['C', 'Check or call'],
    ['B or R', 'Bet or raise'],
    ['1 to 5', 'Pick a bet size'],
    ['↑ ↓', 'Bet size up or down'],
    ['Enter', 'Confirm the bet'],
    ['Esc', 'Close'],
    ['U', 'Undo'],
    ['H', 'Coach hint'],
    ['K', 'Show or hide the hand rankings'],
    /** After the hand, when it has one (1.3.92): the banner's "Hand summary" or "Exam result". */
    ['S', 'Hand summary or exam result'],
    ['?', 'This list'],
  ],
  /** Under the list. */
  note: 'They do not work while you type in a box.',
  close: 'Close',
} as const satisfies {
  title: string;
  rows: readonly (readonly [string, string])[];
  note: string;
  close: string;
};
