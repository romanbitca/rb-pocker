/**
 * Coach explanations (PLAN §8.10, Appendix F.1, F.5, F.9; chunk 5.6): reason codes plus numbers
 * in, a structured explanation out. Never English (§0.3): every line is a template key, its
 * parameters (numbers, chips, hand names and nested keys) and the glossary keys its template
 * links. `i18n/en.ts` holds the templates and `i18n/coach.ts` renders them, so every rule here is
 * tested without any text, and `scripts/check-copy.ts` checks the two halves against each other.
 *
 * The hint (§8.10 "Hint structure"): (1) the headline, the action and its size; (2) the reasons:
 * RANGE_ADJUST first when shown, then the main reason and at most one more; (3) the numbers line,
 * always with the HUD's `eRandom` (C9); (4) one "Why not …?" line per other sensible action;
 * (5) "Close call: {alt} is also fine." when the spot is close; and, for the coach sheet, the rule
 * of 2 and 4 when the hero has a draw.
 *
 * The rules (Appendix F.1 notes; PLAN §8.10 implementation notes of chunk 5.6):
 * - **Main reason.** The trace (the policy's reasons, main first, then a GUARDRAIL reason for each
 *   guardrail that changed the action) is read against the final action: a reason that explains
 *   another action (a policy FOLD_PRICE whose fold a guardrail turned into a call) is dropped, and
 *   a GUARDRAIL reason comes first, because it decided. At most two reasons are shown; with none
 *   left, FALLBACK.
 * - **`{E}`.** In the range codes (CALL_PREFLOP, FOLD_VS_RAISE, THREE_BET_VALUE, FOUR_BET_VALUE,
 *   CALL_ALLIN, FOLD_ALLIN) it is the range equity their policy compared, their `data.E` (else
 *   `eRange`); that number is also the hint's range number. PUSH_FOLD shows its own `data.E`,
 *   the equity when called. Every other code shows `eRandom`, unless RANGE_ADJUST is shown: then
 *   the range number, which RANGE_ADJUST has labelled.
 * - **RANGE_ADJUST** is shown when §8.10's rule holds for the range number or for the decision's
 *   `eRange` (`showsRangeAdjust`), and also when a price sentence (CALL_PROFITABLE, FOLD_PRICE)
 *   would contradict the decision with `eRandom` (whole numbers the other way) but not with the
 *   range number. Its wording: the F.1 sentence ("This player bets big only with good hands")
 *   only when the range number is the decision's `eRange`, lower than `eRandom`, and the
 *   villain's last action is known; `.weaker` when it is higher; `.plain` (both numbers,
 *   labelled) otherwise.
 * - **Consistency.** A sentence that compares the win chance with the price is used only when the
 *   whole numbers it shows agree with it; otherwise its `.close` variant (or `.realise`: you win
 *   less often when later bets can make you fold; or `.implied` for a pocket pair) says so
 *   without a false comparison. For a decision made by its policy's own rule, "close" then means
 *   equal whole numbers (`scripts/copy-rules.ts` checks it).
 * - **Why not.** For each legal action group other than the recommendation's (fold, check, call,
 *   bet, raise; all-in joins bet or raise), only when its sentence is true: fold when facing a bet
 *   and the shown win chance beats the price; check before a bet or raise for value (not a
 *   semi-bluff or a continuation bet); call when the shown win chance is below the price (never a
 *   limp, never in push/fold); bet instead of a check; raise instead of a call, a check or a fold.
 *   The close alternative's group gets the "Close call" line instead.
 */
import { outsChances } from '../analysis/chances.ts';
import type { DrawKind } from '../analysis/types.ts';
import type {
  LegalActions,
  Observation,
  PlayerAction,
  PublicAction,
  Street,
} from '../engine/types.ts';
import { describe } from '../eval/describe.ts';
import type { HandCategory } from '../eval/evaluate.ts';
import { showsRangeAdjust } from './features.ts';
import type { Decision, Facing, Features, Position, Reason, ReasonCode } from './types.ts';

// ── Keys ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Glossary keys (Appendix F.9): every name in the Term column and every parenthesised alias, lower
 * case. `en.glossary` defines each one; `check-copy` keeps the two lists equal.
 */
export const GLOSSARY_KEYS = [
  'all-in',
  'big blind',
  'bb',
  'blinds',
  'bluff',
  'board',
  'button',
  'call',
  'check',
  'fold',
  'raise',
  'continuation bet',
  'c-bet',
  'draw',
  'equity',
  'win chance',
  'flop',
  'turn',
  'river',
  'gutshot',
  'heads-up',
  'kicker',
  'limp',
  'need %',
  'pot odds',
  'nuts',
  'open-ended straight draw',
  'outs',
  'risky out',
  'overpair',
  'pocket pair',
  'position',
  'pot',
  'range',
  'semi-bluff',
  'set',
  'showdown',
  'side pot',
  'spr',
  'split pot',
  'top pair',
  'value bet',
] as const;
export type GlossaryKey = (typeof GLOSSARY_KEYS)[number];

/** What a template needs: its placeholders, and the glossary keys it links (`{g:term}`). */
export interface TemplateSpec {
  readonly params: readonly string[];
  readonly glossary?: readonly GlossaryKey[];
}

const E_NEED = ['E', 'need'] as const;

