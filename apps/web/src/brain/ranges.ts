/**
 * Opponent ranges (PLAN §8.6): 1,326 combo weights per live opponent, rebuilt from the public
 * history on every call (stateless, so undo and resume need nothing), and the range-weighted
 * equity `eRange` (§8.2) sampled from them.
 *
 * ⚠️ Non-cheating (§9.6): every input is the `Observation` (or cards taken from it). Nothing here
 * can see a hidden card; tests permute the hidden cards through `observe()` and require identical
 * results.
 *
 * The model, by `BrainProfile.rangeModel` (§9.2):
 * - `random`: every unblocked combo weighs 1 (Easy bots).
 * - `static`: the preflop prior with looseness 1, no postflop narrowing (Medium bots).
 * - `reweight`: the prior with looseness 1, then Loki re-weighting after every postflop action.
 * - `reweight+stats` (the coach): looseness from the seat's statistics, and the bet/raise μ moved
 *   by its observed aggression.
 *
 * Preflop prior (§8.6 table), "top X%" of the build-time `rankPct` order × looseness (cap 100):
 * a seat that raised preflop is read by its LAST raise (open, 3-bet, 4-bet+, or a push when that
 * raise was all-in for at most 15 bb); a seat that never raised by its first voluntary action
 * (limp or call a limp, call a raise, the big blind checking its option); a seat with no action
 * yet is 100%. Soft edge: weight 1 up to X, linearly down to 0.01 at 1.25·X, 0.01 beyond (the 0.01
 * floor: no hand is ever impossible). Blocked combos (a card the observer can see) weigh 0.
 */
import { classOf, type Card } from '../core/cards.ts';
import { randInt, rngFromSeed, type Seed128 } from '../core/rng.ts';
import { score7 } from '../eval/evaluate.ts';
import * as evalTables from '../eval/tables.ts';
import type { Observation, PublicAction, Street } from '../engine/types.ts';
import { observedSeatModel } from './opponentStats.ts';
import {
  AF_HIGH,
  AF_LOW,
  AF_MU_SHIFT,
  CHECK_STRONG_EHS,
  CHECK_STRONG_WEIGHT,
  DRAW_BONUS_FLUSH,
  DRAW_BONUS_GUTSHOT,
  DRAW_BONUS_OPEN_ENDED,
  DRAW_BONUS_TURN_FACTOR,
  LOKI_BET_MU_BASE,
  LOKI_BET_MU_SLOPE,
  LOKI_CALL_MU,
  LOKI_SIGMA,
  MIN_WEIGHT,
  openPct,
  PRIOR_BB_CHECK_TRAP_PCT,
  PRIOR_CALL_PCT,
  PRIOR_CALL_TRAP_PCT,
  PRIOR_FOUR_BET_PCT,
  PRIOR_LIMP_PCT,
  PRIOR_PUSH_MAX_BB,
  PRIOR_THREE_BET_PCT,
  PRIOR_TRAP_WEIGHT,
  SAMPLE_MAX_COLLISIONS,
  SOFT_EDGE,
  WEIGHT_UNDERFLOW_FLOOR,
} from './tunables.ts';
import type { BrainProfile } from './types.ts';

// Module-local table reference: see the note in eval/evaluate.ts.
const STRAIGHT_HIGH = evalTables.STRAIGHT_HIGH;

// ── Combos ─────────────────────────────────────────────────────────────────────────────────────

/** Two-card combos: C(52, 2). */
export const COMBOS = 1326;
/** The lower card of each combo (combos run a = 0..50, b = a+1..51). */
export const COMBO_LO = new Uint8Array(COMBOS);
/** The higher card of each combo. */
export const COMBO_HI = new Uint8Array(COMBOS);
/** The starting-hand class of each combo (`classOf`). */
export const COMBO_CLASS = new Uint8Array(COMBOS);
const COMBO_OF = new Int16Array(52 * 52).fill(-1);

