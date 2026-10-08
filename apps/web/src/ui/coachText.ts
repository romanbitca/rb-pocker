/**
 * A coach `Decision` (Appendix A.5) as English (PLAN §8.10 hint structure, Appendix F.1): the
 * headline, RANGE_ADJUST, the main reason, "Why not …?" lines, the close-call line and the Rule of
 * 2 and 4. The brain never builds sentences (§8.10); this module fills the F.1 templates of
 * `i18n/en.ts` from the decision and its reason codes.
 *
 * ⚠️ Stand-in until chunk 5.6 (`explain`, the templates' owner, `check-copy`): 5.6 may replace
 * `hintText` and the templates, and must keep its shape (`HintText`), which the coach UI reads.
 *
 * Numbers (F.1): every percentage is a whole number (`pctText`). `{E}` is `eRange` in codes whose
 * sentence names the range (CALL_PREFLOP, FOLD_VS_RAISE, THREE_BET_VALUE, FOUR_BET_VALUE,
 * CALL_ALLIN, FOLD_ALLIN, PUSH_FOLD); in every other code it is `eRandom`, the HUD's number,
 * unless the hint shows RANGE_ADJUST, which then comes first and labels `{E} = eRange` for the
 * rest of the hint. ⚠️ So a sentence after RANGE_ADJUST may hold a range number labelled only by
 * RANGE_ADJUST before it: show `reason` only right after `rangeAdjust` (pitfall 35).
 */
import type { Decision, Reason, ReasonCode } from '../brain/types.ts';
import { RANK_CHARS, RANK_NAMES, RANK_PLURALS } from '../core/cards.ts';
import type { LegalActions, PlayerAction } from '../engine/types.ts';
import { coachText, coachWords } from '../i18n/coachUi.ts';
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

/** Codes whose sentence names the range: their `{E}` is `eRange` (F.1). */
const RANGE_CODES: ReadonlySet<ReasonCode> = new Set<ReasonCode>([
  'CALL_PREFLOP',
  'FOLD_VS_RAISE',
  'THREE_BET_VALUE',
  'FOUR_BET_VALUE',
  'CALL_ALLIN',
  'FOLD_ALLIN',
  'PUSH_FOLD',
]);

const WHY_NOT: ReadonlySet<ReasonCode> = new Set<ReasonCode>([
  'WHY_NOT_FOLD',
  'WHY_NOT_CHECK',
  'WHY_NOT_CALL',
  'WHY_NOT_BET',
  'WHY_NOT_RAISE',
]);

/** Codes that are not the main reason. */
const SECONDARY: ReadonlySet<ReasonCode> = new Set<ReasonCode>([
  ...WHY_NOT,
  'RANGE_ADJUST',
  'CLOSE_SPOT',
  'RULE_2_4',
  'RULE_2_4_BIG',
]);

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

/** "AKs" → "Ace-King suited", "66" → "Pocket Sixes" (F.2); anything else as it is. */
export function preflopName(cls: string): string {
  const hi = RANK_CHARS.indexOf(cls.charAt(0));
  const lo = RANK_CHARS.indexOf(cls.charAt(1));
  if (hi < 0 || lo < 0) return cls;
  if (cls.length === 2 && hi === lo) return coachText.pocket(RANK_PLURALS[hi] ?? '');
  const a = RANK_NAMES[hi] ?? '';
  const b = RANK_NAMES[lo] ?? '';
  if (cls.endsWith('s')) return coachText.suited(a, b);
  if (cls.endsWith('o')) return coachText.offsuit(a, b);
  return cls;
}

/** Splits text into sentences (a period, "!" or "?" followed by a space ends one). */
export function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter((s) => s !== '');
}

const actionTo = (a: PlayerAction): number | null =>
  a.type === 'bet' || a.type === 'raise' ? a.to : null;

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

