/**
 * The EV model (PLAN §8.9): chips from now, relative to folding (money already in the pot is
 * sunk; HEURISTIC). It scores the candidate actions of a decision (a hint's Close/Clear
 * confidence, a bot's softmax, §9.4) and, from Stage 6, grades the hero's action against the
 * recommendation: hint and grade read the same numbers.
 *
 * - `EV(fold) = 0`, `EV(check) = E·R·pot`.
 * - `EV(call) = E·R·(winPot + toCall) − toCall + implied` (§8.3, §8.5) with the §0.3 capped
 *   `winPot`: a short call wins only what it can match (Known pitfall 18).
 * - `EV(bet or raise to T) = FE·pot + (1 − FE)·(E_called·R·pot' − inv)`, `inv = T − heroStreetBet`,
 *   `pot' = pot + inv + (T − villainStreetBet)`. Each opponent continues with the top
 *   `c = clamp(MDF × stickiness, 0.15, 0.95)` of its weighted range, `MDF = pot / (pot + inv)`;
 *   `FE = Π (1 − c_i / √n)`; `E_called` = 800 weighted trials against only the continuing part
 *   of the range of the one caller that `pot'` counts (chunk 5.7, below).
 *
 * `E` is `eRange`. The realisation `R` and the implied odds come from the policy (§8.3 steps 3–4,
 * §8.5 steps 2–3), which owns those formulas.
 *
 * Readings where §8.9 is silent (PLAN §8.9, implementation notes of chunk 5.5):
 * - After an action that ends the hero's betting (the hero is all-in, or calls the all-in of the
 *   last opponent who could bet), `R = 1` and there are no implied odds, as §8.4 does for an
 *   all-in call: nobody can bet the hero off the hand any more.
 * - "The villain" of a bet is the opponent who can still act and has the most chips this street
 *   (street bet + stack); ties go to the larger street bet, then the lower seat. A bet larger than
 *   that villain can match is called only up to what it has; the rest comes back uncalled, so
 *   `inv`, `MDF` and `pot'` use the matched amount (the §0.3 idea, for bets).
 * - An opponent who is already all-in cannot fold: it keeps its whole range in `E_called`, and
 *   while one is live nothing is won uncontested (`FE = 0`). `n` counts the opponents who can act.
 * - `E_called` is against the villain's continuing range (and the all-in opponents' whole ranges)
 *   only, as `pot'` counts one call: when somebody calls, it is nearly always one player
 *   (chunk 5.7). Against every continuing range at once, an unopened open faced five calls in its
 *   equity but one in its pot, and the model rated A♠A♥'s open under the gun at break-even, so the
 *   bots (§9.4 step 3) folded or limped aces.
 * - "Top c of its weighted range": combos ordered by the §8.6 EHS proxy after the flop and by
 *   `rankPct` before it, strongest first (ties by combo index); the cut takes `c` of the range's
 *   total weight, and the combo on the edge keeps the part that fits.
 * - `stickiness` of an opponent: its personality's (§9.1) when the label is visible, else the mean
 *   over its level's personality list (the §9.5 prior); never the hidden personality itself.
 * - Each bet size seeds its own `E_called` trials from the decision seed and the amount, so the
 *   same size always gets the same EV, whether it is a candidate or the hero's own size.
 */
import { deriveSeed, type Seed128 } from '../core/rng.ts';
import type {
  BotLevel,
  LegalActions,
  Observation,
  PersonalityId,
  PlayerAction,
} from '../engine/types.ts';
import { isLegalAction, snapToLegal } from './guardrails.ts';
import {
  COMBO_CLASS,
  COMBOS,
  handStrengths,
  RANGE_TABLES,
  rangeEquity,
  type OpponentRange,
  type RangeTables,
} from './ranges.ts';
import {
  CLEAR_SPOT_POT,
  CLOSE_SPOT_POT,
  CONTINUE_MAX,
  CONTINUE_MIN,
  E_CALLED_TRIALS,
  EV_BET_FRACTIONS,
  EV_OPEN_BB,
  EV_OPEN_PER_LIMPER_BB,
  EV_RAISE_MULTIPLES,
  LEVEL_PERSONALITIES,
  PERSONALITIES,
} from './tunables.ts';
import type { CandidateKey, Decision, EvCandidate, Features } from './types.ts';

// ── The formulas ───────────────────────────────────────────────────────────────────────────────

