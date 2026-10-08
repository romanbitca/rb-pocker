/**
 * The preflop policy (PLAN §8.3; short stacks §8.4, `pushfold.ts`): the rule action before the
 * flop, as a legal `PlayerAction` with reason codes (the brain never builds English, §8.10). The
 * EV model (§8.9) and the guardrails (§8.8) come after it in the pipeline (§8.2).
 *
 * Reads only the `Observation` and its §8.2 `Features` (⚠️ non-cheating, §9.6). The coach calls it
 * with the defaults (`COACH_PREFLOP_STYLE`, `rangeModel: 'reweight+stats'`); a bot passes its
 * profile's range model and the style drawn from its decision seed (`preflopStyle`, §9.4).
 *
 * The rules, `effBB > 12` (with `effBB ≤ 12` the §8.4 push/fold rules decide instead):
 * - **Unopened:** raise if `rankPct ≤ openPct(k)`, else fold (check when free).
 * - **Limpers only:** raise ("isolate") if `rankPct ≤ 0.7 × openPct(k)`; the big blind only below
 *   15% (heads-up 30%), else it checks. Otherwise fold (never an over-limp).
 * - **One raise:** `V = clamp(openPct(kV) × looseness(villain), 3, 100)`, `kV` = players behind the
 *   raiser when it raised; `E` = `eqVsRange` at `V`, or 1,500 weighted Monte Carlo trials against
 *   the raiser's and the callers' ranges when callers are in; `R` = 0.95 in position, 0.80 out of
 *   position, × 0.9 for gapped offsuit hands; set-mining `implied = 0.118 × 0.4 × effStackAfterCall`
 *   for pocket pairs; `EV(call) = E·R·(winPot + toCall) − toCall + implied`. 3-bet for value if
 *   `E ≥ 0.58`; else call if `EV(call) > 0` and (`rankPct ≤ min(50, 1.5·V)` or the big blind); else
 *   fold.
 * - **A 3-bet:** `V = max(3, 0.25 × the opener's range)`; 4-bet if `E ≥ 0.58`; call if `EV(call) > 0`
 *   and `rankPct ≤ 1.5·V`; else fold. **A 4-bet or more:** `V = 2.5`; all-in if `E ≥ 0.50`; call if
 *   `EV(call) > 0`; else fold.
 * - **An all-in** (any depth): call if `E ≥ need` against the shover's range (a push of ≤ 15 bb reads
 *   as `pushPct(kV, S)`, §8.6), else fold.
 * - **Sizes:** open 2.5 bb (3 bb from the small blind, 3+ handed) + 1 bb per limper; 3-bet 3 × the
 *   open in position, 4 × out of position, + 1 × the open per caller; 4-bet 2.3 × the 3-bet; all-in
 *   instead whenever the raise-to is ≥ 35% of the hero's chips. Amounts are rounded to the small
 *   blind and clamped to the legal bounds; with no legal raise the action becomes a call.
 *
 * Units in `Reason.data`: equities, `need` and `Pfold` are fractions in [0, 1]; `rankPct`,
 * `openPct`, `V` and `pushPct` are percents of the 1,326 combos; `to` and `bb` are chips (the text
 * shows `{size}` as "{to} ({to ÷ bb} BB)"); `hand` is the class name ("AKs", "66"); `behind` is `k`.
 */
