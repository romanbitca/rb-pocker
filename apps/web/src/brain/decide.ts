/**
 * The one decision pipeline of the coach and every bot (PLAN §8.1 C1, §8.2, §9.4, Appendix A.5):
 * `decide(obs, profile, seed)` for a bot, `hint(obs, eRandom)` for the coach (the fixed profile
 * `COACH`, seeded from `observationKey`, §2.4). `grade` (§8.9) is `grade.ts`'s, from the same
 * deliberation: `Deliberation.model` holds the hint's EVs.
 *
 * 1. **Features** (§8.2): `features(obs, profile, seed)`, the `eRange` Monte Carlo seeded with the
 *    decision seed itself (the coach: `coachSeed(obs)`; a bot: its table-only seed, §2.4).
 * 2. **Perception** (§9.4 step 1, bots): `E' = clamp(eRange + N(0, σ), 0, 1)`; the postflop rules
 *    see the `p` and bucket of `E'` (`withEquity`), the preflop rules add the same draw to every
 *    equity they compare (`PreflopStyle.equityNoise`).
 * 3. **Rule action `A*`** (§9.4 step 2): the preflop and push/fold policy (§8.3–8.4) with every
 *    "top X%" threshold × looseness × (1 + U(−j, j)) and the level's position awareness, or the
 *    postflop policy (§8.5) sized by the profile's size set (§8.7, §9.2). A bot that may limp turns
 *    an open raise (not a short-stack shove) into a call (the big blind: a check) when its limp
 *    draw is below `1 − pfrRatio`; that draw also limps an open raise the mix picks (step 4).
 * 4. **The pick.** The coach (`deterministic`) takes `A*`: the recommendation is the rule action
 *    (§8.9 "recommendation from the rule policy"), so σ = 0 and no mixing. A bot scores its
 *    candidates (§9.4 step 3): `EV/pot` (§8.9, with `E'`) + `T ×` biases in units of its level's
 *    temperature `T`: `aggressionBias` for a bet or raise, `3 × (stickiness − 1)` for a call, `1`
 *    for `A*` (`3.5` before the flop), `2.5` for a bet when it bluffs (Air and the bluff draw below
 *    `bluffFreq`; before the flop a raise facing one open with a suited A5–A2 or 54–T9 and the draw
 *    below `bluff3betFreq`), `2.5` for a check when it slow-plays (a Monster on a Dry board, the
 *    draw below `slowplayFreq`). Facing a bet after the flop it never folds when
 *    `1 − handPct ≤ MDF × defenseFactor` (§9.4 step 4). It picks with `P(a) ∝ exp(score / T)`
 *    (step 5); in limp mode (step 2) an open raise it picks becomes the limp.
 * 5. **Guardrails** (§8.8, step 6) on the true numbers, for every profile.
 * 6. **EVs** (§8.9): every candidate's EV in chips (the coach: the §8.9 candidates plus its own
 *    action), `confidence` from the two best, and for the coach the hint's structured extras: the
 *    close alternative (`alt`, CLOSE_SPOT), one WHY_NOT_* per other action, RANGE_ADJUST when §8.10
 *    asks for both equities, and the rule of 2 and 4 on a draw. Turning them into English is
 *    `explain.ts` (§8.10); `Decision.trace` is main reason first, then GUARDRAIL reasons, then the
 *    extras.
 *
 * A bot's candidates (§9.4 step 3 over the §9.2 size set): fold (when legal), check or call, its
 * level's sizes (after the flop: 'half' bets 1/2 pot and raises to `currentBet + 1/2 × (pot +
 * toCall)`; 'two' adds the pot-size bet and raise; the texture sets the §8.7 value size; before the
 * flop the §8.3 raise of the spot, `preflopRaiseSize`), and `A*` itself.
 *
 * Random draws (§9.4: N, U, limp, bluff, slow-play, softmax, in this fixed order) come from
 * `deriveSeed(seed, 'mix')`, the think time's `U` from `deriveSeed(seed, 'think')` (§9.8) and the
 * Monte Carlos from the seed itself and its 'preflop' and 'ev-called' children, so no stream feeds
 * two consumers. Everything is a pure function of the observation and the seed (§2.4, C3), and
 * reads nothing but the observation (⚠️ non-cheating, §9.6).
 */
