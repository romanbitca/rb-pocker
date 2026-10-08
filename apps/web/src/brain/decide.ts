/**
 * The one decision pipeline of the coach and every bot (PLAN §8.1 C1, §8.2, §9.4, Appendix A.5):
 * `decide(obs, profile, seed)` for a bot, `hint(obs, eRandom)` for the coach (the fixed profile
 * `COACH`, seeded from `observationKey`, §2.4). `grade` is Stage 6's (§8.9).
 *
 * 1. **Features** (§8.2): `features(obs, profile, seed)`, the `eRange` Monte Carlo seeded with the
 *    decision seed itself (the coach: `coachSeed(obs)`; a bot: its table-only seed, §2.4).
 * 2. **Perception** (§9.4 step 1, bots): `E' = clamp(eRange + N(0, σ), 0, 1)`; the postflop rules
 *    see the `p` and bucket of `E'` (`withEquity`), the preflop rules add the same draw to every
 *    equity they compare (`PreflopStyle.equityNoise`).
 * 3. **Rule action `A*`** (§9.4 step 2): the preflop and push/fold policy (§8.3–8.4) with every
 *    "top X%" threshold × looseness × (1 + U(−j, j)) and the level's position awareness, or the
 *    postflop policy (§8.5) sized by the profile's size set (§8.7, §9.2). A bot that may limp turns
 *    an open raise (not a short-stack shove) into a call (the big blind: a check) with probability
 *    `1 − pfrRatio`.
 * 4. **The pick.** The coach (`deterministic`) takes `A*`: the recommendation is the rule action
 *    (§8.9 "recommendation from the rule policy"), so σ = 0 and no mixing. A bot scores its
 *    candidates (§9.4 step 3): `EV/pot` (§8.9, with `E'`) + `aggressionBias` for a bet or raise,
 *    `+0.05 × (stickiness − 1)` for a call, `+0.10` for `A*`, `+0.30` for a bet when it bluffs (Air
 *    and the bluff draw below `bluffFreq`; before the flop a raise facing one open with a suited
 *    A5–A2 or 54–T9 and the draw below `bluff3betFreq`), `+0.30` for a check when it slow-plays (a
 *    Monster on a Dry board, the draw below `slowplayFreq`). Facing a bet after the flop it never
 *    folds when `1 − handPct ≤ MDF × defenseFactor` (§9.4 step 4). It picks with
 *    `P(a) ∝ exp(score / T)` (step 5).
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
import { candidateActions, candidateKey, confidence, evModel, type EvModel } from './ev.ts';
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
import { raiseTarget, snapRaiseTo, textureBetFraction } from './sizing.ts';
import {
  BUCKET_MEDIUM,
  BUCKET_MONSTER,
  BUCKET_STRONG,
  CLOSE_SPOT_POT,
  E_CALLED_TRIALS,
  MIX_BLUFF_BONUS,
  MIX_CALL_STICKINESS,
  MIX_RULE_BONUS,
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
  GradeResult,
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

/** §8.10 strength meter from `p`: Weak, Marginal (0.35), Decent, Strong, Monster (the buckets). */
export function strengthOf(p: number): Decision['strength'] {
  if (p >= BUCKET_MONSTER) return 'monster';
  if (p >= BUCKET_STRONG) return 'strong';
  if (p >= BUCKET_MEDIUM) return 'decent';
  if (p >= STRENGTH_MARGINAL) return 'marginal';
  return 'weak';
}

const isAggressive = (a: PlayerAction): boolean => a.type === 'bet' || a.type === 'raise';

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

/** §9.4 step 2: an open raise becomes a call (a check in the big blind) with `1 − pfrRatio`. */
function limpInstead(
  obs: Observation,
  f: Features,
  rule: PolicyDecision,
  profile: BrainProfile,
  draws: MixDraws,
): PolicyDecision {
  const open =
    (f.facing === 'none' || f.facing === 'limpers') &&
    !pushFoldApplies(f) &&
    isAggressive(rule.action);
  if (!open || draws.limp >= 1 - profile.pfrRatio) return rule;
  const action = obs.legal.canCheck ? CHECK : CALL;
  return { action, kind: action.type, trace: rule.trace };
}

// ── EVs (§8.9) ─────────────────────────────────────────────────────────────────────────────────

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
  const R = spot === null ? preflopRealisation(f.position, obs.hole) : postflopRealisation(f);
  // §8.3 step 4 sets up implied odds only facing a raise (a limp has none); §8.5 step 3 after the
  // flop. The EV model drops them when the call ends the betting (an all-in).
  const facingRaise = f.facing === 'open' || f.facing === '3bet' || f.facing === '4bet+';
  let implied = 0;
  if (spot !== null && f.toCall > 0) implied = impliedOdds(f, spot);
  else if (spot === null && facingRaise) implied = preflopImplied(obs, f);
  return evModel({
    obs,
    f: { pot: f.pot, toCall: f.toCall, winPot: f.winPot, eRange: E, ranges: f.ranges },
    R,
    implied,
    seed,
    trials: Math.min(E_CALLED_TRIALS, profile.mcTrials),
  });
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
  pick: EvCandidate;
}