{
  let i = 0;
  for (let a = 0; a < 52; a++) {
    for (let b = a + 1; b < 52; b++) {
      COMBO_LO[i] = a;
      COMBO_HI[i] = b;
      COMBO_CLASS[i] = classOf(a, b);
      COMBO_OF[a * 52 + b] = i;
      COMBO_OF[b * 52 + a] = i;
      i++;
    }
  }
}

/** The combo index of two different cards, in either order. */
export function comboIndex(a: Card, b: Card): number {
  const i = a >= 0 && a < 52 && b >= 0 && b < 52 ? (COMBO_OF[a * 52 + b] as number) : -1;
  if (i < 0) throw new RangeError(`comboIndex: not two different cards: ${a}, ${b}`);
  return i;
}

// ── Inputs ─────────────────────────────────────────────────────────────────────────────────────

/** The build-time tables the model reads (§8.3–8.4, `scripts/gen-ranges.ts`, `gen-pushfold.ts`). */
export interface RangeTables {
  /** Percent of all combos ranking at least as well as the class (AA ≈ 0.45, the worst 100). */
  rankPctOfClass(cls: number): number;
  /** Percent of all combos pushed with `k` players behind and `effBB` big blinds (clamped). */
  pushPct(k: number, effBB: number): number;
}

export type RangeModel = BrainProfile['rangeModel'];

/** How a seat's preflop prior was chosen (§8.6 table rows). */
export type PriorKind =
  'open' | 'limp' | 'call' | 'threeBet' | 'fourBet' | 'push' | 'bbCheck' | 'none';

/** What a seat's preflop actions say about its range. */
export interface PreflopRead {
  kind: PriorKind;
  /** Players still to act behind the seat when it made the raise it is read by (0 otherwise). */
  k: number;
  /** A push: its size in big blinds (the all-in raise-to amount ÷ bb); null otherwise. */
  pushBB: number | null;
}

export interface OpponentRange {
  seat: number;
  /** `random` = every combo alike; `known` = the hand is face up. */
  prior: PriorKind | 'random' | 'known';
  /** X of "top X%" after looseness (100 when the prior keeps every hand). */
  topPct: number;
  /** The looseness applied (1 unless the model reads seat statistics). */
  looseness: number;
  /** The estimated AF that moved the bet/raise μ, or null when the model reads no statistics. */
  af: number | null;
  /** 1,326 weights (combo order above): blocked combos 0, the largest 1, every other one > 0. */
  weights: Float64Array;
}

// ── Seats and order ────────────────────────────────────────────────────────────────────────────

/** Dealt-in seats in preflop order: from the first seat after the big blind, the big blind last. */
export function preflopOrder(obs: Observation): number[] {
  const n = obs.dealtIn.length;
  const order: number[] = [];
  for (let d = 1; d <= n; d++) {
    const seat = (obs.bbSeat + d) % n;
    if (obs.dealtIn[seat] === true) order.push(seat);
  }
  return order;
}

/** Live opponents of the observer (dealt in, not folded), in seat order. */
export function liveOpponents(obs: Observation): number[] {
  const seats: number[] = [];
  for (let s = 0; s < obs.dealtIn.length; s++) {
    if (s !== obs.seat && obs.dealtIn[s] === true && obs.folded[s] !== true) seats.push(s);
  }
  return seats;
}

/**
 * Each dealt-in seat's preflop read (null for seats not dealt in), from the preflop history:
 * the last raise of a seat that raised, else its first voluntary action (§8.6).
 */
