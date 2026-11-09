/**
 * The coach's words for the UI (PLAN §8.10 hint structure, Appendix F.1): `HintText`, what the
 * strip and the sheet show, filled from the worker's `Explanation` (`brain/explain.ts`, chunk
 * 5.6: template keys and values, never English) rendered by `i18n/coach.ts`. Glossary links come
 * out as `{g:term}` marks, which `glossary.ts` turns into the dotted words (§12.6). The headline
 * is the action bar's own words (`headlineOf`, the amounts unit of the settings); every sentence
 * is 5.6's, so the text, `check-copy` and the numbers on screen agree (C9; chunk 5.7 replaced the
 * chunk 5.9 stand-in).
 */
import type { Explanation, Line, TemplateKey } from '../brain/explain.ts';
import type { Decision } from '../brain/types.ts';
import type { LegalActions, PlayerAction } from '../engine/types.ts';
import { renderLine } from '../i18n/coach.ts';
import { coachWords } from '../i18n/coachUi.ts';
import { en } from '../i18n/en.ts';
import { formatAmount, formatBigBlinds, type AmountUnit } from './actionBar.ts';
import { plainText } from './glossary.ts';

/** What the text needs besides the decision. */
export interface TextContext {
  readonly bb: number;
  readonly amounts: AmountUnit;
  /** The hero's legal actions (the call amount, "Call all-in"); null when unknown. */
  readonly legal: LegalActions | null;
}

export interface HintText {
  /** §8.10 (1): "Call 40", "Raise to 60 (3 BB)", the action bar's own words. */
  readonly headline: string;
  /** The headline without the big blinds ("Raise to 60"): the strip's when the whole does not fit. */
  readonly headlineShort: string;
  /** RANGE_ADJUST's sentences, when the hint shows both equities (labelled); else null. */
  readonly rangeAdjust: string | null;
  /**
   * The main reason code's 1–3 sentences (§8.10 (2)); may hold `{g:term}` links. RANGE_ADJUST has
   * just said the win chance: a sentence that only says it again is left out (1.3.100).
   */
  readonly reason: string;
  /**
   * The start of the reason (Intermediate's Why, before its "More"): the first sentence, or both
   * halves of a price comparison, so "You win about 23%." never stands without the need (1.3.100).
   */
  readonly reasonFirst: string;
  /**
   * The reason's sentence that says why the advice is right (the strip's, §12.6, 1.4.15): not
   * the need alone, and not a number without the rule that decided.
   */
  readonly reasonWhy: string;
  /** `reasonWhy` with its hand said "your hand"; null when it names no hand. */
  readonly reasonShort: string | null;
  /** The main reason weighs the win chance against the price (F.1's price sentences). */
  readonly comparesPrice: boolean;
  /** Further main codes (e.g. COMMITTED after an all-in raise): the full "Why" only. */
  readonly extra: readonly string[];
  /** §8.10 (4): one line per WHY_NOT_* code. */
  readonly whyNot: readonly string[];
  /** §8.10 (5): "Close call: Fold is also fine." (CLOSE_SPOT), else null. */
  readonly close: string | null;
  /** The Rule of 2 and 4 (draws only; the sheet). */
  readonly trick: readonly string[];
}

/**
 * A fraction as a whole-number percentage without its sign (Appendix F: whole numbers): "45";
 * never "0" or "100" unless exact ("<1", ">99", like the win badge, §7.6).
 */
export function pctText(fraction: number): string {
  const points = fraction * 100;
  if (!(points > 0)) return '0';
  if (points < 0.5) return '<1';
  if (points >= 100) return '100';
  if (points >= 99.5) return '>99';
  return String(Math.round(points));
}

/** Splits text into sentences (a period, "!" or "?" followed by a space ends one). */
export function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter((s) => s !== '');
}

/**
 * The headline of an action, in the action bar's words ("Call 40", "Raise to 60 (3 BB)"); `brief`
 * leaves out the big blinds ("Raise to 60").
 */
export function headlineOf(
  action: PlayerAction,
  ctx: TextContext,
  allIn = false,
  brief = false,
): string {
  const money = (chips: number) => formatAmount(chips, ctx.bb, ctx.amounts);
  const sized = (chips: number) =>
    ctx.amounts === 'bb' || brief
      ? money(chips)
      : coachWords.size(money(chips), formatBigBlinds(chips, ctx.bb));
  switch (action.type) {
    case 'fold':
      return coachWords.headline.fold;
    case 'check':
      return coachWords.headline.check;
    case 'call': {
      const call = ctx.legal?.callAmount ?? 0;
      return ctx.legal?.callIsAllIn === true
        ? en.actions.callAllIn(money(call))
        : coachWords.headline.call(money(call));
    }
    case 'bet':
      return allIn
        ? coachWords.headline.allIn(money(action.to))
        : coachWords.headline.bet(sized(action.to));
    case 'raise':
      return allIn
        ? coachWords.headline.allIn(money(action.to))
        : coachWords.headline.raise(sized(action.to));
  }
}

