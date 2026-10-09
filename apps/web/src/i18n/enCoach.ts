/**
 * The coach's words (PLAN §8.10, Appendix F.1, F.9; chunk 5.6): the hint templates and the
 * glossary. Apart from `en.ts` so they load with the coach's lazy chunk (§15.3; chunk 5.7 moved
 * them: only `i18n/coach.ts` imports this module, and the coach UI imports that).
 */
import type { TemplateKey } from '../brain/explain.ts';
import type { CoachTemplate } from './coach.ts';

export const enCoach = {
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