export function preflopReads(obs: Observation): (PreflopRead | null)[] {
  const n = obs.dealtIn.length;
  const order = preflopOrder(obs);
  const position = new Array<number>(n).fill(-1);
  order.forEach((seat, i) => (position[seat] = i));
  const folded = new Array<boolean>(n).fill(false);
  const allIn = new Array<boolean>(n).fill(false);
  const lastRaise: ({ level: number; k: number; allIn: boolean; to: number } | null)[] = new Array(
    n,
  ).fill(null);
  const first: ('limp' | 'call' | 'bbCheck' | null)[] = new Array(n).fill(null);
  let raises = 0;

  // Players still able to act after `seat` in preflop order.
  const behind = (seat: number): number =>
    order.filter(
      (t) => (position[t] as number) > (position[seat] as number) && !folded[t] && !allIn[t],
    ).length;

  for (const a of obs.history) {
    if (a.street !== 'preflop') break;
    if (a.type === 'fold') folded[a.seat] = true;
    else if (a.type === 'check') first[a.seat] ??= 'bbCheck';
    else if (a.type === 'call') first[a.seat] ??= raises === 0 ? 'limp' : 'call';
    else if (a.type === 'bet' || a.type === 'raise') {
      raises++;
      lastRaise[a.seat] = { level: raises, k: behind(a.seat), allIn: a.allIn, to: a.to as number };
    }
    if (a.allIn) allIn[a.seat] = true;
  }

  return obs.dealtIn.map((dealt, seat) => {
    if (!dealt) return null;
    const r = lastRaise[seat] as { level: number; k: number; allIn: boolean; to: number } | null;
    if (r !== null) {
      if (r.allIn && r.to <= PRIOR_PUSH_MAX_BB * obs.bb) {
        return { kind: 'push', k: r.k, pushBB: r.to / obs.bb };
      }
      const kind = r.level === 1 ? 'open' : r.level === 2 ? 'threeBet' : 'fourBet';
      return { kind, k: r.k, pushBB: null };
    }
    const f = first[seat];
    const kind: PriorKind =
      f === 'limp' ? 'limp' : f === 'call' ? 'call' : f === 'bbCheck' ? 'bbCheck' : 'none';
    return { kind, k: 0, pushBB: null };
  });
}

/** X of "top X%" for a read (§8.6 table), before the 100% cap. */
function readPct(read: PreflopRead, headsUp: boolean, looseness: number, t: RangeTables): number {
  switch (read.kind) {
    case 'open':
      return openPct(read.k, headsUp) * looseness;
    case 'limp':
      return PRIOR_LIMP_PCT * looseness;
    case 'call':
      return PRIOR_CALL_PCT * looseness;
    case 'threeBet':
      return PRIOR_THREE_BET_PCT * looseness;
    case 'fourBet':
      return PRIOR_FOUR_BET_PCT * looseness;
    case 'push':
      return t.pushPct(read.k, read.pushBB as number) * looseness;
    default: // bbCheck, none
      return 100;
  }
}

/** The "would have raised" band of a read: its top hands get `PRIOR_TRAP_WEIGHT`. */
function trapPct(kind: PriorKind): number {
  return kind === 'call' ? PRIOR_CALL_TRAP_PCT : kind === 'bbCheck' ? PRIOR_BB_CHECK_TRAP_PCT : 0;
}

/** Soft-edged membership of a class at percentile `rp` in the top `x`% (§8.6). */
export function softEdge(rp: number, x: number): number {
  if (rp <= x) return 1;
  const end = SOFT_EDGE * x;
  if (rp >= end) return MIN_WEIGHT;
  return 1 - ((1 - MIN_WEIGHT) * (rp - x)) / (end - x);
}

/** Class weights of "top `x`%" with a trap band of the top `trap`%. */
export function priorClassWeights(x: number, trap: number, tables: RangeTables): Float64Array {
  const w = new Float64Array(169);
  for (let cls = 0; cls < 169; cls++) {
    const rp = tables.rankPctOfClass(cls);
    w[cls] = rp <= trap ? PRIOR_TRAP_WEIGHT : softEdge(rp, x);
  }
  return w;
}

// ── Hand strength on a board (EHS proxy) ───────────────────────────────────────────────────────