/** A 5.6 line as UI text: rendered by `i18n/coach.ts`, glossary links as `{g:term}`. */
export function lineMarkup(line: Line): string {
  return renderLine(line)
    .map((seg) => (seg.glossary !== undefined ? `{g:${seg.text}}` : seg.text))
    .join('');
}

/**
 * F.1's price sentences (the win chance against the price): `win` is the index of the sentence
 * that says the win chance; it and its neighbour, the need, are one comparison. `restates`: that
 * sentence only says the number RANGE_ADJUST has just said (not "… if you see every card").
 */
const PRICE_SENTENCES: Readonly<
  Partial<Record<TemplateKey, { readonly win: number; readonly restates: boolean }>>
> = {
  CALL_PROFITABLE: { win: 0, restates: true },
  'CALL_PROFITABLE.close': { win: 0, restates: true },
  CALL_PREFLOP: { win: 0, restates: true },
  'CALL_PREFLOP.close': { win: 0, restates: true },
  'CALL_PREFLOP.implied': { win: 0, restates: true },
  FOLD_PRICE: { win: 1, restates: true },
  'FOLD_PRICE.close': { win: 1, restates: true },
  'FOLD_PRICE.realise': { win: 1, restates: false },
  CALL_ALLIN: { win: 1, restates: true },
  'CALL_ALLIN.close': { win: 1, restates: true },
  FOLD_ALLIN: { win: 1, restates: true },
  'FOLD_ALLIN.close': { win: 1, restates: true },
  'FOLD_VS_RAISE.realise': { win: 1, restates: false },
};

/**
 * The sentence of a reason that says why, when it is not the first (the strip's, §12.6, 1.4.15).
 * These reasons start with the price or a bare number; what decided comes after it, and the strip
 * has room for one sentence.
 */
const WHY_SENTENCE: Readonly<Partial<Record<TemplateKey, number>>> = {
  FOLD_PRICE: 1,
  'FOLD_PRICE.close': 2,
  'FOLD_PRICE.realise': 2,
  'FOLD_VS_RAISE.realise': 2,
  FOLD_ALLIN: 1,
  'FOLD_ALLIN.close': 2,
  CALL_ALLIN: 1,
  'CALL_ALLIN.close': 2,
  'CALL_PROFITABLE.close': 2,
  'CALL_PREFLOP.close': 2,
  'CALL_PREFLOP.implied': 2,
  IMPLIED: 1,
  SET_MINING: 1,
  GUARDRAIL: 1,
};

/**
 * `sentence` with its hand said "your hand" ("Your Two Pair, Queens and Sevens is strong…" → "Your
 * hand is strong…"), for a strip too narrow for the hand's name; null when it names no hand.
 */
function shortHandSentence(line: Line, sentence: string): string | null {
  for (const key of ['hand', 'handName'] as const) {
    const p = line.params[key];
    if (p?.kind !== 'name') continue;
    const prefix = `Your ${p.text}`;
    if (sentence.startsWith(prefix)) return `Your hand${sentence.slice(prefix.length)}`;
    if (sentence.startsWith(p.text)) return `Your hand${sentence.slice(p.text.length)}`;
  }
  return null;
}

/** The main reason's words (§8.10 (2)): the whole, its start, and whether it weighs the price. */
export function reasonWords(
  e: Explanation,
): Pick<HintText, 'reason' | 'reasonFirst' | 'reasonWhy' | 'reasonShort' | 'comparesPrice'> {
  const rangeNumber = e.shown.eRange;
  const line = e.reasons[rangeNumber === null ? 0 : 1];
  if (line === undefined) {
    return { reason: '', reasonFirst: '', reasonWhy: '', reasonShort: null, comparesPrice: false };
  }
  const all = sentences(lineMarkup(line));
  const price = PRICE_SENTENCES[line.key];
  // RANGE_ADJUST ends with the win chance: the reason need not say it again (say it once).
  const said =
    price !== undefined &&
    price.restates &&
    rangeNumber !== null &&
    all[price.win]?.includes(`${pctText(rangeNumber)}%`) === true;
  const kept = said ? all.filter((_, i) => i !== price.win) : all;
  // A comparison shows whole: the win chance and the need, side by side.
  const start = price !== undefined && !said ? kept.slice(0, 2) : kept.slice(0, 1);
  const why = all[WHY_SENTENCE[line.key] ?? 0] ?? '';
  return {
    reason: kept.join(' '),
    reasonFirst: start.join(' '),
    reasonWhy: why,
    reasonShort: shortHandSentence(line, why),
    comparesPrice: price !== undefined,
  };
}

