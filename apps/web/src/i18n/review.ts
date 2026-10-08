/**
 * Review's words (PLAN §12.10, chunk 6.3, Appendix F.10): what the replay screen says. They live
 * here, not in `en.ts`, because only the lazy Review chunk uses them: the initial bundle (§15.3,
 * 150 KB gate) does not pay for them (§0.3 "Strings", the exception for lazy screens). The three
 * lines the app shows while that chunk loads or fails stay in `en.review` (`en.ts`).
 *
 * Amounts arrive formatted ("2,340"); `hero` picks "You fold." over "Ben folds.".
 */
export const enReview = {
  /** The heading of a replay: "Hand 12". */
  title: (n: string) => `Hand ${n}`,
  listTitle: 'Recent hands',
  /** Phones: from a replay to the list. */
  allHands: 'All hands',
  empty: 'No finished hands yet.',
  emptyHint: 'Play a hand, then come back here to replay it.',
  backToGame: 'Back to the game',
  /** A hand that cannot be replayed (§4.7): its result only. */
  version: 'This hand was saved by an older version of the game, so it cannot be replayed.',
  broken: 'This hand cannot be replayed.',
  /** The hero's result of a hand ("+160" is shown; this is what a screen reader says). */
  youWon: (x: string) => `You won ${x} chips.`,
  youLost: (x: string) => `You lost ${x} chips.`,
  even: 'You broke even.',
  /** The step controls. */
  steps: {
    group: 'Step through the hand',
    first: 'First step',
    prev: 'Previous step',
    next: 'Next step',
    last: 'Last step',
    play: 'Play',
    pause: 'Pause',
    /** The slider's name, and "Start" / "Step 7 of 23" for its position. */
    slider: 'Step',
    start: 'Start',
    of: (i: number, n: number) => `Step ${i} of ${n}`,
  },
  /** What happened at a step, one short sentence each. */
  says: {
    deal: 'The cards are dealt.',
    smallBlind: (name: string, hero: boolean, x: string) =>
      hero ? `You post the small blind, ${x}.` : `${name} posts the small blind, ${x}.`,
    bigBlind: (name: string, hero: boolean, x: string) =>
      hero ? `You post the big blind, ${x}.` : `${name} posts the big blind, ${x}.`,
    fold: (name: string, hero: boolean) => (hero ? 'You fold.' : `${name} folds.`),
    check: (name: string, hero: boolean) => (hero ? 'You check.' : `${name} checks.`),
    call: (name: string, hero: boolean, x: string) =>
      hero ? `You call ${x}.` : `${name} calls ${x}.`,
    bet: (name: string, hero: boolean, x: string) =>
      hero ? `You bet ${x}.` : `${name} bets ${x}.`,
    raise: (name: string, hero: boolean, x: string) =>
      hero ? `You raise to ${x}.` : `${name} raises to ${x}.`,
    allIn: 'All-in.',
    flop: (cards: string) => `The flop: ${cards}.`,
    turn: (cards: string) => `The turn: ${cards}.`,
    river: (cards: string) => `The river: ${cards}.`,
    /** `names` is "you and Ben". */
    showdown: (names: string) => `Showdown. Cards face up: ${names}.`,
    runout: (names: string) => `All-in. Cards face up: ${names}.`,
    refund: (name: string, hero: boolean, x: string) =>
      hero ? `You get ${x} back. Nobody called.` : `${name} gets ${x} back. Nobody called.`,
    reshuffle: 'Move taken back. The unseen cards were shuffled again.',
  },
} as const;
