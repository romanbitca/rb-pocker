/**
 * The hand drill's words (PLAN §13.5, Appendix F.10). They load with the drill's lazy chunk; the
 * name of the page, on Home, in the Menu and over the page, is `en.drill.title` (`en.ts`). The
 * ten hand names and tips are the rankings panel's (`data/rankings.ts`, F.7), and a hand's own
 * name ("Two Pair, Kings and Fives") is `describe()`'s (F.2): one vocabulary for the whole app.
 *
 * Plain, short English: the owner reads English as a second language. Names arrive as they are
 * written on the buttons ("Two pair"); card ranks arrive as words ("King", "Kings").
 */
/** "second" … "fifth" (Equal down to the third card). */
const ORDINALS: Readonly<Record<number, string>> = {
  2: 'second',
  3: 'third',
  4: 'fourth',
  5: 'fifth',
};

export const drillWords = {
  /** The counters (the score is this visit's right answers out of its answers). */
  streak: 'Streak',
  score: 'Score',
  best: 'Best',
  scoreValue: (right: number, total: number) => `${right}/${total}`,
  /** The game button's name for screen readers (it shows the game and the difficulty). */
  choose: 'Choose game and difficulty',
  allHands: 'All hands',
  stats: 'Stats',
  /** Above the pickers. */
  hand: 'Hand',
  pickOne: 'Pick one',
  position: 'Position',
  ladder: '1 strongest · 10 weakest',
  positionName: (p: number) => `Position ${p}`,
  keyboard: 'Keyboard: 1 to 9, 0 for 10 · Enter for next · H for all hands',
  next: 'Next',
  /** Over the cards. */
  table: 'Table',
  yourHand: 'Your hand',
  you: 'You',
  opponent: 'Opponent',
  handA: 'Hand A',
  handB: 'Hand B',
  stronger: 'One step stronger',
  weaker: 'One step weaker',
  /** The tag on a trap hand's answer. */
  trap: 'Trap',
  /** "This round": the hands of the answered question, marked in the All hands drawer. */
  thisRound: 'This round',

  /** The games, in the order of the list. `short` is for the game button when the name is long. */
  games: {
    mixed: { name: 'Mixed', desc: 'Every game below, shuffled together.' },
    cards: {
      name: 'Name the hand',
      desc: '5 cards. Pick the hand and its position. Some are trap hands.',
    },
    holdem: {
      name: "Hold'em: your hand",
      short: "Hold'em",
      desc: '5 cards on the table and 2 in your hand. Find your best hand and its position.',
    },
    showdown: {
      name: 'Showdown',
      desc: 'You and an opponent share the table. Who wins, or is it a split pot?',
    },
    versus: {
      name: 'Which wins',
      desc: 'Two hands of 5 cards. Some are the same type and the kickers decide. Some tie.',
    },
    order: {
      name: 'Higher or lower',
      desc: 'Hand names only. Which ranks higher, or which is one step above or below.',
    },
    pos2name: { name: 'Position to hand', desc: 'You see a position number. Pick the hand.' },
    name2pos: { name: 'Hand to position', desc: 'You see a hand name. Pick its position.' },
  },
  difficulties: {
    easy: { name: 'Easy', desc: 'Clear textbook hands. Most matchups are different hand types.' },
    normal: { name: 'Normal', desc: 'About half are traps, kicker battles or split pots.' },
    hard: { name: 'Hard', desc: 'Mostly traps, close kicker battles and split pots.' },
  },
  /** The game sheet. */
  gamesTitle: 'Choose a game',
  difficulty: 'Difficulty',
  game: 'Game',
  playing: 'Playing',
  close: 'Close',

  /** What each question asks, and the hint under it before the answer. */
  prompts: {
    cards: 'Name the hand and its position',
    holdem: 'What is your best hand?',
    showdown: 'Who wins this hand?',
    versus: 'Which hand wins?',
    hl: 'Which ranks higher?',
    above: 'Which hand is one step stronger?',
    below: 'Which hand is one step weaker?',
    pos2name: 'Which hand is at this position?',
    name2pos: 'What position is this hand?',
  },
  hints: {
    cards: 'Pick the hand name, then its position.',
    holdem: 'Use any 5 of the 7 cards. Pick the hand, then its position.',
    showdown: 'Both players use the same 5 table cards plus their own 2.',
    versus: 'Tap the stronger hand, or Split pot if they are equal.',
    hl: 'Tap the hand that ranks higher.',
    above: 'Pick the hand right above it on the ladder.',
    below: 'Pick the hand right below it on the ladder.',
    pos2name: 'Pick the hand that sits at this position.',
    name2pos: 'Pick the position of this hand.',
  },
  options: {
    you: 'You win',
    opp: 'Opponent wins',
    split: 'Split pot',
    a: 'Hand A',
    b: 'Hand B',
    tie: 'Split pot (tie)',
  },

  /** The answer: the first line says right or wrong, the second explains. */
  answer: {
    right: (name: string, pos: number) => `Correct. ${name} · #${pos}`,
    itIs: (name: string, pos: number) => `It's ${name}, #${pos}.`,
    youSaid: (name: string, pos: number) => `You said ${name}, #${pos}.`,
    nameWrong: (name: string) => `Position right. You named it ${name}.`,
    positionWrong: (pos: number) => `Name right. You put it at #${pos}.`,
    /** Hold'em: how many of the player's own cards play (in the best five, kickers too). */
    uses: (n: number) =>
      n === 0
        ? 'Made only from the table.'
        : n === 1
          ? 'Uses 1 of your cards.'
          : 'Uses both your cards.',
    /** Position to hand, Hand to position. */
    isAt: (name: string, pos: number) => `${name} is #${pos}.`,
    rightIsAt: (name: string, pos: number) => `Correct. ${name} is #${pos}.`,
    pickedName: (name: string, pos: number) => `You picked ${name}, which is #${pos}.`,
    pickedPosition: (pos: number, name: string) => `You picked #${pos}, which is ${name}.`,
    /** One step stronger or weaker. */
    rightAbove: (name: string, target: string) => `Correct. ${name} is right above ${target}.`,
    rightBelow: (name: string, target: string) => `Correct. ${name} is right below ${target}.`,
    itsName: (name: string) => `It's ${name}.`,
    both: (target: string, tpos: number, name: string, pos: number) =>
      `${target} is #${tpos}, ${name} is #${pos}.`,
    youPicked: (name: string, pos: number) => `You picked ${name} (#${pos}).`,
    /** Higher or lower. */
    ranksHigher: (name: string) => `${name} ranks higher.`,
    rightRanksHigher: (name: string) => `Correct. ${name} ranks higher.`,
    twoPositions: (w: string, wpos: number, l: string, lpos: number) =>
      `${w} is #${wpos}. ${l} is #${lpos}.`,
    /** Which wins and Showdown. */
    correct: (result: string) => `Correct. ${result}`,
    splitPot: 'Split pot.',
    handWins: (hand: 'A' | 'B') => `Hand ${hand} wins.`,
    youWin: 'You win.',
    opponentWins: 'Opponent wins.',
    /** Under each hand: "Flush, Ace-high · #5". */
    handLine: (name: string, pos: number) => `${name} · #${pos}`,
    /** The showdown's result lines. */
    wins: 'Wins',
    loses: 'Loses',
    split: 'Split',
    legend: "A line under a card means it is the player's own. The rest come from the table.",
  },

  /** Why one hand wins (the evaluator's reason, `drill/explain.ts` `Why`). */
  why: {
    rows: (w: string, wpos: number, l: string, lpos: number) =>
      `${w} (#${wpos}) beats ${l} (#${lpos}).`,
    split: (name: string, sideCards: boolean) =>
      `Both have ${name}${sideCards ? ', with the same side cards' : ''}. Suits never break ties, so the pot is split.`,
    /** Straights and straight flushes: the top card decides; `wheel` when the loser is A-2-3-4-5. */
    straight: (flush: boolean, a: string, b: string, wheel: boolean) =>
      `Both have a ${flush ? 'straight flush' : 'straight'}. ${a}-high beats ${b}-high.${wheel ? ' A-2-3-4-5 is the lowest straight.' : ''}`,
    quads: (as: string, bs: string) => `Both have four of a kind. Four ${as} beat four ${bs}.`,
    quadsKicker: (mains: string, a: string, b: string) =>
      `Same four ${mains}. Kicker ${a} beats ${b}.`,
    fullHouse: (as: string, bs: string) =>
      `Both have a full house. The three of a kind decides first: ${as} full beats ${bs} full.`,
    fullHousePair: (mains: string, as: string, bs: string) =>
      `Same three ${mains}. Pair of ${as} beats pair of ${bs}.`,
    trips: (as: string, bs: string) => `Both have three of a kind. Three ${as} beat three ${bs}.`,
    tripsKicker: (mains: string, next: boolean, a: string, b: string) =>
      `Same three ${mains}. ${next ? 'Next kicker' : 'Kicker'} ${a} beats ${b}.`,
    twoPair: (as: string, bs: string) => `Both have two pair. Top pair ${as} beats ${bs}.`,
    twoPairSecond: (mains: string, as: string, bs: string) =>
      `Same top pair (${mains}). Second pair ${as} beats ${bs}.`,
    twoPairKicker: (a: string, b: string) => `Same two pairs. Kicker ${a} beats ${b}.`,
    pair: (as: string, bs: string) => `Both have one pair. ${as} beat ${bs}.`,
    pairKicker: (mains: string, next: boolean, a: string, b: string) =>
      `Same pair of ${mains}. ${next ? 'Next kicker' : 'Kicker'} ${a} beats ${b}.`,
    /** Flush and high card: card by card from the top. `nth` is 2 to 5. */
    topCard: (flush: boolean, a: string, b: string) =>
      `Both have ${flush ? 'a flush' : 'high card'}. Top card ${a} beats ${b}.`,
    nthCard: (flush: boolean, nth: number, a: string, b: string) =>
      `Both have ${flush ? 'a flush' : 'high card'}. Equal down to the ${ORDINALS[nth] ?? `${nth}th`} card: ${a} beats ${b}.`,
  },

  /** The trap notes (the standalone drill's T5 and T7 templates). */
  traps: {
    wrapAround:
      'A run like Q-K-A-2-3 is not a straight. The Ace can only end a run: 10-J-Q-K-A or A-2-3-4-5.',
    wheel: 'A-2-3-4-5 is a straight. The Ace can play low.',
    mixedRoyal: '10-J-Q-K-A in mixed suits is only a straight. A royal flush needs one suit.',
    fourFlush: 'Four cards of one suit are not a flush. All five must match.',
    gap: 'One gap breaks a straight. All five must be in a row.',
    suitedGap: 'One suit but one gap: a flush, not a straight flush.',
    steelWheel: 'A-2-3-4-5 in one suit is a straight flush. A royal flush is only 10-J-Q-K-A.',
    kingHighStraightFlush:
      '9 to K in one suit is a straight flush. A royal flush must reach the Ace.',
    oneOffSuit: 'Five in a row, but one card is another suit. A straight, not a straight flush.',
    fourInARowAndPair: 'Four in a row plus a pair is only one pair.',
    fourSuitedAndPair:
      'Four cards of one suit plus a pair: one pair. A flush needs five of one suit.',
    tripsNotFull:
      'Three of a kind plus two different cards is three of a kind. A full house needs those two to pair.',
    missingTen: 'A-K-Q-J-9 misses the 10. Close to a straight, but only high card.',
    boardStraight: 'The straight is all on the table. It still counts as your hand.',
    pairDoesNotPlay: (pairs: string) =>
      `Your pair of ${pairs} does not play. The two higher pairs on the table make your two pair.`,
    threePairs: 'Three pairs is still two pair. Only the top two pairs play.',
    twoTriples:
      'Two sets of three make a full house. The higher three plays, plus two of the other.',
    fourSuitedBoard: 'Four cards of one suit on the table plus one of yours make a flush.',
    fourSuitedNoFlush:
      'Four cards of one suit on the table are not a flush. You need a fifth card of that suit.',
    boardPairAndYourCard: 'Your card plus the pair on the table makes three of a kind.',
    fillTheMiddle: 'Both your cards fill the middle of the straight.',
    sixInARow: 'Six in a row is still one straight. The top five cards play.',
    straightAndFlush:
      'You have a straight and a flush, but not in the same five cards. The flush ranks higher.',
    boardPair: 'The pair on the table counts for you too. Your cards are only side cards.',
    boardTripsAndYourPair: 'Three of a kind on the table plus your pair makes a full house.',
    aceLow: 'Your Ace plays low: A-2-3-4-5 is a straight.',
    quadsWithYourPair: 'Your pair plus the same pair on the table: four of a kind.',
    flushBoard: 'All five table cards are one suit, so everyone has at least that flush.',
  },

  /** The stats sheet. */
  statsTitle: 'Your stats',
  statsSummary: (answered: number, best: number) =>
    `${answered} answered · best streak ${best}. Hands you miss come up more often.`,
  notSeen: 'not seen yet',
  noAccuracy: '—',
  accuracy: (pct: number) => `${pct}%`,
  rightOf: (right: number, seen: number) => `${right}/${seen}`,
  /** A stats row for screen readers. */
  statsRow: (name: string, pct: number, right: number, seen: number) =>
    `${name}: ${pct}% right, ${right} of ${seen}.`,
  statsRowNone: (name: string) => `${name}: not seen yet.`,
  reset: 'Reset stats',
  resetConfirm: 'Tap again to reset',
} as const;

export type DrillWords = typeof drillWords;
