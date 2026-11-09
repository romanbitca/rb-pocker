/**
 * The coach's view model (PLAN §10.2, §12.6, §12.7, §8.10): pure builders from the store's coach
 * data (`selectCoach`, `selectNarration`) and the action bar's input to what the strip, the sheet,
 * the action bar's ring and the sizing tray show. The components only draw these.
 *
 * Levels (§10.2; Advanced and Exam show the hint as Intermediate does, chunk 6.4):
 * - Beginner "Full help": the advice is always on show: the strip says it ("Coach is thinking…"
 *   until it comes), the recommended button has the ring and the "Coach" badge, the tray starts at
 *   the coach's size and its coach chip is ringed; the sheet has the strength meter.
 * - Intermediate "Help on tap": a "Hint" button (disabled until the hint is ready); after a tap
 *   (which marks the decision as helped) the strip says the action and one sentence, "Why?" opens
 *   the sheet, and the advice is on show as at Beginner. The sheet's "Why" starts with one
 *   sentence and "More".
 * - Advanced "Mistakes only": as Intermediate, and on 1 in 4 decisions the quiz takes the strip's
 *   place first (§10.3, the quiz chunk `ui/quizEntry.ts`).
 * - Exam "Test yourself": as Intermediate, the button reads "Hint (counts as help)".
 *
 * ⚠️ Pitfall 35 (§8.10): a range number never shows bare. When the hint shows RANGE_ADJUST the
 * strip's line is the labelled pair ("Any cards: 62%. Their likely hands: about 35%."), never a
 * sentence of the main reason (whose `{E}` is then `eRange`, labelled only by RANGE_ADJUST); the
 * sheet shows the reason right after RANGE_ADJUST. When the range number counts only the raiser
 * (and the callers already in) while the HUD's counts every player, each label says whom ("All 5
 * players: 26%. Raiser alone: about 44%."; the sheet "Against all 5 players with any cards: 26%"),
 * so a beginner never reads two win chances that look contradictory.
 *
 * This module (with `coachText.ts`, `glossary.ts` and `i18n/coachUi.ts`) is part of the coach's lazy
 * chunk (`ui/coachEntry.ts`, §15.3); the ring and the tray's amount come from `coachAdvice.ts`.
 */
import { LEVEL_RULES, type CoachData, type CoachState, type NarrationData } from '../app/store.ts';
import type { Explanation, PriceBar } from '../brain/explain.ts';
import type { Decision } from '../brain/types.ts';
import { coachWords } from '../i18n/coachUi.ts';
import {
  formatAmount,
  priceOf,
  type ActionBarInput,
  type AmountUnit,
  type PriceView,
} from './actionBar.ts';
import { coachAdvice, uiLevel, type BarSlot, type CoachUiLevel } from './coachAdvice.ts';
import { hintText, pctText, sentences, type HintText, type TextContext } from './coachText.ts';
import { plainText } from './glossary.ts';

export { slotOf, uiLevel, type BarSlot, type CoachUiLevel } from './coachAdvice.ts';

/** The coach strip (§12.6), one of (every text plain: the strip has no glossary links): */
export type StripView =
  /** No hand: nothing to say. */
  | { readonly kind: 'empty' }
  /** Someone else acts: "Ben raises to 60." */
  | { readonly kind: 'narration'; readonly text: string }
  /** Beginner, the hint on its way. */
  | { readonly kind: 'thinking' }
  /**
   * Above Beginner, before the tap: "Hint", disabled until the hint is ready; at Exam "Hint
   * (counts as help)" (`countsAsHelp`).
   */
  | { readonly kind: 'hint'; readonly ready: boolean; readonly countsAsHelp: boolean }
  /** The advice: "Coach: Call 40", its line and "Why?" (Intermediate's own button). */
  | {
      readonly kind: 'advice';
      readonly headline: string;
      /** The headline without the big blinds, for a strip too narrow for the whole. */
      readonly headlineShort: string;
      readonly line: string;
      /** A shorter line, for a strip too narrow for `line`; '' when there is none. */
      readonly lineShort: string;
      readonly why: boolean;
    }
  /** "Coach is not available. Tap to try again." (§12.11). */
  | { readonly kind: 'failed' };