import { outsChances } from '../analysis/chances.ts';
import type { DrawKind } from '../analysis/types.ts';
import { rankOf, suitOf, type Card } from '../core/cards.ts';
import { deriveSeed, rngFromSeed, type Rng, type Seed128 } from '../core/rng.ts';
import type { LegalActions, Observation, PlayerAction } from '../engine/types.ts';
import { balancedBluffChance } from './bluffs.ts';
import { candidateActions, candidateKey, confidence, evModel, type EvModel } from './ev.ts';
import { explain, explainInput, type Explanation } from './explain.ts';
import { exploitPlan, exploitProfile, NO_EXPLOITS, type ExploitPlan } from './exploits.ts';
import { coachSeed, features } from './features.ts';
import { guardrails, guardSpot } from './guardrails.ts';
import {
  handPercentile,
  impliedOdds,
  mdfDefends,
  mdfFacing,
  postflopPolicy,
  postflopSpot,
  realisation as postflopRealisation,
  withEquity,
} from './postflopPolicy.ts';
import {
  COACH_PREFLOP_STYLE,
  preflopImplied,
  preflopPolicy,
  preflopRaiseSize,
  preflopStyle,
  realisation as preflopRealisation,
} from './preflopPolicy.ts';
import { COACH } from './profiles.ts';
import { pushFoldApplies } from './pushfold.ts';
import { raiseTarget, sizeIntent, snapRaiseTo, textureBetFraction } from './sizing.ts';
import {
  BUCKET_MEDIUM,
  BUCKET_MONSTER,
  BUCKET_STRONG,
  CLEAR_SPOT_POT,
  CLOSE_SPOT_POT,
  E_CALLED_TRIALS,
  EXPLOIT_BLUFF_FACTOR,
  MIX_BIAS_UNIT_MIN,
  MIX_BLUFF_BONUS,
  MIX_CALL_STICKINESS,
  MIX_RULE_BONUS,
  MIX_RULE_BONUS_PREFLOP,
  MIX_SLOWPLAY_BONUS,
  SIZE_HALF,
  SIZE_POT,
  STRENGTH_MARGINAL,
} from './tunables.ts';
import type {
  BrainProfile,
  CandidateKey,
  Decision,
  EvCandidate,
  Features,
  PolicyDecision,
  PostflopSpot,
  Reason,
  ReasonCode,
} from './types.ts';

// ── Small helpers ──────────────────────────────────────────────────────────────────────────────

const FOLD: PlayerAction = { type: 'fold' };
const CHECK: PlayerAction = { type: 'check' };
const CALL: PlayerAction = { type: 'call' };

/** `Decision.kind` of a legal action: a bet or raise to the legal maximum is 'allin'. */
export function kindOf(legal: LegalActions, action: PlayerAction): Decision['kind'] {
  if ((action.type === 'bet' || action.type === 'raise') && action.to === legal[action.type]?.max) {
    return 'allin';
  }
  return action.type;
}

/** §8.10 strength meter band of `p`: Weak, Marginal (0.35), Decent, Strong, Monster (the buckets). */
export function strengthOf(p: number): Decision['strength'] {
  if (p >= BUCKET_MONSTER) return 'monster';
  if (p >= BUCKET_STRONG) return 'strong';
  if (p >= BUCKET_MEDIUM) return 'decent';
  if (p >= STRENGTH_MARGINAL) return 'marginal';
  return 'weak';
}

const isAggressive = (a: PlayerAction): boolean => a.type === 'bet' || a.type === 'raise';

/**
 * The reasons of a bet or raise that say why a weak hand bets (§8.10): a semi-bluff, a
 * continuation bet, a short stack's push or fold. Only they may sit next to a Weak meter.
 */
export const BLUFF_REASONS: ReadonlySet<ReasonCode> = new Set<ReasonCode>([
  'SEMI_BLUFF',
  'CBET_DRY',
  'PUSH_FOLD',
]);

/**
 * §8.10 the strength meter of a decision: the band of `p` (`strengthOf`), which never argues
 * against the move (pitfall 34). Next to a fold it shows at most Decent (the price or the seat
 * says fold, not the hand); next to a bet or raise at least Marginal, unless the main reason
 * `main` is one of `BLUFF_REASONS`. With the fair-share `p` (§8.2) these limits rarely act.
 */
export function meterStrength(
  p: number,
  action: PlayerAction,
  main: ReasonCode | undefined,
): Decision['strength'] {
  const band = strengthOf(p);
  if (action.type === 'fold' && (band === 'strong' || band === 'monster')) return 'decent';
  const bluff = main !== undefined && BLUFF_REASONS.has(main);
  if (isAggressive(action) && band === 'weak' && !bluff) return 'marginal';
  return band;
}

// ── §9.4 draws ─────────────────────────────────────────────────────────────────────────────────

/** Every random draw of a bot decision (§9.4), taken in this order from `deriveSeed(seed, 'mix')`. */
export interface MixDraws {
  /** N(0, 1): the perceived equity's noise is `equityNoiseSD × z`. */
  z: number;
  /** U(−1, 1): the preflop jitter is `preflopJitter × u`. */
  u: number;
  /** U(0, 1) each. */
  limp: number;
  bluff: number;
  slowplay: number;
  pick: number;
}

const TWO_32 = 2 ** 32;
const unit = (rng: Rng): number => rng.next() / TWO_32;

/** The §9.4 draws of a decision seed (Box–Muller for N(0, 1)). */
export function mixDraws(seed: Seed128): MixDraws {
  const rng = rngFromSeed(deriveSeed(seed, 'mix'));
  const u1 = (rng.next() + 1) / (TWO_32 + 1); // (0, 1]: the logarithm is finite
  const u2 = unit(rng);
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return {
    z,
    u: 2 * unit(rng) - 1,
    limp: unit(rng),
    bluff: unit(rng),
    slowplay: unit(rng),
    pick: unit(rng),
  };
}

