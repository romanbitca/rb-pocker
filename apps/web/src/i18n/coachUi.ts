/**
 * The coach's words that load with the coach's lazy chunk (PLAN §0.3 Strings, §15.3): the
 * Appendix F.1 reason templates (and the words their placeholders map to) and the Appendix F.9
 * glossary. Everything else the coach says is in `en.ts` (the strip's words are in the initial
 * bundle). Every value a template receives is already formatted (see `ui/coachText.ts`).
 *
 * ⚠️ The templates are a stand-in until chunk 5.6 (`explain`, `check-copy`) owns them; the words
 * are F.1's.
 */

/** A template's placeholder values (Appendix F.1), already formatted. */
type Vars = Readonly<Record<string, string>>;

export const coachText = {
  /** Appendix F.1 reason templates, by reason code. */
  reason: {
    OPEN_RANGE: (v: Vars) =>
      `${v.hand} is in the top ${v.rankPct}% of starting hands. ${v.behind} players act after you. Play about the top ${v.openPct}% here. Raise to ${v.size}.`,
    FOLD_RANGE: (v: Vars) =>
      `${v.hand} is not strong enough here. ${v.behind} players act after you. Folding saves chips.`,
    ISOLATE: (v: Vars) => `Players only called. Raise to ${v.size} to play against fewer players.`,
    CHECK_FREE: () => 'Checking costs nothing. Never fold when you can check.',
    THREE_BET_VALUE: (v: Vars) =>
      `Your ${v.hand} beats most hands that raise here (about ${v.E}%). Re-raise to ${v.size}.`,
    FOUR_BET_VALUE: (v: Vars) =>
      `Your ${v.hand} is ahead of most re-raising hands. Raise again to ${v.size}.`,
    CALL_PREFLOP: (v: Vars) =>
      `You win about ${v.E}% against their likely hands. You need ${v.need}%. Calling is fine.`,
    FOLD_VS_RAISE: (v: Vars) =>
      `They raised, so they likely have a good hand. ${v.hand} wins only about ${v.E}% against it.`,
    SET_MINING: () =>
      'Small {g:pocket pair}. Call to try for a {g:set}. You hit about 1 time in 8. Then you can win a big pot.',
    CALL_PROFITABLE: (v: Vars) =>
      `You win about ${v.E}%. You need ${v.need}% to call ${v.toCall} into ${v.pot}. ${v.E}% is more than ${v.need}%, so calling wins over time.`,
    FOLD_PRICE: (v: Vars) =>
      `You need ${v.need}% to call. You win only about ${v.E}%. Folding saves chips.`,
    IMPLIED: (v: Vars) =>
      `The price alone needs ${v.need}%. If you hit your ${v.draw}, you can win more later. About ${v.needImplied}% is enough.`,
    VALUE_BET: (v: Vars) =>
      `Your ${v.handName} is probably best (about ${v.E}%). Bet ${v.size}. Worse hands like ${v.example} can pay you.`,
    VALUE_RAISE: (v: Vars) => `You likely have the best hand. Raise to ${v.size} to win more.`,
    RAISE_PROTECT: () =>
      'Strong, but this board has many draws. Raise now so draws pay to continue.',
    THIN_VALUE: (v: Vars) =>
      `Your ${v.handName} is a bit better than their calling hands. A small bet of ${v.size} wins more.`,
    POT_CONTROL: (v: Vars) =>
      `Medium hand (${v.handName}). Check. Better hands would call a bet. Worse hands would fold.`,
    SEMI_BLUFF: (v: Vars) =>
      `${v.Draw}: ${v.outs} {g:outs}. You hit about ${v.hitNext}% next card and ${v.hitRiver}% by the river. Betting can win now or later.`,
    CBET_DRY: (v: Vars) =>
      `You raised before the flop. This board likely missed them. A small bet of ${v.size} often wins.`,
    CHECK_WEAK: () => 'You have little now. Check and see the next card for free.',
    PUSH_FOLD: (v: Vars) =>
      `Only ${v.S} {g:big blind}s left: go {g:all-in} or fold. They fold about ${v.Pfold}%. If called, you still win about ${v.E}%.`,
    CALL_ALLIN: (v: Vars) =>
      `You need ${v.need}% to call. You win about ${v.E}% against hands that go all-in here. Call.`,
    FOLD_ALLIN: (v: Vars) =>
      `You need ${v.need}% to call. Against hands that go all-in here, you win only about ${v.E}%. Fold.`,
    COMMITTED: (v: Vars) =>
      `The pot is big compared to your chips. With ${v.handName}, folding gives up too much.`,
    NUTS: () => 'You have the best possible hand. Make the pot big.',
    BOARD_PLAYS: () => "Your cards don't help. The board is your hand, and everyone shares it.",
    RANGE_ADJUST: (v: Vars) =>
      `Against any cards you win ${v.eRandom}%. This player ${v.actionDescription} only with good hands. Against those, you win about ${v.eRange}%.`,
    WHY_NOT_FOLD: () => 'Why not fold? You win more often than you need to.',
    WHY_NOT_CHECK: () => 'Why not check? Worse hands would get a free card.',
    WHY_NOT_CALL: (v: Vars) => `Why not call? You need ${v.need}%, and you win about ${v.E}%.`,
    WHY_NOT_BET: () => 'Why not bet? Better hands call, and worse hands fold.',
    WHY_NOT_RAISE: () => 'Why not raise? Worse hands fold, and better hands call.',
    CLOSE_SPOT: (v: Vars) => `Close call: ${v.alt} is also fine.`,
    GUARDRAIL: (v: Vars) => `This decision is clear. ${v.detail}`,
    RULE_2_4: (v: Vars) =>
      `Quick trick: outs × 2 ≈ % for the next card. Outs × 4 ≈ % by the river. Exact: ${v.exact}%.`,
    RULE_2_4_BIG: () => 'The trick guesses too high for big draws.',
  },
  /** F.1 `{example}` (VALUE_BET), by the hero's category. */
  example: {
    highCard: 'smaller pairs',
    pair: 'smaller pairs',
    twoPair: 'one pair',
    trips: 'one pair and two pair',
    straight: 'two pair and sets',
    flush: 'straights and sets',
    fullHouse: 'flushes and straights',
    quads: 'flushes and straights',
    straightFlush: 'flushes and straights',
    royalFlush: 'flushes and straights',
  },
  /** F.1 `{actionDescription}` (RANGE_ADJUST), from the villain's last voluntary action. */
  actionDescription: {
    betBig: 'bets big',
    bet: 'bets',
    raise: 'raises',
    reraise: 're-raises',
    allIn: 'goes all-in',
    call: 'calls',
  },
  /** F.1 `{detail}` (GUARDRAIL), by §8.8 rule. */
  guardrail: {
    checkFree: 'Checking is free.',
    tooStrong: 'Your hand is too strong to fold.',
    neverWins: 'You almost never win here.',
    priceGood: 'The price is too good to fold.',
    winsTooRarely: 'You win too rarely to call.',
  },
  /** F.2 preflop names: "Pocket Sixes", "Ace-King suited", "Ace-King offsuit". */
  pocket: (ranks: string) => `Pocket ${ranks}`,
  suited: (a: string, b: string) => `${a}-${b} suited`,
  offsuit: (a: string, b: string) => `${a}-${b} offsuit`,
} as const;