/**
 * Every template the explanation can use, with its placeholders. The keys are the Appendix F.1
 * codes, their chunk 5.6 variants (`CODE.variant`), the hint's own lines (headline, numbers line,
 * the `{alt}` headline), the words a placeholder can hold (`example.*`, `villain.*`, `detail.*`)
 * and the Appendix F.5 feedback rows (`feedback.*`, Stage 6 picks the row).
 */
export const TEMPLATES = {
  OPEN_RANGE: { params: ['hand', 'rankPct', 'behind', 'openPct', 'size'] },
  FOLD_RANGE: { params: ['hand', 'behind'] },
  ISOLATE: { params: ['size'] },
  CHECK_FREE: { params: [] },
  THREE_BET_VALUE: { params: ['hand', 'E', 'size'] },
  FOUR_BET_VALUE: { params: ['hand', 'size'] },
  CALL_PREFLOP: { params: E_NEED },
  'CALL_PREFLOP.close': { params: E_NEED },
  'CALL_PREFLOP.implied': { params: E_NEED, glossary: ['set'] },
  FOLD_VS_RAISE: { params: ['hand', 'E'] },
  SET_MINING: { params: [], glossary: ['pocket pair', 'set'] },
  CALL_PROFITABLE: { params: ['E', 'need', 'toCall', 'pot'] },
  'CALL_PROFITABLE.close': { params: ['E', 'need', 'toCall', 'pot'] },
  FOLD_PRICE: { params: E_NEED },
  'FOLD_PRICE.close': { params: E_NEED },
  'FOLD_PRICE.realise': { params: E_NEED },
  IMPLIED: { params: ['need', 'draw', 'needImplied'] },
  VALUE_BET: { params: ['handName', 'E', 'size', 'example'] },
  'VALUE_BET.noExample': { params: ['handName', 'E', 'size'] },
  'VALUE_BET.multiway': { params: ['handName', 'n', 'E', 'size', 'example'] },
  'VALUE_BET.multiwayNoExample': { params: ['handName', 'n', 'E', 'size'] },
  VALUE_RAISE: { params: ['size'] },
  RAISE_PROTECT: { params: [] },
  THIN_VALUE: { params: ['handName', 'size'] },
  POT_CONTROL: { params: ['handName'] },
  SEMI_BLUFF: { params: ['draw', 'outs', 'hitNext', 'hitRiver'], glossary: ['outs'] },
  'SEMI_BLUFF.turn': { params: ['draw', 'outs', 'hitNext'], glossary: ['outs'] },
  CBET_DRY: { params: ['size'] },
  CHECK_WEAK: { params: [] },
  PUSH_FOLD: { params: ['S', 'Pfold', 'E'], glossary: ['big blind', 'all-in'] },
  'PUSH_FOLD.fold': { params: ['S', 'Pfold', 'E'], glossary: ['big blind', 'all-in'] },
  CALL_ALLIN: { params: E_NEED },
  'CALL_ALLIN.close': { params: E_NEED },
  FOLD_ALLIN: { params: E_NEED },
  'FOLD_ALLIN.close': { params: E_NEED },
  COMMITTED: { params: ['handName'] },
  NUTS: { params: [] },
  BOARD_PLAYS: { params: [] },
  RANGE_ADJUST: { params: ['eRandom', 'actionDescription', 'eRange'] },
  'RANGE_ADJUST.weaker': { params: ['eRandom', 'eRange'] },
  'RANGE_ADJUST.plain': { params: ['eRandom', 'eRange'] },
  WHY_NOT_FOLD: { params: [] },
  WHY_NOT_CHECK: { params: [] },
  WHY_NOT_CALL: { params: E_NEED },
  WHY_NOT_BET: { params: [] },
  WHY_NOT_RAISE: { params: [] },
  CLOSE_SPOT: { params: ['alt'] },
  GUARDRAIL: { params: ['detail'] },
  RULE_2_4: { params: ['exact'] },
  RULE_2_4_BIG: { params: [] },
  FALLBACK: { params: [] },

  'headline.fold': { params: [] },
  'headline.check': { params: [] },
  'headline.call': { params: ['amount'] },
  'headline.callAllIn': { params: ['amount'] },
  'headline.bet': { params: ['size'] },
  'headline.raise': { params: ['size'] },
  'headline.allIn': { params: ['size'] },
  numbers: { params: ['eRandom', 'need', 'pot', 'toCall'] },
  'numbers.free': { params: ['eRandom', 'pot'] },
  'numbers.short': { params: ['eRandom', 'need', 'pot', 'toCall'] },
  'alt.fold': { params: [] },
  'alt.check': { params: [] },
  'alt.call': { params: ['amount'] },
  'alt.callAllIn': { params: ['amount'] },
  'alt.bet': { params: ['amount'] },
  'alt.raise': { params: ['amount'] },
  'alt.allIn': { params: ['amount'] },

  'example.pair': { params: [] },
  'example.twoPair': { params: [] },
  'example.trips': { params: [] },
  'example.straight': { params: [] },
  'example.flush': { params: [] },
  'example.fullHousePlus': { params: [] },
  'villain.betsBig': { params: [] },
  'villain.bets': { params: [] },
  'villain.raises': { params: [] },
  'villain.reRaises': { params: [] },
  'villain.allIn': { params: [] },
  'villain.calls': { params: [] },
  'detail.checkFree': { params: [] },
  'detail.tooStrongToFold': { params: [] },
  'detail.riverNoChance': { params: [] },
  'detail.allInPriceGood': { params: [] },
  'detail.allInPriceBad': { params: [] },

  'feedback.foldedPrice': { params: E_NEED },
  'feedback.foldedPriceRange': { params: E_NEED },
  'feedback.calledPrice': { params: E_NEED },
  'feedback.calledPriceRange': { params: E_NEED },
  'feedback.checkedStrong': { params: [] },
  'feedback.airMultiway': { params: ['n'] },
  'feedback.airHeadsUp': { params: [] },
  'feedback.sizeBig': { params: ['size'] },
  'feedback.sizeSmall': { params: ['size'] },
  'feedback.openLoose': { params: ['hand'] },
  'feedback.foldedStrong': { params: ['hand', 'rankPct'] },
  'feedback.pushFoldAllIn': { params: ['S', 'hand'] },
  'feedback.pushFoldFold': { params: ['S', 'hand'] },
  'feedback.fallback': { params: ['alt'] },
} as const satisfies Record<string, TemplateSpec>;

