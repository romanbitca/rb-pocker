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
 * sheet shows the reason right after RANGE_ADJUST.
 *
 * This module (with `coachText.ts`, `glossary.ts` and `i18n/coachUi.ts`) is part of the coach's lazy
 * chunk (`ui/coachEntry.ts`, §15.3); the ring and the tray's amount come from `coachAdvice.ts`.
 */
import { LEVEL_RULES, type CoachData, type CoachState, type NarrationData } from '../app/store.ts';
import type { Explanation } from '../brain/explain.ts';
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
import { hintText, pctText, type HintText, type TextContext } from './coachText.ts';
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
  /** The advice: "Coach: Call 40" and one line; Intermediate adds "Why?". */
  | {
      readonly kind: 'advice';
      readonly headline: string;
      readonly line: string;
      readonly why: boolean;
    }
  /** "Coach is not available. Tap to try again." (§12.11). */
  | { readonly kind: 'failed' };

/** The price bar of the sheet's numbers (§12.6): 0–100%, the marker at Need, the fill at the win number. */
export interface PriceBarView {
  /** 0..1: the coach's win number (`eRange` when the hint shows RANGE_ADJUST, else `eRandom`). */
  readonly win: number;
  readonly need: number;
  readonly good: boolean;
  /** Its name for screen readers. */
  readonly label: string;
  readonly verdict: string;
}

/** §12.6 (3) "The numbers". */
export interface NumbersView {
  /** "Win chance 45% (any cards)": always the HUD's number. */
  readonly win: string;
  /** The HUD's number, 0..1 ("How is this calculated?": "You won in 45% of them"). */
  readonly winValue: number;
  /** "Against their likely hands: about 38%": only when the hint shows RANGE_ADJUST. */
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
  const facing = price !== null && price.toCall > 0;
  const win = c.winAny(pctText(decision.eRandom));
  const likely = shown.eRange !== null ? c.winLikely(pctText(shown.eRange)) : null;
  // The bar fills to the number the reasons compare with the price (`explain`'s `win`), and
  // its name says which one it is (pitfall 35).
  const winNumber = shown.win;
  return {
    win,
    winValue: decision.eRandom,
    likely,
    need: facing ? c.need(pctText(price.need)) : null,
    needValue: facing ? price.need : null,
    pot: c.pot(money(facing ? price.winPot : pot)),
    toCall: facing ? c.toCall(money(price.toCall)) : null,
    bar: facing
      ? {
          win: winNumber,
          need: price.need,
          good: winNumber >= price.need,
          label: c.barLabel(likely ?? win, pctText(price.need)),
          verdict: winNumber >= price.need ? c.barGood : c.barBad,
        }
      : null,
  };
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

/** The strip's one line under the headline (§12.6). */
function adviceLine(decision: Decision, hint: HintView, level: CoachUiLevel): string {
  // Pitfall 35: with RANGE_ADJUST, only the labelled pair.
  if (hint.rangeAdjust !== null) {
    return coachWords.pair(
      pctText(decision.eRandom),
      pctText(hint.shown.eRange ?? decision.eRange),
    );
  }
  // Beginner facing a bet: the two numbers that decide it ("You win about 45%. You need 25%.").
  if (level === 'beginner' && hint.numbers.needValue !== null) {
    return coachWords.winNeed(pctText(decision.eRandom), pctText(hint.numbers.needValue));
  }
  return plainText(hint.reasonFirst);
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
      return {
        ...base,
        hint,
        shown,
        strip: shown
          ? {
              kind: 'advice',
              headline: hint.headline,
              line: adviceLine(decision, hint, level),
              why: level !== 'beginner',
            }
          : { kind: 'hint', ready: true, countsAsHelp },
        ring,
        size: size?.to ?? null,
      };
    }
  }
}