/** The coach draws nothing: no noise, no jitter, no limp, no bluff, no slow-play. */
const NO_DRAWS: MixDraws = { z: 0, u: 0, limp: 1, bluff: 1, slowplay: 1, pick: 0 };

// ── The rule action A* (§8.3–8.5, §9.4 step 2) ─────────────────────────────────────────────────

/** What the rule policy saw: the perceived equity and the features behind it. */
export interface Perceived {
  /** `E' = clamp(eRange + σ·z, 0, 1)` (the true `eRange` for the coach). */
  E: number;
  /** The features with `E'` (postflop: its `p` and bucket); `f` itself for the coach. */
  f: Features;
  /** The noise draw `σ·z` (0 for the coach). */
  noise: number;
}

/** §9.4 step 1: what a profile perceives of the true features. */
export function perceive(f: Features, profile: BrainProfile, draws: MixDraws): Perceived {
  const noise = profile.deterministic ? 0 : profile.equityNoiseSD * draws.z;
  if (noise === 0) return { E: f.eRange, f, noise: 0 };
  const E = Math.min(1, Math.max(0, f.eRange + noise));
  return { E, f: f.street === 'preflop' ? { ...f, eRange: E } : withEquity(f, E), noise };
}

/**
 * The rule action `A*` (§9.4 step 2): the preflop policy with the profile's style, else the
 * postflop policy on the perceived features with the profile's size set; a bot may limp.
 */
export function ruleAction(
  obs: Observation,
  f: Features,
  seen: Perceived,
  profile: BrainProfile,
  seed: Seed128,
  draws: MixDraws,
  spot: PostflopSpot | null = f.street === 'preflop' ? null : postflopSpot(obs),
): PolicyDecision {
  if (spot !== null) return postflopPolicy(seen.f, spot, profile.sizing);
  const style = profile.deterministic
    ? COACH_PREFLOP_STYLE
    : preflopStyle(profile, { noise: seen.noise, jitter: profile.preflopJitter * draws.u });
  const rule = preflopPolicy(obs, f, {
    style,
    rangeModel: profile.rangeModel,
    seed: deriveSeed(seed, 'preflop'),
  });
  return profile.neverLimp ? rule : limpInstead(obs, f, rule, profile, draws);
}

/**
 * §9.4 step 2, limp mode: a bot that may limp, in an unopened or limped pot that is not a
 * short-stack push or fold, with its limp draw below `1 − pfrRatio`. Its open raise is then a
 * call (a check in the big blind), whether `A*` or the mix picked it (§9.4 step 5), so `pfrRatio`
 * is the share of its opens that raise at every level (chunk 5.11: limping only `A*`, the EVs'
 * fold equity raised most of a Maniac's limps at Medium and far fewer at Easy).
 */
export function limpMode(f: Features, profile: BrainProfile, draws: MixDraws): boolean {
  return (
    !profile.neverLimp &&
    (f.facing === 'none' || f.facing === 'limpers') &&
    !pushFoldApplies(f) &&
    draws.limp < 1 - profile.pfrRatio
  );
}

/** §9.4 step 2: in limp mode an open raise becomes a call (a check in the big blind). */
function limpInstead(
  obs: Observation,
  f: Features,
  rule: PolicyDecision,
  profile: BrainProfile,
  draws: MixDraws,
): PolicyDecision {
  if (!isAggressive(rule.action) || !limpMode(f, profile, draws)) return rule;
  const action = obs.legal.canCheck ? CHECK : CALL;
  return { action, kind: action.type, trace: rule.trace };
}

/**
 * §9.5 Expert exploit of a hero who plays too many hands (chunk 7.1): heads-up against the hero
 * with nothing to call, a Medium hand (as perceived) that the rule would check bets for thin
 * value instead (1/3 pot, §8.7). Any other rule action stands.
 */
export function valueMediumRule(
  rule: PolicyDecision,
  seen: Features,
  spot: PostflopSpot | null,
  profile: BrainProfile,
  plan: ExploitPlan,
): PolicyDecision {
  if (!plan.valueMedium || spot === null) return rule;
  if (seen.bucket !== 'medium' || rule.action.type !== 'check') return rule;
  const bet = betOf('thinValue', seen, spot, profile);
  if (bet === null || bet.type !== 'bet') return rule;
  const data = {
    handName: seen.handInfo.name,
    E: seen.eRange,
    size: bet.to,
    sizeBB: bet.to / spot.bb,
  };
  return { action: bet, kind: kindOf(spot.legal, bet), trace: [{ code: 'THIN_VALUE', data }] };
}

// ── EVs (§8.9) ─────────────────────────────────────────────────────────────────────────────────

/**
 * The policy's realisation `R` of the hero's equity on this street (§8.3 step 3 before the flop,
 * §8.5 step 2 after it). The EV model uses 1 instead after an action that ends the hero's betting.
 */