/**
 * Every number on show argues against a fold or a call: the HUD's number and the number the words
 * compare (`shown.win`, the price bar's) are on the other side of the price `need` (null: none on
 * show) than the advice (§12.6, 1.4.15). A raise is left out: it is rarely about the price.
 */
export function numbersArgue(e: Explanation, need: number | null): boolean {
  if (need === null || e.shown.bar?.basis === 'plain') return false;
  const head = e.headline.key;
  if (head === 'headline.fold') return e.shown.eRandom >= need;
  return (head === 'headline.call' || head === 'headline.callAllIn') && e.shown.eRandom < need;
}

/**
 * The strip's line under the headline (§12.6), and a shorter one for a narrow strip ('' when there
 * is none). `beginner`: the level is Beginner. `need` is the price on show, null when none is. In
 * order:
 *
 * - With RANGE_ADJUST, the labelled pair (pitfall 35), each saying whom it counts when the range
 *   number leaves out players the HUD's counts (§8.10). Not when it argues against the advice.
 * - Facing a bet, the two numbers that decide it ("You win about 45%. You need 25%."), when they
 *   do (the price bar's plain comparison agrees with the advice). At Beginner always; at the other
 *   levels when the reason's own sentence weighs them, so "You win about 23%." never stands without
 *   the need it compares with (1.3.100).
 * - Else the rule that decided (1.4.15): every number on show says one thing and the coach says the
 *   other, so the line must say why. In numbers when the price bar has them, a fold because of later
 *   bets ("Counting later bets: about 17%. You need 20%."; after RANGE_ADJUST the likely-hands number
 *   that a 42% would otherwise leave unexplained, "Their likely hands: about 36%. Counting later bets:
 *   about 30%.") or a call because of what a hit can win later; else the reason's sentence that says
 *   why. Never the need alone ("You need 20% to call." beside 21% and Fold) and never a percentile
 *   without its rule ("in the top 91%" beside 42%).
 */
export function stripLine(
  e: Explanation,
  beginner: boolean,
  need: number | null,
): { readonly line: string; readonly short: string } {
  const { shown } = e;
  const { bar, eRandom } = shown;
  const plain = bar?.basis === 'plain';
  const any = pctText(eRandom);
  if (shown.eRange !== null && !numbersArgue(e, need)) {
    const likely = pctText(shown.eRange);
    const { players, callers } = shown;
    const line =
      callers === null
        ? coachWords.pair(any, likely)
        : callers === 0
          ? coachWords.pairRaiser(players, any, likely)
          : coachWords.pairCallers(players, any, callers, likely);
    return { line, short: '' };
  }
  const words = reasonWords(e);
  if (need !== null && bar !== null) {
    if (plain && (beginner || words.comparesPrice)) {
      return { line: coachWords.winNeed(any, pctText(need)), short: '' };
    }
    if (bar.basis === 'realised') {
      const numbers = coachWords.laterBetsNeed(pctText(bar.win), pctText(need));
      if (shown.eRange === null) return { line: numbers, short: '' };
      const range = pctText(shown.eRange);
      return {
        line: coachWords.laterBetsRange(shown.callers, range, pctText(bar.win)),
        short: numbers,
      };
    }
    if (bar.basis === 'implied') {
      return { line: coachWords.laterWinsNeed(pctText(bar.need)), short: '' };
    }
  }
  return {
    line: plainText(words.reasonWhy),
    short: words.reasonShort === null ? '' : plainText(words.reasonShort),
  };
}

/**
 * The advice as the coach's words (§8.10 hint structure): the headline in the action bar's words,
 * then 5.6's lines: RANGE_ADJUST (when `explain` shows both numbers, its first reason), the main
 * reason and any more, "Why not …?", the close call and the rule of 2 and 4.
 */
export function hintText(d: Decision, e: Explanation, ctx: TextContext): HintText {
  const reasons = e.reasons.map(lineMarkup);
  const adjust = e.shown.eRange !== null;
  const rest = adjust ? reasons.slice(1) : reasons;
  return {
    headline: headlineOf(d.action, ctx, d.kind === 'allin'),
    headlineShort: headlineOf(d.action, ctx, d.kind === 'allin', true),
    rangeAdjust: adjust ? (reasons[0] ?? null) : null,
    ...reasonWords(e),
    extra: rest.slice(1),
    whyNot: e.whyNot.map(lineMarkup),
    close: e.close === null ? null : lineMarkup(e.close),
    trick: e.trick.map(lineMarkup),
  };
}