/** The price bar of the sheet's numbers (§12.6): 0–100%, the marker at Need, the fill at the win number. */
export interface PriceBarView {
  /**
   * 0..1: the number the coach compared with the price (`explain`'s `shown.bar`): the words' win
   * chance (`eRange` when the hint shows RANGE_ADJUST, else `eRandom`), or for a fold that it
   * would pay, what later bets leave of it.
   */
  readonly win: number;
  /** 0..1: the price, or the price with what a hit can win later (a call it would not pay). */
  readonly need: number;
  /** ✓: never next to a fold; ✗: never next to a call or a raise. */
  readonly good: boolean;
  /** A line in plain words when its number is none of the lines above, else null. */
  readonly caption: string | null;
  /** Its name for screen readers. */
  readonly label: string;
  readonly verdict: string;
}

/** §12.6 (3) "The numbers". */
export interface NumbersView {
  /**
   * "Win chance 45% (any cards)": always the HUD's number; "Against all 5 players with any
   * cards: 26%" when the words show a range number of the raiser alone (§8.10).
   */
  readonly win: string;
  /** The HUD's number, 0..1 ("How is this calculated?": "You won in 45% of them"). */
  readonly winValue: number;
  /**
   * "Against their likely hands: about 38%" ("Against the raiser's likely hands alone: about
   * 44%" when it counts fewer players than `win`): only when the hint shows RANGE_ADJUST.
   */
  readonly likely: string | null;
  /** "Need 25%" when facing a bet (the price chip's number, §0.3). */
  readonly need: string | null;
  /** The same, 0..1. */
  readonly needValue: number | null;
  /** "Pot 120": the pot the hero can win when facing a bet (`winPot`, F.1), else the pot. */
  readonly pot: string;
  readonly toCall: string | null;
  readonly bar: PriceBarView | null;
}

/** The §8.10 strength meter (Beginner): which of the five segments, and its word. */
export interface StrengthView {
  /** 1 (Weak) to 5 (Monster). */
  readonly level: 1 | 2 | 3 | 4 | 5;
  readonly label: string;
  readonly name: string;
}

/** The advice, as the sheet and the inline panels show it. */
export interface HintView extends HintText {
  readonly confidence: Decision['confidence'];
  /** The numbers the words show (`explain`): the HUD's, the labelled range number, the win. */
  readonly shown: Explanation['shown'];
  readonly numbers: NumbersView;
  /** Beginner only. */
  readonly strength: StrengthView | null;
}

export interface CoachView {
  readonly level: CoachUiLevel;
  readonly state: CoachState;
  /** The hero decision's key (pending, ready, failed). */
  readonly key: string | null;
  readonly strip: StripView;
  /** The advice is on show: Beginner, or Intermediate after "Hint" (the ring, the tray). */
  readonly shown: boolean;
  /** The advice; null unless ready. Built even before "Hint" (the sheet opens after it). */
  readonly hint: HintView | null;
  /** Row A's recommended button while the advice is on show (§12.7 ring and badge). */
  readonly ring: BarSlot | null;
  /** The coach's "to" amount for a bet or raise while the advice is on show (tray, §12.7). */
  readonly size: number | null;
}

const STRENGTH: readonly Decision['strength'][] = [
  'weak',
  'marginal',
  'decent',
  'strong',
  'monster',
];

