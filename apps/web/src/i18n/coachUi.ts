/**
 * The coach UI's own words that load with the coach's lazy chunk (PLAN §0.3 Strings, §15.3): the
 * strip, the sheet's titles and numbers, the strength meter, the narration. The hint's sentences
 * and the glossary are chunk 5.6's (`i18n/enCoach.ts`, rendered by `i18n/coach.ts`); the strip's
 * words that the first paint needs are in `en.ts`. (Chunk 5.7 removed the 5.9 stand-in templates
 * and glossary that were here.) An estimate says "about", a bound or a sure number does not
 * (`about`: ">99%", QA-2 of 6 Nov 2026).
 */
import { about } from './en.ts';

/** Whom the HUD's number counts when the range number counts fewer: "All 5 players", "Both players". */
const allPlayers = (players: number): string =>
  players === 2 ? 'Both players' : `All ${players} players`;

/** The range number's label in the strip: whom it counts when that is not every player (§8.10). */
const rangeLabel = (callers: number | null, likely: string): string =>
  callers === null
    ? `Their likely hands: ${about(likely)}%`
    : callers === 0
      ? `Raiser alone: ${about(likely)}%`
      : `Raiser + ${callers} ${callers === 1 ? 'caller' : 'callers'}: ${about(likely)}%`;

/** The price bar's captions (§12.6), and the strip's line when later bets or later wins decided. */
const laterBets = (x: string): string => `Counting later bets: ${about(x)}%`;
const laterWins = (x: string): string => `Counting what you can win later: need ${about(x)}%`;

export const coachWords = {
  /** The strip (§12.6). */
  thinking: 'Coach is thinking…',
  prefix: 'Coach:',
  hint: 'Hint',
  /** Exam's hint button (§10.2, §12.6): opening it counts as help. */
  hintExam: 'Hint (counts as help)',
  why: 'Why?',
  /** The strip opens the sheet ("Why?" on its face): its accessible name ends with this. */
  openSheet: 'Show why',
  failed: 'Coach is not available. Tap to try again.',
  /** Compact mode's pill in the hero strip (§12.3). */
  pill: 'Coach',
  /** Beginner's strip line when facing a bet (§12.6): "You win about 45%. You need 25%." */
  winNeed: (win: string, need: string) => `You win ${about(win)}%. You need ${need}%.`,
  /**
   * The strip when every number on show says "call" and the coach folds because of later bets
   * (§12.6, 1.4.15): the realised number against the price, and with RANGE_ADJUST the labelled
   * range number first, then what later bets leave of it (the need is on the price chip beside
   * it). When they say "fold" and it calls for what a hit can win later, the implied price.
   */
  laterBetsNeed: (win: string, need: string) => `${laterBets(win)}. You need ${need}%.`,
  laterBetsRange: (callers: number | null, likely: string, win: string) =>
    `${rangeLabel(callers, likely)}. ${laterBets(win)}.`,
  laterWinsNeed: (need: string) => `${laterWins(need)}.`,
  /** The labelled pair when the hint shows both equities (§8.10 RANGE_ADJUST, pitfall 35). */
  pair: (any: string, likely: string) => `Any cards: ${any}%. ${rangeLabel(null, likely)}.`,
  /**
   * The pair when the range number counts only the raiser (and the callers already in), fewer
   * players than the HUD's (§8.10): each number says whom. Kept short: the strip shows a sentence a
   * line, and a 360 px phone has 210 px for one beside "Why?" (§12.6).
   */
  pairRaiser: (players: number, any: string, likely: string) =>
    `${allPlayers(players)}: ${any}%. ${rangeLabel(0, likely)}.`,
  pairCallers: (players: number, any: string, callers: number, likely: string) =>
    `${allPlayers(players)}: ${any}%. ${rangeLabel(callers, likely)}.`,
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
  winLikely: (x: string) => `Against their likely hands: ${about(x)}%`,
  /** The same two when the range number counts only the raiser and its callers (§8.10). */
  winAll: (players: number, x: string) =>
    `Against ${allPlayers(players).toLowerCase()} with any cards: ${x}%`,
  winRaiser: (x: string) => `Against the raiser's likely hands alone: ${about(x)}%`,
  winCallers: (callers: number, x: string) =>
    `Against the likely hands of the raiser and ${callers} ${callers === 1 ? 'caller' : 'callers'}: ${about(x)}%`,
  need: (x: string) => `Need ${x}%`,
  pot: (x: string) => `Pot ${x}`,
  toCall: (x: string) => `To call ${x}`,
  /** The price bar's verdict (✓ / ✗ are drawn icons). */
  barGood: 'You win more often than you need.',
  barBad: 'You win less often than you need.',
  /** The price bar's name: "Win chance 45% (any cards). Need 25%." (`win` is a labelled line). */
  barLabel: (win: string, need: string) => `${win}. Need ${need}%.`,
  /**
   * The bar's caption when its number is none of the lines above (§12.6): a fold filled to the
   * realised E·R, or a call against the price with what a hit can win later (F.1 `needImplied`).
   */
  barRealised: laterBets,
  barImplied: laterWins,
  /** The bar's name with an implied-price caption: "{win line}. {caption}." */
  barLabelWith: (win: string, caption: string) => `${win}. ${caption}.`,
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