/** The draw bonus of a combo on a flop or turn board (before the turn halving). */
function drawBonus(a: Card, b: Card, suitCount: Int8Array, boardRanks: number): number {
  let bonus = 0;
  const sa = a & 3;
  const sb = b & 3;
  const inA = (suitCount[sa] as number) + 1 + (sb === sa ? 1 : 0);
  const inB = sb === sa ? inA : (suitCount[sb] as number) + 1;
  if ((inA === 4 || inB === 4) && inA < 5 && inB < 5 && maxSuit(suitCount) < 5) {
    bonus += DRAW_BONUS_FLUSH;
  }
  const present = boardRanks | (1 << (a >> 2)) | (1 << (b >> 2));
  if ((STRAIGHT_HIGH[present] as number) < 0) {
    let ranks = 0;
    for (let r = 0; r < 13; r++) {
      const bit = 1 << r;
      if ((present & bit) !== 0) continue;
      const high = STRAIGHT_HIGH[present | bit] as number;
      if (high >= 0 && (STRAIGHT_HIGH[boardRanks | bit] as number) < high) ranks++;
    }
    if (ranks >= 2) bonus += DRAW_BONUS_OPEN_ENDED;
    else if (ranks === 1) bonus += DRAW_BONUS_GUTSHOT;
  }
  return bonus;
}

function maxSuit(suitCount: Int8Array): number {
  return Math.max(
    suitCount[0] as number,
    suitCount[1] as number,
    suitCount[2] as number,
    suitCount[3] as number,
  );
}

/**
 * EHS proxy of every combo on `board` (3, 4 or 5 cards), §8.6: `HS` = the percentile of the
 * combo's hand among all combos that use neither a board card nor a `dead` card (ties count half:
 * `(below + (equal − 1) / 2) / (N − 1)`), plus the draw bonus (flush draw +0.15, open-ended or
 * double gutshot +0.12, gutshot +0.06 on the flop, half on the turn, none on the river).
 * Combos outside that population get −1.
 */
export function handStrengths(board: readonly Card[], dead: Uint8Array): Float64Array {
  const ehs = new Float64Array(COMBOS).fill(-1);
  const blocked = Uint8Array.from(dead);
  for (const c of board) blocked[c] = 1;
  const cards = [0, 0, ...board];
  const scores = new Int32Array(COMBOS);
  const population: number[] = [];
  for (let i = 0; i < COMBOS; i++) {
    const a = COMBO_LO[i] as number;
    const b = COMBO_HI[i] as number;
    if (blocked[a] === 1 || blocked[b] === 1) continue;
    cards[0] = a;
    cards[1] = b;
    scores[i] = score7(cards, cards.length);
    population.push(i);
  }
  population.sort((x, y) => (scores[x] as number) - (scores[y] as number));
  const n = population.length;
  for (let i = 0; i < n;) {
    const s = scores[population[i] as number] as number;
    let j = i;
    while (j < n && scores[population[j] as number] === s) j++;
    const hs = n > 1 ? (i + (j - i - 1) / 2) / (n - 1) : 1;
    for (let t = i; t < j; t++) ehs[population[t] as number] = hs;
    i = j;
  }
  if (board.length < 5) {
    const factor = board.length === 3 ? 1 : DRAW_BONUS_TURN_FACTOR;
    const suitCount = new Int8Array(4);
    let boardRanks = 0;
    for (const c of board) {
      suitCount[c & 3] = (suitCount[c & 3] as number) + 1;
      boardRanks |= 1 << (c >> 2);
    }
    for (const i of population) {
      const bonus = drawBonus(COMBO_LO[i] as number, COMBO_HI[i] as number, suitCount, boardRanks);
      ehs[i] = (ehs[i] as number) + factor * bonus;
    }
  }
  return ehs;
}

// ── Loki re-weighting ──────────────────────────────────────────────────────────────────────────

/** `clamp((EHS − μ + σ) / (2σ), 0.01, 1)`. */
export function lokiFactor(ehs: number, mu: number, sigma: number): number {
  return Math.min(1, Math.max(MIN_WEIGHT, (ehs - mu + sigma) / (2 * sigma)));
}