import { classOf, className, rankOf, suitOf } from '../core/cards.ts';
import { deriveSeed, type Seed128 } from '../core/rng.ts';
import type { LegalActions, Observation, PlayerAction } from '../engine/types.ts';
import { coachSeed } from './features.ts';
import { observedSeatModel } from './opponentStats.ts';
import {
  callVsAllIn,
  pushFoldApplies,
  shoveVsRaise,
  unopenedPush,
  type PushFoldVerdict,
} from './pushfold.ts';
import { pushPct } from './pushFoldData.ts';
import { preflopOrder, rangeEquity, type RangeModel } from './ranges.ts';
import { equityVsTopOfClass } from './rangesData.ts';
import {
  ALLIN_VS_FOUR_BET_EQUITY,
  BB_ISOLATE_PCT,
  BB_ISOLATE_PCT_HEADS_UP,
  CALL_RANGE_CAP_PCT,
  CALL_RANGE_FACTOR,
  FOUR_BET_RANGE_PCT,
  FOUR_BET_SIZE,
  ISOLATE_FACTOR,
  OPEN_SIZE_BB,
  OPEN_SIZE_PER_LIMPER_BB,
  OPEN_SIZE_SB_BB,
  openPct,
  PREFLOP_GAP_MIN,
  PREFLOP_MULTIWAY_TRIALS,
  PREFLOP_R_GAPPED_OFFSUIT,
  PREFLOP_R_IP,
  PREFLOP_R_OOP,
  PRIOR_PUSH_MAX_BB,
  RERAISE_VALUE_EQUITY,
  SET_HIT_CHANCE,
  SET_MINING_MAX_PAIR_RANK,
  SET_PAYOFF_SHARE,
  SHOVE_INSTEAD_SHARE,
  THREE_BET_RANGE_SHARE,
  THREE_BET_SIZE_IP,
  THREE_BET_SIZE_OOP,
  THREE_BET_SIZE_PER_CALLER,
  VILLAIN_RANGE_MIN_PCT,
} from './tunables.ts';
import type {
  BrainProfile,
  Features,
  PreflopDecision,
  PreflopStyle,
  Reason,
  ReasonCode,
} from './types.ts';

/** The coach's preflop style: no noise, the thresholds as written, full position awareness. */
export const COACH_PREFLOP_STYLE: PreflopStyle = {
  equityNoise: 0,
  thresholdFactor: 1,
  positionAwareness: 1,
};

/**
 * A bot's preflop style (§9.4): `noise` is its N(0, σ) draw and `jitter` its U(−j, j) draw, taken
 * from its decision seed in that order by `decide()`. Every threshold X becomes
 * `X × looseness × (1 + jitter)` (capped at 100 where it is used).
 */
export function preflopStyle(
  profile: Pick<BrainProfile, 'looseness' | 'positionAwareness'>,
  draws: { noise: number; jitter: number },
): PreflopStyle {
  return {
    equityNoise: draws.noise,
    thresholdFactor: profile.looseness * (1 + draws.jitter),
    positionAwareness: profile.positionAwareness,
  };
}

export interface PreflopOptions {
  /** Default: `COACH_PREFLOP_STYLE`. */
  style?: PreflopStyle;
  /** The profile's range model (§9.2); default the coach's `'reweight+stats'`. */
  rangeModel?: RangeModel;
  /** Seed of the multiway Monte Carlo; default `deriveSeed(coachSeed(obs), 'preflop')`. */
  seed?: Seed128;
}

/** One preflop raise: who, the how-many-th, its raise-to, all-in, and the players behind it. */
export interface PreflopRaise {
  seat: number;
  level: number;
  to: number;
  allIn: boolean;
  k: number;
}

/** Every preflop raise in order; `k` counts the players after the raiser who could still act. */
export function preflopRaises(obs: Observation): PreflopRaise[] {
  const order = preflopOrder(obs);
  const position = new Map(order.map((seat, i) => [seat, i] as const));
  const out = new Set<number>();
  const raises: PreflopRaise[] = [];
  for (const a of obs.history) {
    if (a.street !== 'preflop') break;
    if (a.type === 'fold') out.add(a.seat);
    if (a.type === 'bet' || a.type === 'raise') {
      const at = position.get(a.seat) as number;
      const k = order.filter((t) => (position.get(t) as number) > at && !out.has(t)).length;
      raises.push({
        seat: a.seat,
        level: raises.length + 1,
        to: a.to as number,
        allIn: a.allIn,
        k,
      });
    }
    if (a.allIn) out.add(a.seat);
  }
  return raises;
}

/** What the rules read about the spot, beyond the features. */
interface Spot {
  obs: Observation;
  f: Features;
  style: PreflopStyle;
  rangeModel: RangeModel;
  seed: Seed128;
  cls: number;
  hand: string;
  pair: boolean;
  headsUp: boolean;
  isBB: boolean;
  isSB: boolean;
  /** Stack + this street's bet. */
  chips: number;
  /** Players who called the big blind before any raise. */
  limpers: number;
  raises: PreflopRaise[];
}