/** "Ben raises to 60." / "You call 40." (+ " All-in."), amounts in the player's unit. */
export function narrationText(n: NarrationData, bb: number, amounts: AmountUnit): string {
  const t = coachWords.narrate;
  const x = formatAmount(n.amount, bb, amounts);
  let text: string;
  switch (n.type) {
    case 'fold':
      text = n.hero ? t.youFold : t.fold(n.name);
      break;
    case 'check':
      text = n.hero ? t.youCheck : t.check(n.name);
      break;
    case 'call':
      text = n.hero ? t.youCall(x) : t.call(n.name, x);
      break;
    case 'bet':
      text = n.hero ? t.youBet(x) : t.bet(n.name, x);
      break;
    case 'raise':
      text = n.hero ? t.youRaise(x) : t.raise(n.name, x);
      break;
  }
  return n.allIn ? text + t.allIn : text;
}

/** The range number's label: whom it counts when that is not every player (§8.10). */
function likelyText(shown: Explanation['shown'], x: string): string {
  const c = coachWords;
  if (shown.callers === null) return c.winLikely(x);
  return shown.callers === 0 ? c.winRaiser(x) : c.winCallers(shown.callers, x);
}

/** §12.6 (3): the HUD's number, the labelled range number (RANGE_ADJUST only), the price. */
export function numbersView(
  decision: Decision,
  shown: Explanation['shown'],
  price: PriceView | null,
  pot: number,
  ctx: TextContext,
): NumbersView {
  const money = (chips: number) => formatAmount(chips, ctx.bb, ctx.amounts);
  const c = coachWords;
  // The price only when the advice weighs it (`shown.price`): never a limp's price next to an
  // open or a fold before the flop (F.1 numbers line).
  const facing = shown.price && price !== null && price.toCall > 0;
  const any = pctText(decision.eRandom);
  // With a range number of the raiser alone in the words, the HUD's says whom it counts too.
  const win = shown.callers === null ? c.winAny(any) : c.winAll(shown.players, any);
  const likely = shown.eRange !== null ? likelyText(shown, pctText(shown.eRange)) : null;
  return {
    win,
    winValue: decision.eRandom,
    likely,
    need: facing ? c.need(pctText(price.need)) : null,
    needValue: facing ? price.need : null,
    pot: c.pot(money(facing ? price.winPot : pot)),
    toCall: facing ? c.toCall(money(price.toCall)) : null,
    bar: facing && shown.bar !== null ? priceBarView(shown.bar, likely ?? win) : null,
  };
}

/**
 * The price bar (§12.6): the comparison the coach made (`explain`'s `shown.bar`), so its ✓/✗
 * never argues against the advice. Its name says which number it is (pitfall 35): the labelled
 * line above it fills to, or a caption in plain words when it is none of them.
 */
function priceBarView(bar: PriceBar, line: string): PriceBarView {
  const c = coachWords;
  const common = { win: bar.win, need: bar.need, good: bar.good };
  const verdict = bar.good ? c.barGood : c.barBad;
  switch (bar.basis) {
    case 'plain':
      return { ...common, caption: null, label: c.barLabel(line, pctText(bar.need)), verdict };
    case 'realised': {
      const caption = c.barRealised(pctText(bar.win));
      return { ...common, caption, label: c.barLabel(caption, pctText(bar.need)), verdict };
    }
    case 'implied': {
      const caption = c.barImplied(pctText(bar.need));
      return { ...common, caption, label: c.barLabelWith(line, caption), verdict };
    }
  }
}

/** The advice for the sheet and the inline panels. */
export function hintView(
  decision: Decision,
  explanation: Explanation,
  level: CoachUiLevel,
  input: ActionBarInput | null,
): HintView {
  const legal = input?.legal ?? null;
  const ctx: TextContext = { bb: input?.bb ?? 1, amounts: input?.amounts ?? 'chips', legal };
  const text = hintText(decision, explanation, ctx);
  const price =
    input !== null && legal !== null && legal.canCall
      ? priceOf(input.seats, legal.seat, legal.callAmount)
      : null;
  const pot = input === null ? 0 : input.seats.reduce((sum, s) => sum + s.totalBet, 0);
  const index = STRENGTH.indexOf(decision.strength);
  const label = coachWords.strength[decision.strength];
  return {
    ...text,
    confidence: decision.confidence,
    shown: explanation.shown,
    numbers: numbersView(decision, explanation.shown, price, pot, ctx),
    strength:
      level === 'beginner' && index >= 0
        ? {
            level: (index + 1) as StrengthView['level'],
            label,
            name: coachWords.strengthLabel(label),
          }
        : null,
  };
}

