/**
 * Grading (PLAN §8.9 "Grade", §8.10, §11.3–11.4, Appendix A.5, F.4–F.5; chunk 6.1): how good the
 * hero's move was, measured against the coach's own recommendation, so the coach never
 * contradicts itself (Known pitfall 34). Following the hint is always Best (C8).
 *
 * `coachAnswer(obs, eRandom)` is one coach computation of a decision (`deliberate` with `COACH`,
 * seeded from the observation): the hint (what the `hint` job posts) and `grade(taken, …)` from the
 * same numbers. `brain.worker` keeps it by observation (§8.11, LRU of 32), so grading after the
 * action reads the hint's EVs and computes only the EV of a size that is not one of its
 * candidates (800 `E_called` trials, §8.9 "the hero's own size"). The recommendation, its EVs and
 * the alternative do not depend on `eRandom` (it is shown, never compared): a grade reuses the
 * hint whatever HUD number either job brought; only the F.5 wording reads it.
 *
 * The grade (§8.9), in this order:
 * 1. A fold when checking is free is a Blunder (the engine refuses it; the rule is kept).
 * 2. The recommendation itself, matched by `sameMove` (the same action type; a bet or raise with
 *    a "to" amount within ±15% of the recommended one) → Best (C8). In a Close spot the hint's
 *    close alternative ("Close call: {alt} is also fine") is matched the same way → Best too.
 * 3. `loss = max(0, EV(rec) − EV(taken))` in chips (§8.9's model, `E = eRange`, the hint's own
 *    numbers); `lossPot = loss / pot` (the pot before the action); `lossBB = loss / bb`.
 * 4. Any other move that the model rates above the recommendation → exactly Good: the coach never
 *    calls a move it did not recommend Best, and never grades it worse than Good.
 * 5. Otherwise the table: Best ≤ 1% of the pot, Good ≤ 5%, Inaccuracy ≤ 15%, Mistake ≤ 40%, else
 *    Blunder; then the price signal may raise it (a call with `E·R < need − 0.15` at least a
 *    Mistake, `< need − 0.30` a Blunder; a fold with `E·R > need + 0.15` at least a Mistake,
 *    `> need + 0.30` a Blunder; `R` is the call's realisation as the EV model has it, 1 when the
 *    call ends the betting); then the bb floors cap it (below 0.25 bb at most Good, below 1 bb at
 *    most Inaccuracy; a Blunder from any path needs 5 bb, else Mistake). Pot-relative bands with
 *    bb floors: the same chips are a big mistake in a small pot and nothing in a big one.
 *
 * Then the leak tag (`leakOf`: the §8.9 table, first matching row, only for Inaccuracy or worse)
 * and the feedback card's reason (`feedbackRow`: Appendix F.5 in its order; null for Best and
 * Good, which have no card, and for the fallback row, which the card says itself with the coach's
 * move in the player's unit, chunk 6.2). `GradeResult.trace` is the recommendation's reasons (the
 * policy's and the guardrails' part of the hint's trace), so a review can say why the coach's move.
 *
 * Pure and deterministic: the same observation, action and HUD number give the same result, from
 * the cache or not (a null HUD number reads the hint's, which is the HUD's own function, C9).
 */
import type { LegalActions, Observation, PlayerAction, Street } from '../engine/types.ts';
import { describe } from '../eval/describe.ts';
import { deliberate, type CoachHint, type Deliberation } from './decide.ts';
import { callEndsBetting } from './ev.ts';
import {
  explain,
  explainInput,
  feedbackLine,
  shownPct,
  type FeedbackInput,
  type Line,
} from './explain.ts';
import { coachSeed, showsRangeAdjust } from './features.ts';
import { COACH } from './profiles.ts';
import { pushFoldStack } from './pushFoldData.ts';
import { pushFoldApplies } from './pushfold.ts';
import {
  FEEDBACK_STRONG_PCT,
  GRADE_BEST_POT,
  GRADE_BLUNDER_MIN_BB,
  GRADE_GOOD_MAX_BB,
  GRADE_GOOD_POT,
  GRADE_INACCURACY_MAX_BB,
  GRADE_INACCURACY_POT,
  GRADE_MISTAKE_POT,
  PRICE_SIGNAL_BLUNDER,
  PRICE_SIGNAL_MISTAKE,
  SAME_SIZE_SHARE,
} from './tunables.ts';
import type { Bucket, Facing, Grade, GradeResult, LeakId, Reason, ReasonCode } from './types.ts';

