/**
 * Every user-visible string lives here (PLAN §0.3 "Strings", Appendix F), including the web app
 * manifest (vite.config.ts reads `en.app`). The one exception is the static `index.html`
 * (`<title>`, `<noscript>`), which cannot import it.
 */
import type { TemplateKey } from '../brain/explain.ts';
import type { CoachTemplate } from './coach.ts';

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
    /** A level card that a later stage switches on (Hard, Expert, Advanced, Exam; §18). */
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

  /** Settings: the Game section (PLAN §12.1; §18 Stages 3 and 5). Later stages add rows and sections. */
  settings: {
    title: 'Settings',
    game: 'Game',
    /** The two level rows are the Setup cards (§10, §12.1); when a change starts is in the hint. */
    coachLevel: { label: 'Coach level', hint: 'Changes start with your next decision.' },
    botLevel: { label: 'Bot level', hint: 'Changes start with the next hand.' },
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

  /**
   * The action bar (PLAN §12.7, Appendix F.10). `{x}` is an amount already formatted in the
   * player's unit ("2,340" or "117 BB"); every amount is a "raise to" amount (§0.3).
   */
  actions: {
    /** The bar's group label for screen readers. */
    group: 'Your actions',
    fold: 'Fold',
    check: 'Check',
    call: (x: string) => `Call ${x}`,
    callAllIn: (x: string) => `Call all-in ${x}`,
    /** F.10 "Bet ▲" / "Raise ▲": the ▲ is drawn as an SVG icon, not a text glyph. */
    bet: 'Bet',
    raise: 'Raise',
    betTo: (x: string) => `Bet ${x}`,
    raiseTo: (x: string) => `Raise to ${x}`,
    allIn: (x: string) => `All-in ${x}`,
    waiting: 'Waiting…',
    /** Shown when the disabled Fold is tapped while checking is free. */
    foldNotNeeded: 'Checking is free. No need to fold.',
    /** Shown when the disabled Raise is tapped: a short all-in did not reopen the betting. */
    cannotRaise: "You can't raise here: the all-in was too small to reopen the betting.",
    /** Under "Call all-in {x}" when the hero cannot cover the bet (§0.3 `winPot`). */
    potYouCanWin: (x: string) => `Pot you can win ${x}`,
  },

  /** The sizing tray (PLAN §12.7). */
  sizing: {
    /** The tray's group label for screen readers. */
    label: { bet: 'Choose your bet', raise: 'Choose your raise' },
    /** Preset chips: the chip text and what a screen reader says. */
    preset: {
      third: { label: '⅓ pot', spoken: 'One third of the pot' },
      half: { label: '½ pot', spoken: 'Half the pot' },
      twoThirds: { label: '⅔ pot', spoken: 'Two thirds of the pot' },
      pot: { label: 'Pot', spoken: 'The size of the pot' },
      bb25: { label: '2.5\u00A0BB', spoken: '2.5 big blinds' },
      bb3: { label: '3\u00A0BB', spoken: '3 big blinds' },
      bb4: { label: '4\u00A0BB', spoken: '4 big blinds' },
      min: { label: 'Min', spoken: 'The smallest raise' },
      x25: { label: '2.5×', spoken: '2.5 times the bet' },
      x3: { label: '3×', spoken: '3 times the bet' },
      allIn: { label: 'All-in', spoken: 'All your chips' },
    },
    /** A preset chip's accessible name: "Half the pot: 60". */
    presetName: (spoken: string, amount: string) => `${spoken}: ${amount}`,
    slider: 'Amount',
    smaller: 'Smaller amount',
    bigger: 'Bigger amount',
    field: { chips: 'Type an amount in chips', bb: 'Type an amount in big blinds' },
    close: 'Close',
    /** The slider's aria-valuetext: "Raise to 120, 6 big blinds". */
    valueText: (action: string, other: string) => `${action}, ${other}`,
    bigBlinds: (x: string, one: boolean) => (one ? `${x} big blind` : `${x} big blinds`),
    chips: (x: string) => `${x} chips`,
  },

  /** Amounts in big blinds (Setting "show amounts as BB"; Appendix F: "2.5 BB"). */
  amounts: {
    /** A no-break space: "15 BB" never splits across two lines of a button. */
    bb: (x: string) => `${x}\u00A0BB`,
    /** The unit beside the typed amount in the sizing tray. */
    bbUnit: 'BB',
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
    /** The hero's name at the table: always "You" (Appendix F.10). */
    hero: 'You',
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

  /** What each personality is like and how to beat it: the bot card's text (PLAN Appendix F.6). */
  personalityText: {
    rock: {
      description: 'Plays few hands. When they bet big, believe them.',
      tip: 'Steal their blinds. Fold when they raise.',
    },
    tag: {
      description: 'Plays good hands and bets them well.',
      tip: "Play good hands. Don't bluff too much.",
    },
    lag: {
      description: 'Plays many hands and bets often.',
      tip: 'Call them down with good hands. Let them bluff.',
    },
    station: {
      description: 'Calls with almost anything. Rarely raises.',
      tip: 'Bet your good hands. Almost never bluff.',
    },
    maniac: {
      description: 'Bets and raises with anything.',
      tip: 'Wait for a good hand. Then let them bet for you.',
    },
  },

  /** The bot card, the sheet for a tapped seat (PLAN §9.3, Appendix F.6, F.10). */
  botCard: {
    close: 'Close',
    howToBeat: 'How to beat them',
    stack: (chips: string) => `Stack: ${chips}`,
    /**
     * Hard and Expert hide the personality (§9.2). Stage 7 adds "Here is what you have seen:" and
     * the stats under this line (§9.3).
     */
    unknownStyle: 'Style: unknown.',
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

  /** The Table screen (PLAN §12.3–§12.5). Amounts arrive formatted ("2,340"). */
  table: {
    /** The page heading, for screen readers only. */
    heading: 'Poker table',
    /** Top bar: "Blinds 10/20 · Hand 12". */
    blinds: (sb: string, bb: string) => `Blinds ${sb}/${bb}`,
    hand: (n: string) => `Hand ${n}`,
    separator: ' · ',
    menu: 'Menu',
    /** The hero strip's group label. */
    yourHand: 'Your hand',
    /** Under the hero's cards: "You · 2,340". */
    heroChips: (chips: string) => `You · ${chips}`,
    /** The hero's hand label is a button: it opens the hand rankings (§12.3). */
    labelHint: 'Tap to see all poker hands',
    folded: 'You folded',
    /** After the sub-label when no hand can beat the hero's (§6.5). */
    nuts: ' · Best possible hand',
    allIn: 'All-in',
    yourBet: (chips: string) => `Your bet ${chips}`,
  },

  /**
   * The win badge, its popover, the price chip and the big-move lines (PLAN §7.6, §12.14,
   * Appendix F.3, F.10). Percentages arrive formatted ("62%").
   */
  badge: {
    caption: 'win chance',
    folded: 'Folded',
    /** Before the first estimate (never "0%" while computing). */
    skeleton: '--%',
    /** No number: the job timed out with no estimate, or the worker failed (§12.14). */
    none: '—',
    /** Provisional estimates: "~62%". */
    approx: (pct: string) => `~${pct}`,
    /** Screen-reader names of the badge. */
    label: (pct: string) => `Win chance ${pct}`,
    labelApprox: (pct: string) => `Win chance about ${pct}`,
    labelComputing: 'Win chance: working it out',
    labelFolded: 'Win chance: you folded',
    labelNone: 'Win chance not available',
    /** The popover: "Wins 60% · splits 4% · vs 3 players (any cards) · 40,000 deals". */
    stats: (win: string, tie: string, players: number, deals: string) =>
      `Wins ${win} · splits ${tie} · vs ${players} ${players === 1 ? 'player' : 'players'} (any cards) · ${deals} deals`,
    howLink: 'How is this calculated?',
    how: (pct: string) =>
      `We play out the rest of the hand thousands of times, dealing the other players random cards. You won in ${pct} of them. We never look at the bots' real cards.`,
    unavailable: 'Win chance is not available right now',
    /** The price chip under the badge when facing a bet: "Call 40 · need 20%" (§0.3 `need`). */
    price: (toCall: string, need: string) => `Call ${toCall} · need ${need}`,
    /** Between the price chip's two parts (they sit on two lines under the badge). */
    priceSeparator: ' · ',
    /** The big-move lines (§7.6); `card` is drawn as a small card. */
    move: {
      fold: (name: string) => `${name} folded. One fewer player to beat.`,
      improved: (card: string, hand: string) => `The ${card} helped you: now ${hand}.`,
      danger: (card: string, threat: string) =>
        `The ${card} is dangerous: ${threat} is now possible.`,
      blank: (card: string) => `The ${card} did not help you.`,
      threat: { flush: 'a flush', straight: 'a straight', fullHouse: 'a full house' },
    },
  },

  /** Draw chips and their out cards (PLAN §6.2–§6.4, §6.6, Appendix F.3). */
  draws: {
    name: {
      flush: 'Flush draw',
      nutFlush: 'Nut flush draw',
      oesd: 'Open-ended straight draw',
      doubleGutshot: 'Double gutshot',
      gutshot: 'Gutshot straight draw',
      overcards: 'Two overcards',
      backdoorFlush: 'Backdoor flush draw',
      backdoorStraight: 'Backdoor straight draw',
    },
    /** "Flush draw · 9 outs · 35% by river". */
    chip: (name: string, outs: number, pct: string, when: string) =>
      `${name} · ${outs} ${outs === 1 ? 'out' : 'outs'} · ${pct} ${when}`,
    /** The chip on a phone, where the full text does not fit: "Flush draw · 35% by river". */
    chipShort: (name: string, pct: string, when: string) => `${name} · ${pct} ${when}`,
    byRiver: 'by river',
    nextCard: 'next card',
    /** After the chip text when some outs are risky: " (1 risky)". */
    risky: (n: number) => ` (${n} risky)`,
    /** The chip for the draws that do not fit: "+1". */
    more: (n: number) => `+${n}`,
    moreLabel: 'Show all your draws',
    /** On a risky out card, and its caption (§6.4). */
    riskyMark: '!',
    riskyCaption: 'may help them too',
    /** A risky out card's screen-reader name: "Nine of hearts, may help them too". */
    riskyCard: (card: string) => `${card}, may help them too`,
  },

  /**
   * The coach (PLAN §12.6, §12.7): the words the initial bundle needs. The strip, the sheet and
   * the panels say the rest; their words load with the coach's lazy chunk (`i18n/coachUi.ts`).
   */
  coachUi: {
    /** The sheet (§12.6). */
    title: 'Coach',
    /** The recommended Row A button's badge (§12.7). */
    badge: 'Coach',
    /** The sizing tray's coach chip (§12.7 "Coach: ¾ pot") and its accessible name. */
    chip: 'Coach',
    chipName: (amount: string) => `Coach's amount: ${amount}`,
  },

  /** The hand-end banner (PLAN §12.9, §12.11). `x` is an amount already formatted. */
  handEnd: {
    youWin: (x: string) => `You win ${x}!`,
    wins: (name: string, x: string, hand: string) => `${name} wins ${x} with ${hand}.`,
    winsNoHand: (name: string, x: string) => `${name} wins ${x}.`,
    youWinFold: (x: string) => `Everyone folded. You win ${x}.`,
    winsFold: (name: string, x: string) => `${name} wins ${x}. Everyone else folded.`,
    /** "Split pot: you and Ben each win 170." */
    split: (names: string, x: string) => `Split pot: ${names} each win ${x}.`,
    you: 'you',
    and: ' and ',
    comma: ', ',
    /** At a showdown the hero won: "Ben: Two Pair — loses to your Flush". */
    loses: (name: string, hand: string, yours: string) =>
      `${name}: ${hand} — loses to your ${yours}`,
    /** Category names for the loser line (Appendix F.2 words). */
    category: {
      highCard: 'High Card',
      pair: 'Pair',
      twoPair: 'Two Pair',
      trips: 'Three of a Kind',
      straight: 'Straight',
      flush: 'Flush',
      fullHouse: 'Full House',
      quads: 'Four of a Kind',
      straightFlush: 'Straight Flush',
      royalFlush: 'Royal Flush',
    },
    nextHand: 'Next hand',
  },

  /** Short messages (PLAN §12.11). */
  toast: {
    /** "Nora sits down." / "Nora and Ben sit down." / "Nora, Ben and Sam sit down." */
    botsJoined: (names: string, one: boolean) =>
      one ? `${names} sits down.` : `${names} sit down.`,
    handVoided: 'This hand was cancelled because of an internal error. Your chips were returned.',
    handNotRestored: 'Your last hand could not be restored. Chips were returned.',
    dataRecovered: 'Your saved data was damaged. We started fresh and kept a copy.',
  },

  /**
   * The storage-failure banner (PLAN §12.11, §12.14), once per launch. Its second sentence
   * ("Export before you close the tab.") arrives with Export in Stage 8.
   */
  storage: {
    banner: "Stats can't be saved in this browser mode (for example private browsing).",
    ok: 'OK',
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
    /** The hero's chance to finish with exactly each hand (§6.6); "—" for none. */
    byRiver: 'By river',
    byRiverInfo: 'Your chance to finish with exactly this hand, if you stay to the end.',
    byRiverNone: '—',
    rowByRiver: (pct: string) => `By river: ${pct}.`,
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

  /**
   * All-in "TV mode" (PLAN §7.6): every face-up player's equity bar, and the luck line at the hand
   * end (§12.9). Percentages arrive formatted ("62%").
   */
  runout: {
    /** The bar's screen-reader name: "Ben: 62% win chance". */
    bar: (name: string, pct: string) => `${name}: ${pct} win chance`,
    heroBar: (pct: string) => `You: ${pct} win chance`,
    /** The hero lost with 60% or more when the chips went in. */
    unlucky: (pct: string) =>
      `You had ${pct} when the chips went in. Good decision. Unlucky this time.`,
    /** The hero won with 35% or less. */
    lucky: (pct: string) => `You got lucky. You had ${pct}.`,
  },

  /**
   * The hidden `#bench` screen (PLAN §15.4): how fast this device runs the game maths. Targets are
   * the §15.4 ones for a Galaxy A5x-class phone.
   */
  bench: {
    title: 'Speed test',
    intro: 'This test measures how fast this device runs the game maths. It takes a few seconds.',
    running: 'Measuring…',
    failed: (reason: string) => `The test did not finish: ${reason}`,
    evaluator: 'Hand evaluator',
    eq8Preflop: 'Win chance against 8 players, before the flop',
    eq8Flop: 'Win chance against 8 players, on the flop',
    eq1Flop: 'Win chance against 1 player, on the flop',
    hint: 'Coach hint',
    hintValue: 'Coming in Stage 5',
    device: 'Device',
    /** "12.3 million hands per second". */
    evalsPerSec: (millions: string) => `${millions} million hands per second`,
    ms: (ms: string) => `${ms} ms`,
    /** Targets (§15.4). */
    targetEvaluator: 'Target: 2 million or more',
    targetEquity: 'Target: 400 ms or less',
    noTarget: 'No target',
    ok: 'OK',
    slow: 'Too slow',
    again: 'Run again',
    copy: 'Copy the results',
    copied: 'Copied',
    /** Above the plain-text copy of the results (it can be selected on a plain-http page). */
    textLabel: 'The results as text',
    back: 'Back to the game',
    /** The plain-text report's first line. */
    reportTitle: 'RB Poker Coach speed test',
  },

  /**
   * The coach's sentences (PLAN §8.10, Appendix F.1, F.5): `brain/explain.ts` picks a template and
   * its values, `i18n/coach.ts` renders it. `{name}` is a value (a number, an amount, a hand name
   * or another template here: it counts as one word); `{g:term}` is a glossary link (F.9), and
   * "{g:big blind}s" adds a plural "s" outside the link. A template with `count` has a form for a
   * count of 1. `scripts/check-copy.ts` enforces the rules: at most 15 words a sentence,
   * whole-number percentages, every placeholder and glossary key known; and no idioms (by review).
   */
  coach: {
    templates: {
      // Appendix F.1 (CALL_PROFITABLE says "{E}% is more than {need}%": with the % signs).
      OPEN_RANGE: {
        count: 'behind',
        one: '{hand} is in the top {rankPct}% of starting hands. {behind} player acts after you. Play about the top {openPct}% here. Raise to {size}.',
        other:
          '{hand} is in the top {rankPct}% of starting hands. {behind} players act after you. Play about the top {openPct}% here. Raise to {size}.',
      },
      FOLD_RANGE: {
        count: 'behind',
        one: '{hand} is not strong enough here. {behind} player acts after you. Folding saves chips.',
        other:
          '{hand} is not strong enough here. {behind} players act after you. Folding saves chips.',
      },
      ISOLATE: 'Players only called. Raise to {size} to play against fewer players.',
      CHECK_FREE: 'Checking costs nothing. Never fold when you can check.',
      THREE_BET_VALUE:
        'Your {hand} beats most hands that raise here (about {E}%). Re-raise to {size}.',
      FOUR_BET_VALUE: 'Your {hand} is ahead of most re-raising hands. Raise again to {size}.',
      CALL_PREFLOP:
        'You win about {E}% against their likely hands. You need {need}%. Calling is fine.',
      FOLD_VS_RAISE:
        'They raised, so they likely have a good hand. {hand} wins only about {E}% against it.',
      SET_MINING:
        'Small {g:pocket pair}. Call to try for a {g:set}. You hit about 1 time in 8. Then you can win a big pot.',
      CALL_PROFITABLE:
        'You win about {E}%. You need {need}% to call {toCall} into {pot}. {E}% is more than {need}%, so calling wins over time.',
      FOLD_PRICE: 'You need {need}% to call. You win only about {E}%. Folding saves chips.',
      IMPLIED:
        'The price alone needs {need}%. If you hit your {draw}, you can win more later. About {needImplied}% is enough.',
      VALUE_BET:
        'Your {handName} is probably best (about {E}%). Bet {size}. Worse hands like {example} can pay you.',
      VALUE_RAISE: 'You likely have the best hand. Raise to {size} to win more.',
      RAISE_PROTECT: 'Strong, but this board has many draws. Raise now so draws pay to continue.',
      THIN_VALUE:
        'Your {handName} is a bit better than their calling hands. A small bet of {size} wins more.',
      POT_CONTROL:
        'Medium hand ({handName}). Check. Better hands would call a bet. Worse hands would fold.',
      SEMI_BLUFF:
        '{draw}: {outs} {g:outs}. You hit about {hitNext}% next card and {hitRiver}% by the river. Betting can win now or later.',
      CBET_DRY:
        'You raised before the flop. This board likely missed them. A small bet of {size} often wins.',
      CHECK_WEAK: 'You have little now. Check and see the next card for free.',
      PUSH_FOLD: {
        count: 'S',
        one: 'Only {S} {g:big blind} left: go {g:all-in} or fold. They fold about {Pfold}%. If called, you still win about {E}%.',
        other:
          'Only {S} {g:big blind}s left: go {g:all-in} or fold. They fold about {Pfold}%. If called, you still win about {E}%.',
      },
      CALL_ALLIN:
        'You need {need}% to call. You win about {E}% against hands that go all-in here. Call.',
      FOLD_ALLIN:
        'You need {need}% to call. Against hands that go all-in here, you win only about {E}%. Fold.',
      COMMITTED:
        'The pot is big compared to your chips. With {handName}, folding gives up too much.',
      NUTS: 'You have the best possible hand. Make the pot big.',
      BOARD_PLAYS: "Your cards don't help. The board is your hand, and everyone shares it.",
      RANGE_ADJUST:
        'Against any cards you win {eRandom}%. This player {actionDescription} only with good hands. Against those, you win about {eRange}%.',
      WHY_NOT_FOLD: 'Why not fold? You win more often than you need to.',
      WHY_NOT_CHECK: 'Why not check? Worse hands would get a free card.',
      WHY_NOT_CALL: 'Why not call? You need {need}%, and you win about {E}%.',
      WHY_NOT_BET: 'Why not bet? Better hands call, and worse hands fold.',
      WHY_NOT_RAISE: 'Why not raise? Worse hands fold, and better hands call.',
      CLOSE_SPOT: 'Close call: {alt} is also fine.',
      GUARDRAIL: 'This decision is clear. {detail}',
      RULE_2_4:
        'Quick trick: outs × 2 ≈ % for the next card. Outs × 4 ≈ % by the river. Exact: {exact}%.',
      RULE_2_4_BIG: 'The trick guesses too high for big draws.',

      // Variants (Appendix F.1 notes, chunk 5.6): the coach never contradicts its own numbers.
      'CALL_PREFLOP.close':
        'You win about {E}% against their likely hands. You need {need}%. It is close, but calling is a little better.',
      'CALL_PREFLOP.implied':
        'You win about {E}% against their likely hands. You need {need}%. If you make a {g:set}, you can win a big pot.',
      'CALL_PROFITABLE.close':
        'You win about {E}%. You need {need}% to call {toCall} into {pot}. It is close, but calling is a little better.',
      'FOLD_PRICE.close':
        'You need {need}% to call. You win about {E}%. It is close, but folding is a little better.',
      'FOLD_PRICE.realise':
        'You need {need}% to call. You win about {E}% if you see every card. Later bets can make you fold before that. Folding saves chips.',
      'CALL_ALLIN.close':
        'You need {need}% to call. You win about {E}% against hands that go all-in here. It is close, but calling is a little better.',
      'FOLD_ALLIN.close':
        'You need {need}% to call. Against hands that go all-in here, you win about {E}%. It is close, but folding is a little better.',
      'VALUE_BET.noExample': 'Your {handName} is probably best (about {E}%). Bet {size}.',
      'VALUE_BET.multiway':
        'Your {handName} is strong against {n} players (about {E}%). Bet {size}. Worse hands like {example} can pay you.',
      'VALUE_BET.multiwayNoExample':
        'Your {handName} is strong against {n} players (about {E}%). Bet {size}.',
      'SEMI_BLUFF.turn':
        '{draw}: {outs} {g:outs}. You hit about {hitNext}% on the river. Betting can win now or later.',
      'PUSH_FOLD.fold': {
        count: 'S',
        one: 'Only {S} {g:big blind} left: go {g:all-in} or fold. They fold only about {Pfold}%. If called, you win only about {E}%.',
        other:
          'Only {S} {g:big blind}s left: go {g:all-in} or fold. They fold only about {Pfold}%. If called, you win only about {E}%.',
      },
      'RANGE_ADJUST.weaker':
        'Against any cards you win {eRandom}%. How they played makes strong hands less likely. Against their likely hands, you win about {eRange}%.',
      'RANGE_ADJUST.plain':
        'Against any cards you win {eRandom}%. Against their likely hands, you win about {eRange}%.',
      FALLBACK: 'This move wins the most chips over time.',

      // The hint's own lines (§8.10 hint structure 1 and 3) and `{alt}` (F.1: chips only).
      'headline.fold': 'Fold',
      'headline.check': 'Check',
      'headline.call': 'Call {amount}',
      'headline.callAllIn': 'Call all-in {amount}',
      'headline.bet': 'Bet {size}',
      'headline.raise': 'Raise to {size}',
      'headline.allIn': 'All-in {size}',
      numbers: 'Win {eRandom}% · Need {need}% · Pot {pot} · To call {toCall}',
      'numbers.free': 'Win {eRandom}% · Pot {pot}',
      'numbers.short': 'Win {eRandom}% · Need {need}% · Pot you can win {pot} · To call {toCall}',
      'alt.fold': 'Fold',
      'alt.check': 'Check',
      'alt.call': 'Call {amount}',
      'alt.callAllIn': 'Call all-in {amount}',
      'alt.bet': 'Bet {amount}',
      'alt.raise': 'Raise to {amount}',
      'alt.allIn': 'All-in {amount}',

      // Words for F.1 placeholders: {example} (VALUE_BET), {actionDescription}, {detail}.
      'example.pair': 'smaller pairs',
      'example.twoPair': 'one pair',
      'example.trips': 'one pair and two pair',
      'example.straight': 'two pair and sets',
      'example.flush': 'straights and sets',
      'example.fullHousePlus': 'flushes and straights',
      'villain.betsBig': 'bets big',
      'villain.bets': 'bets',
      'villain.raises': 'raises',
      'villain.reRaises': 're-raises',
      'villain.allIn': 'goes all-in',
      'villain.calls': 'calls',
      'detail.checkFree': 'Checking is free.',
      'detail.tooStrongToFold': 'Your hand is too strong to fold.',
      'detail.riverNoChance': 'You almost never win here.',
      'detail.allInPriceGood': 'The price is too good to fold.',
      'detail.allInPriceBad': 'You win too rarely to call.',

      // Appendix F.5: feedback card reasons (Stage 6 picks the row).
      'feedback.foldedPrice': 'You folded with a {E}% win chance. You needed only {need}% to call.',
      'feedback.foldedPriceRange':
        'You folded with a {E}% win chance against their likely hands. You needed only {need}% to call.',
      'feedback.calledPrice':
        'You called with a {E}% win chance. You needed {need}%. Calling loses chips over time.',
      'feedback.calledPriceRange':
        'You called with a {E}% win chance against their likely hands. You needed {need}%. Calling loses chips over time.',
      'feedback.checkedStrong':
        'You checked a very strong hand. Betting wins more from worse hands.',
      'feedback.airMultiway':
        'You bet with almost nothing into {n} players. Someone usually calls.',
      'feedback.airHeadsUp': 'This bet rarely makes better hands fold. Checking was cheaper.',
      'feedback.sizeBig': 'Good idea, but the size was too big. Coach: {size}.',
      'feedback.sizeSmall': 'Good idea, but the size was too small. Coach: {size}.',
      'feedback.openLoose': '{hand} is too weak to play from here. Most players fold it.',
      'feedback.foldedStrong':
        '{hand} is in the top {rankPct}% of hands. It is strong enough to play.',
      'feedback.pushFoldAllIn': {
        count: 'S',
        one: 'With {S} big blind, {hand} should go all-in.',
        other: 'With {S} big blinds, {hand} should go all-in.',
      },
      'feedback.pushFoldFold': {
        count: 'S',
        one: 'With {S} big blind, {hand} should fold.',
        other: 'With {S} big blinds, {hand} should fold.',
      },
      'feedback.fallback': "The coach's move wins more chips here: {alt}.",
    } satisfies Record<TemplateKey, CoachTemplate>,
    /** `{draw}` when the hand has no named draw. */
    genericDraw: 'draw',
    /** `{size}` (F.1): "1,200 (60 BB)", with a no-break space before "BB". */
    size: (to: string, bb: string) => `${to} (${bb}\u00A0BB)`,
  },

  /**
   * The glossary (Appendix F.9), one line each. A term's keys (`{g:term}`): each name split at
   * " / ", plus a parenthesised alias, lower case (`glossaryKeys` in `i18n/coach.ts`); "call /
   * check / fold / raise" gives four keys that share one definition.
   */
  glossary: [
    { term: 'all-in', definition: 'Betting all the chips you have left.' },
    {
      term: 'big blind (BB)',
      definition: 'The larger forced bet. Amounts are often counted in big blinds.',
    },
    { term: 'blinds', definition: 'Two forced bets that start the pot each hand.' },
    { term: 'bluff', definition: 'A bet with a weak hand, hoping better hands fold.' },
    { term: 'board', definition: 'The shared cards in the middle of the table.' },
    {
      term: 'button',
      definition: 'The dealer seat. It acts last after the flop, which is an advantage.',
    },
    {
      term: 'call / check / fold / raise',
      definition:
        'Match the bet / pass without betting / give up the hand / bet more than the current bet.',
    },
    {
      term: 'continuation bet (c-bet)',
      definition: 'A bet on the flop by the player who raised before the flop.',
    },
    { term: 'draw', definition: 'A hand that needs more cards to become strong.' },
    {
      term: 'equity / win chance',
      definition: 'Your share of the pot if the hand were played out many times.',
    },
    {
      term: 'flop / turn / river',
      definition: 'The first three shared cards / the fourth / the fifth and last.',
    },
    {
      term: 'gutshot',
      definition: 'A straight draw that needs one exact rank in the middle. 4 outs.',
    },
    { term: 'heads-up', definition: 'Only two players.' },
    { term: 'kicker', definition: 'A side card that breaks ties between equal hands.' },
    { term: 'limp', definition: 'Calling the big blind instead of raising.' },
    {
      term: 'need % / pot odds',
      definition: 'How often you must win for a call to pay: call ÷ (pot + call).',
    },
    { term: 'nuts', definition: 'The best possible hand right now.' },
    {
      term: 'open-ended straight draw',
      definition: 'Four cards in a row that can be completed at either end. 8 outs.',
    },
    { term: 'outs', definition: 'Cards still in the deck that improve your hand.' },
    { term: 'risky out', definition: 'An out that improves you but may help an opponent more.' },
    { term: 'overpair', definition: 'A pocket pair higher than every card on the board.' },
    { term: 'pocket pair', definition: 'Two hole cards of the same rank.' },
    { term: 'position', definition: 'Where you sit. Acting later is better.' },
    { term: 'pot', definition: 'All the chips bet this hand.' },
    { term: 'range', definition: 'All the hands a player could have here.' },
    { term: 'semi-bluff', definition: 'A bet with a draw: it can win now or improve later.' },
    { term: 'set', definition: 'Three of a kind made with a pocket pair.' },
    { term: 'showdown', definition: 'Players show their cards; the best hand wins.' },
    { term: 'side pot', definition: 'A separate pot that an all-in player cannot win.' },
    {
      term: 'SPR',
      definition: 'Your chips behind divided by the pot. Low SPR means close to all-in.',
    },
    { term: 'split pot', definition: 'Equal hands share the pot.' },
    { term: 'top pair', definition: 'Pairing the highest card on the board.' },
    { term: 'value bet', definition: 'A bet with a strong hand, hoping worse hands call.' },
  ],
} as const;