/** `EV(fold) = 0`: every EV is measured against folding. */
export function evFold(): number {
  return 0;
}

/** `EV(check) = E·R·pot`. */
export function evCheck(E: number, R: number, pot: number): number {
  return E * R * pot;
}

/** `EV(call) = E·R·(winPot + toCall) − toCall + implied` (`winPot`: §0.3, the pot the hero can win). */
export function evCall(E: number, R: number, winPot: number, toCall: number, implied = 0): number {
  return E * R * (winPot + toCall) - toCall + implied;
}

/** Minimum defence frequency against a bet of `inv` into `pot`: `pot / (pot + inv)`. */
export function mdf(pot: number, inv: number): number {
  return pot / (pot + inv);
}

/** The share of its range an opponent continues with: `clamp(MDF × stickiness, 0.15, 0.95)`. */
export function continueFraction(pot: number, inv: number, stickiness: number): number {
  return Math.min(CONTINUE_MAX, Math.max(CONTINUE_MIN, mdf(pot, inv) * stickiness));
}

/**
 * The chance that every opponent folds, `Π (1 − c_i / √n)` over the `n` opponents who can act
 * (HEURISTIC); 1 with no one left to fold (an empty product).
 */
export function foldEquity(continueFractions: readonly number[]): number {
  const root = Math.sqrt(continueFractions.length);
  return continueFractions.reduce((fe, c) => fe * (1 - c / root), 1);
}

/** What a bet or raise puts in play, for `evBetOrRaise`. */
export interface BetOutcome {
  /** The pot before the action. */
  pot: number;
  /** The hero's chips that a call would match (`inv`). */
  heroIn: number;
  /** The chips the villain adds when it calls. */
  callIn: number;
  /** The chance that every opponent folds. */
  FE: number;
  /** The hero's equity against the continuing ranges. */
  eCalled: number;
  R: number;
}

/** `EV = FE·pot + (1 − FE)·(E_called·R·pot' − inv)`, `pot' = pot + inv + callIn`. */
export function evBetOrRaise(o: BetOutcome): number {
  return o.FE * o.pot + (1 - o.FE) * (o.eCalled * o.R * (o.pot + o.heroIn + o.callIn) - o.heroIn);
}

/**
 * The top `c` (a share of the total weight) of a weighted range, walking `order` (strongest
 * first, only combos with weight); the combo on the edge keeps the part of its weight that fits.
 */
export function continuingWeights(
  weights: Float64Array,
  order: readonly number[],
  c: number,
): Float64Array {
  let total = 0;
  for (const i of order) total += weights[i] as number;
  const out = new Float64Array(COMBOS);
  let left = c * total;
  for (const i of order) {
    if (left <= 0) break;
    const take = Math.min(weights[i] as number, left);
    out[i] = take;
    left -= take;
  }
  return out;
}

/**
 * §9.1 `stickiness` of a seat as the observer can know it: its personality's when the label is
 * visible, else the mean over its level's personality list (as the §9.5 prior).
 */
export function seatStickiness(obs: Observation, seat: number): number {
  const label = obs.visiblePersonality[seat] as PersonalityId | null;
  if (label !== null) return PERSONALITIES[label].stickiness;
  const list = LEVEL_PERSONALITIES[obs.seatLevels[seat] as BotLevel];
  return list.reduce((sum, id) => sum + PERSONALITIES[id].stickiness, 0) / list.length;
}

// ── Candidates ─────────────────────────────────────────────────────────────────────────────────

/** §8.9 key of a legal action: a bet or raise to the maximum is `allin`. */
export function candidateKey(legal: LegalActions, action: PlayerAction): CandidateKey {
  if (action.type === 'bet' || action.type === 'raise') {
    return action.to === legal[action.type]?.max ? 'allin' : `${action.type}:${action.to}`;
  }
  return action.type;
}

/**
 * The §8.9 candidate actions of the observer, with duplicates removed: fold (if legal); check or
 * call; after the flop bets of 1/3, 1/2, 2/3, 3/4 and 1 pot and all-in; raises to the minimum,
 * 2.5×, 3× and 4× the bet and all-in; before the flop, while nobody has raised, opens to 2.5, 3
 * and 4 bb (+1 bb per limper) and all-in instead. A computed size is rounded to a multiple of the
 * small blind (§8.7), then snapped to legal (rule 5: clamped, or a call at the call level or
 * below); the minimum and all-in come from the legal bounds as they are.
 */