function readSpot(obs: Observation, f: Features, options: PreflopOptions): Spot {
  const [a, b] = obs.hole;
  let limpers = 0;
  for (const act of obs.history) {
    if (act.street !== 'preflop' || act.type === 'bet' || act.type === 'raise') break;
    if (act.type === 'call') limpers++;
  }
  const cls = classOf(a, b);
  return {
    obs,
    f,
    style: options.style ?? COACH_PREFLOP_STYLE,
    rangeModel: options.rangeModel ?? 'reweight+stats',
    seed: options.seed ?? deriveSeed(coachSeed(obs), 'preflop'),
    cls,
    hand: className(cls),
    pair: rankOf(a) === rankOf(b),
    headsUp: obs.dealtIn.filter(Boolean).length === 2,
    isBB: obs.seat === obs.bbSeat,
    isSB: obs.seat === obs.sbSeat,
    chips: (obs.stacks[obs.seat] as number) + (obs.streetBets[obs.seat] as number),
    limpers,
    raises: preflopRaises(obs),
  };
}

// ── Actions ────────────────────────────────────────────────────────────────────────────────────

type Built = Pick<PreflopDecision, 'action' | 'kind'>;

const FOLD: PlayerAction = { type: 'fold' };
const CHECK: PlayerAction = { type: 'check' };
const CALL: PlayerAction = { type: 'call' };

function checkOrFold(legal: LegalActions): Built {
  return legal.canCheck ? { action: CHECK, kind: 'check' } : { action: FOLD, kind: 'fold' };
}

function callOrCheck(legal: LegalActions): Built {
  if (legal.canCall) return { action: CALL, kind: 'call' };
  return { action: CHECK, kind: 'check' };
}

function allIn(legal: LegalActions): Built {
  if (legal.raise !== null) {
    return { action: { type: 'raise', to: legal.raise.max }, kind: 'allin' };
  }
  return callOrCheck(legal);
}

/**
 * A raise to `to` chips: all-in instead when `to` is at least 35% of the hero's chips; else
 * rounded to the small blind and clamped to the legal bounds (all-in at the top). With no legal
 * raise it becomes a call (or a check).
 */
function raiseTo(spot: Spot, to: number): Built {
  const { legal, sb } = spot.obs;
  if (legal.raise === null) return callOrCheck(legal);
  if (to >= SHOVE_INSTEAD_SHARE * spot.chips) return allIn(legal);
  const snapped = Math.round(to / sb + 1e-9) * sb; // a half rounds up, whatever the float noise
  const amount = Math.min(legal.raise.max, Math.max(legal.raise.min, snapped));
  if (amount >= legal.raise.max) return allIn(legal);
  return { action: { type: 'raise', to: amount }, kind: 'raise' };
}

const isRaise = (b: Built): boolean => b.kind === 'raise' || b.kind === 'allin';
const raisedTo = (b: Built): number => (b.action.type === 'raise' ? b.action.to : 0);

function decision(built: Built, code: ReasonCode, data: Reason['data']): PreflopDecision {
  return { ...built, trace: [{ code, data }] };
}

// ── Numbers ────────────────────────────────────────────────────────────────────────────────────

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** A "rankPct ≤ X" threshold with the profile's factor, capped at 100. */
const threshold = (spot: Spot, x: number): number => Math.min(100, x * spot.style.thresholdFactor);

/** `openPct(k)` blended with `openPct(4)` by the profile's position awareness (§9.2). */
function openRange(spot: Spot, k: number): number {
  const p = spot.style.positionAwareness;
  return p * openPct(k, spot.headsUp) + (1 - p) * openPct(4, false);
}

function looseness(spot: Spot, seat: number): number {
  return spot.rangeModel === 'reweight+stats' ? observedSeatModel(spot.obs, seat).looseness : 1;
}

