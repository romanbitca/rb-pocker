/**
 * Learn's seven lessons (PLAN §12.1, Appendix F.8; chunk 9.2): each at most 150 words, with one
 * card diagram. Static data like `rankings.ts`, so the lessons work offline. Only the Learn chunk
 * imports this file (a lazy chunk, §15.3). The words are F.8's, written out in plain, short
 * sentences (at most 15 words each); `scripts/check-copy.ts` and `tests/data/lessons.test.ts`
 * check both limits, and that every word is in docs/PLAN.md.
 *
 * Cards use the text form ("Ts" is the Ten; the UI shows "10"), as in `rankings.ts`. The numbers
 * are checked against the evaluator and Appendix C.5 (`tests/data/lessons.test.ts`).
 */

/** One row of the picture: a caption over some cards. */
export interface DiagramGroup {
  /** The words over the cards ("Your 2 cards"). */
  readonly label: string;
  /** Text-form cards ("Ks"); null is a card face down. */
  readonly cards: readonly (string | null)[];
  /** Indices of the cards drawn dimmed (45%): they do not count, as in the rankings (§13.2). */
  readonly dim?: readonly number[];
  /** The row the picture is about (the winning hand, the button): outlined. Its label or the
   *  caption says why, so the outline is never the only cue (§12.12). */
  readonly mark?: boolean;
}

export interface LessonDiagram {
  readonly groups: readonly DiagramGroup[];
  /** Lesson 6: the coach's price bar (§12.6), whole percentages. */
  readonly price?: { readonly win: number; readonly need: number };
  /** The line under the picture. */
  readonly caption: string;
}

/** A paragraph, numbered steps, a plain list, or terms with their meaning. */
export type LessonBlock =
  | string
  | { readonly steps: readonly string[] }
  | { readonly points: readonly string[] }
  | { readonly terms: readonly (readonly [term: string, meaning: string])[] };

export interface Lesson {
  readonly key: 'goal' | 'steps' | 'options' | 'whichWins' | 'position' | 'potOdds' | 'outs';
  readonly title: string;
  readonly diagram: LessonDiagram;
  readonly body: readonly LessonBlock[];
  /** Lesson 4 opens the full-page hand rankings (F.8: "Opens the rankings panel"). */
  readonly link?: 'rankings';
}

