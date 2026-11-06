/**
 * Learn's words (PLAN §12.1, Appendix F.10; chunk 9.2). They load with its lazy chunk (§15.3); the
 * ways in say `en.home.learn` (Home's tile), `en.menu.learn` (the Menu) and `en.welcome.guide`
 * (Welcome's link to lesson 1). The lessons are `data/lessons.ts` (F.8), the hand rankings
 * `data/rankings.ts` (F.7) with the panel's words in `en.rankings`, the glossary `i18n/enCoach.ts`
 * (F.9).
 */
export const learnWords = {
  title: 'Learn',
  lessons: 'Lessons',
  /** A lesson in the list, for screen readers: "Lesson 3: Your options". */
  lessonName: (n: number, title: string) => `Lesson ${n}: ${title}`,
  /** Over a lesson: "Lesson 3 of 7". */
  lessonOf: (n: number, of: number) => `Lesson ${n} of ${of}`,
  /** A lesson's way on: "Next: Position". */
  next: (title: string) => `Next: ${title}`,
  /** The last lesson's way on: the list. */
  allLessons: 'All lessons',
  /** Lesson 4 opens the full-page hand rankings (F.8). */
  seeRankings: 'See all poker hands',
  /** The list's second group: the rankings, the glossary (and the hand drill, chunk 9.2b). */
  more: 'More',
  rankings: 'Poker hands',
  rankingsHint: 'Best at the top. Tap a hand to see more.',
  glossary: 'Glossary',
  glossaryHint: 'Poker words in plain English.',
  /** The glossary's search field. */
  search: 'Find a word',
  /** How many glossary words match the search (said by screen readers as it changes). */
  matches: (n: number) => (n === 1 ? '1 word' : `${n} words`),
  noMatch: 'No words match.',
  /** The hand drill (chunk 9.2b): shown once that page exists. */
  drill: 'Practise the 10 hands',
  /** Lesson 6's price bar, as the coach shows it (§12.6): "Win 35% · Need 25%". */
  price: (win: number, need: number) => `Win ${win}% · Need ${need}%`,
  /** The bar's name for screen readers. */
  priceLabel: (win: number, need: number) => `Win chance ${win}%. Need ${need}%.`,
  /** A dimmed card in a lesson's picture, for screen readers: "Five of clubs, does not count". */
  dimCard: (card: string) => `${card}, does not count`,
} as const;