/** The opener's range in percent: the hero's own threshold, or the raiser's §8.3 `V`. */
function openerPct(spot: Spot): number {
  const open = spot.raises[0] as PreflopRaise;
  if (open.seat === spot.obs.seat) return threshold(spot, openRange(spot, open.k));
  return Math.min(
    100,
    Math.max(VILLAIN_RANGE_MIN_PCT, openPct(open.k, spot.headsUp) * looseness(spot, open.seat)),
  );
}

/** The §8.3 range `V` (percent) of the player who made `raise`. */
function villainRange(spot: Spot, raise: PreflopRaise): number {
  if (spot.rangeModel === 'random') return 100;
  const bb = spot.obs.bb;
  if (raise.allIn && raise.to <= PRIOR_PUSH_MAX_BB * bb) {
    return Math.min(100, pushPct(raise.k, raise.to / bb) * looseness(spot, raise.seat));
  }
  if (raise.level === 1) {
    const v = openPct(raise.k, spot.headsUp) * looseness(spot, raise.seat);
    return Math.min(100, Math.max(VILLAIN_RANGE_MIN_PCT, v));
  }
  if (raise.level === 2)
    return Math.max(VILLAIN_RANGE_MIN_PCT, THREE_BET_RANGE_SHARE * openerPct(spot));
  return FOUR_BET_RANGE_PCT;
}

/** Live opponents other than the raiser who are in for the current bet or all-in (callers). */
function callersIn(spot: Spot, raiser: number): number[] {
  const { obs } = spot;
  const currentBet = (obs.streetBets[obs.seat] as number) + obs.legal.toCall;
  const voluntary = new Set(
    obs.history
      .filter(
        (a) =>
          a.street === 'preflop' && (a.type === 'call' || a.type === 'raise' || a.type === 'bet'),
      )
      .map((a) => a.seat),
  );
  return spot.f.ranges
    .map((r) => r.seat)
    .filter(
      (s) =>
        s !== raiser &&
        voluntary.has(s) &&
        ((obs.streetBets[s] as number) >= currentBet || obs.allIn[s] === true),
    );
}

/**
 * The hero's equity against the raiser: `eqVsRange` at `V`, or with callers in a weighted Monte
 * Carlo against the raiser's and the callers' ranges (§8.6) with 1,500 trials.
 */
function equityVs(spot: Spot, raiser: number, V: number): { E: number; multiway: boolean } {
  const callers = callersIn(spot, raiser);
  if (callers.length === 0) return { E: equityVsTopOfClass(spot.cls, V), multiway: false };
  const seats = new Set([raiser, ...callers]);
  const ranges = spot.f.ranges.filter((r) => seats.has(r.seat)).map((r) => r.weights);
  const E = rangeEquity({
    hole: spot.obs.hole,
    board: [],
    ranges,
    trials: PREFLOP_MULTIWAY_TRIALS,
    seed: spot.seed,
  });
  return { E, multiway: true };
}

/** §8.3 step 3: 0.95 in position, 0.80 out of position, × 0.9 for offsuit hands gapped ≥ 3. */
export function realisation(
  position: Features['position'],
  hole: readonly [number, number],
): number {
  const [a, b] = hole;
  const gapped =
    rankOf(a) !== rankOf(b) &&
    suitOf(a) !== suitOf(b) &&
    Math.abs(rankOf(a) - rankOf(b)) >= PREFLOP_GAP_MIN;
  return (
    (position === 'IP' ? PREFLOP_R_IP : PREFLOP_R_OOP) * (gapped ? PREFLOP_R_GAPPED_OFFSUIT : 1)
  );
}

// ── The rules ──────────────────────────────────────────────────────────────────────────────────

/** Open (or isolate) size: 2.5 bb, 3 bb from the small blind 3+ handed, + 1 bb per limper. */
function openSize(spot: Spot): number {
  const base = spot.isSB && !spot.headsUp ? OPEN_SIZE_SB_BB : OPEN_SIZE_BB;
  return (base + OPEN_SIZE_PER_LIMPER_BB * spot.limpers) * spot.obs.bb;
}