/**
 * Floating-point slack at the §8.9 boundaries: "≤" holds at the boundary and "<" does not, also
 * when a product lands one unit in the last place away from it (as the guardrails, §8.8).
 */
const EPS = 1e-9;

// ── Grades ─────────────────────────────────────────────────────────────────────────────────────

/** The five grades from best to worst (§8.9; F.4 chips "Best move" … "Big mistake"). */
export const GRADES: readonly Grade[] = ['best', 'good', 'inaccuracy', 'mistake', 'blunder'];

/** 0 for Best … 4 for Blunder. */
export function severity(grade: Grade): number {
  return GRADES.indexOf(grade);
}

/** The more severe of two grades. */
export function worseOf(a: Grade, b: Grade): Grade {
  return severity(a) >= severity(b) ? a : b;
}

/** The milder of two grades. */
export function milderOf(a: Grade, b: Grade): Grade {
  return severity(a) <= severity(b) ? a : b;
}

/** Inaccuracy or worse: a decision with a feedback reason and maybe a leak tag. */
export const isMistake = (grade: Grade): boolean => severity(grade) >= severity('inaccuracy');

const isAggressive = (type: PlayerAction['type']): boolean => type === 'bet' || type === 'raise';

/**
 * §8.9: `taken` is the move `target`: the same action type, and for a bet or raise a "to" amount
 * within ±15% of the target's.
 */
export function sameMove(taken: PlayerAction, target: PlayerAction): boolean {
  if (taken.type !== target.type) return false;
  if (taken.type === 'bet' || taken.type === 'raise') {
    const to = (target as { to: number }).to;
    return Math.abs(taken.to - to) <= SAME_SIZE_SHARE * to + EPS;
  }
  return true;
}

/** The §8.9 table's grade of a loss of `lossPot` pots (before the price signal and the floors). */
export function gradeOfLoss(lossPot: number): Grade {
  if (lossPot <= GRADE_BEST_POT + EPS) return 'best';
  if (lossPot <= GRADE_GOOD_POT + EPS) return 'good';
  if (lossPot <= GRADE_INACCURACY_POT + EPS) return 'inaccuracy';
  if (lossPot <= GRADE_MISTAKE_POT + EPS) return 'mistake';
  return 'blunder';
}

/**
 * The §8.9 price signal: the least severe grade a call or a fold deserves from its price alone
 * (`ER` = `E·R`, the chance the hero realises), or null when the price says nothing.
 */
export function priceSignal(type: PlayerAction['type'], ER: number, need: number): Grade | null {
  if (type === 'call') {
    if (ER < need - PRICE_SIGNAL_BLUNDER - EPS) return 'blunder';
    if (ER < need - PRICE_SIGNAL_MISTAKE - EPS) return 'mistake';
  } else if (type === 'fold') {
    if (ER > need + PRICE_SIGNAL_BLUNDER + EPS) return 'blunder';
    if (ER > need + PRICE_SIGNAL_MISTAKE + EPS) return 'mistake';
  }
  return null;
}

/**
 * The §8.9 bb floors, last: below 0.25 bb at most Good, below 1 bb at most Inaccuracy, and a
 * Blunder (from any path, the price signal included) needs 5 bb, else it is a Mistake.
 */
export function capByBB(grade: Grade, lossBB: number): Grade {
  let capped = grade;
  if (lossBB < GRADE_GOOD_MAX_BB - EPS) capped = milderOf(capped, 'good');
  else if (lossBB < GRADE_INACCURACY_MAX_BB - EPS) capped = milderOf(capped, 'inaccuracy');
  if (capped === 'blunder' && lossBB < GRADE_BLUNDER_MIN_BB - EPS) capped = 'mistake';
  return capped;
}

/** Everything the §8.9 grade reads, as plain numbers (no Monte Carlo). */
export interface GradeFacts {
  legal: LegalActions;
  /** The recommendation and its EV (chips, relative to folding). */
  rec: PlayerAction;
  recEV: number;
  /** The hint's close alternative in a Close spot, else null. */
  alt: PlayerAction | null;
  /** The hero's move and its EV. */
  taken: PlayerAction;
  takenEV: number;
  /** The pot before the action and the big blind, in chips. */
  pot: number;
  bb: number;
  /** `eRange`, the realisation of a call (1 when it ends the betting) and the price (§8.2). */
  E: number;
  R: number;
  need: number;
}

/** The grade of one move and the loss behind it. */
export interface Scored {
  grade: Grade;
  /** `max(0, EV(rec) − EV(taken))`, chips. */
  loss: number;
  lossPot: number;
  lossBB: number;
}