/**
 * The glossary (Appendix F.9): one line each. Keys: every name in `term`, split at " / ", plus a
 * parenthesised alias, lower-case (`ui/glossary.ts`); "{g:big blind}s" links the key only.
 */
/**
 * The strip, sheet and panels (PLAN §10.2, §12.6, §12.11, Appendix F.10). Percentages arrive as
 * whole numbers without the sign ("45", "<1"); amounts formatted ("2,340").
 */
export const coachWords = {
  /** The strip (§12.6). */
  thinking: 'Coach is thinking…',
  prefix: 'Coach:',
  hint: 'Hint',
  why: 'Why?',
  /** The strip opens the sheet (the "›"): its accessible name ends with this. */
  openSheet: 'Show why',
  failed: 'Coach is not available. Tap to try again.',
  /** Compact mode's pill in the hero strip (§12.3). */
  pill: 'Coach',
  /** Beginner's strip line when facing a bet (§12.6): "You win about 45%. You need 25%." */
  winNeed: (win: string, need: string) => `You win about ${win}%. You need ${need}%.`,
  /** The labelled pair when the hint shows both equities (§8.10 RANGE_ADJUST, pitfall 35). */
  pair: (any: string, likely: string) =>
    `Any cards: ${any}%. Their likely hands: about ${likely}%.`,
  /** The headline (§8.10 hint structure 1): "Call 40", "Raise to 60 (3 BB)". */
  headline: {
    fold: 'Fold',
    check: 'Check',
    call: (x: string) => `Call ${x}`,
    bet: (x: string) => `Bet ${x}`,
    raise: (x: string) => `Raise to ${x}`,
    allIn: (x: string) => `All-in ${x}`,
  },
  /** Appendix F.1 `{size}` = "{to} ({bb} BB)". */
  size: (to: string, bb: string) => `${to} (${bb}\u00A0BB)`,
  close: 'Close',
  doThis: 'Do this',
  clear: 'Clear choice',
  whyTitle: 'Why',
  more: 'More',
  numbers: 'The numbers',
  winAny: (x: string) => `Win chance ${x}% (any cards)`,
  winLikely: (x: string) => `Against their likely hands: about ${x}%`,
  need: (x: string) => `Need ${x}%`,
  pot: (x: string) => `Pot ${x}`,
  toCall: (x: string) => `To call ${x}`,
  /** The price bar's verdict (✓ / ✗ are drawn icons). */
  barGood: 'You win more often than you need.',
  barBad: 'You win less often than you need.',
  /** The price bar's name: "Win chance 45% (any cards). Need 25%." (`win` is a labelled line). */
  barLabel: (win: string, need: string) => `${win}. Need ${need}%.`,
  yourHand: 'Your hand',
  nextRiver: (next: string, river: string) => `Next card: ${next}% · By river: ${river}%`,
  beaters: (n: string, total: string) => `Hands that beat you right now: ${n} of ${total} possible`,
  whyNotTitle: 'Why not…',
  learnMore: 'Learn more',
  useSize: 'Use coach size',
  /** The strength meter at Beginner (§8.10): five labelled segments. */
  strength: {
    weak: 'Weak',
    marginal: 'Marginal',
    decent: 'Decent',
    strong: 'Strong',
    monster: 'Monster',
  },
  strengthLabel: (label: string) => `Hand strength: ${label}`,
  /** Bots acting (§12.6): "Ben raises to 60." The hero's own: "You call 40." */
  narrate: {
    fold: (name: string) => `${name} folds.`,
    check: (name: string) => `${name} checks.`,
    call: (name: string, x: string) => `${name} calls ${x}.`,
    bet: (name: string, x: string) => `${name} bets ${x}.`,
    raise: (name: string, x: string) => `${name} raises to ${x}.`,
    youFold: 'You fold.',
    youCheck: 'You check.',
    youCall: (x: string) => `You call ${x}.`,
    youBet: (x: string) => `You bet ${x}.`,
    youRaise: (x: string) => `You raise to ${x}.`,
    allIn: ' All-in.',
  },
} as const;

