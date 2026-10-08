/**
 * Guardrails (PLAN §8.8): the last word on every decision, for every profile, the coach included.
 * They exist because rule-based advisors fail loudly on obvious spots (§1.7: an advisor told a
 * player to fold K-Q on the river getting 6.77-to-1).
 *
 * 1. Never fold when checking is free (`checkFree`).
 * 2. Never fold with `p ≥ 0.95` (`tooStrongToFold`).
 * 3. Never call a river bet with `eRange < 0.03` (`riverNoChance`).
 * 4. Facing an all-in: always call when `eRange ≥ need + 0.15` (`allInPriceGood`); never call
 *    when `eRange < need − 0.25` (`allInPriceBad`), whatever the noise.
 * 5. Illegal or sub-minimum amounts are snapped to legal ones (`legalAmount`).
 *
 * Each rule is its own object, so a test can run a spot without it and show that the spot then
 * goes wrong (§18 Stage 5 criterion 3). `guardrails()` applies a rule list, `GUARDRAILS` by
 * default, in this order: rule 5 first, so every other rule reads a legal action, then rules 1–4
 * in their §8.8 order. Rules 1–4 only turn a fold into a check or a call, or a call into a fold,
 * and only when the new action is legal, so the result stays legal and applying the list twice
 * changes nothing. (Snapping last would let a raise that cannot be made, and so becomes a call,
 * slip past rules 3 and 4.) A bet or raise is never touched by rules 1–4: they guard folds and
 * calls, as §8.8 words them.
 *
 * The rules read the true `p`, `eRange` and `need` of the features. A bot's equity noise (§9.4)
 * moves its pick, never these limits ("whatever the noise").
 *
 * Types only from engine/types (§2.1): the brain never runs engine code, so `isLegalAction`
 * mirrors the engine's own check of an action (`engine/step.ts`) and a test keeps the two equal.
 */
import type { LegalActions, Observation, PlayerAction } from '../engine/types.ts';
import {
  GUARD_ALLIN_CALL_MARGIN,
  GUARD_ALLIN_FOLD_MARGIN,
  GUARD_NEVER_FOLD_P,
  GUARD_RIVER_MIN_EQUITY,
} from './tunables.ts';
import type { Features, GuardrailId, GuardrailResult, Reason } from './types.ts';

/** Everything the guardrails read about one decision. */
export interface GuardSpot {
  /** The decision's true (un-noised) features. */
  f: Pick<Features, 'street' | 'facing' | 'need' | 'eRange' | 'p'>;
  legal: LegalActions;
  /** The small blind: an amount that must be snapped becomes a multiple of it (§0.3, §8.7). */
  sb: number;
  /** The hero's chips already in this street: a raise to the call level or less is a call. */
  streetBet: number;
}

/** The guard spot of the observer of `obs`, with the features of that decision. */
export function guardSpot(obs: Observation, f: GuardSpot['f']): GuardSpot {
  return { f, legal: obs.legal, sb: obs.sb, streetBet: obs.streetBets[obs.seat] as number };
}

export interface Guardrail {
  id: GuardrailId;
  /** The rule's number in §8.8. */
  rule: 1 | 2 | 3 | 4 | 5;
  /** The corrected action, or null when the rule leaves this action alone. */
  fix(spot: GuardSpot, action: PlayerAction): PlayerAction | null;
}

/**
 * Floating-point slack for the §8.8 boundaries: "≥" holds at the boundary and "<" does not, also
 * when `need + 0.15` lands one unit in the last place away from the exact value.
 */
const EPS = 1e-9;

const fold = (): PlayerAction => ({ type: 'fold' });
const check = (): PlayerAction => ({ type: 'check' });
const call = (): PlayerAction => ({ type: 'call' });

/** The engine accepts `action` from this seat now (the same test as `engine/step.ts`). */
export function isLegalAction(legal: LegalActions, action: PlayerAction): boolean {
  switch (action.type) {
    case 'fold':
      return legal.canFold;
    case 'check':
      return legal.canCheck;
    case 'call':
      return legal.canCall;
    case 'bet':
    case 'raise': {
      const bounds = legal[action.type];
      const to: unknown = action.to;
      return (
        bounds !== null &&
        typeof to === 'number' &&
        Number.isSafeInteger(to) &&
        to >= bounds.min &&
        to <= bounds.max
      );
    }
    default:
      return false;
  }
}

/**
 * Rule 5: the legal action nearest to `action`. A legal action comes back as the same object.
 * - A bet or raise whose amount is not a whole number inside the bounds is rounded to a multiple
 *   of the small blind and clamped to the bounds (§8.7); a missing amount (NaN) is the minimum.
 *   Rounded to the call level or below, it is a call (a check when there is nothing to call).
 * - A bet when there is a bet to raise is that raise, and a raise with nothing to raise is that
 *   bet; with no bet or raise allowed at all, it becomes the call (or check).
 * - A check facing a bet is the call, and a call with nothing to call is the check: on screen
 *   they are the same button.
 * - A fold is left alone: folding when checking is free is rule 1's business.
 */
