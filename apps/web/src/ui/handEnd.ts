/**
 * The hand-end banner's lines (PLAN §12.9, §12.11), from the store's `HandEndView`. Pure.
 *
 * - Everyone else folded: "Everyone folded. You win 120." / "Ben wins 120. Everyone else folded."
 *   No cards are named.
 * - Showdown, one winner: "You win 340!" / "Ben wins 340 with Two Pair, Kings and Sevens."
 * - Showdown, the same amount to several winners: "Split pot: you and Ben each win 170."
 *   Different amounts (side pots, an odd chip): one line per winner.
 * - When the hero wins a showdown, one line per beaten hand that was shown (at most two):
 *   "Ben: Two Pair — loses to your Flush"; with the same category the full names ("Ben: Pair of
 *   Kings — loses to your Pair of Aces"), and with the same name the card that decided it ("Priya:
 *   Two Pair, Fours and Threes — your King kicker beats their Jack"; a flush: "your King beats
 *   their Queen").
 *
 * The banner (`bannerLines`, 1.3.99) adds the hero's own result after the winners: "You won 340" /
 * "You lost 340", what the hand did to the hero's stack (the chips a winner line names include the
 * hero's own). None when it did not change. Review has its own line for it (`netSpoken`).
 *
 * Only hands the engine revealed reach `HandEndView.shown`, so nothing here can name a hidden card.
 *
 * After an all-in the §7.6 luck line follows (`luckLine`, from the store's `LuckLineData`): "You
 * had 72% when the chips went in. Good decision. Unlucky this time." / "You got lucky. You had 30%."
 */
import type { HandEndView, LuckLineData } from '../app/store.ts';
import { RANK_NAMES } from '../core/cards.ts';
import type { HandCategory } from '../eval/evaluate.ts';
import { en } from '../i18n/en.ts';
import { formatChips } from './format.ts';
import { joinNames } from './names.ts';

/** The hero's seat (PLAN §0.3). */
const HERO = 0;
/** Loser lines shown at most (the banner stays short). */
const MAX_LOSER_LINES = 2;

const T = en.handEnd;

const categoryName = (category: HandCategory): string => T.category[category];

/** Who won what, in order. Empty when the hand has no winner (not complete). */
function winnerLines(view: HandEndView): string[] {
  const { winners, shown } = view;
  if (winners.length === 0) return [];
  if (view.endedBy === 'fold') {
    const w = winners[0] as HandEndView['winners'][number];
    const x = formatChips(w.amount);
    return [w.seat === HERO ? T.youWinFold(x) : T.winsFold(w.name, x)];
  }

  const lines: string[] = [];
  const first = winners[0] as HandEndView['winners'][number];
  if (winners.length > 1 && winners.every((w) => w.amount === first.amount)) {
    const names = winners.map((w) => (w.seat === HERO ? T.you : w.name));
    lines.push(T.split(joinNames(names), formatChips(first.amount)));
  } else {
    for (const w of winners) {
      const x = formatChips(w.amount);
      const hand = shown.find((s) => s.seat === w.seat);
      if (w.seat === HERO) lines.push(T.youWin(x));
      else
        lines.push(hand === undefined ? T.winsNoHand(w.name, x) : T.wins(w.name, x, hand.handName));
    }
  }
  return lines;
}

/** At a showdown the hero won: one line per beaten hand that was shown, at most two. */
function loserLines(view: HandEndView): string[] {
  const { winners, shown } = view;
  if (view.endedBy === 'fold') return [];
  const heroHand = shown.find((s) => s.seat === HERO);
  if (!winners.some((w) => w.seat === HERO) || heroHand === undefined) return [];
  const lines: string[] = [];
  const beaten = shown.filter((s) => s.seat !== HERO && !winners.some((w) => w.seat === s.seat));
  for (const s of beaten.slice(0, MAX_LOSER_LINES)) {
    // The same name too ("Two Pair, Fours and Threes — loses to your Two Pair, Fours and
    // Threes") says nothing either: the card that decided it does (QA-5).
    const d = s.decider;
    if (d !== null) {
      const [yours, theirs] = [RANK_NAMES[d.yours] as string, RANK_NAMES[d.theirs] as string];
      lines.push(
        d.kicker
          ? T.losesKicker(s.name, s.handName, yours, theirs)
          : T.losesCard(s.name, s.handName, yours, theirs),
      );
      continue;
    }
    // The same category ("Pair — loses to your Pair") says nothing: name the full hands then.
    const same = s.category === heroHand.category;
    const theirs = same ? s.handName : categoryName(s.category);
    const yours = same ? heroHand.handName : categoryName(heroHand.category);
    lines.push(T.loses(s.name, theirs, yours));
  }
  return lines;
}

/** The result's lines, in order (the words of the module comment). Empty before a winner. */
export function handEndLines(view: HandEndView): string[] {
  return [...winnerLines(view), ...loserLines(view)];
}

/** One line of the hand-end banner, and how it is drawn. */
export interface BannerLine {
  readonly text: string;
  /** 'main': the first line. 'own': the hero's own result. 'line': the rest. */
  readonly kind: 'main' | 'own' | 'line';
}

/**
 * The hero's own result (§12.9, 1.3.99): "You won 340" / "You lost 340"; null when the hand did
 * not change the hero's stack (a fold with no chips in, a split that gave them back).
 */
export function ownResultLine(net: number): string | null {
  if (net === 0) return null;
  return net > 0 ? T.youWon(formatChips(net)) : T.youLost(formatChips(-net));
}

/**
 * The banner (§12.9, 1.3.99): who won, the hero's own result, then the hands the hero beat. Empty
 * when the hand has no winner (not complete).
 */
export function bannerLines(view: HandEndView): BannerLine[] {
  const winners = winnerLines(view);
  if (winners.length === 0) return [];
  const own = ownResultLine(view.heroNet);
  return [
    ...winners.map((text, i): BannerLine => ({ text, kind: i === 0 ? 'main' : 'line' })),
    ...(own === null ? [] : [{ text: own, kind: 'own' } as const]),
    ...loserLines(view).map((text): BannerLine => ({ text, kind: 'line' })),
  ];
}

/** The §7.6 luck line after an all-in run-out. */
export function luckLine(luck: LuckLineData): string {
  const pct = `${luck.pct}%`;
  return luck.kind === 'unlucky' ? en.runout.unlucky(pct) : en.runout.lucky(pct);
}
