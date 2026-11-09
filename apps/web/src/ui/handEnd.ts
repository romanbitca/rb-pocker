/**
 * The hand-end banner's lines (PLAN §12.9, §12.11), from the store's `HandEndView`. Pure.
 *
 * **One number (1.4.15).** When the hand changed the hero's stack, the hero's own result is the
 * only amount on the banner: "You won 190" / "You lost 120", what the hand did to the stack. The
 * pot is not named beside it: "You win 280." over "You won 190" were both true (the pot and the
 * profit) and read as a contradiction. When the hand cost the hero nothing there is no such number
 * to confuse, and the winners' amounts stay.
 *
 * - Everyone else folded: "Everyone folded." then "You won 120" / "Ben wins. Everyone else
 *   folded." then "You lost 40" ("Ben wins 120. Everyone else folded." when the hero paid
 *   nothing). No cards are named.
 * - Showdown, one winner: "You won 340" / "Ben wins with Two Pair, Kings and Sevens." then "You
 *   lost 170" ("Ben wins 340 with …" when the hero paid nothing).
 * - Showdown, the same amount to several winners: "Split pot with Ben." then "You won 20" (nothing
 *   when the chips only came back) / "Ben and Anna split the pot." then "You lost 40" ("Split pot:
 *   Ben and Anna each win 170." when the hero paid nothing).
 * - Different amounts (side pots, an odd chip): "You won 100" when the hero made chips, one line
 *   per other winner ("Ben wins part of the pot with Straight, Five-high."), then "You lost 900"
 *   when it did not: a hero who won a side pot and lost more in the main pot never reads "You win
 *   200!" over it.
 * - When the hero wins a showdown, one line per beaten hand that was shown (at most two):
 *   "Ben: Two Pair — loses to your Flush"; with the same category the full names ("Ben: Pair of
 *   Kings — loses to your Pair of Aces"), and with the same name the card that decided it ("Priya:
 *   Two Pair, Fours and Threes — your King kicker beats their Jack"; a flush: "your King beats
 *   their Queen").
 *
 * Review shows these same lines (`handEndLines`, §12.10).
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

type Winner = HandEndView['winners'][number];

/**
 * The line of a winner other than the hero (the module note). `withOwn`: the hero's own result is
 * on the banner, so this line has no amount.
 */
function otherWinnerLine(view: HandEndView, w: Winner, withOwn: boolean): string {
  const hand = view.shown.find((s) => s.seat === w.seat)?.handName;
  if (!withOwn) {
    const x = formatChips(w.amount);
    return hand === undefined ? T.winsNoHand(w.name, x) : T.wins(w.name, x, hand);
  }
  if (view.winners.length > 1) {
    return hand === undefined ? T.winsPart(w.name) : T.winsPartHand(w.name, hand);
  }
  return hand === undefined ? T.winsPlain(w.name) : T.winsHand(w.name, hand);
}

/** Who won, and the hero's own result (the module note). Empty before a winner. */
function resultLines(view: HandEndView): BannerLine[] {
  const { winners, heroNet } = view;
  const first = winners[0];
  if (first === undefined) return [];
  const own = ownResultLine(heroNet);
  // The hero's own result is on the banner: another amount would read against it (1.4.15).
  const withOwn = own !== null;
  const heroWon = winners.some((w) => w.seat === HERO);
  const others = winners.filter((w) => w.seat !== HERO);
  const namesOf = (list: readonly Winner[]): string => joinNames(list.map((w) => w.name));
  const x = formatChips(first.amount);
  const split = winners.length > 1 && winners.every((w) => w.amount === first.amount);

  let who: string[];
  if (view.endedBy === 'fold') {
    who = [
      heroWon
        ? T.everyoneFolded
        : withOwn
          ? T.winsFoldPlain(first.name)
          : T.winsFold(first.name, x),
    ];
  } else if (split) {
    who = [
      heroWon
        ? T.splitWith(namesOf(others))
        : withOwn
          ? T.splitOthers(namesOf(winners))
          : T.split(namesOf(winners), x),
    ];
  } else {
    who = others.map((w) => otherWinnerLine(view, w, withOwn));
  }
  // The result leads when the hero won at a showdown with no line of its own to follow.
  const heroLeads = heroNet > 0 && view.endedBy !== 'fold' && !split;
  const lines = own === null ? who : heroLeads ? [own, ...who] : [...who, own];
  return lines.map((text, i) => ({ text, kind: i === 0 ? 'main' : text === own ? 'own' : 'line' }));
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

/** One line of the hand-end banner, and how it is drawn. */
export interface BannerLine {
  readonly text: string;
  /** 'main': the first line. 'own': the hero's own result under it. 'line': the rest. */
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
 * The banner (§12.9, the module note): who won, the hero's own result, then the hands the hero
 * beat. Empty when the hand has no winner (not complete).
 */
export function bannerLines(view: HandEndView): BannerLine[] {
  const result = resultLines(view);
  if (result.length === 0) return [];
  return [...result, ...loserLines(view).map((text): BannerLine => ({ text, kind: 'line' }))];
}

/** The banner's lines as plain text, for Review (§12.10). Empty before a winner. */
export function handEndLines(view: HandEndView): string[] {
  return bannerLines(view).map((line) => line.text);
}

/** The §7.6 luck line after an all-in run-out. */
export function luckLine(luck: LuckLineData): string {
  const pct = `${luck.pct}%`;
  return luck.kind === 'unlucky' ? en.runout.unlucky(pct) : en.runout.lucky(pct);
}