export type TemplateKey = keyof typeof TEMPLATES;
export const TEMPLATE_KEYS = Object.keys(TEMPLATES) as TemplateKey[];

/** The spec of a template key. */
export function templateSpec(key: TemplateKey): TemplateSpec {
  return TEMPLATES[key];
}

// ── Lines ──────────────────────────────────────────────────────────────────────────────────────

/** A placeholder's value. Chances are percentage points, unrounded: the renderer rounds them. */
export type Param =
  /** A chance or a share, 0–100 points: a whole number ("<1" and ">99" at the ends, as the HUD). */
  | { kind: 'pct'; value: number }
  /** A starting-hand percentile (§8.3 `rankPct`), 0–100: rounded up, at least 1 ("top 1%"). */
  | { kind: 'top'; value: number }
  | { kind: 'chips'; value: number }
  /** A "to" amount in chips and the same in big blinds: "{to} ({bb} BB)". */
  | { kind: 'size'; to: number; bb: number }
  | { kind: 'count'; value: number }
  /** A hand name from `eval/describe.ts` (PLAN §0.3's exception: hand names live there). */
  | { kind: 'name'; text: string }
  /** A draw (Appendix F.3 name, lower case); null when the hand has no named draw. */
  | { kind: 'draw'; draw: DrawKind | null }
  /** Another template, rendered in place: `{example}`, `{actionDescription}`, `{detail}`, `{alt}`. */
  | { kind: 'line'; line: Line };

export interface Line {
  key: TemplateKey;
  params: Readonly<Record<string, Param>>;
  glossary: readonly GlossaryKey[];
}

/** A line of `key` with these params (the glossary keys come from the template's spec). */
export function line(key: TemplateKey, params: Record<string, Param> = {}): Line {
  return { key, params, glossary: templateSpec(key).glossary ?? [] };
}

const pct = (fraction: number): Param => ({ kind: 'pct', value: 100 * fraction });
const points = (value: number): Param => ({ kind: 'pct', value });
const chips = (value: number): Param => ({ kind: 'chips', value });
const count = (value: number): Param => ({ kind: 'count', value });
const name = (text: string): Param => ({ kind: 'name', text });
const nested = (key: TemplateKey, params: Record<string, Param> = {}): Param => ({
  kind: 'line',
  line: line(key, params),
});
const sizeOf = (to: number, bb: number): Param => ({ kind: 'size', to, bb: to / bb });

/** The whole number a chance shows as (the renderer's rounding; "<1" and ">99" keep the order). */
export function shownPct(fraction: number): number {
  return Math.round(100 * fraction);
}

// ── Inputs ─────────────────────────────────────────────────────────────────────────────────────

/** The villain's last voluntary action, for RANGE_ADJUST's `{actionDescription}` (F.1). */
export type VillainAction = 'betsBig' | 'bets' | 'raises' | 'reRaises' | 'allIn' | 'calls';

/** F.1 `{actionDescription}`: a bet or raise of at least ⅔ of the pot "bets big" (a copy rule). */
export const BETS_BIG_SHARE = 2 / 3;

/**
 * The last voluntary action (call, bet or raise) of a live opponent, as F.1 describes it: a call
 * "calls" (a call all-in too); an all-in bet or raise "goes all-in"; after the flop, a bet or raise
 * that puts in at least ⅔ of the pot before it "bets big"; else by its rank on its street (after
 * the flop the first "bets", the second "raises", later ones "re-raise"; before the flop the open
 * "raises" and every later raise "re-raises": an open is always several times the blinds, so the
 * ⅔ rule would call every open "big"). Null when no opponent has acted voluntarily.
 */
export function villainAction(obs: Observation): VillainAction | null {
  for (let i = obs.history.length - 1; i >= 0; i--) {
    const a = obs.history[i] as PublicAction;
    if (a.seat === obs.seat || obs.folded[a.seat] === true) continue;
    if (a.type === 'call') return 'calls';
    if (a.type !== 'bet' && a.type !== 'raise') continue;
    if (a.allIn) return 'allIn';
    if (a.street !== 'preflop' && a.amountIn >= BETS_BIG_SHARE * a.potBefore - 1e-9) {
      return 'betsBig';
    }
    let nth = 0;
    for (let j = 0; j <= i; j++) {
      const b = obs.history[j] as PublicAction;
      if (b.street === a.street && (b.type === 'bet' || b.type === 'raise')) nth++;
    }
    if (a.street === 'preflop') return nth === 1 ? 'raises' : 'reRaises';
    return nth === 1 ? 'bets' : nth === 2 ? 'raises' : 'reRaises';
  }
  return null;
}