export function candidateActions(obs: Observation): { key: CandidateKey; action: PlayerAction }[] {
  const { legal, pot, bb, sb } = obs;
  const streetBet = obs.streetBets[obs.seat] as number;
  const sized = (to: number): number => Math.round(to / sb) * sb;
  const raw: PlayerAction[] = [];
  if (legal.canFold) raw.push({ type: 'fold' });
  raw.push(legal.canCheck ? { type: 'check' } : { type: 'call' });
  if (legal.bet !== null) {
    for (const f of EV_BET_FRACTIONS) raw.push({ type: 'bet', to: sized(f * pot) });
    raw.push({ type: 'bet', to: legal.bet.max });
  }
  if (legal.raise !== null) {
    // Before the flop every aggressive action is a raise (the big blind is the first bet).
    const preflop = obs.history.filter((a) => a.street === 'preflop');
    if (obs.street === 'preflop' && !preflop.some((a) => a.type === 'raise')) {
      const limpers = preflop.filter((a) => a.type === 'call').length;
      for (const x of EV_OPEN_BB) {
        raw.push({ type: 'raise', to: sized((x + EV_OPEN_PER_LIMPER_BB * limpers) * bb) });
      }
    } else {
      const currentBet = streetBet + legal.toCall;
      raw.push({ type: 'raise', to: legal.raise.min });
      for (const m of EV_RAISE_MULTIPLES) raw.push({ type: 'raise', to: sized(m * currentBet) });
    }
    raw.push({ type: 'raise', to: legal.raise.max });
  }
  const spot = { legal, sb: obs.sb, streetBet };
  const seen = new Set<CandidateKey>();
  const out: { key: CandidateKey; action: PlayerAction }[] = [];
  for (const a of raw) {
    const action = snapToLegal(spot, a);
    const key = candidateKey(legal, action);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, action });
  }
  return out;
}

/**
 * §8.9 confidence from the candidate EVs: Close when the top two are within 3% of the pot, Clear
 * when they are more than 10% apart, else Normal (one candidate alone is Clear).
 */
export function confidence(evs: readonly number[], pot: number): Decision['confidence'] {
  if (evs.length < 2) return 'clear';
  const [best, second] = [...evs].sort((a, b) => b - a) as [number, number];
  const gap = best - second;
  if (gap <= CLOSE_SPOT_POT * pot + 1e-9) return 'close';
  return gap > CLEAR_SPOT_POT * pot ? 'clear' : 'normal';
}

// ── The model of one decision ──────────────────────────────────────────────────────────────────

export interface EvSpot {
  obs: Observation;
  /** The decision's §8.2 features: the pot, the price and the ranges behind `eRange`. */
  f: Pick<Features, 'pot' | 'toCall' | 'winPot' | 'eRange' | 'ranges'>;
  /** Realisation of the hero's equity on this street (§8.3 step 3, §8.5 step 2). */
  R: number;
  /** Implied odds of a call in chips (§8.3 step 4, §8.5 step 3); 0 when there are none. */
  implied: number;
  /** Seeds the `E_called` trials (the coach: `coachSeed(obs)`; a bot: its decision seed). */
  seed: Seed128;
  /** `E_called` trials, `E_CALLED_TRIALS` by default (§8.11 may lower it). */
  trials?: number;
  /** The strength order before the flop: the build-time tables by default. */
  tables?: RangeTables;
  /** Each seat's stickiness: `seatStickiness` by default. */
  stickiness?: (seat: number) => number;
}

export interface EvModel {
  /** EV of a legal action of the hero, in chips relative to folding (throws on an illegal one). */
  ev(action: PlayerAction): number;
  /** The §8.9 candidates with their EVs, in `candidateActions` order. */
  candidates(): EvCandidate[];
}

/**
 * The EV model of one decision. Strength orders and hand strengths are computed once, when a bet
 * or raise first needs them; every EV is deterministic for the same spot.
 */
