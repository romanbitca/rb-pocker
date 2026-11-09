/**
 * The words of the first paint (PLAN §0.3 "Strings", §15.3): Welcome and Home, the app's name,
 * what sits over every screen (the toasts, the banners, the one-time cards) and the lines the app
 * shows while a lazy screen loads. They are part of `en` (`i18n/en.ts` spreads them in, so `en`
 * still holds every string), but the code that paints the first screen imports them from here:
 * the initial bundle then carries none of the words of the Table, Setup, Settings and the other
 * screens after the first tap, which load with those screens (chunk 9.7).
 */
export const enStart = {
  /** Level names (PLAN §10.1), keyed like `BotLevel` / `CoachLevel`: Home's session line. */
  levels: {
    bot: { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert' },
    coach: {
      beginner: 'Beginner',
      intermediate: 'Intermediate',
      advanced: 'Advanced',
      exam: 'Exam',
    },
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

  /**
   * The hand drill (PLAN §13.5): its name on Home, in the Menu and over its page. Its other words
   * load with it (`i18n/drill.ts`).
   */
  drill: { title: 'Hand drill' },

  /**
   * The screens after the first tap (the Table, Setup, Settings) are a lazy chunk, loaded right
   * after the first paint (PLAN §15.3). Only a tap before it arrives shows `loading` (after half a
   * second); `loadFailed` when it cannot load (no connection, not cached yet).
   */
  screens: {
    loading: 'Loading…',
    loadFailed: 'This screen could not be loaded. Check your connection and try again.',
    tryAgain: 'Try again',
  },

  /** Welcome's and Home's button inside Telegram (§19.10): its other words are `i18n/mp.ts`. */
  playWithFriends: 'Play with friends',

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

  app: {
    name: 'RB Poker Coach',
    /** Home-screen name (PLAN §0.3). */
    shortName: 'RB Poker',
    /** Web app manifest description (PLAN §15.1). */
    description:
      "Learn Texas Hold'em against friendly bots, with a coach. Free, offline, no sign-up.",
    tagline: 'Learn poker by playing.',
    /** The hero's name at the table: always "You" (Appendix F.10). */
    hero: 'You',
  },

  /** Chip amounts: "2,340"; compact stacks on seat pods: "1.2k", "3.4M" (PLAN §12.4). */
  chips: {
    thousands: 'k',
    millions: 'M',
  },

  /** Joining names in a toast or a hand-end line: "you and Ben", "Nora, Ben and Sam". */
  handEnd: {
    and: ' and ',
    comma: ', ',
  },

  /**
   * Short messages (PLAN §12.11) that can show at launch, before the first tap: the saved data's
   * repairs and the first offline-ready. The others come after a tap, with the screens' words
   * (`en.toast`, `i18n/en.ts`).
   */
  toast: {
    handNotRestored: 'Your last hand could not be restored. Chips were returned.',
    dataRecovered: 'Your saved data was damaged. We started fresh and kept a copy.',
    /** The profile was damaged and its backup was good (§14.6 rule 2). */
    dataRestored:
      'Your saved data was damaged. We restored a backup. Your last hand may be missing.',
    /** Once ever: the first service worker is installed (§15.1). */
    offlineReady: 'Ready to play offline.',
  },

  /** Another tab has the game (PLAN §12.11, §14.7): the game screens show this instead. */
  otherTab: {
    text: 'The game is open in another tab. Close it, or tap here to play here instead.',
    playHere: 'Play here',
  },

  /** The storage-failure banner (PLAN §12.11, §12.14), once per launch. */
  storage: {
    banner:
      "Stats can't be saved in this browser mode (for example private browsing). Export before you close the tab.",
    ok: 'OK',
  },

  /**
   * The one-time cards on Home and Welcome (PLAN §12.11, §12.13; chunk 8.4): installing, and a
   * home-screen app's own storage.
   */
  nudge: {
    iosTip:
      "Tip: add RB Poker Coach to your Home Screen. Tap Share, then 'Add to Home Screen'. It works offline and keeps your stats safer.",
    gotIt: 'Got it',
    installCard:
      'Install RB Poker Coach? It opens like an app, works offline and keeps your stats safer.',
    installNow: 'Install',
    notNow: 'Not now',
    safariImport: 'Played in Safari before? Export your stats there, then Import them here.',
    import: 'Import',
    skip: 'Skip',
  },

  /**
   * The Stats screen's title, shown by the app over the `screens` lines while its lazy chunk loads
   * or when it cannot (PLAN §14.4, §15.3). Every other Stats word is in `i18n/stats.ts` (lazy).
   */
  stats: {
    title: 'Stats',
  },

  /**
   * Review's loading and failure lines, shown by the app while the lazy Review chunk loads or when
   * it cannot (PLAN §12.10, §15.3). Every other Review word is in `i18n/review.ts` (lazy).
   */
  review: {
    screenTitle: 'Review',
    loading: 'Loading…',
    /** The screen's files could not be loaded (no connection, not cached yet). */
    loadFailed: 'Review could not be loaded. Check your connection and try again.',
  },
} as const;