/** Everything an explanation reads: the decision, its numbers and a few facts of the spot. */
export interface ExplainInput {
  /** The final, legal action, and the reasons the policy and the guardrails gave, main first. */
  action: PlayerAction;
  trace: readonly Reason[];
  confidence: Decision['confidence'];
  alt: PlayerAction | null;
  /** HUD equity (vs random hands), equity vs the estimated ranges, and the price: fractions. */
  eRandom: number;
  eRange: number;
  need: number;
  /** Chips: the pot, the pot the hero can win (§0.3), the call, the big blind. */
  pot: number;
  winPot: number;
  toCall: number;
  bb: number;
  legal: LegalActions;
  street: Street;
  facing: Facing;
  position: Position;
  nOpp: number;
  /** §8.2 `k` (preflop players behind) and the starting-hand percentile (§8.3). */
  k: number;
  rankPct: number;
  /** `describe(hole, board)`: name and category; and the preflop name of the hole cards (F.2). */
  handName: string;
  handCategory: HandCategory;
  preflopName: string;
  /** §6.2 draws and §6.3 outs (flop and turn; none on the river). */
  draws: readonly { kind: DrawKind; outs: number }[];
  outs: number;
  villain: VillainAction | null;
}

/** The input for the observer of `obs`, its features `f` and its decision `d`. */
export function explainInput(
  obs: Observation,
  f: Features,
  d: Pick<Decision, 'action' | 'trace' | 'confidence' | 'alt' | 'eRandom' | 'eRange' | 'need'>,
): ExplainInput {
  return {
    action: d.action,
    trace: d.trace,
    confidence: d.confidence,
    alt: d.alt,
    eRandom: d.eRandom,
    eRange: d.eRange,
    need: d.need,
    pot: f.pot,
    winPot: f.winPot,
    toCall: f.toCall,
    bb: obs.bb,
    legal: obs.legal,
    street: f.street,
    facing: f.facing,
    position: f.position,
    nOpp: f.nOpp,
    k: f.k,
    rankPct: f.rankPct,
    handName: f.handInfo.name,
    handCategory: f.handInfo.category,
    preflopName: describe(obs.hole, []).name,
    draws: f.draws,
    outs: f.outs,
    villain: villainAction(obs),
  };
}

// ── The explanation ────────────────────────────────────────────────────────────────────────────

export interface Explanation {
  headline: Line;
  /** RANGE_ADJUST first when shown, then the main reason and at most one more. */
  reasons: Line[];
  numbers: Line;
  whyNot: Line[];
  close: Line | null;
  /** The rule of 2 and 4 (coach sheet, draws only). */
  trick: Line[];
  /** The reason codes the lines show, in order, with their numbers (§8.2 `trace`). */
  trace: Reason[];
  /**
   * The numbers the text shows, as fractions: the HUD's `eRandom`; the range number when
   * RANGE_ADJUST labels it (else null); `win`, the chance the reasons compare with the price
   * (the price bar's fill, §12.6); and `need`.
   */
  shown: { eRandom: number; eRange: number | null; win: number; need: number };
}

/** Action groups: what the "Why not …?" lines and the main reason are matched by. */
export type ActionGroup = 'fold' | 'check' | 'call' | 'bet' | 'raise';
const GROUPS: readonly ActionGroup[] = ['fold', 'check', 'call', 'bet', 'raise'];

/** A bet or raise to the legal maximum, or a call that puts the hero all-in. */
export function isAllIn(action: PlayerAction, legal: LegalActions): boolean {
  if (action.type === 'call') return legal.callIsAllIn;
  if (action.type === 'bet' || action.type === 'raise') {
    return action.to === legal[action.type]?.max;
  }
  return false;
}

/** The group of an action: its type (an all-in is a bet or a raise, an all-in call a call). */
export function groupOf(action: PlayerAction): ActionGroup {
  return action.type;
}

/** The guardrail behind each F.1 `{detail}` (§8.8 rules 1–4) and the action it leads to. */
const GUARD_GROUP = {
  checkFree: 'check',
  tooStrongToFold: 'call',
  riverNoChance: 'fold',
  allInPriceGood: 'call',
  allInPriceBad: 'fold',
} as const satisfies Record<string, ActionGroup>;
type GuardDetail = keyof typeof GUARD_GROUP;

const isGuardDetail = (x: unknown): x is GuardDetail =>
  typeof x === 'string' && Object.prototype.hasOwnProperty.call(GUARD_GROUP, x);

const num = (x: number | string | undefined): number | null =>
  typeof x === 'number' && Number.isFinite(x) ? x : null;

/** Does the reason have the numbers its sentence needs from the policy? */
function usable(r: Reason): boolean {
  switch (r.code) {
    case 'OPEN_RANGE':
      return num(r.data.openPct) !== null;
    case 'PUSH_FOLD':
      return (
        num(r.data.S) !== null &&
        num(r.data.Pfold) !== null &&
        num(r.data.E) !== null &&
        (r.data.action === 'allin' || r.data.action === 'fold')
      );
    case 'IMPLIED':
      return num(r.data.needImplied) !== null;
    case 'GUARDRAIL':
      return isGuardDetail(r.data.detail);
    default:
      return true;
  }
}