export function realisationOf(obs: Observation, f: Features, spot: PostflopSpot | null): number {
  return spot === null ? preflopRealisation(f.position, obs.hole) : postflopRealisation(f);
}

/**
 * The EV model of the decision with equity `E` (the coach: `eRange`; a bot: `E'`): the policy's
 * realisation and implied odds (§8.3 steps 3–4, §8.5 steps 2–3), `E_called` trials capped at the
 * profile's own `mcTrials`.
 */
function evModelOf(
  obs: Observation,
  f: Features,
  E: number,
  profile: BrainProfile,
  seed: Seed128,
  spot: PostflopSpot | null,
): EvModel {
  const R = realisationOf(obs, f, spot);
  // §8.3 step 4 sets up implied odds only facing a raise (a limp has none); §8.5 step 3 after the
  // flop. The EV model drops them when the call ends the betting (an all-in).
  const facingRaise = f.facing === 'open' || f.facing === '3bet' || f.facing === '4bet+';
  let implied = 0;
  if (spot !== null && f.toCall > 0) implied = impliedOdds(f, spot);
  else if (spot === null && facingRaise) implied = preflopImplied(obs, f);
  const model = evModel({
    obs,
    f: { pot: f.pot, toCall: f.toCall, winPot: f.winPot, eRange: E, ranges: f.ranges },
    R,
    implied,
    seed,
    trials: Math.min(E_CALLED_TRIALS, profile.mcTrials),
  });
  // Each action's EV once per decision (a bet's E_called is a Monte Carlo of its own).
  const memo = new Map<CandidateKey, number>();
  return {
    ev: (action) => {
      const key = candidateKey(obs.legal, action);
      let v = memo.get(key);
      if (v === undefined) {
        v = model.ev(action);
        memo.set(key, v);
      }
      return v;
    },
    candidates: () => model.candidates(),
  };
}

/** Candidates with unique keys, in order (§8.9 keys). */
function unique(legal: LegalActions, actions: readonly PlayerAction[]): EvCandidate[] {
  const seen = new Set<CandidateKey>();
  const out: EvCandidate[] = [];
  for (const action of actions) {
    const key = candidateKey(legal, action);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, action, ev: 0 });
  }
  return out;
}

/** The raise-to targets of a bot's size set after the flop (§9.2 "Sizes", §8.7 formulas). */
function sizeTargets(obs: Observation, seen: Features, profile: BrainProfile): number[] {
  const { legal } = obs;
  const pot = seen.pot;
  if (legal.bet !== null) {
    if (profile.sizing === 'half') return [SIZE_HALF * pot];
    if (profile.sizing === 'two') return [SIZE_HALF * pot, SIZE_POT * pot];
    return [textureBetFraction('value', seen, obs.board) * pot];
  }
  const currentBet = (obs.streetBets[obs.seat] as number) + legal.toCall;
  const raiseBy = (x: number): number => currentBet + x * (pot + seen.toCall);
  if (profile.sizing === 'half') return [raiseBy(SIZE_HALF)];
  if (profile.sizing === 'two') return [raiseBy(SIZE_HALF), raiseBy(SIZE_POT)];
  return [raiseTarget('value', seen, currentBet, profile.sizing)];
}

/**
 * A bot's candidate actions (§9.4 step 3): fold when legal, check or call, its size set's bets or
 * raises (before the flop the §8.3 raise of the spot) and the rule action itself.
 */
export function botCandidates(
  obs: Observation,
  f: Features,
  seen: Features,
  profile: BrainProfile,
  rule: PolicyDecision,
): EvCandidate[] {
  const { legal } = obs;
  const raw: PlayerAction[] = [];
  if (legal.canFold) raw.push(FOLD);
  raw.push(legal.canCheck ? CHECK : CALL);
  if (f.street === 'preflop') {
    const raise = preflopRaiseSize(obs, f);
    if (raise !== null) raw.push(raise.action);
  } else if (legal.bet !== null || legal.raise !== null) {
    const streetBet = obs.streetBets[obs.seat] as number;
    for (const to of sizeTargets(obs, seen, profile)) {
      raw.push(snapRaiseTo(to, legal, obs.sb, streetBet).action);
    }
  }
  raw.push(rule.action);
  return unique(legal, raw);
}

// ── The pick (§9.4 steps 3–5) ──────────────────────────────────────────────────────────────────

/** "Bluff 3-bets use A5s–A2s and suited connectors first" (§9.1): suited A5–A2 and 54–T9. */
export function bluff3betHand(hole: readonly [Card, Card] | readonly Card[]): boolean {
  const [a, b] = hole as [Card, Card];
  if (suitOf(a) !== suitOf(b)) return false;
  const hi = Math.max(rankOf(a), rankOf(b));
  const lo = Math.min(rankOf(a), rankOf(b));
  if (hi === 12) return lo <= 3; // A5s–A2s
  return hi - lo === 1 && hi >= 3 && hi <= 8; // 54s–T9s
}