export function evModel(spot: EvSpot): EvModel {
  const { obs, f } = spot;
  const { legal } = obs;
  const hero = obs.seat;
  const heroStreet = obs.streetBets[hero] as number;
  const heroMax = heroStreet + (obs.stacks[hero] as number);
  const allInSeat = (r: OpponentRange): boolean => obs.allIn[r.seat] === true;
  const responders = f.ranges.filter((r) => !allInSeat(r));
  const anyAllIn = responders.length < f.ranges.length;
  const stickiness = spot.stickiness ?? ((seat: number) => seatStickiness(obs, seat));
  const trials = spot.trials ?? E_CALLED_TRIALS;
  const chips = (seat: number): number =>
    (obs.streetBets[seat] as number) + (obs.stacks[seat] as number);
  const villain = responders.reduce<OpponentRange | null>((best, r) => {
    if (best === null) return r;
    const d = chips(r.seat) - chips(best.seat);
    const s = (obs.streetBets[r.seat] as number) - (obs.streetBets[best.seat] as number);
    return d > 0 || (d === 0 && s > 0) ? r : best;
  }, null);

  let strength: ((i: number) => number) | null = null;
  const orders = new Map<number, number[]>();
  const orderOf = (r: OpponentRange): number[] => {
    let order = orders.get(r.seat);
    if (order === undefined) {
      strength ??= strengthOf(obs, spot.tables ?? RANGE_TABLES);
      const by = strength;
      order = [];
      for (let i = 0; i < COMBOS; i++) if ((r.weights[i] as number) > 0) order.push(i);
      order.sort((a, b) => by(b) - by(a) || a - b);
      orders.set(r.seat, order);
    }
    return order;
  };

  const betEV = (to: number): number => {
    if (villain === null) throw new RangeError('evModel: a bet needs an opponent who can act');
    const villainMax = chips(villain.seat);
    const matched = Math.min(to, villainMax);
    const heroIn = matched - heroStreet;
    const callIn = matched - (obs.streetBets[villain.seat] as number);
    const cs = responders.map((r) => continueFraction(f.pot, heroIn, stickiness(r.seat)));
    const FE = anyAllIn ? 0 : foldEquity(cs);
    // One caller, as pot′ counts it: the villain's continuing range, plus the whole range of every
    // all-in opponent (in the pot, it cannot fold); the others have folded (chunk 5.7, PLAN §8.9).
    const ranges: Float64Array[] = [];
    for (const r of f.ranges) {
      if (allInSeat(r)) ranges.push(r.weights);
      else if (r === villain) {
        const c = cs[responders.indexOf(r)] as number;
        ranges.push(continuingWeights(r.weights, orderOf(r), c));
      }
    }
    const eCalled = rangeEquity({
      hole: obs.hole,
      board: obs.board,
      ranges,
      trials,
      seed: deriveSeed(spot.seed, 'ev-called', to),
    });
    const ends = to === heroMax || (responders.length === 1 && villainMax <= to);
    return evBetOrRaise({ pot: f.pot, heroIn, callIn, FE, eCalled, R: ends ? 1 : spot.R });
  };

  const ev = (action: PlayerAction): number => {
    if (!isLegalAction(legal, action)) {
      throw new RangeError(`evModel: not a legal action now: ${JSON.stringify(action)}`);
    }
    switch (action.type) {
      case 'fold':
        return evFold();
      case 'check':
        return evCheck(f.eRange, spot.R, f.pot);
      case 'call': {
        const ends = legal.callIsAllIn || responders.length === 0;
        return ends
          ? evCall(f.eRange, 1, f.winPot, f.toCall)
          : evCall(f.eRange, spot.R, f.winPot, f.toCall, spot.implied);
      }
      case 'bet':
      case 'raise':
        return betEV(action.to);
    }
  };

  return {
    ev,
    candidates: () =>
      candidateActions(obs).map(({ key, action }) => ({ key, action, ev: ev(action) })),
  };
}

/** The strength of each combo for "the top c of a range": EHS after the flop, rankPct before. */
function strengthOf(obs: Observation, tables: RangeTables): (i: number) => number {
  if (obs.board.length === 0) {
    return (i) => -tables.rankPctOfClass(COMBO_CLASS[i] as number);
  }
  const dead = new Uint8Array(52);
  for (const c of obs.hole) dead[c] = 1;
  for (const h of obs.revealedHoles) if (h !== null) for (const c of h) dead[c] = 1;
  const ehs = handStrengths(obs.board, dead);
  return (i) => ehs[i] as number;
}

/** The §8.9 candidates of a decision with their EVs (`evModel(spot).candidates()`). */
export function candidateEVs(spot: EvSpot): EvCandidate[] {
  return evModel(spot).candidates();
}

/** The EV of one legal action, the hero's own size included (`evModel(spot).ev(action)`). */
export function actionEV(spot: EvSpot, action: PlayerAction): number {
  return evModel(spot).ev(action);
}