/** Does the reason explain this final action? Derived codes are never main reasons. */
function fits(r: Reason, group: ActionGroup, allIn: boolean): boolean {
  switch (r.code) {
    case 'OPEN_RANGE':
    case 'ISOLATE':
    case 'THREE_BET_VALUE':
    case 'FOUR_BET_VALUE':
    case 'VALUE_RAISE':
    case 'RAISE_PROTECT':
      return group === 'raise';
    case 'FOLD_RANGE':
    case 'FOLD_VS_RAISE':
    case 'FOLD_PRICE':
    case 'FOLD_ALLIN':
      return group === 'fold';
    case 'CHECK_FREE':
    case 'POT_CONTROL':
    case 'CHECK_WEAK':
      return group === 'check';
    case 'CALL_PREFLOP':
    case 'SET_MINING':
    case 'CALL_PROFITABLE':
    case 'IMPLIED':
    case 'CALL_ALLIN':
      return group === 'call';
    case 'VALUE_BET':
    case 'THIN_VALUE':
    case 'CBET_DRY':
    case 'SEMI_BLUFF':
      return group === 'bet';
    case 'NUTS':
      return group === 'bet' || group === 'raise';
    case 'COMMITTED':
      return group === 'call' || group === 'bet' || group === 'raise';
    case 'BOARD_PLAYS':
      return group === 'fold' || group === 'check' || group === 'call';
    case 'PUSH_FOLD':
      return r.data.action === 'fold' ? group === 'fold' : allIn;
    case 'GUARDRAIL':
      return isGuardDetail(r.data.detail) && GUARD_GROUP[r.data.detail] === group;
    default:
      return false;
  }
}

/** Codes whose sentence names the range their `{E}` is against (F.1); PUSH_FOLD is apart. */
const RANGE_CODES: ReadonlySet<ReasonCode> = new Set<ReasonCode>([
  'CALL_PREFLOP',
  'FOLD_VS_RAISE',
  'THREE_BET_VALUE',
  'FOUR_BET_VALUE',
  'CALL_ALLIN',
  'FOLD_ALLIN',
]);

/** How a price sentence compares the shown win chance with the shown price. */
type Direction = 'more' | 'atLeast' | 'less';

/** `win` against `need` in whole numbers, as the text shows them. */
function holds(direction: Direction, win: number, need: number): boolean {
  const a = shownPct(win);
  const b = shownPct(need);
  return direction === 'more' ? a > b : direction === 'atLeast' ? a >= b : a < b;
}

/** The whole numbers point the other way (a tie is no contradiction: it is "close"). */
function contradicts(direction: Direction, win: number, need: number): boolean {
  const a = shownPct(win);
  const b = shownPct(need);
  return direction === 'less' ? a > b : a < b;
}

/** The two price codes whose `{E}` is `eRandom` unless RANGE_ADJUST is shown. */
const PRICE_DIRECTION: Partial<Record<ReasonCode, Direction>> = {
  CALL_PROFITABLE: 'more',
  FOLD_PRICE: 'less',
};

/** F.1 `{example}` (VALUE_BET) by the hero's category; none for high card. */
function exampleKey(category: HandCategory): TemplateKey | null {
  switch (category) {
    case 'highCard':
      return null;
    case 'pair':
      return 'example.pair';
    case 'twoPair':
      return 'example.twoPair';
    case 'trips':
      return 'example.trips';
    case 'straight':
      return 'example.straight';
    case 'flush':
      return 'example.flush';
    default:
      return 'example.fullHousePlus';
  }
}

const DRAW_KINDS: ReadonlySet<string> = new Set<DrawKind>([
  'flush',
  'nutFlush',
  'oesd',
  'doubleGutshot',
  'gutshot',
  'overcards',
  'backdoorFlush',
  'backdoorStraight',
]);

/** The draw a reason names (`data.draw`), else the hero's largest draw (most outs), else none. */
function drawOf(r: Reason, input: ExplainInput): DrawKind | null {
  const named = r.data.draw;
  if (typeof named === 'string' && DRAW_KINDS.has(named)) return named as DrawKind;
  let best: ExplainInput['draws'][number] | null = null;
  for (const d of input.draws) if (best === null || d.outs > best.outs) best = d;
  return best === null ? null : best.kind;
}

/** Board cards by street, for the §6.6 outs chances. */
const BOARD_LENGTH: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5 };

/** Headline-style keys of an action: `headline.*` (with big blinds) or `alt.*` (chips only). */
function actionLine(
  prefix: 'headline' | 'alt',
  action: PlayerAction,
  input: Pick<ExplainInput, 'legal' | 'toCall' | 'bb'>,
): Line {
  switch (action.type) {
    case 'fold':
      return line(`${prefix}.fold`);
    case 'check':
      return line(`${prefix}.check`);
    case 'call':
      return line(input.legal.callIsAllIn ? `${prefix}.callAllIn` : `${prefix}.call`, {
        amount: chips(input.toCall),
      });
    default: {
      const kind = isAllIn(action, input.legal) ? 'allIn' : action.type;
      if (prefix === 'alt') return line(`alt.${kind}`, { amount: chips(action.to) });
      return line(`headline.${kind}`, { size: sizeOf(action.to, input.bb) });
    }
  }
}