function sized(b: Built, bb: number): Reason['data'] {
  return isRaise(b) ? { to: raisedTo(b), bb } : {};
}

function unopened(spot: Spot): PreflopDecision {
  const { f, obs } = spot;
  const open = threshold(spot, openRange(spot, f.k));
  if (f.rankPct <= open) {
    const b = raiseTo(spot, openSize(spot));
    if (isRaise(b)) {
      return decision(b, 'OPEN_RANGE', {
        hand: spot.hand,
        rankPct: f.rankPct,
        behind: f.k,
        openPct: open,
        ...sized(b, obs.bb),
      });
    }
  }
  const b = checkOrFold(obs.legal);
  if (b.kind === 'check') return decision(b, 'CHECK_FREE', {});
  return decision(b, 'FOLD_RANGE', {
    hand: spot.hand,
    rankPct: f.rankPct,
    behind: f.k,
    openPct: open,
  });
}

function limped(spot: Spot): PreflopDecision {
  const { f, obs } = spot;
  const limit = spot.isBB
    ? threshold(spot, spot.headsUp ? BB_ISOLATE_PCT_HEADS_UP : BB_ISOLATE_PCT)
    : threshold(spot, ISOLATE_FACTOR * openRange(spot, f.k));
  if (f.rankPct <= limit) {
    const b = raiseTo(spot, openSize(spot));
    if (isRaise(b)) {
      return decision(b, 'ISOLATE', {
        hand: spot.hand,
        rankPct: f.rankPct,
        limpers: spot.limpers,
        ...sized(b, obs.bb),
      });
    }
  }
  const b = checkOrFold(obs.legal);
  if (b.kind === 'check') return decision(b, 'CHECK_FREE', {});
  return decision(b, 'FOLD_RANGE', {
    hand: spot.hand,
    rankPct: f.rankPct,
    behind: f.k,
    openPct: limit,
  });
}

/** Facing an open, a 3-bet or a 4-bet or more that is not all-in (§8.3). */
function facingRaise(spot: Spot): PreflopDecision {
  const { f, obs } = spot;
  const last = spot.raises[spot.raises.length - 1] as PreflopRaise;
  const V = villainRange(spot, last);
  const { E: e0 } = equityVs(spot, last.seat, V);
  const E = clamp01(e0 + spot.style.equityNoise);
  const R = realisation(f.position, obs.hole);
  const afterCall = Math.max(0, f.effStack - ((obs.streetBets[obs.seat] as number) + f.toCall));
  const implied = spot.pair ? SET_HIT_CHANCE * SET_PAYOFF_SHARE * afterCall : 0;
  const evCall = E * R * (f.winPot + f.toCall) - f.toCall + implied;
  const numbers = { hand: spot.hand, E, need: f.need, V, R, evCall };

  let valueRaise: Built | null = null;
  let valueCode: ReasonCode = 'THREE_BET_VALUE';
  let callOk: boolean;
  if (last.level === 1) {
    if (E >= RERAISE_VALUE_EQUITY) {
      const currentBet = (obs.streetBets[obs.seat] as number) + obs.legal.toCall;
      const callers = callersIn(spot, last.seat).length;
      const mult =
        (f.position === 'IP' ? THREE_BET_SIZE_IP : THREE_BET_SIZE_OOP) +
        THREE_BET_SIZE_PER_CALLER * callers;
      valueRaise = raiseTo(spot, mult * currentBet);
    }
    const cap = threshold(spot, Math.min(CALL_RANGE_CAP_PCT, CALL_RANGE_FACTOR * V));
    callOk = evCall > 0 && (f.rankPct <= cap || spot.isBB);
  } else if (last.level === 2) {
    valueCode = 'FOUR_BET_VALUE';
    if (E >= RERAISE_VALUE_EQUITY) {
      const currentBet = (obs.streetBets[obs.seat] as number) + obs.legal.toCall;
      valueRaise = raiseTo(spot, FOUR_BET_SIZE * currentBet);
    }
    callOk = evCall > 0 && f.rankPct <= threshold(spot, CALL_RANGE_FACTOR * V);
  } else {
    valueCode = 'FOUR_BET_VALUE';
    if (E >= ALLIN_VS_FOUR_BET_EQUITY) valueRaise = allIn(obs.legal);
    callOk = evCall > 0;
  }

  if (valueRaise !== null && isRaise(valueRaise)) {
    return decision(valueRaise, valueCode, { ...numbers, ...sized(valueRaise, obs.bb) });
  }
  if (valueRaise !== null || callOk) {
    const b = callOrCheck(obs.legal);
    const smallPair = spot.pair && rankOf(obs.hole[0]) <= SET_MINING_MAX_PAIR_RANK;
    const code: ReasonCode = smallPair && valueRaise === null ? 'SET_MINING' : 'CALL_PREFLOP';
    return decision(b, code, { ...numbers, implied });
  }
  return decision(checkOrFold(obs.legal), 'FOLD_VS_RAISE', numbers);
}