export function snapToLegal(
  spot: Pick<GuardSpot, 'legal' | 'sb' | 'streetBet'>,
  action: PlayerAction,
): PlayerAction {
  const { legal } = spot;
  if (isLegalAction(legal, action)) return action;
  switch (action.type) {
    case 'fold':
      return action;
    case 'check':
      return call();
    case 'call':
      return check();
    case 'bet':
    case 'raise':
      return snapAmount(spot, action.type, action.to);
    default:
      return legal.canCheck ? check() : call();
  }
}

function snapAmount(
  spot: Pick<GuardSpot, 'legal' | 'sb' | 'streetBet'>,
  type: 'bet' | 'raise',
  to: unknown,
): PlayerAction {
  const { legal, sb } = spot;
  const kind = legal[type] !== null ? type : type === 'bet' ? 'raise' : 'bet';
  const bounds = legal[kind];
  const passive = legal.canCheck ? check() : call();
  if (bounds === null) return passive;
  const x = typeof to === 'number' && !Number.isNaN(to) ? to : bounds.min;
  if (Number.isSafeInteger(x) && x >= bounds.min && x <= bounds.max) return { type: kind, to: x };
  const rounded = Math.round(x / sb) * sb;
  if (rounded <= spot.streetBet + legal.toCall) return passive;
  return { type: kind, to: Math.min(bounds.max, Math.max(bounds.min, rounded)) };
}

/** §8.8 rule 1: never fold when checking is free. */
export const checkFree: Guardrail = {
  id: 'checkFree',
  rule: 1,
  fix: (s, a) => (a.type === 'fold' && s.legal.canCheck ? check() : null),
};

/** §8.8 rule 2: never fold with `p ≥ 0.95`; call instead. */
export const tooStrongToFold: Guardrail = {
  id: 'tooStrongToFold',
  rule: 2,
  fix: (s, a) =>
    a.type === 'fold' && s.legal.canCall && s.f.p >= GUARD_NEVER_FOLD_P - EPS ? call() : null,
};

/** §8.8 rule 3: never call a river bet with `eRange < 0.03`; fold instead. */
export const riverNoChance: Guardrail = {
  id: 'riverNoChance',
  rule: 3,
  fix: (s, a) =>
    a.type === 'call' &&
    s.f.street === 'river' &&
    s.legal.canFold &&
    s.f.eRange < GUARD_RIVER_MIN_EQUITY - EPS
      ? fold()
      : null,
};

/** §8.8 rule 4, first half: facing an all-in, always call when `eRange ≥ need + 0.15`. */
export const allInPriceGood: Guardrail = {
  id: 'allInPriceGood',
  rule: 4,
  fix: (s, a) =>
    a.type === 'fold' &&
    s.f.facing === 'allin' &&
    s.legal.canCall &&
    s.f.eRange >= s.f.need + GUARD_ALLIN_CALL_MARGIN - EPS
      ? call()
      : null,
};

/** §8.8 rule 4, second half: facing an all-in, never call when `eRange < need − 0.25`. */
export const allInPriceBad: Guardrail = {
  id: 'allInPriceBad',
  rule: 4,
  fix: (s, a) =>
    a.type === 'call' &&
    s.f.facing === 'allin' &&
    s.legal.canFold &&
    s.f.eRange < s.f.need - GUARD_ALLIN_FOLD_MARGIN - EPS
      ? fold()
      : null,
};

/** §8.8 rule 5: illegal or sub-minimum amounts are snapped to legal ones (`snapToLegal`). */
export const legalAmount: Guardrail = {
  id: 'legalAmount',
  rule: 5,
  fix: (s, a) => {
    const snapped = snapToLegal(s, a);
    return snapped === a ? null : snapped;
  },
};

/** Every guardrail in the order `guardrails()` applies them (see the header). */
export const GUARDRAILS: readonly Guardrail[] = [
  legalAmount,
  checkFree,
  tooStrongToFold,
  riverNoChance,
  allInPriceGood,
  allInPriceBad,
];

/**
 * §8.2 `act = guardrails(f, act)`: the proposed action after every rule of `rules` in order, the
 * rules that changed it, and a GUARDRAIL reason for each of rules 1–4 that fired.
 */
export function guardrails(
  spot: GuardSpot,
  proposed: PlayerAction,
  rules: readonly Guardrail[] = GUARDRAILS,
): GuardrailResult {
  let action = proposed;
  const fired: GuardrailId[] = [];
  const trace: Reason[] = [];
  for (const g of rules) {
    const fixed = g.fix(spot, action);
    if (fixed === null) continue;
    action = fixed;
    fired.push(g.id);
    if (g.rule !== 5) trace.push({ code: 'GUARDRAIL', data: { rule: g.rule, detail: g.id } });
  }
  return { action, fired, trace };
}