/** μ of a bet or raise that puts `amountIn` into `potBefore` (§8.6), plus the AF shift. */
export function betMu(amountIn: number, potBefore: number, afShift: number): number {
  const size = potBefore > 0 ? Math.min(amountIn / potBefore, 1) : 1;
  return LOKI_BET_MU_BASE + LOKI_BET_MU_SLOPE * size + afShift;
}

/** Observed aggression: AF > 3 → μ − 0.08, AF < 1 → μ + 0.08 (bets and raises only). */
export function afShift(af: number | null): number {
  if (af === null) return 0;
  return af > AF_HIGH ? -AF_MU_SHIFT : af < AF_LOW ? AF_MU_SHIFT : 0;
}

/** The weight factor of one postflop action for a combo with this EHS (1 for folds). */
export function actionFactor(a: PublicAction, ehs: number, shift: number): number {
  switch (a.type) {
    case 'bet':
    case 'raise':
      return lokiFactor(ehs, betMu(a.amountIn, a.potBefore, shift), LOKI_SIGMA);
    case 'call':
      return lokiFactor(ehs, LOKI_CALL_MU, LOKI_SIGMA);
    case 'check':
      return ehs > CHECK_STRONG_EHS ? CHECK_STRONG_WEIGHT : 1;
    default:
      return 1;
  }
}

/** Scales the weights so the largest is 1 and keeps every unblocked one above the floor. */
function normalise(w: Float64Array, blocked: Uint8Array): void {
  let max = 0;
  for (let i = 0; i < COMBOS; i++) {
    if (blocked[COMBO_LO[i] as number] === 1 || blocked[COMBO_HI[i] as number] === 1) w[i] = 0;
    else if ((w[i] as number) > max) max = w[i] as number;
  }
  for (let i = 0; i < COMBOS; i++) {
    const wi = w[i] as number;
    if (wi > 0) w[i] = Math.max(WEIGHT_UNDERFLOW_FLOOR, wi / max);
  }
}

const POSTFLOP: readonly [Street, number][] = [
  ['flop', 3],
  ['turn', 4],
  ['river', 5],
];

// ── The ranges ─────────────────────────────────────────────────────────────────────────────────

/** Cards the observer can see: its own hole cards, the board and every face-up hand. */
export function visibleCards(obs: Observation): Uint8Array {
  const seen = new Uint8Array(52);
  for (const c of obs.hole) seen[c] = 1;
  for (const c of obs.board) seen[c] = 1;
  for (const h of obs.revealedHoles) if (h !== null) for (const c of h) seen[c] = 1;
  return seen;
}

/**
 * Every live opponent's range as the observer estimates it (§8.6), in seat order. Only public
 * facts are read: the history, the board, the observer's own cards, face-up hands, and the seat
 * statistics, labels and levels in the observation.
 */
export function opponentRanges(
  obs: Observation,
  model: RangeModel,
  tables: RangeTables,
): OpponentRange[] {
  const seen = visibleCards(obs);
  const seats = liveOpponents(obs);
  const reads = model === 'random' ? [] : preflopReads(obs);
  const headsUp = obs.dealtIn.filter(Boolean).length === 2;
  const ranges = seats.map((seat): OpponentRange => {
    const weights = new Float64Array(COMBOS);
    const known = obs.revealedHoles[seat] as [Card, Card] | null;
    if (known !== null) {
      weights[comboIndex(known[0], known[1])] = 1;
      return { seat, prior: 'known', topPct: 100, looseness: 1, af: null, weights };
    }
    if (model === 'random') {
      weights.fill(1);
      normalise(weights, seen);
      return { seat, prior: 'random', topPct: 100, looseness: 1, af: null, weights };
    }
    const stats = model === 'reweight+stats' ? observedSeatModel(obs, seat) : null;
    const looseness = stats === null ? 1 : stats.looseness;
    const read = reads[seat] as PreflopRead;
    const topPct = Math.min(100, readPct(read, headsUp, looseness, tables));
    const byClass = priorClassWeights(topPct, trapPct(read.kind), tables);
    for (let i = 0; i < COMBOS; i++) weights[i] = byClass[COMBO_CLASS[i] as number] as number;
    normalise(weights, seen);
    return {
      seat,
      prior: read.kind,
      topPct,
      looseness,
      af: stats === null ? null : stats.af,
      weights,
    };
  });
  if (model === 'reweight' || model === 'reweight+stats') reweight(obs, ranges, seen);
  return ranges;
}