/** The §8.9 grade of `taken` (see the header for the order of the rules). */
export function scoreGrade(x: GradeFacts): Scored {
  const freeFold = x.taken.type === 'fold' && x.legal.canCheck;
  const takenEV = freeFold ? 0 : x.takenEV;
  const loss = Math.max(0, x.recEV - takenEV);
  const lossPot = loss / x.pot;
  const lossBB = loss / x.bb;
  const scored = (grade: Grade): Scored => ({ grade, loss, lossPot, lossBB });
  if (freeFold) return scored('blunder');
  if (sameMove(x.taken, x.rec)) return scored('best');
  if (x.alt !== null && sameMove(x.taken, x.alt)) return scored('best');
  if (takenEV > x.recEV + EPS) return scored('good');
  let grade = gradeOfLoss(lossPot);
  const signal = priceSignal(x.taken.type, x.E * x.R, x.need);
  if (signal !== null) grade = worseOf(grade, signal);
  return scored(capByBB(grade, lossBB));
}

// ── Leak tags (§8.9) ───────────────────────────────────────────────────────────────────────────

/** What the leak tags read. */
export interface LeakFacts {
  street: Street;
  facing: Facing;
  /** The §8.2 bucket (null before the flop). */
  bucket: Bucket | null;
  /** §8.4 applies: before the flop with `effBB ≤ 12` (`pushFoldApplies`). */
  pushFold: boolean;
  taken: PlayerAction;
  rec: PlayerAction;
  grade: Grade;
}

/** Before the flop, nobody has raised yet (limpers or not). */
const unopened = (street: Street, facing: Facing): boolean =>
  street === 'preflop' && (facing === 'none' || facing === 'limpers');

/**
 * The leak tag of a graded decision (§8.9 table, first matching row), only for Inaccuracy or
 * worse (a leak is a mistake pattern; Best and Good have none). "Preflop facing a raise" is any
 * raise, all-in or not; "postflop facing a bet" is a bet, a raise or an all-in to call. The push/
 * fold row (`effBB ≤ 12`) is §8.4's spot, before the flop: after it there is no push/fold rule.
 */
export function leakOf(x: LeakFacts): LeakId | null {
  if (!isMistake(x.grade)) return null;
  const t = x.taken.type;
  const r = x.rec.type;
  if (x.street === 'preflop') {
    const open = unopened(x.street, x.facing);
    if (open && t === 'raise' && r === 'fold') return 'open-loose';
    if (open && t === 'fold' && r === 'raise') return 'open-tight';
    if (open && t === 'call' && r !== 'call') return 'limp';
    if (!open && t === 'call' && r === 'fold') return 'call-pre-wide';
    if (!open && t === 'fold' && r !== 'fold') return 'fold-pre-much';
    if (x.pushFold) return 'pushfold';
  } else {
    const strong = x.bucket === 'strong' || x.bucket === 'monster';
    const facingBet = x.facing === 'bet' || x.facing === 'raise' || x.facing === 'allin';
    if ((t === 'check' || t === 'call') && isAggressive(r) && strong) return 'missed-value';
    if (isAggressive(t) && x.bucket === 'air' && (r === 'check' || r === 'fold')) {
      return 'bluff-much';
    }
    if (facingBet && t === 'fold' && (r === 'call' || r === 'raise')) return 'overfold';
    if (facingBet && t === 'call' && r === 'fold') {
      if (x.bucket === 'draw') return 'chase';
      return x.street === 'river' ? 'river-call' : 'call-light';
    }
  }
  return t === r ? 'sizing' : null;
}

// ── The feedback card's reason (Appendix F.5) ──────────────────────────────────────────────────

/** What the F.5 rows read. */
export interface FeedbackFacts {
  legal: LegalActions;
  street: Street;
  facing: Facing;
  bucket: Bucket | null;
  /** Live opponents. */
  nOpp: number;
  /** §8.4 applies, and its `S` (`clamp(round(effBB), 1, 15)`). */
  pushFold: boolean;
  S: number;
  /** The hole cards' starting-hand percentile (§8.3) and preflop name (F.2, "Ace-King suited"). */
  rankPct: number;
  hand: string;
  bb: number;
  /** The chips a call puts in (the fallback's "Call {amount}"). */
  toCall: number;
  taken: PlayerAction;
  rec: PlayerAction;
  /** `eRange`, the call's realisation and the price, as the grade read them. */
  E: number;
  R: number;
  need: number;
  /** §8.10's RANGE_ADJUST condition with the HUD's number: the price rows add "against their likely hands". */
  rangeAdjust: boolean;
}