export const LESSONS: readonly Lesson[] = [
  {
    key: 'goal',
    title: 'The goal',
    diagram: {
      groups: [
        { label: 'Your 2 cards', cards: ['Ah', 'Kd'] },
        { label: '5 shared cards', cards: ['Ks', '9h', '5c', '2d', 'Js'], dim: [2, 3] },
      ],
      caption: 'Your best 5 cards make a pair of Kings. The dim cards do not count.',
    },
    body: [
      'Win chips. Have the best 5-card hand at the end, or make everyone else fold.',
      'You get 2 private cards; 5 shared cards come to the middle.',
      'Only you see your 2 cards. Everyone can use the shared cards.',
      'Your hand is the best 5 cards of these 7. It can use both of your cards, one, or none.',
    ],
  },
  {
    key: 'steps',
    title: 'A hand, step by step',
    diagram: {
      groups: [
        { label: 'Flop', cards: ['Ks', '9h', '5c'] },
        { label: 'Turn', cards: ['2d'] },
        { label: 'River', cards: ['Js'] },
      ],
      caption: 'The shared cards come in three steps: 3 cards, then 1, then 1.',
    },
    body: [
      'Every hand goes in the same order:',
      {
        steps: [
          'Blinds: two players put in forced bets.',
          'Everyone gets 2 cards. Betting.',
          'Flop: 3 shared cards. Betting.',
          'Turn: 1 more card. Betting.',
          'River: 1 last card. Betting.',
          'Showdown: the players still in show their cards. The best hand wins.',
        ],
      },
      'If everyone else folds, the last player wins at once. No cards are shown.',
      'Then the button moves one seat to the left, and the next hand starts.',
    ],
  },
  {
    key: 'options',
    title: 'Your options',
    diagram: {
      groups: [{ label: 'Your 2 cards', cards: ['Qh', 'Qc'] }],
      caption: 'Nobody bet? You can check or bet. Someone bet? You can fold, call or raise.',
    },
    body: [
      'When it is your turn, you choose one move:',
      {
        terms: [
          ['Fold', 'Give up the hand.'],
          ['Check', 'Pass. Only if nobody bet.'],
          ['Call', 'Match the bet.'],
          ['Bet', 'Put chips in first.'],
          ['Raise', 'Bet more than someone else.'],
        ],
      },
      'All-in means you bet all your chips.',
      'The buttons at the bottom of the table show the moves you can make now.',
    ],
  },
  {
    key: 'whichWins',
    title: 'Which hand wins',
    diagram: {
      groups: [
        { label: 'Hand 1', cards: ['Kh', 'Kc', 'Ad', '9s', '4h'], mark: true },
        { label: 'Hand 2', cards: ['Kd', 'Ks', 'Qc', '9h', '4c'] },
      ],
      caption: 'Both are a pair of Kings. The Ace beats the Queen, so hand 1 wins.',
    },
    body: [
      'There are 10 kinds of poker hands. A higher one always beats a lower one.',
      'Same hand? Higher cards win. Suits never break a tie.',
      'Still equal? The players split the pot.',
      'See all 10 hands with examples. Then practise with "Which hand wins?" at the top.',
    ],
    link: 'rankings',
  },
  {
    key: 'position',
    title: 'Position',
    diagram: {
      groups: [
        { label: 'Small blind: acts first', cards: [null, null] },
        { label: 'Big blind', cards: [null, null] },
        { label: 'Button: acts last', cards: [null, null], mark: true },
      ],
      caption: 'After the flop, the player on the button acts last.',
    },
    body: [
      'Position is where you sit. It decides when you act.',
      'Acting last shows you what others did first.',
      'After the flop, the button acts last in every round. The button is the best seat.',
      'The blinds act first after the flop. They must decide before they see what others do.',
      'Play more hands near the button. Play fewer when you must act first.',
    ],
  },
  {
    key: 'potOdds',
    title: 'Pot odds',
    diagram: {
      groups: [
        { label: 'Your 2 cards', cards: ['8h', '7h'] },
        { label: 'The flop', cards: ['Kh', '9h', '2c'] },
      ],
      price: { win: 35, need: 25 },
      caption: 'You win more often than you need.',
    },
    body: [
      'Before you call, compare your win chance with the price.',
      'Need % = the call ÷ (pot + the call).',
      'Example: the pot has 60 chips, their bet included. You must call 20.',
      '20 ÷ (60 + 20) = 25%. So you need to win 25% of the time.',
      'Here a fifth heart makes your flush. It comes by the river 35% of the time.',
      'If your win chance is higher, calling wins chips over time. 35% is more than 25%, so call.',
      'The coach shows both numbers on a bar. The line marks what you need.',
    ],
  },
  {
    key: 'outs',
    title: 'Outs',
    diagram: {
      groups: [
        { label: 'Your 2 cards', cards: ['8h', '7h'] },
        { label: 'The flop', cards: ['Kh', '9h', '2c'] },
        {
          label: 'Your 9 outs',
          cards: ['Ah', 'Qh', 'Jh', 'Th', '6h', '5h', '4h', '3h', '2h'],
          mark: true,
        },
      ],
      caption: 'Any of these 9 hearts gives you a flush.',
    },
    body: [
      'Outs are cards that improve your hand.',
      'Here you have 4 hearts. 9 hearts are left in the deck, so you have 9 outs.',
      'The rule of 2 and 4 is a quick guess:',
      {
        points: [
          'Outs × 2 ≈ your chance on the next card.',
          'Outs × 4 ≈ your chance by the river, from the flop.',
        ],
      },
      'With 9 outs it says 18% and 36%. The exact numbers are 19% and 35%.',
      'The trick guesses too high for big draws. With 15 outs it says 60%, but the truth is 54%.',
      'So the app counts every card and shows the exact number.',
    ],
  },
];