/** Loki re-weighting of every live opponent after each of its postflop actions (§8.6). */
function reweight(obs: Observation, ranges: OpponentRange[], seen: Uint8Array): void {
  const bySeat = new Map<number, OpponentRange>();
  for (const r of ranges) if (r.prior !== 'known') bySeat.set(r.seat, r);
  // The HS population excludes the observer's own cards and face-up hands (and the street's board).
  const dead = new Uint8Array(52);
  for (const c of obs.hole) dead[c] = 1;
  for (const h of obs.revealedHoles) if (h !== null) for (const c of h) dead[c] = 1;
  for (const [street, boardLen] of POSTFLOP) {
    if (obs.board.length < boardLen) break;
    const actions = obs.history.filter((a) => a.street === street && bySeat.has(a.seat));
    if (actions.length === 0) continue;
    const ehs = handStrengths(obs.board.slice(0, boardLen), dead);
    for (const a of actions) {
      const r = bySeat.get(a.seat) as OpponentRange;
      const shift = afShift(r.af);
      const w = r.weights;
      for (let i = 0; i < COMBOS; i++) {
        const e = ehs[i] as number;
        if ((w[i] as number) > 0 && e >= 0) w[i] = (w[i] as number) * actionFactor(a, e, shift);
      }
      normalise(w, seen);
    }
  }
}

// ── Range-weighted equity ──────────────────────────────────────────────────────────────────────

export interface RangeEquityRequest {
  /** The observer's two hole cards. */
  hole: readonly Card[];
  /** 0, 3, 4 or 5 cards. */
  board: readonly Card[];
  /** One weight array per live opponent (1,326 weights; combos using a known card are ignored). */
  ranges: readonly Float64Array[];
  /** Monte Carlo trials (ignored when exact). */
  trials: number;
  seed: Seed128;
}

const TWO_32 = 2 ** 32;

/**
 * The observer's equity against the weighted ranges (§8.2 `eRange`): the pot share (ties split)
 * averaged over deals. Exact on the river heads-up; otherwise a seeded Monte Carlo with a fixed
 * number of trials (§8.6 sampling: per opponent a `Float32Array(1326)` cumulative distribution
 * and a binary search; a combo that collides with a card already drawn this trial is redrawn, and
 * after 20 collisions two free cards are drawn uniformly; the rest of the board is dealt
 * uniformly from the cards left). Same request, same number, on every device.
 */