/** An all-in move: a bet or raise to the legal maximum, or a call that puts the hero all-in. */
function allInMove(action: PlayerAction, legal: LegalActions): boolean {
  if (action.type === 'call') return legal.callIsAllIn;
  if (action.type === 'bet' || action.type === 'raise')
    return action.to === legal[action.type]?.max;
  return false;
}

/**
 * The F.5 row of a decision graded Inaccuracy or worse. Rows in F.5's order: the push/fold
 * deviation (§8.4 spots, when the coach's move is an all-in or a fold: the two the row can say),
 * the two preflop rows, the size, then the rest top to bottom; the first that fits wins. Each
 * row's sentence must be true:
 * - "Opened too loose": the hero raised or limped into an unopened pot that the coach folds.
 * - "Folded a strong preflop hand": the coach plays the hand and it is in the top half of
 *   starting hands ("strong enough to play"); a big blind's price defence goes to the price row.
 * - The price rows compare the numbers they show: a fold when `E·R` beats the price in whole
 *   percentages (so `{E}` does too), a call when `{E}` itself is below it (so `E·R` is too); a
 *   fold before anyone raised has no price row (the coach never just calls there, C10).
 *   `{E}` is `eRange` and `{need}` the capped price, as the grade read them.
 * - "Bet/raised with Air heads-up" ends "Checking was cheaper": only when checking was possible.
 * - The fallback, "The coach's move wins more chips here: {alt}", otherwise.
 */
export function feedbackRow(x: FeedbackFacts): FeedbackInput {
  const { taken, rec } = x;
  const t = taken.type;
  const preflop = x.street === 'preflop';
  const open = unopened(x.street, x.facing);
  if (x.pushFold) {
    const move = allInMove(rec, x.legal) ? 'allin' : rec.type === 'fold' ? 'fold' : null;
    if (move !== null) return { row: 'pushFold', S: x.S, hand: x.hand, move };
  }
  if (open && (t === 'raise' || t === 'call') && rec.type === 'fold') {
    return { row: 'openLoose', hand: x.hand };
  }
  if (preflop && t === 'fold' && rec.type !== 'fold' && x.rankPct <= FEEDBACK_STRONG_PCT) {
    return { row: 'foldedStrong', hand: x.hand, rankPct: x.rankPct };
  }
  if (
    (taken.type === 'bet' || taken.type === 'raise') &&
    (rec.type === 'bet' || rec.type === 'raise') &&
    rec.type === taken.type
  ) {
    return { row: 'size', tooBig: taken.to > rec.to, to: rec.to, bb: x.bb };
  }
  if (t === 'fold' && !open && shownPct(x.E * x.R) > shownPct(x.need)) {
    return { row: 'foldedPrice', E: x.E, need: x.need, rangeAdjust: x.rangeAdjust };
  }
  if (t === 'call' && shownPct(x.E) < shownPct(x.need)) {
    return { row: 'calledPrice', E: x.E, need: x.need, rangeAdjust: x.rangeAdjust };
  }
  if (t === 'check' && (x.bucket === 'strong' || x.bucket === 'monster')) {
    return { row: 'checkedStrong' };
  }
  if (isAggressive(t) && x.bucket === 'air') {
    if (x.nOpp > 1) return { row: 'airMultiway', players: x.nOpp };
    if (x.legal.canCheck) return { row: 'airHeadsUp' };
  }
  return { row: 'fallback', alt: rec, legal: x.legal, toCall: x.toCall, bb: x.bb };
}

// ── The grade of a decision ────────────────────────────────────────────────────────────────────

/**
 * The grade of the hero's `taken` against the coach's deliberation `d` of `obs` (§8.9): the hint's
 * own EVs (`d.model`), the leak tag and the F.5 reason. `eRandom` is the HUD's number the grade
 * job brought (null: the hint's), read only for the F.5 wording.
 */