/**
 * §9.4 step 3: the pot value of one unit of bias at temperature `T`, `max(T, 0.12)`. At Easy and
 * Medium it is `T` itself (chunk 5.11: a bias weighs the same against the other candidates at
 * both); below Medium's `T` it stays at Medium's value (chunk 7.3), so the scores of a Hard or
 * Expert bot are a Medium bot's and its lower `T` only makes the same choice more often (`P` ∝
 * Medium's odds to the power 0.12 / `T`: 2 at Hard, 3 at Expert). With `T` as the unit, the §9.4
 * biases shrank in pots while the §8.9 EVs did not, and the preflop fold-equity heuristic, which
 * rates a re-raise with any two cards at break-even or better, drowned the personalities (R20).
 */
export function biasUnit(T: number): number {
  return Math.max(T, MIX_BIAS_UNIT_MIN);
}

/** Index picked by `P(i) ∝ exp(score_i / T)` with the uniform draw `u` (argmax when T ≤ 0). */
export function softmaxIndex(scores: readonly number[], T: number, u: number): number {
  let best = 0;
  for (let i = 1; i < scores.length; i++) {
    if ((scores[i] as number) > (scores[best] as number)) best = i;
  }
  if (!(T > 0)) return best;
  const max = scores[best] as number;
  const w = scores.map((s) => Math.exp((s - max) / T));
  const total = w.reduce((sum, x) => sum + x, 0);
  let x = u * total;
  for (let i = 0; i < w.length; i++) {
    x -= w[i] as number;
    if (x < 0) return i;
  }
  return w.length - 1;
}

/** A bot's scored candidates and its pick (§9.4 steps 3–5). */
export interface BotPick {
  candidates: EvCandidate[];
  scores: number[];
  /** Fold was taken out by the §9.4 step 4 defence. */
  defended: boolean;
  /**
   * The softmax pick; in limp mode (§9.4 step 2) an open raise it picked is the limp instead.
   * Hard and Expert: a river Air hand bluffs or checks by the balanced chance (§9.2, `river`);
   * Expert: the c-bet exploit bets 1/3 pot with any two cards (§9.5).
   */
  pick: EvCandidate;
  /** Hard and Expert, a river Air hand with a bet allowed: the balanced bluff chance and the pick. */
  river: { chance: number; bluff: boolean } | null;
}

/** A bet of the given §8.7 row, sized by the profile's set, or null when it is not a bet. */
function betOf(
  purpose: 'cbet' | 'bluff' | 'thinValue',
  f: Features,
  spot: PostflopSpot,
  profile: BrainProfile,
): PlayerAction | null {
  const sized = sizeIntent({ kind: 'bet', purpose, allIn: false }, f, spot, profile.sizing);
  return sized.action.type === 'bet' ? sized.action : null;
}

/** The candidate for `action`, added (with its EV) when the size set did not have it. */
function candidateFor(
  candidates: EvCandidate[],
  legal: LegalActions,
  action: PlayerAction,
  model: EvModel,
): EvCandidate {
  const key = candidateKey(legal, action);
  let c = candidates.find((x) => x.key === key);
  if (c === undefined) {
    c = { key, action, ev: model.ev(action) };
    candidates.push(c);
  }
  return c;
}

