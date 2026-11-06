/**
 * The words of the end-of-hand summary and the Exam result (PLAN §10.2, §12.9, Appendix F.10;
 * chunk 6.4). They load with the summary's lazy chunk (`ui/summaryEntry.ts`, §15.3).
 */
import { about } from './en.ts';

export const summaryWords = {
  /** "Hand 12: +160" (a real minus sign for a loss). */
  title: (hand: string, net: string) => `Hand ${hand}: ${net}`,
  /** Exam's heading above the title (§10.2). */
  exam: 'Exam result',
  /** "Your score: 82 of 100" (the decision score of the hand, §14.4). */
  score: (score: number) => `Your score: ${score} of 100`,
  streets: {
    preflop: 'Before the flop',
    flop: 'Flop',
    turn: 'Turn',
    river: 'River',
  },
  /**
   * What you did. An all-in says so, as the action bar does (QA-2 of 6 Nov 2026, item 6: "You
   * raised to 710" was the hero's whole stack).
   */
  did: {
    fold: 'You folded',
    check: 'You checked',
    call: 'You called',
    callAllIn: 'You called all-in',
    bet: (x: string) => `You bet ${x}`,
    raise: (x: string) => `You raised to ${x}`,
    allIn: (x: string) => `You went all-in for ${x}`,
  },
  /** The coach's move, when it was another ("Coach: All-in 200", the hint's headline). */
  coach: {
    fold: 'Coach: Fold',
    check: 'Coach: Check',
    call: 'Coach: Call',
    callAllIn: 'Coach: Call all-in',
    bet: (x: string) => `Coach: Bet ${x}`,
    raise: (x: string) => `Coach: Raise to ${x}`,
    allIn: (x: string) => `Coach: All-in ${x}`,
  },
  /**
   * A Best grade for a move other than the coach's (§8.9: the close alternative, or a loss of at
   * most 1% of the pot) says so, in place of "Coach: Fold": "Calling was as good as folding here."
   * (fix/coach-strategy-audit: "Best move" next to "Coach: Fold" left the player guessing.)
   */
  asGood: (did: string, coach: string) => `${did} was as good as ${coach} here.`,
  /**
   * A check or a call graded Slightly off or worse where the coach bet or raised: the coach's move
   * wins more (§8.9 "value missed"; QA-2 of 6 Nov 2026, item 1: "Coach: Raise to 2,100" beside a
   * Big mistake read as "calling was wrong" with the nut flush), in place of "Coach: Raise to …".
   */
  winsMore: (coach: string) => `${coach} wins more here.`,
  /** The moves in `asGood` and `winsMore`: what you did, then the coach's. */
  doing: {
    fold: 'Folding',
    check: 'Checking',
    call: 'Calling',
    callAllIn: 'Calling all-in',
    bet: (x: string) => `Betting ${x}`,
    raise: (x: string) => `Raising to ${x}`,
    allIn: (x: string) => `Going all-in for ${x}`,
  },
  coachDoing: {
    fold: 'folding',
    check: 'checking',
    call: 'calling',
    callAllIn: 'calling all-in',
    bet: (x: string) => `betting ${x}`,
    raise: (x: string) => `raising to ${x}`,
    allIn: (x: string) => `going all-in for ${x}`,
  },
  /** The numbers at the decision: "You had 45%, needed 25%." (each with its % sign). */
  numbers: (win: string, need: string) => `You had ${win}, needed ${need}.`,
  win: (win: string) => `You had ${win}.`,
  /**
   * The HUD's number and the one the hint and the grade compared, labelled as the strip labels
   * them (§8.10: "Any cards: 62%. Their likely hands: about 35%."; QA-1, and QA-2 item 3: the
   * hint's own number, not another estimate). An estimate says "about", a bound does not.
   */
  likely: (any: string, likely: string, need: string) =>
    `Any cards: ${any}. Their likely hands: ${about(likely)}, needed ${need}.`,
  likelyOnly: (any: string, likely: string) =>
    `Any cards: ${any}. Their likely hands: ${about(likely)}.`,
  /**
   * The same when the number counts only the raiser (and the callers already in), fewer players
   * than the HUD's: each says whom, as the strip does (§8.10, "All 3 players: 34%. Raiser alone:
   * about 56%.").
   */
  whom: (players: number, any: string, callers: number, likely: string) =>
    `All ${players} players: ${any}. ${
      callers === 0 ? 'Raiser alone' : `Raiser + ${callers} ${callers === 1 ? 'caller' : 'callers'}`
    }: ${about(likely)}`,
  /** `whom` with the price, or alone: "…: about 56%, needed 33%." / "…: about 56%." */
  whomPrice: (whom: string, need: string) => `${whom}, needed ${need}.`,
  whomOnly: (whom: string) => `${whom}.`,
  /** The realised number behind a fold the price alone would pay (the sheet's price bar, §12.6). */
  later: (x: string) => `Counting later bets: ${about(x)}.`,
  /** A decision taken back with Undo (it still counts, §11.4). */
  undone: 'Taken back with Undo',
  /** Grading failed for this decision (§11.3 r5). */
  noGrade: 'No grade',
  review: 'Review hand',
  next: 'Next hand ›',
  close: 'Close',
} as const;