export function gradeDecision(
  obs: Observation,
  d: Deliberation,
  taken: PlayerAction,
  decisionId: number,
  eRandom: number | null = null,
): GradeResult {
  const { decision, f, model } = d;
  const { legal } = obs;
  const rec = decision.action;
  const freeFold = taken.type === 'fold' && legal.canCheck;
  const R = callEndsBetting(obs, f.ranges) ? 1 : d.R;
  const scored = scoreGrade({
    legal,
    rec,
    recEV: model.ev(rec),
    alt: decision.confidence === 'close' ? decision.alt : null,
    taken,
    // A fold is worth 0; any other move's EV comes from the hint's model (once per action).
    takenEV: freeFold ? 0 : model.ev(taken),
    pot: f.pot,
    bb: obs.bb,
    E: f.eRange,
    R,
    need: f.need,
  });
  const pushFold = pushFoldApplies(f);
  const leak = leakOf({
    street: f.street,
    facing: f.facing,
    bucket: f.bucket,
    pushFold,
    taken,
    rec,
    grade: scored.grade,
  });
  let feedback: Line | null = null;
  if (isMistake(scored.grade)) {
    const row = feedbackRow({
      legal,
      street: f.street,
      facing: f.facing,
      bucket: f.bucket,
      nOpp: f.nOpp,
      pushFold,
      S: pushFoldStack(f.effBB),
      rankPct: f.rankPct,
      hand: describe(obs.hole, []).name,
      bb: obs.bb,
      toCall: f.toCall,
      taken,
      rec,
      E: f.eRange,
      R,
      need: f.need,
      rangeAdjust: showsRangeAdjust(eRandom ?? decision.eRandom, f.eRange, f.need),
    });
    if (row.row !== 'fallback') feedback = feedbackLine(row);
  }
  return {
    decisionId,
    grade: scored.grade,
    rec,
    taken,
    lossChips: scored.loss,
    lossPot: scored.lossPot,
    lossMilliBB: Math.round((1000 * scored.loss) / obs.bb),
    leak,
    trace: recommendationTrace(decision.trace),
    feedback,
  };
}

/** The hint's own lines (§8.10 hint structure 3–5): they show the HUD number, so a grade leaves them out. */
const HINT_LINES: ReadonlySet<ReasonCode> = new Set<ReasonCode>([
  'RANGE_ADJUST',
  'CLOSE_SPOT',
  'WHY_NOT_FOLD',
  'WHY_NOT_CHECK',
  'WHY_NOT_CALL',
  'WHY_NOT_BET',
  'WHY_NOT_RAISE',
  'RULE_2_4',
  'RULE_2_4_BIG',
]);

/**
 * The recommendation's reasons: the policy's and the guardrails' part of the hint's trace (main
 * reason first). Nothing in it depends on the HUD number, so the grade is the same whichever
 * cached hint of the observation it reads.
 */
export function recommendationTrace(trace: readonly Reason[]): Reason[] {
  return trace.filter((r) => !HINT_LINES.has(r.code));
}

// ── The coach's answer: hint and grade from one computation (§8.11) ─────────────────────────────

/** One coach computation of an observation: what `brain.worker` caches (§8.11). */
export interface CoachAnswer {
  /** The hint job's answer: `hint(obs, eRandom)` and `explain()` of it (chunk 5.7). */
  hint: CoachHint;
  /**
   * Appendix A.5 `grade` of `taken` against this hint: costs only the EV of an action that is not
   * a candidate yet. `eRandom` is the grade job's HUD number (null or left out: the hint's).
   */
  grade(taken: PlayerAction, decisionId: number, eRandom?: number | null): GradeResult;
}

/** The coach's hint of `obs` and the grade of any move from it, from one deliberation. */
export function coachAnswer(obs: Observation, eRandom: number | null): CoachAnswer {
  const d = deliberate(obs, COACH, coachSeed(obs), eRandom);
  return {
    hint: { decision: d.decision, explanation: explain(explainInput(obs, d.f, d.decision)) },
    grade: (taken, decisionId, hud = null) => gradeDecision(obs, d, taken, decisionId, hud),
  };
}

/**
 * Appendix A.5 `grade(obs, taken, eRandom, decisionId)`: the hero's move at the observation `obs`
 * graded against `hint(obs, eRandom)`. `brain.worker` grades through its cached `coachAnswer`.
 */
export function grade(
  obs: Observation,
  taken: PlayerAction,
  eRandom: number | null,
  decisionId: number,
): GradeResult {
  return coachAnswer(obs, eRandom).grade(taken, decisionId, eRandom);
}

/**
 * What a grade needs: the A.6 `grade` request and chunk 6.2's `GradeAsk` both have these fields,
 * so `gradeOf` grades either as it is (e.g. a scripted brain's `grade(req)` in place of a stub).
 */
export interface GradeInput {
  obs: Observation;
  taken: PlayerAction;
  eRandom: number | null;
  decisionId: number;
}

/** `grade` of a request object (`GradeInput`). */
export function gradeOf(input: GradeInput): GradeResult {
  return grade(input.obs, input.taken, input.eRandom, input.decisionId);
}