export function botPick(
  obs: Observation,
  f: Features,
  seen: Perceived,
  profile: BrainProfile,
  rule: PolicyDecision,
  draws: MixDraws,
  model: EvModel,
  plan: ExploitPlan = NO_EXPLOITS,
  spot: PostflopSpot | null = f.street === 'preflop' ? null : postflopSpot(obs),
): BotPick {
  const { legal } = obs;
  const preflop = f.street === 'preflop';
  const ruleKey = candidateKey(legal, rule.action);
  let candidates = botCandidates(obs, f, seen.f, profile, rule).map((c) => ({
    ...c,
    ev: model.ev(c.action),
  }));
  let defended = false;
  if (!preflop && legal.toCall > 0 && legal.canFold) {
    const handPct = handPercentile(obs.hole, obs.board);
    if (mdfDefends(handPct, mdfFacing(obs), profile.defenseFactor)) {
      candidates = candidates.filter((c) => c.key !== 'fold');
      defended = true;
    }
  }
  // The moves the exploits and the balanced river bluffs make for the bot (chunk 7.1), among the
  // candidates before they are scored: the §9.5 c-bet with any two cards, or a river Air hand's
  // bluff (§9.2, heads-up only) or check.
  let forced: EvCandidate | null = null;
  let river: BotPick['river'] = null;
  if (spot !== null && legal.bet !== null) {
    if (plan.cbet) {
      const cbet = betOf('cbet', seen.f, spot, profile);
      if (cbet !== null) forced = candidateFor(candidates, legal, cbet, model);
    } else if (profile.balancedBluffs && f.street === 'river' && seen.f.bucket === 'air') {
      const bluff = f.nOpp === 1 ? betOf('bluff', seen.f, spot, profile) : null;
      const villain = f.ranges[0];
      const chance =
        bluff === null || bluff.type !== 'bet' || villain === undefined
          ? 0
          : balancedBluffChance(obs, profile.rangeModel, villain.weights, bluff.to) *
            (plan.halveBluffs ? EXPLOIT_BLUFF_FACTOR : 1);
      const bluffs = bluff !== null && draws.bluff < chance;
      forced = candidateFor(candidates, legal, bluffs ? (bluff as PlayerAction) : CHECK, model);
      river = { chance, bluff: bluffs };
    }
  }
  const bluffing = preflop
    ? f.facing === 'open' && bluff3betHand(obs.hole) && draws.bluff < profile.bluff3betFreq
    : seen.f.bucket === 'air' && draws.bluff < profile.bluffFreq;
  const slowplaying =
    !preflop &&
    seen.f.bucket === 'monster' &&
    f.texture === 'dry' &&
    draws.slowplay < profile.slowplayFreq;
  const pot = Math.max(f.pot, 1);
  // "Air bucket bet": a bet into the pot after the flop; before it, the bluff 3-bet (a raise).
  const bluffType: PlayerAction['type'] = preflop ? 'raise' : 'bet';
  // The biases are in units of max(T, 0.12): EV/pot + unit × bias (§9.4 step 3, chunks 5.11, 7.3).
  const ruleBonus = preflop ? MIX_RULE_BONUS_PREFLOP : MIX_RULE_BONUS;
  const unit = biasUnit(profile.temperature);
  const scores = candidates.map((c) => {
    let bias = 0;
    if (isAggressive(c.action)) bias += profile.aggressionBias;
    if (bluffing && c.action.type === bluffType) bias += MIX_BLUFF_BONUS;
    if (c.action.type === 'call') bias += MIX_CALL_STICKINESS * (profile.stickiness - 1);
    if (c.action.type === 'check' && slowplaying) bias += MIX_SLOWPLAY_BONUS;
    const rule = c.key === ruleKey ? ruleBonus : 0;
    return c.ev / pot + profile.temperature * bias + unit * rule;
  });
  let pick = candidates[softmaxIndex(scores, profile.temperature, draws.pick)] as EvCandidate;
  // Limp mode (§9.4 step 2) limps an open raise the mix picked too: `pfrRatio` holds at every level.
  if (preflop && isAggressive(pick.action) && limpMode(f, profile, draws)) {
    pick = candidates.find((c) => !isAggressive(c.action) && c.key !== 'fold') as EvCandidate;
  }
  if (forced !== null) pick = forced;
  return { candidates, scores, defended, pick, river };
}

// ── The coach's hint extras (§8.9 Close, §8.10) ────────────────────────────────────────────────

const WHY_NOT: Readonly<Record<PlayerAction['type'], ReasonCode>> = {
  fold: 'WHY_NOT_FOLD',
  check: 'WHY_NOT_CHECK',
  call: 'WHY_NOT_CALL',
  bet: 'WHY_NOT_BET',
  raise: 'WHY_NOT_RAISE',
};
const RULE_2_4_DRAWS: ReadonlySet<DrawKind> = new Set<DrawKind>([
  'flush',
  'nutFlush',
  'oesd',
  'doubleGutshot',
  'gutshot',
]);
/** "Above 8 outs" the trick guesses too high (§8.10). */
const RULE_2_4_BIG_OUTS = 8;

/** The coach's bet or raise of the spot: §8.3 before the flop, §8.7 (value, by texture) after it. */
function coachAggression(
  obs: Observation,
  f: Features,
  spot: PostflopSpot | null,
): PlayerAction | null {
  if (spot === null) return preflopRaiseSize(obs, f)?.action ?? null;
  const { legal } = obs;
  if (legal.bet === null && legal.raise === null) return null;
  const kind = legal.bet !== null ? 'bet' : 'raise';
  const sized = sizeIntent({ kind, purpose: 'value', allIn: false }, f, spot, 'texture');
  return isAggressive(sized.action) ? sized.action : null;
}

/**
 * The coach's sensible alternatives (§8.10 "one line per other sensible action"), with their EVs:
 * for each kind of legal action other than the recommendation's, the one the coach would take of
 * that kind. A fold when there is something to call; a check; a call, but never a limp or a
 * complete (C10) nor a flat call of a raise with a short stack (§8.4: fold or all-in); a bet or
 * raise of the coach's own size (§8.3 before the flop, §8.7 by texture after it), so all-in only
 * where those sizes go all-in. The EV-best of the §8.9 sizes is never offered: the fold-equity
 * heuristic can rate a deep all-in near a normal open, and "Close call: All-in 21,800 is also
 * fine" would be absurd (chunk 5.7).
 */
export function sensibleAlternatives(
  obs: Observation,
  f: Features,
  spot: PostflopSpot | null,
  action: PlayerAction,
  model: EvModel,
): EvCandidate[] {
  const { legal } = obs;
  const raw: PlayerAction[] = [];
  if (legal.canFold && legal.toCall > 0) raw.push(FOLD);
  if (legal.canCheck) raw.push(CHECK);
  const flat =
    spot !== null ||
    (f.facing !== 'none' &&
      f.facing !== 'limpers' &&
      (f.facing === 'allin' || !pushFoldApplies(f)));
  if (legal.canCall && flat) raw.push(CALL);
  const aggressive = coachAggression(obs, f, spot);
  if (aggressive !== null) raw.push(aggressive);
  return unique(
    legal,
    raw.filter((a) => a.type !== action.type),
  ).map((c) => ({ ...c, ev: model.ev(c.action) }));
}

