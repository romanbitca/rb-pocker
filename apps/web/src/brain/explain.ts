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
 * - **Whom each number counts** (§8.10). `eRandom` counts every live opponent. A range code's own
 *   number before the flop counts only the raiser and its `data.callers` callers already in
 *   (§8.3): the players still to act are left out. When that is fewer players, each number says
 *   whom it counts (`.raiser`: "Against all 5 players with any cards, you win 26%. Against the
 *   raiser's likely hands alone, you win about 44%."; `.callers` with callers), and `shown` says
 *   so to the strip and the sheet (`players`, `callers`); with the same players the words above
 *   stay. Otherwise a raiser's 44% next to five players' 26% reads as a contradiction.
 * - **The price bar** (`shown.bar`, §12.6) follows the comparison the coach made, so its ✓/✗
 *   never argues against the advice: the words' win chance against the price when that agrees;
 *   else, as the main reason compared, the realised `win × R` (a fold the price alone would pay)
 *   or the implied price (a call it would not pay); else no bar (`priceBar`).
 * - **Consistency.** A sentence that compares the win chance with the price is used only when the
 *   whole numbers it shows agree with it; otherwise its `.close` variant (or `.realise`: you win
 *   less often when later bets can make you fold; or `.implied` for a pocket pair) says so
 *   without a false comparison; "close" means at most `CLOSE_POINTS` apart (for a decision made
 *   by its policy's own rule, equal whole numbers). A price sentence that no variant can say
 *   honestly is not used (`honest`): the next reason, or FALLBACK, explains the action.
 * - **Why not.** For each legal action group other than the recommendation's (fold, check, call,
 *   bet, raise; all-in joins bet or raise), only when its sentence is true: fold when facing a bet
 *   and the shown win chance beats the price; check before a bet or raise for value (not a
 *   semi-bluff or a continuation bet; on the river "worse hands would call a bet", there is no
 *   free card); call when the shown win chance is below the price (never a limp, never in
 *   push/fold); bet instead of a check; raise instead of a call, a check or a fold. The close
 *   alternative's group gets the "Close call" line instead.
 *
 * The coach-advice audit of 6 Nov 2026 (branch `fix/coach-words-and-draws`) added:
 * - **No limp's price.** Before the flop with nobody raised, a call would be a limp (C10): the
 *   numbers line shows the win chance and the pot only, there is no price bar and no "Why not
 *   fold?" (`shown.price` false; the sheet follows it).
 * - **Draws.** `{draw}` is the strongest real draw (`mainDraw`: a flush draw, then a straight
 *   draw), never the draw with the most outs; with outs of more than one kind SEMI_BLUFF names
 *   each group by what it makes (`.groups`: "9 for a flush · 6 for a pair (weak)", weak outs and
 *   pairs marked, §6.3), and the rule of 2 and 4 says how many outs its exact chance counts. A
 *   Draw that checks names its draw (`CHECK_WEAK.draw`).
 * - **FOLD_VS_RAISE** says "wins only about {E}%" only below the price; at or above it the true
 *   reason: `.realise` when the policy's EV(call) still says fold (later bets, R < 1), `.range`
 *   when EV(call) > 0 and the hand is outside the range that calls the raise (§8.3 step 6).
 * - **River.** RAISE_PROTECT's "so draws pay" becomes `.river` ("worse hands can still call").
 */
import { outsChances } from '../analysis/chances.ts';
import { findOuts } from '../analysis/handinfo.ts';
import type { DrawKind, OutCard } from '../analysis/types.ts';
import type {
  LegalActions,
  Observation,
  PlayerAction,
  PublicAction,
  Street,
} from '../engine/types.ts';
import { describe } from '../eval/describe.ts';
import { HAND_CATEGORIES, type HandCategory } from '../eval/evaluate.ts';
import { mainDraw, REAL_DRAWS, showsRangeAdjust } from './features.ts';
import type { Decision, Facing, Features, Position, Reason, ReasonCode } from './types.ts';

// ── Keys ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Glossary keys (Appendix F.9): every name in the Term column and every parenthesised alias, lower
 * case. `enCoach.glossary` defines each one; `check-copy` keeps the two lists equal.
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
  // Heads-up there are no other players to keep out (QA-2 of 6 Nov 2026, item 7).
  'ISOLATE.headsUp': { params: ['hand', 'size'] },
  CHECK_FREE: { params: [] },
  THREE_BET_VALUE: { params: ['hand', 'E', 'size'] },
  FOUR_BET_VALUE: { params: ['hand', 'size'] },
  CALL_PREFLOP: { params: E_NEED },
  'CALL_PREFLOP.close': { params: E_NEED },
  'CALL_PREFLOP.implied': { params: E_NEED, glossary: ['set'] },
  FOLD_VS_RAISE: { params: ['hand', 'E'] },
  'FOLD_VS_RAISE.realise': { params: ['need', 'hand', 'E'] },
  'FOLD_VS_RAISE.range': { params: ['hand', 'rankPct'] },
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
  'RAISE_PROTECT.river': { params: [] },
  THIN_VALUE: { params: ['handName', 'size'] },
  POT_CONTROL: { params: ['handName'] },
  SEMI_BLUFF: { params: ['draw', 'outs', 'hitNext', 'hitRiver'], glossary: ['outs'] },
  'SEMI_BLUFF.turn': { params: ['draw', 'outs', 'hitNext'], glossary: ['outs'] },
  'SEMI_BLUFF.groups': { params: ['draw', 'groups', 'hitNext', 'hitRiver'], glossary: ['outs'] },
  'SEMI_BLUFF.turnGroups': { params: ['draw', 'groups', 'hitNext'], glossary: ['outs'] },
  CBET_DRY: { params: ['size'] },
  CHECK_WEAK: { params: [] },
  'CHECK_WEAK.draw': { params: ['draw'] },
  PUSH_FOLD: { params: ['S', 'Pfold', 'E'], glossary: ['big blind', 'all-in'] },
  'PUSH_FOLD.fold': { params: ['S', 'Pfold', 'E'], glossary: ['big blind', 'all-in'] },
  // `S` is an opponent's stack, not the hero's (QA-2 item 2): whose it is, heads-up or not.
  'PUSH_FOLD.them': { params: ['S', 'Pfold', 'E'], glossary: ['big blind', 'all-in'] },
  'PUSH_FOLD.themFold': { params: ['S', 'Pfold', 'E'], glossary: ['big blind', 'all-in'] },
  'PUSH_FOLD.others': { params: ['S', 'Pfold', 'E'], glossary: ['big blind', 'all-in'] },
  'PUSH_FOLD.othersFold': { params: ['S', 'Pfold', 'E'], glossary: ['big blind', 'all-in'] },
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
  'RANGE_ADJUST.raiser': { params: ['n', 'eRandom', 'eRange'] },
  'RANGE_ADJUST.both': { params: ['eRandom', 'eRange'] },
  'RANGE_ADJUST.callers': { params: ['n', 'eRandom', 'callers', 'eRange'] },
  WHY_NOT_FOLD: { params: [] },
  WHY_NOT_CHECK: { params: [] },
  'WHY_NOT_CHECK.river': { params: [] },
  WHY_NOT_CALL: { params: E_NEED },
  WHY_NOT_BET: { params: [] },
  WHY_NOT_RAISE: { params: [] },
  CLOSE_SPOT: { params: ['alt'] },
  GUARDRAIL: { params: ['detail'] },
  RULE_2_4: { params: ['outs', 'exact'] },
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
  // SEMI_BLUFF's `{groups}` (§6.3: the outs by what they make): "9 for a flush · 6 for a pair
  // (weak)", one `outs.list` per extra group.
  'outs.list': { params: ['group', 'rest'] },
  'outs.group': { params: ['outs', 'makes'] },
  'outs.groupWeak': { params: ['outs', 'makes'] },
  'makes.pair': { params: [] },
  'makes.twoPair': { params: [] },
  'makes.trips': { params: [] },
  'makes.straight': { params: [] },
  'makes.flush': { params: [] },
  'makes.fullHouse': { params: [] },
  'makes.quads': { params: [] },
  'makes.straightFlush': { params: [] },
  'makes.royalFlush': { params: [] },
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
  'feedback.foldedPriceRaiser': { params: ['E', 'who', 'need'] },
  'feedback.calledPrice': { params: E_NEED },
  'feedback.calledPriceRange': { params: E_NEED },
  'feedback.calledPriceRaiser': { params: ['E', 'who', 'need'] },
  'feedback.calledValue': { params: [] },
  'feedback.checkedStrong': { params: [] },
  'feedback.airMultiway': { params: ['n'] },
  'feedback.airHeadsUp': { params: [] },
  'feedback.sizeBig': { params: ['size'] },
  'feedback.sizeSmall': { params: ['size'] },
  'feedback.openLoose': { params: ['hand'] },
  'feedback.foldedStrong': { params: ['hand', 'rankPct'] },
  'feedback.pushFoldAllIn': { params: ['stack', 'hand'] },
  'feedback.pushFoldFold': { params: ['stack', 'hand'] },
  'feedback.fallback': { params: ['alt'] },
  // F.5 `{who}`: whom the hint's range number counts, when fewer than every live opponent
  // (§8.10); `{stack}`: whose stack the push/fold row's `S` is (QA-2 items 2 and 3).
  'who.raiser': { params: [] },
  'who.callers': { params: ['callers'] },
  'stack.own': { params: ['S'] },
  'stack.them': { params: ['S'] },
  'stack.others': { params: ['S'] },
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
  /** The same outs grouped by what they make (`outGroups`): SEMI_BLUFF names each group. */
  outGroups: readonly OutGroup[];
  villain: VillainAction | null;
}