export function botPick(
  obs: Observation,
  f: Features,
  seen: Perceived,
  profile: BrainProfile,
  rule: PolicyDecision,
  draws: MixDraws,
  model: EvModel,
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
  const scores = candidates.map((c) => {
    let s = c.ev / pot;
    if (isAggressive(c.action)) s += profile.aggressionBias;
    if (bluffing && c.action.type === bluffType) s += MIX_BLUFF_BONUS;
    if (c.action.type === 'call') s += MIX_CALL_STICKINESS * (profile.stickiness - 1);
    if (c.action.type === 'check' && slowplaying) s += MIX_SLOWPLAY_BONUS;
    if (c.key === ruleKey) s += MIX_RULE_BONUS;
    return s;
  });
  const pick = candidates[softmaxIndex(scores, profile.temperature, draws.pick)] as EvCandidate;
  return { candidates, scores, defended, pick };
}

// ── The coach's hint extras (§8.9 Close, §8.10) ────────────────────────────────────────────────

const WHY_NOT: Readonly<Record<PlayerAction['type'], ReasonCode>> = {
  fold: 'WHY_NOT_FOLD',
  check: 'WHY_NOT_CHECK',
  call: 'WHY_NOT_CALL',
  bet: 'WHY_NOT_BET',
  raise: 'WHY_NOT_RAISE',
};
const GROUPS: readonly PlayerAction['type'][] = ['fold', 'check', 'call', 'bet', 'raise'];
const RULE_2_4_DRAWS: ReadonlySet<DrawKind> = new Set<DrawKind>([
  'flush',
  'nutFlush',
  'oesd',
  'doubleGutshot',
  'gutshot',
]);
/** "Above 8 outs" the trick guesses too high (§8.10). */
const RULE_2_4_BIG_OUTS = 8;

/**
 * The close alternative (§8.9: the top two candidate EVs within 3% of the pot): when the spot is
 * close and the recommendation is itself within 3% of the pot of the best EV, the best action of
 * another kind (fold, check, call, bet, raise) that is too. Null otherwise.
 */
export function closeAlternative(
  candidates: readonly EvCandidate[],
  action: PlayerAction,
  recEV: number,
  pot: number,
  conf: Decision['confidence'],
): EvCandidate | null {
  if (conf !== 'close') return null;
  const band = CLOSE_SPOT_POT * pot + 1e-9;
  const best = Math.max(...candidates.map((c) => c.ev));
  if (best - recEV > band) return null;
  let alt: EvCandidate | null = null;
  for (const c of candidates) {
    if (c.action.type === action.type || best - c.ev > band) continue;
    if (alt === null || c.ev > alt.ev) alt = c;
  }
  return alt;
}

/**
 * The hint's structured extras (§8.10 hint structure 3–5, Appendix F.1): RANGE_ADJUST when both
 * equities must be shown (`{eRandom}`, `{eRange}`), CLOSE_SPOT with the close alternative, one
 * WHY_NOT_* per other kind of legal action (its best candidate, its EV and what it loses against
 * the recommendation, and the hint's `{E}` and `{need}`), and the rule of 2 and 4 on a draw (exact
 * chances as fractions). Which lines are said, and how, is `explain.ts`'s business.
 */
function hintExtras(
  obs: Observation,
  f: Features,
  action: PlayerAction,
  candidates: readonly EvCandidate[],
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
  for (const group of GROUPS) {
    if (group === action.type || (alt !== null && group === alt.action.type)) continue;
    let best: EvCandidate | null = null;
    for (const c of candidates) {
      if (c.action.type === group && (best === null || c.ev > best.ev)) best = c;
    }
    if (best === null) continue;
    trace.push({
      code: WHY_NOT[group],
      data: { alt: best.key, ev: best.ev, loss: recEV - best.ev, E, need: f.need },
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
  const seen = perceive(f, profile, draws);
  const spot = f.street === 'preflop' ? null : postflopSpot(obs);
  const rule = ruleAction(obs, f, seen, profile, seed, draws, spot);
  const model = evModelOf(obs, f, seen.E, profile, seed, spot);

  let bot: BotPick | null = null;
  let proposed = rule.action;
  if (!profile.deterministic) {
    bot = botPick(obs, f, seen, profile, rule, draws, model);
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
  const conf = confidence(
    candidates.map((c) => c.ev),
    f.pot,
  );
  const ev: Decision['ev'] = {};
  for (const c of candidates) ev[c.key] = c.ev;

  let trace: Reason[];
  let alt: EvCandidate | null = null;
  if (bot === null) {
    alt = closeAlternative(candidates, action, recEV, f.pot, conf);
    trace = [
      ...rule.trace,
      ...guarded.trace,
      ...hintExtras(obs, f, action, candidates, recEV, alt),
    ];
  } else {
    // A bot's reasons explain A* only when it picked A* (they are never shown, §8.10).
    const pickedRule = bot.pick.key === candidateKey(obs.legal, rule.action);
    trace = [...(pickedRule ? rule.trace : []), ...guarded.trace];
  }

  const decision: Decision = {
    action,
    kind: kindOf(obs.legal, action),
    ev,
    eRandom: f.eRandom,
    eRange: f.eRange,
    need: f.need,
    bucket: f.bucket,
    strength: strengthOf(f.p),
    confidence: conf,
    alt: alt === null ? null : alt.action,
    trace,
  };
  return { decision, f, seen, rule, bot, fired: guarded.fired };
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

/** Appendix A.5 `grade(obs, taken, eRandom, decisionId)`: Stage 6 (§8.9, chunk 6.1). */
export const grade: (
  obs: Observation,
  taken: PlayerAction,
  eRandom: number | null,
  decisionId: number,
) => GradeResult = () => {
  throw new Error('grade: not available until Stage 6');
};
