/**
 * Every user-visible string lives here (PLAN §0.3 "Strings", Appendix F), including the web app
 * manifest (vite.config.ts reads `en.app`). The one exception is the static `index.html`
 * (`<title>`, `<noscript>`), which cannot import it.
 */
export const en = {
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