/** Facing an all-in raise, at any depth: call if E ≥ need against the shover's range. */
function facingAllIn(spot: Spot): PreflopDecision {
  const last = spot.raises[spot.raises.length - 1] as PreflopRaise;
  const V = villainRange(spot, last);
  const { E, multiway } = equityVs(spot, last.seat, V);
  const verdict = callVsAllIn({
    cls: spot.cls,
    E,
    need: spot.f.need,
    V: multiway ? null : V,
    equityNoise: spot.style.equityNoise,
  });
  return fromVerdict(spot, verdict);
}

function fromVerdict(spot: Spot, verdict: PushFoldVerdict): PreflopDecision {
  const { legal } = spot.obs;
  const built =
    verdict.move === 'allin'
      ? allIn(legal)
      : verdict.move === 'call'
        ? callOrCheck(legal)
        : checkOrFold(legal);
  if (built.kind === 'check' && verdict.move !== 'check') {
    return decision(built, 'CHECK_FREE', {});
  }
  return { ...built, trace: verdict.trace };
}

/** §8.4: push or fold with an effective stack of at most 12 big blinds. */
function shortStack(spot: Spot): PreflopDecision {
  const { f, obs } = spot;
  if (f.facing === 'none' || f.facing === 'limpers') {
    return fromVerdict(
      spot,
      unopenedPush({
        cls: spot.cls,
        rankPct: f.rankPct,
        k: f.k,
        effBB: f.effBB,
        limped: f.facing === 'limpers',
        canCheck: obs.legal.canCheck,
        thresholdFactor: spot.style.thresholdFactor,
      }),
    );
  }
  if (f.facing === 'allin') return facingAllIn(spot);
  const last = spot.raises[spot.raises.length - 1] as PreflopRaise;
  const hero = obs.seat;
  const heroBet = obs.streetBets[hero] as number;
  const raiserBet = obs.streetBets[last.seat] as number;
  const covered = Math.min(spot.chips, (obs.stacks[last.seat] as number) + raiserBet);
  return fromVerdict(
    spot,
    shoveVsRaise({
      cls: spot.cls,
      effBB: f.effBB,
      V: villainRange(spot, last),
      pot: f.pot,
      risk: covered - heroBet,
      finalPot: f.pot + (covered - heroBet) + (covered - raiserBet),
      equityNoise: spot.style.equityNoise,
    }),
  );
}

/**
 * The preflop rule action for the observer (§8.3–8.4): always legal for `obs.legal`, with the
 * reason codes that explain it. `f` must be `features(obs, …)` of the same observation.
 */
export function preflopPolicy(
  obs: Observation,
  f: Features,
  options: PreflopOptions = {},
): PreflopDecision {
  if (f.street !== 'preflop' || obs.street !== 'preflop') {
    throw new RangeError('preflopPolicy: the observation is not preflop');
  }
  const spot = readSpot(obs, f, options);
  if (pushFoldApplies(f)) return shortStack(spot);
  switch (f.facing) {
    case 'none':
      return unopened(spot);
    case 'limpers':
      return limped(spot);
    case 'allin':
      return facingAllIn(spot);
    default:
      return facingRaise(spot);
  }
}
