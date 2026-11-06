/**
 * The words of the Stats screen (PLAN §14.4, §8.9 "Stats wording", Appendix F.10, G.4; chunk 8.2).
 * They load with the screen's lazy chunk (`ui/screens/Stats.tsx`, §15.3); the screen's loading and
 * failure lines are in `en.stats`. Numbers arrive formatted ("2,340", "+640", "45%").
 */
export const statsWords = {
  tabs: {
    /** The group of the four pages, for screen readers. */
    label: 'Stats pages',
    progress: 'Progress',
    results: 'Results',
    hands: 'Hands',
    history: 'History',
  },
  /** Progress and Results below 5 hands (§14.4: empty states teach). */
  empty: 'Play 5 hands to see your first stats.',
  soFar: (n: string) => `Hands so far: ${n}`,
  /** No number yet. */
  none: '—',
  /** A change from the 7 days before: drawn as an arrow, said in words. */
  up: (n: string) => `↑ ${n}`,
  down: (n: string) => `↓ ${n}`,
  upSpoken: (n: string) => `Up ${n} from the 7 days before.`,
  downSpoken: (n: string) => `Down ${n} from the 7 days before.`,

  progress: {
    score: 'Decision score',
    scoreHint: 'How good your decisions were. 100 is the best.',
    session: 'This session',
    lastSession: 'Last session',
    week: 'Last 7 days',
    scoreChart: 'Decision score in your last sessions, oldest first.',
    mistakes: 'Mistakes per 100 decisions',
    lower: 'Lower is better.',
    mistakesChart: 'Mistakes per 100 decisions in your last sessions, oldest first.',
    /** A chart's data table: one row per session, oldest first. */
    sessionCol: 'Session',
    sessionRow: (n: number) => `Session ${n}`,
    value: 'Value',
    own: 'On your own',
    ownText: (pct: string) => `Without the hint, ${pct} of your decisions were Best or Good.`,
    ownNone: 'No decisions without the hint yet.',
    follow: 'Following the coach',
    followText: (pct: string) => `You did what the coach said ${pct} of the time.`,
    followNone: 'You have not seen a hint yet.',
    streak: 'Streak',
    streakText: (n: string) => `Good decisions in a row: ${n}`,
    streakBest: (n: string) => `Your best: ${n}`,
    leaks: 'Your biggest leaks',
    leakLine: (count: string, chips: string) => `${count} times · about ${chips} chips lost`,
    leaksNone: 'No leaks yet. A leak shows after the same mistake 3 times.',
    /** A leak's link to the lesson about it (§8.9): "Lesson 6: Pot odds", as Learn names it. */
    lessonLink: (n: number, title: string) => `Lesson ${n}: ${title}`,
    undo: (n: string) => `Fixed with Undo: ${n}`,
    quiz: (right: string, asked: string, pct: string) =>
      `Quiz answers right: ${right} of ${asked} (${pct})`,
  },

  /** §8.9 leak tags, their "Stats wording". */
  leaks: {
    'open-loose': 'Playing too many hands before the flop',
    'open-tight': 'Folding good hands before the flop',
    limp: 'Calling the big blind instead of raising',
    'call-pre-wide': 'Calling raises with weak hands',
    'fold-pre-much': 'Folding too much to raises',
    pushfold: 'Short-stack all-in decisions',
    'missed-value': 'Not betting your strong hands',
    'bluff-much': 'Bluffing too often',
    overfold: 'Folding when the price was good',
    chase: 'Chasing draws without the right price',
    'river-call': 'Calling river bets with weak hands',
    'call-light': 'Calling bets without enough chance to win',
    sizing: 'Bet sizes too big or too small',
  },

  /**
   * The titles of the lessons the leaks link to (Appendix F.8; `LEAK_LESSON` in `ui/stats.ts`).
   * Only these four, so the lessons themselves stay in Learn's chunk; a test keeps them equal to
   * `data/lessons.ts`.
   */
  lessons: {
    3: 'Your options',
    5: 'Position',
    6: 'Pot odds',
    7: 'Outs',
  },

  results: {
    hands: 'Hands',
    won: 'Hands won',
    net: 'Chips won or lost',
    bb100: 'Big blinds per 100 hands',
    /** "Plays 24% of hands, raises 12%." */
    style: (vpip: string, pfr: string) => `Plays ${vpip} of hands, raises ${pfr}.`,
    good: 'Good players: about 20% / 16%.',
    showdown: 'Won at showdown',
    showdownText: (won: string, of: string, pct: string) => `${won} of ${of} (${pct})`,
    biggest: 'Biggest pot won',
    reloads: 'Reloads',
    luck: 'All-in luck',
    /** "Expected +1,200 · Actual +860": chips from the pots, as expected and as it happened. */
    luckLine: (expected: string, actual: string) => `Expected ${expected} · Actual ${actual}`,
    lucky: (x: string) => `You were lucky by ${x} chips.`,
    unlucky: (x: string) => `You were unlucky by ${x} chips.`,
    even: 'Your luck was even.',
    luckNone: 'No all-in hands yet.',
    byLevel: 'By bot level',
    level: 'Bots',
    levelHands: 'Hands',
    levelBb: 'Big blinds per 100',
    practice: (n: string) => `Practice hands (used Undo): ${n}, not counted above.`,
  },

  collection: {
    title: 'Hands you made',
    note: 'Every hand you made by the river. Just for learning: it unlocks nothing.',
    /** "Made 3 times · first 12 Oct 2026". */
    made: (n: string, date: string) => `Made ${n} times · first ${date}`,
    madeOnce: (date: string) => `Made once · ${date}`,
    never: 'Not made yet',
    oneIn: (n: string) => `About 1 in ${n} hands`,
  },

  history: {
    title: 'Last 100 hands',
    hand: (n: string) => `Hand ${n}`,
    loading: 'Loading…',
    empty: 'No finished hands yet.',
    /** A hand with an Undo (§11.4). */
    practice: 'Practice',
    /** The screen reader's list of the row's grade dots. */
    grades: (list: string) => `Grades: ${list}.`,
    noGrades: 'No decisions.',
    noGrade: 'No grade',
    /** Footer (§14.4); Export and Import arrive with chunk 8.3. */
    saved: 'Your stats are saved only on this device.',
    /** The footer's buttons (chunk 8.4, §14.8). */
    export: 'Export',
    import: 'Import',
    where: 'Where are my stats?',
    /** Appendix G.4. */
    whereText:
      "Your stats and settings are saved only on this device, inside this browser. Nothing is sent to the internet, and there is no account. If you clear your browser data, use private mode, or (on iPhone) don't open the game in Safari for a while, the stats can be deleted. To keep them safe, add the game to your Home Screen, and use Export to save a backup file. On a new phone, use Import.",
  },

  /** Appendix F.4 chip words. */
  grades: {
    best: 'Best move',
    good: 'Good',
    inaccuracy: 'Slightly off',
    mistake: 'Mistake',
    blunder: 'Big mistake',
  },
} as const;