export function rangeEquity(req: RangeEquityRequest): number {
  const { hole, board, ranges } = req;
  const known = new Uint8Array(52);
  for (const c of [...hole, ...board]) known[c] = 1;
  if (ranges.length === 0) return 1;
  if (board.length === 5 && ranges.length === 1) return exactRiver(hole, board, known, ranges[0]!);
  if (!Number.isInteger(req.trials) || req.trials < 1) {
    throw new RangeError(`rangeEquity: trials must be a positive integer, got ${req.trials}`);
  }

  const cdfs = ranges.map((w) => {
    const cdf = new Float32Array(COMBOS);
    let acc = 0;
    for (let i = 0; i < COMBOS; i++) {
      const lo = COMBO_LO[i] as number;
      const hi = COMBO_HI[i] as number;
      if (known[lo] === 0 && known[hi] === 0) acc += w[i] as number;
      cdf[i] = acc;
    }
    if (!((cdf[COMBOS - 1] as number) > 0)) {
      throw new RangeError('rangeEquity: a range has no weight on any possible hand');
    }
    return cdf;
  });

  const rng = rngFromSeed(req.seed);
  const used = new Uint8Array(52);
  const free = new Int32Array(52);
  const heroCards = [hole[0] as Card, hole[1] as Card, ...board, 0, 0, 0, 0, 0].slice(0, 7);
  const oppCards = [0, 0, ...board, 0, 0, 0, 0, 0].slice(0, 7);
  const opp = new Int32Array(2 * ranges.length);
  const missing = 5 - board.length;
  let share = 0;

  for (let t = 0; t < req.trials; t++) {
    used.set(known);
    for (let o = 0; o < cdfs.length; o++) {
      const cdf = cdfs[o] as Float32Array;
      const total = cdf[COMBOS - 1] as number;
      let combo = -1;
      for (let collisions = 0; collisions < SAMPLE_MAX_COLLISIONS; collisions++) {
        const c = drawCombo(cdf, (rng.next() / TWO_32) * total);
        if (used[COMBO_LO[c] as number] === 0 && used[COMBO_HI[c] as number] === 0) {
          combo = c;
          break;
        }
      }
      let a: number;
      let b: number;
      if (combo >= 0) {
        a = COMBO_LO[combo] as number;
        b = COMBO_HI[combo] as number;
      } else {
        const n = collectFree(used, free);
        const i = randInt(rng, n);
        a = free[i] as number;
        free[i] = free[n - 1] as number;
        b = free[randInt(rng, n - 1)] as number;
      }
      used[a] = 1;
      used[b] = 1;
      opp[2 * o] = a;
      opp[2 * o + 1] = b;
    }
    if (missing > 0) {
      const n = collectFree(used, free);
      for (let k = 0; k < missing; k++) {
        const j = k + randInt(rng, n - k);
        const c = free[j] as number;
        free[j] = free[k] as number;
        free[k] = c;
        heroCards[2 + board.length + k] = c;
        oppCards[2 + board.length + k] = c;
      }
    }
    const heroScore = score7(heroCards, 7);
    let best = heroScore;
    let tied = 1;
    for (let o = 0; o < cdfs.length; o++) {
      oppCards[0] = opp[2 * o] as number;
      oppCards[1] = opp[2 * o + 1] as number;
      const s = score7(oppCards, 7);
      if (s > best) {
        best = s;
        tied = 0;
      } else if (s === best && best === heroScore) {
        tied++;
      }
    }
    if (best === heroScore) share += 1 / tied;
  }
  return share / req.trials;
}

/** First combo whose cumulative weight exceeds `u` (u < total). */
function drawCombo(cdf: Float32Array, u: number): number {
  let lo = 0;
  let hi = COMBOS - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((cdf[mid] as number) > u) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Writes the cards not in `used` to `free`; returns how many. */
function collectFree(used: Uint8Array, free: Int32Array): number {
  let n = 0;
  for (let c = 0; c < 52; c++) if (used[c] === 0) free[n++] = c;
  return n;
}

/** Heads-up river: the weighted average of the result against every possible combo. */
function exactRiver(
  hole: readonly Card[],
  board: readonly Card[],
  known: Uint8Array,
  w: Float64Array,
): number {
  const hero = score7([...hole, ...board], 7);
  const cards = [0, 0, ...board];
  let num = 0;
  let den = 0;
  for (let i = 0; i < COMBOS; i++) {
    const wi = w[i] as number;
    const a = COMBO_LO[i] as number;
    const b = COMBO_HI[i] as number;
    if (wi <= 0 || known[a] === 1 || known[b] === 1) continue;
    cards[0] = a;
    cards[1] = b;
    const s = score7(cards, 7);
    num += wi * (hero > s ? 1 : hero === s ? 0.5 : 0);
    den += wi;
  }
  if (den <= 0) throw new RangeError('rangeEquity: the range has no weight on any possible hand');
  return num / den;
}