/** §6.3: the outs that make one category, the weak ones apart. */
export interface OutGroup {
  makes: HandCategory;
  outs: number;
  /** Shown "(weak)": weak outs (§6.3), or a Pair (§6.2: two overcards are always weak). */
  weak: boolean;
}

/**
 * The §6.3 outs grouped by the category they make, strongest first (a weak group after the
 * strong one of its category): together they count every out once, as `outs` does.
 */
export function outGroupsOf(outs: readonly OutCard[]): OutGroup[] {
  const groups: OutGroup[] = [];
  for (const o of outs) {
    const weak = o.weak || o.makes === 'pair';
    const g = groups.find((x) => x.makes === o.makes && x.weak === weak);
    if (g === undefined) groups.push({ makes: o.makes, outs: 1, weak });
    else g.outs++;
  }
  const level = (c: HandCategory): number => HAND_CATEGORIES.indexOf(c);
  return groups.sort((a, b) => level(b.makes) - level(a.makes) || Number(a.weak) - Number(b.weak));
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
    outGroups: f.outs > 0 ? outGroupsOf(findOuts(obs.hole, obs.board)) : [],
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
   * (the price bar's fill, §12.6); and `need`. And whom they count (§8.10): `eRandom` all
   * `players` live opponents; a range number the text shows, the raiser and `callers` callers
   * already in when that is fewer players (null: every live opponent, as `eRandom`).
   */
  shown: {
    eRandom: number;
    eRange: number | null;
    win: number;
    need: number;
    players: number;
    callers: number | null;
    /**
     * The hint shows a price (need, to call): something to call that the advice weighs. False
     * with nothing to call, and before the flop when nobody has raised yet (the call would be a
     * limp, C10): the numbers line and the sheet show the win chance and the pot only (F.1).
     */
    price: boolean;
    /** The sheet's price bar (§12.6), facing a bet; null when the coach did not decide on it. */
    bar: PriceBar | null;
  };
}

/**
 * The price bar (§12.6): the comparison the coach made, as fractions, so its ✓/✗ never argues
 * against the advice. `plain`: the win chance the words compare (`shown.win`) against the price.
 * `realised`: a fold that number would pay, filled to `win × R`, what later bets leave of it.
 * `implied`: a call it would not pay, against the price with what a hit can win later.
 */
export interface PriceBar {
  win: number;
  need: number;
  /** `win ≥ need`: ✓; never next to a fold, and ✗ never next to a call or a raise. */
  good: boolean;
  basis: 'plain' | 'realised' | 'implied';
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

/**
 * The reasons that explain the final action (see the header): those that fit it, a guardrail
 * that fired first, at most two; the first is the main reason.
 */
function explaining(input: Pick<ExplainInput, 'action' | 'trace' | 'legal'>): Reason[] {
  const group = groupOf(input.action);
  const allIn = isAllIn(input.action, input.legal);
  const fitting = input.trace.filter((r) => usable(r) && fits(r, group, allIn));
  return [
    ...fitting.filter((r) => r.code === 'GUARDRAIL'),
    ...fitting.filter((r) => r.code !== 'GUARDRAIL'),
  ].slice(0, 2);
}

/** A hint's range number (Appendix F.1 "`{E}` and the range number") and whom it counts. */
export interface RangeNumber {
  /** The first range code's `data.E` among the reasons that explain the action, else `eRange`. */
  E: number;
  /**
   * Whom it counts when that is fewer players than the live opponents `eRandom` counts: the
   * callers already in besides the raiser (§8.3's E leaves out the players still to act). Null
   * when it counts every live opponent (heads-up, or the decision's own `eRange`).
   */
  callers: number | null;
}

function rangeOf(
  reasons: readonly Reason[],
  input: Pick<ExplainInput, 'eRange' | 'nOpp'>,
): RangeNumber {
  const reason = reasons.find((r) => RANGE_CODES.has(r.code) && num(r.data.E) !== null);
  if (reason === undefined) return { E: input.eRange, callers: null };
  const callers = num(reason.data.callers);
  return {
    E: num(reason.data.E) as number,
    callers: callers !== null && callers + 1 < input.nOpp ? callers : null,
  };
}

/**
 * The range number `explain` shows for this decision and whom it counts. The grade reads it too:
 * an F.5 price row names every player when the hint's range number counted only the raiser.
 */
export function rangeNumber(
  input: Pick<ExplainInput, 'action' | 'trace' | 'legal' | 'eRange' | 'nOpp'>,
): RangeNumber {
  return rangeOf(explaining(input), input);
}

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

/** Every code whose sentence compares `{E}` with `{need}`, and how. */
const COMPARE_DIRECTION: Partial<Record<ReasonCode, Direction>> = {
  ...PRICE_DIRECTION,
  CALL_PREFLOP: 'atLeast',
  CALL_ALLIN: 'atLeast',
  FOLD_ALLIN: 'less',
};

/**
 * "It is close" is said only when the two shown whole numbers are at most this far apart; further
 * apart, a sentence that compares the price would contradict its own numbers and is not used.
 */
export const CLOSE_POINTS = 2;

/** Later bets can still make the hero fold before the river (§8.5: R < 1). */
const laterBets = (input: ExplainInput): boolean =>
  input.street !== 'river' && (input.position === 'OOP' || input.nOpp > 1);

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

/**
 * The draw a reason names (`data.draw`), else the hero's strongest real draw (`mainDraw`: a
 * flush draw, then a straight draw, then two overcards), else none.
 */
function drawOf(r: Reason, input: ExplainInput): DrawKind | null {
  const named = r.data.draw;
  if (typeof named === 'string' && DRAW_KINDS.has(named)) return named as DrawKind;
  return mainDraw(input.draws);
}

/** Board cards by street, for the §6.6 outs chances. */
const BOARD_LENGTH: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5 };

/** One `{groups}` item: "9 for a flush", "6 for a pair (weak)". */
function groupLine(g: OutGroup): Line {
  return line(g.weak ? 'outs.groupWeak' : 'outs.group', {
    outs: count(g.outs),
    makes: nested(`makes.${g.makes as Exclude<HandCategory, 'highCard'>}`),
  });
}

/** SEMI_BLUFF's `{groups}` (§6.3): every group by what it makes, joined by " · ". */
function groupsParam(groups: readonly OutGroup[]): Param {
  let rest = groupLine(groups[groups.length - 1] as OutGroup);
  for (let i = groups.length - 2; i >= 0; i--) {
    rest = line('outs.list', {
      group: { kind: 'line', line: groupLine(groups[i] as OutGroup) },
      rest: { kind: 'line', line: rest },
    });
  }
  return { kind: 'line', line: rest };
}

/** Before the flop, nobody has raised yet: a call would be a limp, which is never advice (C10). */
const unopened = (input: Pick<ExplainInput, 'street' | 'facing'>): boolean =>
  input.street === 'preflop' && (input.facing === 'none' || input.facing === 'limpers');

/** Does the advice weigh the price of a call? Something to call, and not a limp (`unopened`). */
const priced = (input: Pick<ExplainInput, 'toCall' | 'street' | 'facing'>): boolean =>
  input.toCall > 0 && !unopened(input);

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

/**
 * The numbers line (§8.10 hint structure 3): always the HUD's `eRandom`. The price only when the
 * advice weighs it (`priced`): not with nothing to call, nor before the flop in an unopened or
 * limped pot, where the call would be a limp and the advice is a raise or a fold (F.1).
 */
function numbersLine(input: ExplainInput): Line {
  const eRandom = pct(input.eRandom);
  if (!priced(input)) return line('numbers.free', { eRandom, pot: chips(input.pot) });
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

/**
 * Can the reason's sentence be said with the numbers it shows? A price sentence whose whole
 * numbers point the wrong way is said only as its `.close` variant (at most `CLOSE_POINTS`
 * apart), `.realise` (a fold at or above the price, with later bets to come) or `.implied` (a
 * pocket pair's implied odds); otherwise it is not used (e.g. a raise that became an all-in call
 * because no raise was legal, explained with a price it does not beat).
 */
function honest(r: Reason, c: Context): boolean {
  const direction = COMPARE_DIRECTION[r.code];
  if (direction === undefined) return true;
  const E = eOf(r, c);
  const need = c.input.need;
  if (holds(direction, E, need)) return true;
  if (Math.abs(shownPct(E) - shownPct(need)) <= CLOSE_POINTS) return true;
  if (r.code === 'FOLD_PRICE') return laterBets(c.input) && shownPct(E) >= shownPct(need);
  return r.code === 'CALL_PREFLOP' && (num(r.data.implied) ?? 0) > 0;
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
      // Heads-up nobody else is left to keep out: "Players only called … fewer players" was
      // false (QA-2 of 6 Nov 2026, item 7). The hand is the reason (§8.3: the isolation range).
      return input.nOpp === 1
        ? line('ISOLATE.headsUp', { hand: name(input.preflopName), size: size() })
        : line('ISOLATE', { size: size() });
    case 'VALUE_RAISE':
    case 'CBET_DRY':
      return line(r.code, { size: size() });
    case 'THREE_BET_VALUE':
      return line('THREE_BET_VALUE', { hand: name(input.preflopName), E: pE, size: size() });
    case 'FOUR_BET_VALUE':
      return line('FOUR_BET_VALUE', { hand: name(input.preflopName), size: size() });
    case 'FOLD_VS_RAISE': {
      // "wins only about E%" only below the price (F.1); else the reason that is true: the
      // policy's EV(call) counts later bets (R < 1) and still says fold, or EV(call) > 0 and
      // the hand is outside the range that calls this raise (§8.3 step 6).
      const hand = name(input.preflopName);
      if (holds('less', E, need)) return line('FOLD_VS_RAISE', { hand, E: pE });
      const evCall = num(r.data.evCall);
      if (evCall !== null && evCall > 0) {
        return line('FOLD_VS_RAISE.range', {
          hand,
          rankPct: { kind: 'top', value: input.rankPct },
        });
      }
      return line('FOLD_VS_RAISE.realise', { need: pNeed, hand, E: pE });
    }
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
      const variant = holds('less', E, need)
        ? 'FOLD_PRICE'
        : laterBets(input)
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
      // The strongest real draw names the hand (F.1 `{draw}`); with outs of more than one kind
      // each group says what it makes (§6.3), so "Flush draw: 19 outs" is never said.
      const hit = outsChances(input.outs, BOARD_LENGTH[input.street]);
      const draw: Param = { kind: 'draw', draw: drawOf(r, input) };
      const hitNext = points(hit.nextCardPct ?? 0);
      const turn = input.street === 'turn';
      const hitRiver = turn ? {} : { hitRiver: points(hit.byRiverPct ?? 0) };
      if (input.outGroups.length > 1) {
        const groups = groupsParam(input.outGroups);
        return line(turn ? 'SEMI_BLUFF.turnGroups' : 'SEMI_BLUFF.groups', {
          draw,
          groups,
          hitNext,
          ...hitRiver,
        });
      }
      return line(turn ? 'SEMI_BLUFF.turn' : 'SEMI_BLUFF', {
        draw,
        outs: count(input.outs),
        hitNext,
        ...hitRiver,
      });
    }
    case 'CHECK_WEAK': {
      // A Draw that checks (§8.5 step 5) says which draw it waits for.
      const named = r.data.draw;
      return typeof named === 'string' && REAL_DRAWS.has(named as DrawKind)
        ? line('CHECK_WEAK.draw', { draw: { kind: 'draw', draw: named as DrawKind } })
        : line('CHECK_WEAK');
    }
    case 'RAISE_PROTECT':
      // On the river there are no draws left to make pay: the raise is for value (§8.10).
      return line(input.street === 'river' ? 'RAISE_PROTECT.river' : 'RAISE_PROTECT');
    case 'PUSH_FOLD':
      return line(pushFoldKey(r, input), {
        S: count(num(r.data.S) as number),
        Pfold: pct(num(r.data.Pfold) as number),
        E: pE,
      });
    case 'GUARDRAIL':
      return line('GUARDRAIL', { detail: nested(`detail.${r.data.detail as GuardDetail}`) });
    case 'CHECK_FREE':
    case 'SET_MINING':
    case 'NUTS':
    case 'BOARD_PLAYS':
      return line(r.code);
    default:
      return line('FALLBACK');
  }
}