/** The numbers line (§8.10 hint structure 3): always the HUD's `eRandom`. */
function numbersLine(input: ExplainInput): Line {
  const eRandom = pct(input.eRandom);
  if (input.toCall <= 0) return line('numbers.free', { eRandom, pot: chips(input.pot) });
  const short = input.winPot < input.pot;
  return line(short ? 'numbers.short' : 'numbers', {
    eRandom,
    need: pct(input.need),
    pot: chips(short ? input.winPot : input.pot),
    toCall: chips(input.toCall),
  });
}

interface Context {
  input: ExplainInput;
  /** The hint's range number and whether RANGE_ADJUST labels it. */
  rangeE: number;
  adjust: boolean;
}

/** `{E}` of a reason (see the header). */
function eOf(r: Reason, c: Context): number {
  if (r.code === 'PUSH_FOLD') return num(r.data.E) ?? c.rangeE;
  if (RANGE_CODES.has(r.code)) return c.rangeE;
  return c.adjust ? c.rangeE : c.input.eRandom;
}

/** The line of one reason, with the variant its numbers call for. */
function reasonLine(r: Reason, c: Context): Line {
  const { input } = c;
  const E = eOf(r, c);
  const need = input.need;
  const pE = pct(E);
  const pNeed = pct(need);
  const size = (): Param =>
    input.action.type === 'bet' || input.action.type === 'raise'
      ? sizeOf(input.action.to, input.bb)
      : sizeOf(0, input.bb);
  switch (r.code) {
    case 'OPEN_RANGE':
      return line('OPEN_RANGE', {
        hand: name(input.preflopName),
        rankPct: { kind: 'top', value: input.rankPct },
        behind: count(input.k),
        openPct: points(num(r.data.openPct) as number),
        size: size(),
      });
    case 'FOLD_RANGE':
      return line('FOLD_RANGE', { hand: name(input.preflopName), behind: count(input.k) });
    case 'ISOLATE':
    case 'VALUE_RAISE':
    case 'CBET_DRY':
      return line(r.code, { size: size() });
    case 'THREE_BET_VALUE':
      return line('THREE_BET_VALUE', { hand: name(input.preflopName), E: pE, size: size() });
    case 'FOUR_BET_VALUE':
      return line('FOUR_BET_VALUE', { hand: name(input.preflopName), size: size() });
    case 'FOLD_VS_RAISE':
      return line('FOLD_VS_RAISE', { hand: name(input.preflopName), E: pE });
    case 'CALL_PREFLOP': {
      const variant = holds('atLeast', E, need)
        ? 'CALL_PREFLOP'
        : (num(r.data.implied) ?? 0) > 0
          ? 'CALL_PREFLOP.implied'
          : 'CALL_PREFLOP.close';
      return line(variant, { E: pE, need: pNeed });
    }
    case 'CALL_PROFITABLE':
      return line(holds('more', E, need) ? 'CALL_PROFITABLE' : 'CALL_PROFITABLE.close', {
        E: pE,
        need: pNeed,
        toCall: chips(input.toCall),
        pot: chips(input.winPot),
      });
    case 'FOLD_PRICE': {
      const laterBets = input.street !== 'river' && (input.position === 'OOP' || input.nOpp > 1);
      const variant = holds('less', E, need)
        ? 'FOLD_PRICE'
        : laterBets
          ? 'FOLD_PRICE.realise'
          : 'FOLD_PRICE.close';
      return line(variant, { E: pE, need: pNeed });
    }
    case 'CALL_ALLIN':
      return line(holds('atLeast', E, need) ? 'CALL_ALLIN' : 'CALL_ALLIN.close', {
        E: pE,
        need: pNeed,
      });
    case 'FOLD_ALLIN':
      return line(holds('less', E, need) ? 'FOLD_ALLIN' : 'FOLD_ALLIN.close', {
        E: pE,
        need: pNeed,
      });
    case 'IMPLIED':
      return line('IMPLIED', {
        need: pNeed,
        draw: { kind: 'draw', draw: drawOf(r, input) },
        needImplied: pct(num(r.data.needImplied) as number),
      });
    case 'VALUE_BET': {
      const example = exampleKey(input.handCategory);
      const multiway = input.nOpp > 1 && shownPct(E) < 50;
      const base = { handName: name(input.handName), E: pE, size: size() };
      const n = { n: count(input.nOpp) };
      if (example === null) {
        return multiway
          ? line('VALUE_BET.multiwayNoExample', { ...base, ...n })
          : line('VALUE_BET.noExample', base);
      }
      const ex = { example: nested(example) };
      return multiway
        ? line('VALUE_BET.multiway', { ...base, ...n, ...ex })
        : line('VALUE_BET', { ...base, ...ex });
    }
    case 'THIN_VALUE':
      return line('THIN_VALUE', { handName: name(input.handName), size: size() });
    case 'POT_CONTROL':
    case 'COMMITTED':
      return line(r.code, { handName: name(input.handName) });
    case 'SEMI_BLUFF': {
      const hit = outsChances(input.outs, BOARD_LENGTH[input.street]);
      const params: Record<string, Param> = {
        draw: { kind: 'draw', draw: drawOf(r, input) },
        outs: count(input.outs),
        hitNext: points(hit.nextCardPct ?? 0),
      };
      if (input.street === 'turn') return line('SEMI_BLUFF.turn', params);
      return line('SEMI_BLUFF', { ...params, hitRiver: points(hit.byRiverPct ?? 0) });
    }
    case 'PUSH_FOLD':
      return line(r.data.action === 'fold' ? 'PUSH_FOLD.fold' : 'PUSH_FOLD', {
        S: count(num(r.data.S) as number),
        Pfold: pct(num(r.data.Pfold) as number),
        E: pE,
      });
    case 'GUARDRAIL':
      return line('GUARDRAIL', { detail: nested(`detail.${r.data.detail as GuardDetail}`) });
    case 'CHECK_FREE':
    case 'SET_MINING':
    case 'RAISE_PROTECT':
    case 'CHECK_WEAK':
    case 'NUTS':
    case 'BOARD_PLAYS':
      return line(r.code);
    default:
      return line('FALLBACK');
  }
}

