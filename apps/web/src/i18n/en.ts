/**
 * Every user-visible string lives here (PLAN §0.3 "Strings", Appendix F), including the web app
 * manifest (vite.config.ts reads `en.app`). The one exception is the static `index.html`
 * (`<title>`, `<noscript>`), which cannot import it.
 */
export const en = {
  // --- Screens and dialogs outside the Table (PLAN §12.1, §12.2, §12.11, Appendix F.10, G.1) ---

  /** Level names and Setup card text (PLAN §10.1, §12.2), keyed like `BotLevel` / `CoachLevel`. */
  levels: {
    bot: { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert' },
    botText: {
      easy: 'Bots make many mistakes. They call too much and rarely bluff.',
      medium: 'Bots play okay but are easy to read.',
      hard: 'Bots play solid poker and read the board. Their style is hidden.',
      expert: 'Bots study how you play and adapt.',
    },
    coach: {
      beginner: 'Beginner',
      intermediate: 'Intermediate',
      advanced: 'Advanced',
      exam: 'Exam',
    },
    coachText: {
      beginner: 'Full help',
      intermediate: 'Help on tap',
      advanced: 'Mistakes only',
      exam: 'Test yourself',
    },
    /** A level card that later stages switch on (§18 Stage 3). */
    comingSoon: 'Coming soon',
  },

  /** The play-money disclaimer (Appendix G.1): its first sentence on Welcome, Home and Setup. */
  legal: {
    playMoneyOnly: 'Play money only.',
    /** Setup's footer adds this (§12.2). */
    chipsHaveNoValue: 'Chips have no value.',
    privacy: 'Privacy',
  },

  /** Back to the previous screen (Setup, Settings). */
  back: 'Back',

  /** First launch (PLAN §12.1). The wordmark and tagline are `app.name` and `app.tagline`. */
  welcome: {
    bullets: [
      'Play against friendly bots',
      'A coach tells you what to do, and why',
      'See your hand, your chance to win, and all poker hands',
      'Free, no sign-up, works offline',
    ],
    play: 'Play',
    setup: 'Choose players, chips and levels',
    guide: 'New to poker? 1-minute guide',
  },

  /** Later launches (PLAN §12.1, Appendix F.10). Amounts arrive formatted ("2,340"). */
  home: {
    play: 'Play',
    /** "Hand 23 · 6 players · You have 2,340 chips · Easy bots · Beginner coach", in parts so a
     *  line breaks only between them. */
    session: {
      hand: (n: number) => `Hand ${n}`,
      players: (n: number) => `${n} players`,
      chips: (chips: string) => `You have ${chips} chips`,
      bots: (level: string) => `${level} bots`,
      coach: (level: string) => `${level} coach`,
      separator: ' · ',
    },
    newTable: 'New table…',
    learn: 'Learn',
    stats: 'Stats',
    settings: 'Settings',
    install: 'Install app',
  },

  /** "Set up your table" (PLAN §12.2). Amounts arrive formatted ("2,000"). */
  setup: {
    title: 'Set up your table',
    players: {
      question: 'How many players? (you + bots)',
      fewer: 'Fewer players',
      more: 'More players',
      caption: (bots: number) => (bots === 1 ? 'You and 1 bot' : `You and ${bots} bots`),
    },
    chips: {
      question: 'Starting chips',
      customLabel: 'Starting chips',
      range: '200 to 1,000,000',
    },
    blinds: {
      question: 'Blinds',
      bigBlind: 'Big blind',
      smallBlind: (sb: string) => `Small blind ${sb}`,
      range: '2 to 100,000',
    },
    custom: 'Custom',
    depth: {
      caption: (chips: string, bigBlinds: string) =>
        `Each player starts with ${chips} chips = ${bigBlinds} big blinds.`,
      short: 'Short: many all-ins, fast games',
      medium: 'Medium',
      normal: 'Normal',
      deep: 'Deep: long hands, bigger decisions',
      tooShallow: 'Too few chips for these blinds. Choose smaller blinds.',
      tooDeep: 'Very deep. Choose bigger blinds.',
    },
    bots: { question: 'How good are the bots?' },
    coach: { question: 'How much help do you want?' },
    start: 'Start game',
  },

  /** Settings: the Game section (PLAN §12.1; §18 Stage 3). Later stages add rows and sections. */
  settings: {
    title: 'Settings',
    game: 'Game',
    speed: {
      label: 'Speed',
      hint: 'How fast the bots play and the cards move.',
      normal: 'Normal',
      fast: 'Fast',
      instant: 'Instant',
    },
    autoNext: {
      label: 'Deal the next hand by itself',
      hint: 'Off: the next hand waits for your tap.',
    },
    amounts: {
      label: 'Show amounts as',
      hint: 'For example 2,000 chips, or 100 big blinds.',
      chips: 'Chips',
      bb: 'Big blinds',
    },
  },

  /** The Table's ☰ sheet (PLAN §12.3). */
  menu: {
    title: 'Menu',
    resume: 'Resume',
    topUp: (chips: string) => `Top up to ${chips} chips`,
    rankings: 'Hand rankings',
    settings: 'Settings',
    stats: 'Stats',
    learn: 'Learn',
    install: 'Install app',
    leaveTable: 'Leave table',
    newTable: 'New table',
  },

  /** Dialogs (PLAN §3.1, §12.11, Appendix F.10). */
  dialog: {
    outOfChips: {
      text: "You're out of chips. That's okay: chips are free here.",
      reload: (chips: string) => `Reload ${chips} chips`,
      changeTable: 'Change table',
    },
    newTable: {
      text: 'Your unfinished hand will be folded. Start a new table?',
      confirm: 'Start new table',
      cancel: 'Cancel',
    },
  },

  // --- The app itself ---

  app: {
    name: 'RB Poker Coach',
    /** Home-screen name (PLAN §0.3). */
    shortName: 'RB Poker',
    /** Web app manifest description (PLAN §15.1). */
    description:
      "Learn Texas Hold'em against friendly bots, with a coach. Free, offline, no sign-up.",
    tagline: 'Learn poker by playing.',
  },

  /** Cards (PLAN §12.12). Card names ("King of hearts") come from `core/cards.ts`. */
  cards: {
    hidden: 'Hidden card',
  },

  /** Chip amounts: "2,340"; compact stacks on seat pods: "1.2k", "3.4M" (PLAN §12.4). */
  chips: {
    thousands: 'k',
    millions: 'M',
  },

  /** Bot personalities (PLAN Appendix F.6), keyed like `PersonalityId` (Appendix A.3). */
  personality: {
    rock: 'Careful',
    tag: 'Solid',
    lag: 'Aggressive',
    station: 'Calls a lot',
    maniac: 'Wild',
  },

  /** Seat pods (PLAN §12.4, §12.12). */
  seat: {
    /** Status tags on the pod. */
    tag: {
      fold: 'Fold',
      allIn: 'All-in',
      check: 'Check',
      call: 'Call',
      bet: 'Bet',
      raise: 'Raise',
    },
    dealer: 'D',
    smallBlind: 'SB',
    bigBlind: 'BB',
    /** Screen-reader label parts: "Anna, bot, Careful, stack 1,250, bet 50, folded". */
    label: {
      bot: 'bot',
      stack: (chips: string) => `stack ${chips}`,
      betAmount: (chips: string) => `bet ${chips}`,
      dealer: 'dealer',
      smallBlind: 'small blind',
      bigBlind: 'big blind',
      folded: 'folded',
      allIn: 'all-in',
      thinking: 'thinking',
      /** The last action this street. */
      action: { check: 'checked', call: 'called', bet: 'bet', raise: 'raised' },
      winner: 'wins',
      separator: ', ',
    },
  },

  /** The pot in the middle (PLAN §12.3). */
  pot: {
    total: (chips: string) => `Pot ${chips}`,
    main: (chips: string) => `Main ${chips}`,
    side: (chips: string) => `Side ${chips}`,
    separator: ' · ',
  },

  /** The shared cards (PLAN §12.3). */
  board: {
    label: 'Board',
  },

  /** The hand-rankings panel and drawer (PLAN §13). The ten rows are in `data/rankings.ts`. */
  rankings: {
    title: 'Poker hands: best at the top',
    /** The edge tab and the top-bar button. */
    tab: 'Hands',
    open: 'Show all poker hands',
    close: 'Close',
    collapse: 'Hide the poker hands',
    you: 'You',
    beatsYou: 'beats you',
    youBeat: 'you beat',
    youFolded: 'You folded',
    /** "How often" (7-card odds), e.g. "2.6%" over "1 in 39". */
    howOften: 'How often',
    percent: (value: string) => `${value}%`,
    oneIn: (n: string) => `1 in ${n}`,
    /** Tie-break footer, always shown (§13.2). */
    footer: [
      'A higher row always beats a lower row.',
      'Same row? The higher cards win: the higher pair, then the kickers.',
      'Suits never break a tie. No suit beats another.',
      'Still equal? The pot is split.',
      'Why does a flush beat a straight? It is rarer.',
      'The order comes from 5-card hands. With 7 cards, high card is rarer than one pair, but it still ranks lowest.',
    ],
    /** Screen-reader row label (§13.4). */
    row: (rank: number, name: string, example: string, tip: string) =>
      `Rank ${rank}, ${name}. Example: ${example}. ${tip}`,
    rowYou: 'You have this hand.',
    rowFolded: 'You folded this hand.',
    rowBeatsYou: 'It beats your hand.',
    rowYouBeat: 'Your hand beats it.',
    rowHowOften: (percent: string, oneIn: string) => `How often: ${percent}, ${oneIn}.`,
    /** The "You" line: the hero's actual best five. */
    yourCards: 'Your cards',
    listSeparator: ', ',
  },
} as const;
