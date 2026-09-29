/**
 * The hand-end banner's lines (PLAN §12.9, §12.11), from the store's `HandEndView`. Pure.
 *
 * - Everyone else folded: "Everyone folded. You win 120." / "Ben wins 120. Everyone else folded."
 *   No cards are named.
 * - Showdown, one winner: "You win 340!" / "Ben wins 340 with Two Pair, Kings and Sevens."
 * - Showdown, the same amount to several winners: "Split pot: you and Ben each win 170."
 *   Different amounts (side pots, an odd chip): one line per winner.
 * - When the hero wins a showdown, one line per beaten hand that was shown (at most two):
 *   "Ben: Two Pair — loses to your Flush".
 *
 * Only hands the engine revealed reach `HandEndView.shown`, so nothing here can name a hidden card.
 */
import type { HandEndView } from '../app/store.ts';
import type { HandCategory } from '../eval/evaluate.ts';
import { en } from '../i18n/en.ts';
import { formatChips } from './format.ts';

/** The hero's seat (PLAN §0.3). */
const HERO = 0;
/** Loser lines shown at most (the banner stays short). */
const MAX_LOSER_LINES = 2;

const T = en.handEnd;

/** "you and Ben", "Ben and Anna", "you, Ben and Anna". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(T.comma)}${T.and}${names[names.length - 1] ?? ''}`;
}

const categoryName = (category: HandCategory): string => T.category[category];

/** The banner's lines, in order. Empty when the hand has no winner (not complete). */
export function handEndLines(view: HandEndView): string[] {
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

  const heroWon = winners.some((w) => w.seat === HERO);
  const heroHand = shown.find((s) => s.seat === HERO);
  if (heroWon && heroHand !== undefined) {
    const beaten = shown.filter((s) => s.seat !== HERO && !winners.some((w) => w.seat === s.seat));
    for (const s of beaten.slice(0, MAX_LOSER_LINES)) {
      // The same category ("Pair — loses to your Pair") says nothing: name the full hands then.
      const same = s.category === heroHand.category;
      const theirs = same ? s.handName : categoryName(s.category);
      const yours = same ? heroHand.handName : categoryName(heroHand.category);
      lines.push(T.loses(s.name, theirs, yours));
    }
  }
  return lines;
}