/** RANGE_ADJUST and its wording (see the header). */
function rangeAdjustLine(input: ExplainInput, rangeE: number): Line {
  const params = { eRandom: pct(input.eRandom), eRange: pct(rangeE) };
  if (rangeE === input.eRange) {
    if (shownPct(rangeE) < shownPct(input.eRandom) && input.villain !== null) {
      return line('RANGE_ADJUST', {
        ...params,
        actionDescription: nested(`villain.${input.villain}`),
      });
    }
    if (shownPct(rangeE) > shownPct(input.eRandom)) return line('RANGE_ADJUST.weaker', params);
  }
  return line('RANGE_ADJUST.plain', params);
}

/** The groups a hero may choose now (fold only when it is not free). */
function legalGroups(legal: LegalActions): Record<ActionGroup, boolean> {
  return {
    fold: legal.canFold && !legal.canCheck,
    check: legal.canCheck,
    call: legal.canCall,
    bet: legal.bet !== null,
    raise: legal.raise !== null,
  };
}

/** Codes that bet or raise without value: "worse hands would get a free card" is not the reason. */
const NOT_FOR_VALUE: ReadonlySet<ReasonCode> = new Set<ReasonCode>(['SEMI_BLUFF', 'CBET_DRY']);

/**
 * The explanation of a decision (see the header). Deterministic and cheap: no Monte Carlo, only
 * the numbers in `input`.
 */