/** The strip's line under the headline (§12.6), and a shorter one for a narrow strip. */
function adviceLine(
  decision: Decision,
  hint: HintView,
  level: CoachUiLevel,
): { readonly line: string; readonly short: string } {
  // Pitfall 35: with RANGE_ADJUST, only the labelled pair; each says whom it counts when the
  // range number leaves out players the HUD's counts (§8.10).
  if (hint.rangeAdjust !== null) {
    const any = pctText(decision.eRandom);
    const likely = pctText(hint.shown.eRange ?? decision.eRange);
    const { players, callers } = hint.shown;
    if (callers === null) return { line: coachWords.pair(any, likely), short: '' };
    return {
      line:
        callers === 0
          ? coachWords.pairRaiser(players, any, likely)
          : coachWords.pairCallers(players, any, callers, likely),
      short: '',
    };
  }
  // Facing a bet, the two numbers that decide it ("You win about 45%. You need 25%."), when they
  // do: the price bar's plain comparison agrees with the advice (§12.6). At Beginner always; at
  // the other levels when the reason's own sentence weighs them, so "You win about 23%." never
  // stands without the need it compares with (1.3.100). Else (a fold the price alone would pay,
  // a call it would not, an open) the reason says why.
  if (
    (level === 'beginner' || hint.comparesPrice) &&
    hint.numbers.needValue !== null &&
    hint.shown.bar?.basis === 'plain'
  ) {
    return {
      line: coachWords.winNeed(pctText(decision.eRandom), pctText(hint.numbers.needValue)),
      short: '',
    };
  }
  const short = hint.reasonShort === null ? '' : plainText(hint.reasonShort);
  return { line: plainText(sentences(hint.reasonFirst)[0] ?? ''), short };
}

/** Everything the coach's places show for this moment. */
export function coachView(
  data: CoachData,
  narration: NarrationData | null,
  input: ActionBarInput | null,
): CoachView {
  const level = uiLevel(data.level);
  const countsAsHelp = LEVEL_RULES[data.level].hint === 'countsAsHelp';
  const base = { level, state: data.state, key: data.key, hint: null, ring: null, size: null };
  switch (data.state) {
    case 'off':
      return { ...base, strip: { kind: 'empty' }, shown: false };
    case 'waiting':
      return {
        ...base,
        strip:
          narration === null
            ? { kind: 'empty' }
            : {
                kind: 'narration',
                text: narrationText(narration, input?.bb ?? 1, input?.amounts ?? 'chips'),
              },
        shown: false,
      };
    case 'failed':
      return { ...base, strip: { kind: 'failed' }, shown: false };
    case 'pending':
      return {
        ...base,
        strip:
          level === 'beginner'
            ? { kind: 'thinking' }
            : { kind: 'hint', ready: false, countsAsHelp },
        shown: false,
      };
    case 'ready': {
      const decision = data.decision as Decision;
      const hint = hintView(decision, data.explanation as Explanation, level, input);
      const { shown, ring, size } = coachAdvice(data);
      const { line, short: lineShort } = adviceLine(decision, hint, level);
      return {
        ...base,
        hint,
        shown,
        strip: shown
          ? {
              kind: 'advice',
              headline: hint.headline,
              headlineShort: hint.headlineShort,
              line,
              lineShort,
              why: level !== 'beginner',
            }
          : { kind: 'hint', ready: true, countsAsHelp },
        ring,
        size: size?.to ?? null,
      };
    }
  }
}
