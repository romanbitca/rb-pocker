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
} as const;