export function explain(input: ExplainInput): Explanation {
  const group = groupOf(input.action);
  const allIn = isAllIn(input.action, input.legal);

  // 1. The reasons that explain the final action; a guardrail that fired first.
  const fitting = input.trace.filter((r) => usable(r) && fits(r, group, allIn));
  const ordered = [
    ...fitting.filter((r) => r.code === 'GUARDRAIL'),
    ...fitting.filter((r) => r.code !== 'GUARDRAIL'),
  ].slice(0, 2);
  const main = ordered[0] ?? null;

  // 2. The hint's range number, RANGE_ADJUST and the `{E}` of the other codes.
  const rangeReason = ordered.find((r) => RANGE_CODES.has(r.code) && num(r.data.E) !== null);
  const rangeE = rangeReason === undefined ? input.eRange : (num(rangeReason.data.E) as number);
  let adjust =
    showsRangeAdjust(input.eRandom, rangeE, input.need) ||
    showsRangeAdjust(input.eRandom, input.eRange, input.need);
  const direction = main === null ? undefined : PRICE_DIRECTION[main.code];
  if (
    !adjust &&
    direction !== undefined &&
    contradicts(direction, input.eRandom, input.need) &&
    !contradicts(direction, rangeE, input.need)
  ) {
    adjust = true;
  }
  const c: Context = { input, rangeE, adjust };
  /** `{E}` of every code that does not name a range: what "Why not …?" compares, too. */
  const win = adjust ? rangeE : input.eRandom;

  // 3. The lines.
  const trace: Reason[] = [];
  const reasons: Line[] = [];
  if (adjust) {
    const ra = rangeAdjustLine(input, rangeE);
    reasons.push(ra);
    trace.push({
      code: 'RANGE_ADJUST',
      data: {
        eRandom: input.eRandom,
        eRange: rangeE,
        ...(ra.key === 'RANGE_ADJUST' && input.villain !== null ? { action: input.villain } : {}),
      },
    });
  }
  if (ordered.length === 0) reasons.push(line('FALLBACK'));
  for (const r of ordered) {
    reasons.push(reasonLine(r, c));
    trace.push(r);
  }

  // 4. Close call, then "Why not …?" for the other groups (the close alternative's group excluded).
  let close: Line | null = null;
  let closeGroup: ActionGroup | null = null;
  const alt = input.alt;
  if (input.confidence === 'close' && alt !== null && !sameAction(alt, input.action)) {
    close = line('CLOSE_SPOT', { alt: { kind: 'line', line: actionLine('alt', alt, input) } });
    closeGroup = groupOf(alt);
  }
  const whyNot: Line[] = [];
  const can = legalGroups(input.legal);
  const valueBet =
    (group === 'bet' || group === 'raise') && (main === null || !NOT_FOR_VALUE.has(main.code));
  // A limp is never advice (C10), and with a short stack the choice is only fold or all-in (§8.4).
  const noCall =
    (input.street === 'preflop' && (input.facing === 'none' || input.facing === 'limpers')) ||
    main?.code === 'PUSH_FOLD';
  for (const g of GROUPS) {
    if (g === group || g === closeGroup || !can[g]) continue;
    let reason: Reason | null = null;
    let text: Line | null = null;
    if (g === 'fold' && input.toCall > 0 && holds('more', win, input.need)) {
      reason = { code: 'WHY_NOT_FOLD', data: {} };
      text = line('WHY_NOT_FOLD');
    } else if (g === 'check' && valueBet) {
      reason = { code: 'WHY_NOT_CHECK', data: {} };
      text = line('WHY_NOT_CHECK');
    } else if (g === 'call' && !noCall && holds('less', win, input.need)) {
      reason = { code: 'WHY_NOT_CALL', data: { E: win, need: input.need } };
      text = line('WHY_NOT_CALL', { E: pct(win), need: pct(input.need) });
    } else if (g === 'bet' && group === 'check') {
      reason = { code: 'WHY_NOT_BET', data: {} };
      text = line('WHY_NOT_BET');
    } else if (g === 'raise' && (group === 'call' || group === 'check' || group === 'fold')) {
      reason = { code: 'WHY_NOT_RAISE', data: {} };
      text = line('WHY_NOT_RAISE');
    }
    if (reason !== null && text !== null) {
      whyNot.push(text);
      trace.push(reason);
    }
  }
  if (close !== null && alt !== null) {
    trace.push({ code: 'CLOSE_SPOT', data: { alt: alt.type } });
  }

  // 5. The rule of 2 and 4: draws only, flop and turn; "too high" only where ×4 is used (flop).
  const trick: Line[] = [];
  const hasDraw = input.draws.some(
    (d) => d.kind !== 'backdoorFlush' && d.kind !== 'backdoorStraight',
  );
  if ((input.street === 'flop' || input.street === 'turn') && input.outs > 0 && hasDraw) {
    const exact = outsChances(input.outs, BOARD_LENGTH[input.street]).byRiverPct ?? 0;
    trick.push(line('RULE_2_4', { exact: points(exact) }));
    trace.push({ code: 'RULE_2_4', data: { outs: input.outs, exact: exact / 100 } });
    if (input.street === 'flop' && input.outs > 8) {
      trick.push(line('RULE_2_4_BIG'));
      trace.push({ code: 'RULE_2_4_BIG', data: {} });
    }
  }

  return {
    headline: actionLine('headline', input.action, input),
    reasons,
    numbers: numbersLine(input),
    whyNot,
    close,
    trick,
    trace,
    shown: {
      eRandom: input.eRandom,
      eRange: adjust ? rangeE : null,
      win,
      need: input.need,
    },
  };
}

function sameAction(a: PlayerAction, b: PlayerAction): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'bet' || a.type === 'raise') return a.to === (b as { to: number }).to;
  return true;
}

// ── Feedback (Appendix F.5): the template plumbing; Stage 6 picks the row ────────────────────────

/** One F.5 row with its numbers (fractions for chances, chips for sizes). */
export type FeedbackInput =
  | { row: 'foldedPrice' | 'calledPrice'; E: number; need: number; rangeAdjust: boolean }
  | { row: 'checkedStrong' | 'airHeadsUp' }
  | { row: 'airMultiway'; players: number }
  | { row: 'size'; tooBig: boolean; to: number; bb: number }
  | { row: 'openLoose'; hand: string }
  | { row: 'foldedStrong'; hand: string; rankPct: number }
  | { row: 'pushFold'; S: number; hand: string; move: 'allin' | 'fold' }
  | { row: 'fallback'; alt: PlayerAction; legal: LegalActions; toCall: number; bb: number };

/**
 * The line of one F.5 feedback row. With RANGE_ADJUST's condition (§8.10) a price row says
 * "against their likely hands" (`*Range`), so it never contradicts the HUD badge.
 */
export function feedbackLine(f: FeedbackInput): Line {
  switch (f.row) {
    case 'foldedPrice':
    case 'calledPrice': {
      const key = `feedback.${f.row}${f.rangeAdjust ? 'Range' : ''}` as const;
      return line(key, { E: pct(f.E), need: pct(f.need) });
    }
    case 'checkedStrong':
    case 'airHeadsUp':
      return line(`feedback.${f.row}`);
    case 'airMultiway':
      return line('feedback.airMultiway', { n: count(f.players) });
    case 'size':
      return line(f.tooBig ? 'feedback.sizeBig' : 'feedback.sizeSmall', {
        size: sizeOf(f.to, f.bb),
      });
    case 'openLoose':
      return line('feedback.openLoose', { hand: name(f.hand) });
    case 'foldedStrong':
      return line('feedback.foldedStrong', {
        hand: name(f.hand),
        rankPct: { kind: 'top', value: f.rankPct },
      });
    case 'pushFold':
      return line(f.move === 'allin' ? 'feedback.pushFoldAllIn' : 'feedback.pushFoldFold', {
        S: count(f.S),
        hand: name(f.hand),
      });
    case 'fallback':
      return line('feedback.fallback', {
        alt: { kind: 'line', line: actionLine('alt', f.alt, f) },
      });
  }
}