/**
 * PUSH_FOLD's sentence: `{S}` is the effective stack (§8.4), the hero's own ("Only 5 big blinds
 * left") unless an opponent is the short one (`data.short` 'them', §8.4 notes): then whose it is,
 * "They have only 5 big blinds" heads-up, "No one else has more than 5 big blinds" against more
 * (QA-2 of 6 Nov 2026, item 2: "Only 5 big blinds left" beside the hero's 35 bb).
 */
function pushFoldKey(r: Reason, input: Pick<ExplainInput, 'nOpp'>): TemplateKey {
  const fold = r.data.action === 'fold';
  if (r.data.short !== 'them') return fold ? 'PUSH_FOLD.fold' : 'PUSH_FOLD';
  if (input.nOpp === 1) return fold ? 'PUSH_FOLD.themFold' : 'PUSH_FOLD.them';
  return fold ? 'PUSH_FOLD.othersFold' : 'PUSH_FOLD.others';
}

/** RANGE_ADJUST and its wording (see the header); `callers` as `RangeNumber`'s. */
function rangeAdjustLine(input: ExplainInput, rangeE: number, callers: number | null): Line {
  const params = { eRandom: pct(input.eRandom), eRange: pct(rangeE) };
  if (callers !== null) {
    // The two numbers count different players: each says whom (§8.10).
    const n = count(input.nOpp);
    if (callers === 0 && input.nOpp === 2) return line('RANGE_ADJUST.both', params);
    return callers === 0
      ? line('RANGE_ADJUST.raiser', { ...params, n })
      : line('RANGE_ADJUST.callers', { ...params, n, callers: count(callers) });
  }
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

/** The price with what a hit can win later (F.1 `{needImplied}`); null without implied odds. */
function impliedPrice(r: Reason, input: ExplainInput): number | null {
  const needImplied = num(r.data.needImplied);
  if (needImplied !== null) return needImplied;
  const implied = num(r.data.implied);
  if (implied === null || implied <= 0) return null;
  return input.toCall / (input.winPot + input.toCall + implied);
}

/**
 * The price bar (§12.6), facing a bet. `win` (the words' win chance) against the price when that
 * agrees with the action (at or above it for a call or a raise, below it for a fold). Else as the
 * main reason compared (§8.3, §8.5: `E·R·(winPot + toCall) − toCall + implied`): a fold that the
 * price alone would pay, filled to the reason's own `{E}` × R when later bets make it lose
 * (`data.R`: FOLD_PRICE, FOLD_VS_RAISE); a call that it would not pay, against the implied price
 * when a hit pays for it (IMPLIED's `needImplied`, a pocket pair's `data.implied`). Neither: the
 * coach decided on something else (its ranges, push or fold, commitment, a guardrail): no bar.
 */
function priceBar(c: Context, main: Reason | null, win: number): PriceBar | null {
  const { input } = c;
  if (!priced(input)) return null;
  const fold = input.action.type === 'fold';
  const { need } = input;
  const good = win >= need;
  if (good !== fold) return { win, need, good, basis: 'plain' };
  if (main === null) return null;
  if (fold) {
    const R = num(main.data.R);
    const realised = R === null ? null : eOf(main, c) * R;
    return realised !== null && realised < need
      ? { win: realised, need, good: false, basis: 'realised' }
      : null;
  }
  if (input.action.type !== 'call') return null;
  const implied = impliedPrice(main, input);
  return implied !== null && win >= implied
    ? { win, need: implied, good: true, basis: 'implied' }
    : null;
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

/** A range code's line that shows its `{E}` (FOLD_VS_RAISE.range shows none). */
const showsRangeE = (l: Line): boolean =>
  RANGE_CODES.has(l.key.split('.')[0] as ReasonCode) && l.params.E !== undefined;

/** Codes that bet or raise without value: "worse hands would get a free card" is not the reason. */
const NOT_FOR_VALUE: ReadonlySet<ReasonCode> = new Set<ReasonCode>(['SEMI_BLUFF', 'CBET_DRY']);

/**
 * The explanation of a decision (see the header). Deterministic and cheap: no Monte Carlo, only
 * the numbers in `input`.
 */
export function explain(input: ExplainInput): Explanation {
  const group = groupOf(input.action);

  // 1. The reasons that explain the final action; a guardrail that fired first.
  const ordered = explaining(input);
  const main = ordered[0] ?? null;

  // 2. The hint's range number (and whom it counts), RANGE_ADJUST and the `{E}` of the others.
  const range = rangeOf(ordered, input);
  const rangeE = range.E;
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

  // 3. The lines: a reason only when its sentence agrees with the numbers it shows.
  const said = ordered.filter((r) => honest(r, c));
  const trace: Reason[] = [];
  const reasons: Line[] = [];
  if (adjust) {
    const ra = rangeAdjustLine(input, rangeE, range.callers);
    reasons.push(ra);
    trace.push({
      code: 'RANGE_ADJUST',
      data: {
        eRandom: input.eRandom,
        eRange: rangeE,
        ...(ra.key === 'RANGE_ADJUST' && input.villain !== null ? { action: input.villain } : {}),
        ...(range.callers === null ? {} : { players: input.nOpp, callers: range.callers }),
      },
    });
  }
  if (said.length === 0) reasons.push(line('FALLBACK'));
  for (const r of said) {
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
  const noCall = unopened(input) || main?.code === 'PUSH_FOLD';
  for (const g of GROUPS) {
    if (g === group || g === closeGroup || !can[g]) continue;
    let reason: Reason | null = null;
    let text: Line | null = null;
    // "You win more often than you need to": only against a price the advice weighs.
    if (g === 'fold' && priced(input) && holds('more', win, input.need)) {
      reason = { code: 'WHY_NOT_FOLD', data: {} };
      text = line('WHY_NOT_FOLD');
    } else if (g === 'check' && valueBet) {
      // On the river there is no free card to give: worse hands would call the bet (§8.10).
      reason = { code: 'WHY_NOT_CHECK', data: {} };
      text = line(input.street === 'river' ? 'WHY_NOT_CHECK.river' : 'WHY_NOT_CHECK');
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
    // `{outs}`: the exact chance is for every out (§6.3), so the line says how many those are.
    const exact = outsChances(input.outs, BOARD_LENGTH[input.street]).byRiverPct ?? 0;
    trick.push(line('RULE_2_4', { outs: count(input.outs), exact: points(exact) }));
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
      players: input.nOpp,
      // Whom the range number counts, when the words show it: in RANGE_ADJUST, or in a range
      // code's sentence ("wins only about 44% against it", `eOf`), next to `eRandom`.
      callers: adjust || reasons.some(showsRangeE) ? range.callers : null,
      price: priced(input),
      bar: priceBar(c, main, win),
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
  | {
      row: 'foldedPrice' | 'calledPrice';
      /** The hint's range number (the grade compares it, §8.9) and the price. */
      E: number;
      need: number;
      rangeAdjust: boolean;
      /**
       * Whom `E` counts, said with `rangeAdjust` when it is only the raiser and `callers` callers
       * already in (§8.10, the hint's own words): "against the raiser's likely hands alone".
       * Null: every live opponent, "against their likely hands".
       */
      callers: number | null;
    }
  | { row: 'calledValue' | 'checkedStrong' | 'airHeadsUp' }
  | { row: 'airMultiway'; players: number }
  | { row: 'size'; tooBig: boolean; to: number; bb: number }
  | { row: 'openLoose'; hand: string }
  | { row: 'foldedStrong'; hand: string; rankPct: number }
  | {
      row: 'pushFold';
      S: number;
      hand: string;
      move: 'allin' | 'fold';
      /**
       * Whose stack `S` is (§8.4's effective stack): the hero's ('own', the default), the only
       * opponent's ('them') or every opponent's at most ('others') (QA-2 item 2).
       */
      stack?: 'own' | 'them' | 'others';
    }
  | { row: 'fallback'; alt: PlayerAction; legal: LegalActions; toCall: number; bb: number };

/**
 * The line of one F.5 feedback row. With RANGE_ADJUST's condition (§8.10) a price row says
 * "against their likely hands" (`*Range`), so it never contradicts the HUD badge; and "against
 * the raiser's likely hands alone" (`*Raiser`, `{who}`) when the hint's range number counted only
 * the raiser and its callers, the hint's own words (1.3.90: the grade compares the hint's number,
 * QA-2 item 3; before, "against the likely hands of all {n} players" with the decision's eRange).
 */
export function feedbackLine(f: FeedbackInput): Line {
  switch (f.row) {
    case 'foldedPrice':
    case 'calledPrice': {
      const numbers = { E: pct(f.E), need: pct(f.need) };
      if (!f.rangeAdjust) return line(`feedback.${f.row}`, numbers);
      if (f.callers === null) return line(`feedback.${f.row}Range`, numbers);
      const who =
        f.callers === 0
          ? nested('who.raiser')
          : nested('who.callers', { callers: count(f.callers) });
      return line(`feedback.${f.row}Raiser`, { ...numbers, who });
    }
    case 'calledValue':
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
        stack: nested(`stack.${f.stack ?? 'own'}`, { S: count(f.S) }),
        hand: name(f.hand),
      });
    case 'fallback':
      return line('feedback.fallback', {
        alt: { kind: 'line', line: actionLine('alt', f.alt, f) },
      });
  }
}