/**
 * A hint's confidence (§8.9 Close / Clear): the recommendation against its best sensible
 * alternative. Close when the two are within 3% of the pot, either way; Clear when the
 * recommendation is ahead by more than 10%; else Normal, also when the model rates the alternative
 * higher (the rule policy decides, §8.9, and a hint never calls a choice "clear" that its own EVs
 * rate worse). No alternative at all: Clear.
 */
export function hintConfidence(
  recEV: number,
  alternatives: readonly EvCandidate[],
  pot: number,
): Decision['confidence'] {
  if (alternatives.length === 0) return 'clear';
  const best = Math.max(...alternatives.map((c) => c.ev));
  const gap = recEV - best;
  if (Math.abs(gap) <= CLOSE_SPOT_POT * pot + 1e-9) return 'close';
  return gap > CLEAR_SPOT_POT * pot ? 'clear' : 'normal';
}

/**
 * The close alternative (§8.9 "Close call: {alt} is also fine"): the best sensible alternative
 * when it is within 3% of the pot of the recommendation; null otherwise.
 */
export function closeAlternative(
  alternatives: readonly EvCandidate[],
  recEV: number,
  pot: number,
): EvCandidate | null {
  let alt: EvCandidate | null = null;
  for (const c of alternatives) if (alt === null || c.ev > alt.ev) alt = c;
  if (alt === null || Math.abs(recEV - alt.ev) > CLOSE_SPOT_POT * pot + 1e-9) return null;
  return alt;
}

/**
 * The hint's structured extras (§8.10 hint structure 3–5, Appendix F.1): RANGE_ADJUST when both
 * equities must be shown (`{eRandom}`, `{eRange}`), CLOSE_SPOT with the close alternative, one
 * WHY_NOT_* per other sensible alternative (its key, its EV and what it loses against the
 * recommendation, and the hint's `{E}` and `{need}`), and the rule of 2 and 4 on a draw (exact
 * chances as fractions). Which lines are said, and how, is `explain.ts`'s business.
 */
function hintExtras(
  obs: Observation,
  f: Features,
  alternatives: readonly EvCandidate[],
  recEV: number,
  alt: EvCandidate | null,
): Reason[] {
  const trace: Reason[] = [];
  if (f.rangeAdjust) {
    trace.push({
      code: 'RANGE_ADJUST',
      data: { eRandom: f.eRandom, eRange: f.eRange, need: f.need },
    });
  }
  if (alt !== null) trace.push({ code: 'CLOSE_SPOT', data: { alt: alt.key, ev: alt.ev } });
  const E = f.rangeAdjust ? f.eRange : f.eRandom;
  for (const c of alternatives) {
    if (c === alt) continue;
    trace.push({
      code: WHY_NOT[c.action.type],
      data: { alt: c.key, ev: c.ev, loss: recEV - c.ev, E, need: f.need },
    });
  }
  const drawStreet = obs.board.length === 3 || obs.board.length === 4;
  if (drawStreet && f.outs > 0 && f.draws.some((d) => RULE_2_4_DRAWS.has(d.kind))) {
    const c = outsChances(f.outs, obs.board.length);
    trace.push({
      code: 'RULE_2_4',
      data: {
        outs: f.outs,
        nextCard: (c.nextCardPct as number) / 100,
        byRiver: (c.byRiverPct as number) / 100,
      },
    });
    if (f.outs > RULE_2_4_BIG_OUTS) trace.push({ code: 'RULE_2_4_BIG', data: { outs: f.outs } });
  }
  return trace;
}

// ── The pipeline ───────────────────────────────────────────────────────────────────────────────

/** Everything one decision computed: what `decide` returns, and what led to it (tests, Stage 6). */
export interface Deliberation {
  decision: Decision;
  /** The true features (§8.2). */
  f: Features;
  /** What the profile perceived (§9.4 step 1). */
  seen: Perceived;
  /** The rule action `A*` (§9.4 step 2), before mixing and guardrails. */
  rule: PolicyDecision;
  /** A bot's scored candidates and pick (null for the coach). */
  bot: BotPick | null;
  /** The guardrails that changed the pick (§8.8). */
  fired: string[];
  /**
   * The decision's EV model (§8.9), each action's EV computed once: the grade (chunk 6.1) reads
   * the hint's own numbers from it and computes only an action that is not a candidate yet.
   */
  model: EvModel;
  /** The street's realisation `R` the EV model used (`realisationOf`). */
  R: number;
}

/**
 * The whole pipeline for `profile` with decision seed `seed`. `eRandom` is the coach's HUD number
 * when the caller has it (§8.2); a bot never computes one (`Decision.eRandom = eRange`).
 */
