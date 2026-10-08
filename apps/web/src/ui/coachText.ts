/**
 * The coach's words for the UI (PLAN §8.10 hint structure, Appendix F.1): `HintText`, what the
 * strip and the sheet show, filled from the worker's `Explanation` (`brain/explain.ts`, chunk
 * 5.6: template keys and values, never English) rendered by `i18n/coach.ts`. Glossary links come
 * out as `{g:term}` marks, which `glossary.ts` turns into the dotted words (§12.6). The headline
 * is the action bar's own words (`headlineOf`, the amounts unit of the settings); every sentence
 * is 5.6's, so the text, `check-copy` and the numbers on screen agree (C9; chunk 5.7 replaced the
 * chunk 5.9 stand-in).
 */
import type { Explanation, Line } from '../brain/explain.ts';
import type { Decision } from '../brain/types.ts';
import type { LegalActions, PlayerAction } from '../engine/types.ts';
import { renderLine } from '../i18n/coach.ts';
import { coachWords } from '../i18n/coachUi.ts';
import { en } from '../i18n/en.ts';
import { formatAmount, formatBigBlinds, type AmountUnit } from './actionBar.ts';

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
  /** RANGE_ADJUST's sentences, when the hint shows both equities (labelled); else null. */
  readonly rangeAdjust: string | null;
  /** The main reason code's 1–3 sentences (§8.10 (2)); may hold `{g:term}` links. */
  readonly reason: string;
  /** The reason's first sentence (Intermediate's strip and its "More ›"). */
  readonly reasonFirst: string;
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

/** The headline of an action, in the action bar's words ("Call 40", "Raise to 60 (3 BB)"). */
export function headlineOf(action: PlayerAction, ctx: TextContext, allIn = false): string {
  const money = (chips: number) => formatAmount(chips, ctx.bb, ctx.amounts);
  const sized = (chips: number) =>
    ctx.amounts === 'bb'
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
 * The advice as the coach's words (§8.10 hint structure): the headline in the action bar's words,
 * then 5.6's lines: RANGE_ADJUST (when `explain` shows both numbers, its first reason), the main
 * reason and any more, "Why not …?", the close call and the rule of 2 and 4.
 */
export function hintText(d: Decision, e: Explanation, ctx: TextContext): HintText {
  const reasons = e.reasons.map(lineMarkup);
  const adjust = e.shown.eRange !== null;
  const rest = adjust ? reasons.slice(1) : reasons;
  const reason = rest[0] ?? '';
  return {
    headline: headlineOf(d.action, ctx, d.kind === 'allin'),
    rangeAdjust: adjust ? (reasons[0] ?? null) : null,
    reason,
    reasonFirst: sentences(reason)[0] ?? '',
    extra: rest.slice(1),
    whyNot: e.whyNot.map(lineMarkup),
    close: e.close === null ? null : lineMarkup(e.close),
    trick: e.trick.map(lineMarkup),
  };
}