export const glossary = [
  { term: 'all-in', text: 'Betting all the chips you have left.' },
  {
    term: 'big blind (BB)',
    text: 'The larger forced bet. Amounts are often counted in big blinds.',
  },
  { term: 'blinds', text: 'Two forced bets that start the pot each hand.' },
  { term: 'bluff', text: 'A bet with a weak hand, hoping better hands fold.' },
  { term: 'board', text: 'The shared cards in the middle of the table.' },
  {
    term: 'button',
    text: 'The dealer seat. It acts last after the flop, which is an advantage.',
  },
  {
    term: 'call / check / fold / raise',
    text: 'Match the bet / pass without betting / give up the hand / bet more than the current bet.',
  },
  {
    term: 'continuation bet (c-bet)',
    text: 'A bet on the flop by the player who raised before the flop.',
  },
  { term: 'draw', text: 'A hand that needs more cards to become strong.' },
  {
    term: 'equity / win chance',
    text: 'Your share of the pot if the hand were played out many times.',
  },
  {
    term: 'flop / turn / river',
    text: 'The first three shared cards / the fourth / the fifth and last.',
  },
  { term: 'gutshot', text: 'A straight draw that needs one exact rank in the middle. 4 outs.' },
  { term: 'heads-up', text: 'Only two players.' },
  { term: 'kicker', text: 'A side card that breaks ties between equal hands.' },
  { term: 'limp', text: 'Calling the big blind instead of raising.' },
  {
    term: 'need % / pot odds',
    text: 'How often you must win for a call to pay: call ÷ (pot + call).',
  },
  { term: 'nuts', text: 'The best possible hand right now.' },
  {
    term: 'open-ended straight draw',
    text: 'Four cards in a row that can be completed at either end. 8 outs.',
  },
  { term: 'outs', text: 'Cards still in the deck that improve your hand.' },
  { term: 'risky out', text: 'An out that improves you but may help an opponent more.' },
  { term: 'overpair', text: 'A pocket pair higher than every card on the board.' },
  { term: 'pocket pair', text: 'Two hole cards of the same rank.' },
  { term: 'position', text: 'Where you sit. Acting later is better.' },
  { term: 'pot', text: 'All the chips bet this hand.' },
  { term: 'range', text: 'All the hands a player could have here.' },
  { term: 'semi-bluff', text: 'A bet with a draw: it can win now or improve later.' },
  { term: 'set', text: 'Three of a kind made with a pocket pair.' },
  { term: 'showdown', text: 'Players show their cards; the best hand wins.' },
  { term: 'side pot', text: 'A separate pot that an all-in player cannot win.' },
  {
    term: 'SPR',
    text: 'Your chips behind divided by the pot. Low SPR means close to all-in.',
  },
  { term: 'split pot', text: 'Equal hands share the pot.' },
  { term: 'top pair', text: 'Pairing the highest card on the board.' },
  { term: 'value bet', text: 'A bet with a strong hand, hoping worse hands call.' },
] as const;