const num = (r: Reason, key: string): number | null => {
  const v = r.data[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};
const str = (r: Reason, key: string): string | null => {
  const v = r.data[key];
  return typeof v === 'string' && v !== '' ? v : null;
};

/** F.1 `{detail}` (GUARDRAIL) from the rule the brain names. */
function guardrailDetail(r: Reason): string {
  const g = coachText.guardrail;
  const key = str(r, 'detail') ?? str(r, 'rule');
  switch (key) {
    case 'checkFree':
    case '1':
      return g.checkFree;
    case 'tooStrong':
    case '2':
      return g.tooStrong;
    case 'neverWins':
    case '3':
      return g.neverWins;
    case 'priceGood':
    case '4call':
      return g.priceGood;
    case 'winsTooRarely':
    case '4fold':
      return g.winsTooRarely;
    default:
      return '';
  }
}

/** The placeholder values of one reason (every value formatted, F.1). */
function varsOf(r: Reason, d: Decision, E: number, ctx: TextContext): Record<string, string> {
  const money = (chips: number) => formatAmount(chips, ctx.bb, ctx.amounts);
  const to = num(r, 'size') ?? num(r, 'to') ?? actionTo(d.action);
  const size =
    to === null
      ? ''
      : ctx.amounts === 'bb'
        ? money(to)
        : coachWords.size(money(to), formatBigBlinds(to, ctx.bb));
  const drawKey = str(r, 'draw');
  const drawName =
    drawKey !== null && drawKey in en.draws.name
      ? en.draws.name[drawKey as keyof typeof en.draws.name]
      : '';
  const category = str(r, 'category');
  const example =
    category !== null && category in coachText.example
      ? coachText.example[category as keyof typeof coachText.example]
      : coachText.example.pair;
  const described = str(r, 'actionDescription') ?? str(r, 'villainAction');
  const actionDescription =
    described !== null && described in coachText.actionDescription
      ? coachText.actionDescription[described as keyof typeof coachText.actionDescription]
      : (described ?? coachText.actionDescription.bet);
  const whole = (x: number | null) => (x === null ? '' : String(Math.round(x)));
  const S = num(r, 'S');
  return {
    E: pctText(E),
    need: pctText(num(r, 'need') ?? d.need),
    eRandom: pctText(d.eRandom),
    eRange: pctText(d.eRange),
    toCall: money(num(r, 'toCall') ?? ctx.legal?.callAmount ?? 0),
    pot: money(num(r, 'pot') ?? 0),
    size,
    hand: preflopName(str(r, 'hand') ?? ''),
    handName: str(r, 'handName') ?? '',
    example,
    draw: drawName.toLowerCase(),
    Draw: drawName,
    outs: whole(num(r, 'outs')),
    hitNext: pctText(num(r, 'hitNext') ?? 0),
    hitRiver: pctText(num(r, 'hitRiver') ?? 0),
    exact: pctText(num(r, 'exact') ?? 0),
    Pfold: pctText(num(r, 'Pfold') ?? 0),
    needImplied: pctText(num(r, 'needImplied') ?? 0),
    rankPct: whole(num(r, 'rankPct')),
    openPct: whole(num(r, 'openPct')),
    behind: whole(num(r, 'behind')),
    S: S === null ? '' : formatBigBlinds(S, 1),
    actionDescription,
    alt: d.alt === null ? '' : headlineOf(d.alt, ctx),
    detail: guardrailDetail(r),
  };
}

/** One reason as its F.1 sentences. */
export function reasonText(r: Reason, d: Decision, ctx: TextContext, rangeShown: boolean): string {
  const E = RANGE_CODES.has(r.code) || rangeShown ? d.eRange : d.eRandom;
  return coachText.reason[r.code](varsOf(r, d, E, ctx));
}

/** The decision as the coach's words (§8.10 hint structure). */
export function hintText(d: Decision, ctx: TextContext): HintText {
  const rangeReason = d.trace.find((r) => r.code === 'RANGE_ADJUST') ?? null;
  const rangeShown = rangeReason !== null;
  const render = (r: Reason) => reasonText(r, d, ctx, rangeShown);
  const main = d.trace.filter((r) => !SECONDARY.has(r.code));
  const reason = main[0] === undefined ? '' : render(main[0]);
  const close = d.trace.find((r) => r.code === 'CLOSE_SPOT');
  return {
    headline: headlineOf(d.action, ctx, d.kind === 'allin'),
    rangeAdjust: rangeReason === null ? null : render(rangeReason),
    reason,
    reasonFirst: sentences(reason)[0] ?? '',
    extra: main.slice(1).map(render),
    whyNot: d.trace.filter((r) => WHY_NOT.has(r.code)).map(render),
    close: close === undefined || d.alt === null ? null : render(close),
    trick: d.trace.filter((r) => r.code === 'RULE_2_4' || r.code === 'RULE_2_4_BIG').map(render),
  };
}