export function deliberate(
  obs: Observation,
  profile: BrainProfile,
  seed: Seed128,
  eRandom: number | null = null,
): Deliberation {
  const f = features(obs, profile, seed, eRandom);
  const draws = profile.deterministic ? NO_DRAWS : mixDraws(seed);
  // §9.5 Expert exploits (chunk 7.1): what they change in this decision, and the profile it is
  // played with (halved bluffs; stickiness + 0.2 and full defence against an aggressive hero).
  const plan = exploitPlan(obs, f, profile);
  const played = exploitProfile(profile, plan);
  const seen = perceive(f, played, draws);
  const spot = f.street === 'preflop' ? null : postflopSpot(obs);
  const rule = valueMediumRule(
    ruleAction(obs, f, seen, played, seed, draws, spot),
    seen.f,
    spot,
    played,
    plan,
  );
  const model = evModelOf(obs, f, seen.E, played, seed, spot);

  let bot: BotPick | null = null;
  let proposed = rule.action;
  if (!profile.deterministic) {
    bot = botPick(obs, f, seen, played, rule, draws, model, plan, spot);
    proposed = bot.pick.action;
  }
  const guarded = guardrails(guardSpot(obs, f), proposed);
  const action = guarded.action;
  const key = candidateKey(obs.legal, action);

  let candidates: EvCandidate[];
  if (bot === null) {
    candidates = candidateActions(obs).map((c) => ({ ...c, ev: model.ev(c.action) }));
  } else {
    candidates = bot.candidates;
  }
  if (!candidates.some((c) => c.key === key)) {
    candidates = [...candidates, { key, action, ev: model.ev(action) }];
  }
  const recEV = (candidates.find((c) => c.key === key) as EvCandidate).ev;

  let trace: Reason[];
  let alt: EvCandidate | null = null;
  let conf: Decision['confidence'];
  if (bot === null) {
    // The coach: its recommendation against the sensible alternatives (§8.9, §8.10).
    const alternatives = sensibleAlternatives(obs, f, spot, action, model);
    for (const c of alternatives) {
      if (!candidates.some((x) => x.key === c.key)) candidates.push(c);
    }
    conf = hintConfidence(recEV, alternatives, f.pot);
    alt = conf === 'close' ? closeAlternative(alternatives, recEV, f.pot) : null;
    trace = [...rule.trace, ...guarded.trace, ...hintExtras(obs, f, alternatives, recEV, alt)];
  } else {
    conf = confidence(
      candidates.map((c) => c.ev),
      f.pot,
    );
    // A bot's reasons explain A* only when it picked A* (they are never shown, §8.10).
    const pickedRule = bot.pick.key === candidateKey(obs.legal, rule.action);
    trace = [...(pickedRule ? rule.trace : []), ...guarded.trace];
  }
  const ev: Decision['ev'] = {};
  for (const c of candidates) ev[c.key] = c.ev;

  const decision: Decision = {
    action,
    kind: kindOf(obs.legal, action),
    ev,
    eRandom: f.eRandom,
    eRange: f.eRange,
    need: f.need,
    bucket: f.bucket,
    strength: meterStrength(f.p, action, trace[0]?.code),
    confidence: conf,
    alt: alt === null ? null : alt.action,
    trace,
  };
  return {
    decision,
    f,
    seen,
    rule,
    bot,
    fired: guarded.fired,
    model,
    R: realisationOf(obs, f, spot),
  };
}

/**
 * Appendix A.5 `decide(obs, profile, seed)`: the decision of the observer with `profile` (a bot's
 * `profileFor`, or `COACH`), a pure function of the observation and the seed. Always legal.
 */
export function decide(obs: Observation, profile: BrainProfile, seed: Seed128): Decision {
  return deliberate(obs, profile, seed).decision;
}

/**
 * Appendix A.5 `hint(obs, eRandom)`: the coach's advice, `decide` with `COACH` and the seed of the
 * observation (`coachSeed`, §2.4), so the same observation always gets the same advice, numbers
 * and reasons (C3, pitfall 17). `eRandom` is the HUD's final number when the caller has it, else
 * null and the HUD's own deterministic function computes it (§8.2, C9). It has no level: the coach
 * level changes what is shown, never the advice (C4).
 */
export function hint(obs: Observation, eRandom: number | null): Decision {
  return deliberate(obs, COACH, coachSeed(obs), eRandom).decision;
}

/** The coach's advice with its words (§8.10): what `brain.worker` sends for a hint job. */
export interface CoachHint {
  decision: Decision;
  /** `explain()` of the decision (template keys and values, never English; chunk 5.6). */
  explanation: Explanation;
}

/**
 * `hint(obs, eRandom)` and its explanation from one computation: `explain` needs the §8.2
 * features, which only the brain has (the main thread renders the lines, `i18n/coach.ts`, so no
 * brain data joins the main bundle). The numbers in the words are the decision's own (C9).
 */
export function coachHint(obs: Observation, eRandom: number | null): CoachHint {
  const { decision, f } = deliberate(obs, COACH, coachSeed(obs), eRandom);
  return { decision, explanation: explain(explainInput(obs, f, decision)) };
}
