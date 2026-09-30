/**
 * Win chance, the hero's equity (PLAN §7, §2.4 "HUD equity", Appendix A.5, C.2, C.3).
 *
 * `equity = P(win) + Σ P(tie among k players) / k` against the live opponents' UNKNOWN hands, dealt
 * at random from the unseen cards. Results are fractions in [0, 1]; `equity === win + split`.
 *
 * - ⚠️ Folded players' cards are unknown, not dead: the pool is always "52 minus the hero's two
 *   cards minus the board" (pitfall 14). This module never sees a bot's hole cards.
 * - ⚠️ Opponents are sampled jointly, without replacement (pitfall 15). A k-way tie is worth 1/k.
 * - ⚠️ Fixed n, never a time limit (pitfall 16): the method and n depend only on
 *   `(board length, nOpp)`, so the same situation gives the same bits on every device.
 *
 * Shape for the equity worker (chunk 4.5): `equitySteps` is a generator. Each step is `null` (a
 * checkpoint: a chance to look for a cancel or a newer job, then call `next()` again; stop calling
 * to cancel) or an `EquityResult` (post it: the progress marks at n = 2,500 and 10,000, then the
 * final one, `final: true`). The result is the LAST non-null step.
 *
 * `runoutSteps` is the same for known hands (an all-in run-out, PLAN §7.2): one result per player,
 * and the results of all players add up to 1.
 */
import { formatCard, isCard, type Card } from '../core/cards.ts';
import { deriveSeed, randInt, rngFromSeed, ZERO_SEED, type Seed128 } from '../core/rng.ts';
import { score7 } from '../eval/evaluate.ts';
import type { EquityResult } from './types.ts';

/** Exact enumeration up to this many deals (opponent hands × runouts), PLAN §7.2. */
export const EXACT_LIMIT = 500_000;
/** Monte Carlo sends progress at these trial counts (PLAN §7.3); the final result comes after. */
export const PROGRESS_MARKS: readonly number[] = [2_500, 10_000];
/** Final n for a run-out with known hands that is too big to enumerate (PLAN §7.2). */
export const RUNOUT_TRIALS = 20_000;

/** Trials between two checkpoints (PLAN §7.3: "chunks of 2,000 trials"). */
const CHUNK = 2_000;
/** Exact enumeration: deals between two checkpoints. */
const CHECK_DEALS = 20_000;

/** Final n of the HUD estimate: 40,000 (±0.5%) for 1–3 opponents, 20,000 (±0.7%) for 4–8. */
export function finalTrials(nOpp: number): number {
  return nOpp <= 3 ? 40_000 : 20_000;
}

export interface EquityRequest {
  /** The hero's two hole cards. */
  hero: readonly Card[];
  /** 0, 3, 4 or 5 cards. */
  board: readonly Card[];
  /** Live opponents (1–8), each holding unknown random cards. */
  nOpp: number;
}

export interface RunoutRequest {
  /** Every live player's known hole cards (two each, at least two players). */
  hands: readonly (readonly Card[])[];
  board: readonly Card[];
}

export interface EquityOptions {
  /** Force a method (tests). Default: exact when the size is within `exactLimit`, else Monte Carlo. */
  mode?: 'exact' | 'montecarlo';
  /** Monte Carlo n (tests). Default: `finalTrials(nOpp)`, `RUNOUT_TRIALS` for run-outs. */
  trials?: number;
  /** Default `EXACT_LIMIT`. */
  exactLimit?: number;
  /** Monte Carlo seed (tests). Default: `equitySeed` / `runoutSeed`. */
  seed?: Seed128;
}

/** One `EquityResult` per reported player, or `null` for a checkpoint. */
type Step = EquityResult[] | null;

// Module-local references: Vitest's module runner turns every use of an imported binding into a
// property lookup, which slows a hot loop several times (same note as in `eval/evaluate.ts`).
const score = score7;
const rand = randInt;

// ── Sizes and seeds ───────────────────────────────────────────────────────────────────────────

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; // every step is an exact binomial
  return r;
}

/**
 * Deals to enumerate for the hero against `nOpp` unknown hands: (unordered sets of `nOpp` disjoint
 * hands) × (runouts). Heads-up turn 45,540, river 990; two opponents on the river 446,985 (§7.2).
 */
export function dealCount(boardLen: number, nOpp: number): number {
  const pool = 50 - boardLen;
  let sets = 1;
  for (let i = 0; i < nOpp; i++) sets *= choose(pool - 2 * i, 2);
  for (let i = 2; i <= nOpp; i++) sets /= i;
  return sets * choose(pool - 2 * nOpp, 5 - boardLen);
}

/** Boards × players of a run-out with known hands (§7.2 uses it against the exact limit). */
export function runoutCost(nPlayers: number, boardLen: number): number {
  return choose(52 - 2 * nPlayers - boardLen, 5 - boardLen) * nPlayers;
}

const byCardDesc = (a: Card, b: Card): number => b - a;
const cardsText = (cards: readonly Card[]): string =>
  [...cards].sort(byCardDesc).map(formatCard).join('');

/**
 * PLAN §2.4: `deriveSeed(ZERO_SEED, 'eq|' + sortedHeroCards + '|' + board + '|' + nOpp)`, cards as
 * text, e.g. `eq|AhKh|Qh7h2c|3`. Hero cards and board are both written highest card first, so the
 * seed depends on the cards, not on the order they came in or were dealt.
 */
export function equitySeed(hero: readonly Card[], board: readonly Card[], nOpp: number): Seed128 {
  return deriveSeed(ZERO_SEED, `eq|${cardsText(hero)}|${cardsText(board)}|${nOpp}`);
}

/** Seed of a known-hands Monte Carlo: `'run|' + sorted hands joined by '/' + '|' + board`. */
export function runoutSeed(hands: readonly (readonly Card[])[], board: readonly Card[]): Seed128 {
  const hs = hands.map(cardsText).sort();
  return deriveSeed(ZERO_SEED, `run|${hs.join('/')}|${cardsText(board)}`);
}

function checkCards(fn: string, holes: readonly (readonly Card[])[], board: readonly Card[]): void {
  if (![0, 3, 4, 5].includes(board.length)) {
    throw new RangeError(`${fn}: board must have 0, 3, 4 or 5 cards, got ${board.length}`);
  }
  if (!holes.every((h) => h.length === 2)) {
    throw new RangeError(`${fn}: every hand needs exactly 2 hole cards`);
  }
  const all = [...holes.flat(), ...board];
  if (!all.every(isCard) || new Set(all).size !== all.length) {
    throw new RangeError(`${fn}: cards must be distinct cards 0..51: ${all.join(',')}`);
  }
}

/** Cards not in `known`, ascending. Nothing else is ever removed: folded cards stay in. */
function unseen(known: readonly Card[]): number[] {
  const out: number[] = [];
  for (let c = 0; c < 52; c++) if (!known.includes(c)) out.push(c);
  return out;
}

function throwBadTrials(trials: number): never {
  throw new RangeError(`trials must be a positive integer, got ${trials}`);
}

/** Checkpoint sizes of a Monte Carlo run: every CHUNK trials, at the progress marks, at the end. */
function boundaries(total: number): number[] {
  const set = new Set<number>([total]);
  for (let n = CHUNK; n < total; n += CHUNK) set.add(n);
  for (const m of PROGRESS_MARKS) if (m < total) set.add(m);
  return [...set].sort((a, b) => a - b);
}

// ── Monte Carlo ───────────────────────────────────────────────────────────────────────────────

/**
 * Fixed-n Monte Carlo. Players are `fixed` (known hands; the hero is `fixed[0]`) followed by
 * `nRandom` random hands. Per trial: a partial Fisher–Yates over the unseen cards draws
 * `2·nRandom + (5 − board.length)` of them (the pool keeps its permutation between trials), then
 * every player is scored. `reportAll` reports every player, else only `fixed[0]`.
 */
function* monteCarlo(
  fixed: readonly (readonly Card[])[],
  nRandom: number,
  board: readonly Card[],
  total: number,
  seed: Seed128,
  reportAll: boolean,
): Generator<Step, void, undefined> {
  const bl = board.length;
  const r = 5 - bl;
  const nFixed = fixed.length;
  const players = nFixed + nRandom;
  const pool = Uint8Array.from(unseen([...fixed.flat(), ...board]));
  const m = pool.length;
  const draw = 2 * nRandom + r;
  const rng = rngFromSeed(seed);
  const holes = Uint8Array.from(fixed.flat());
  const buf = new Uint8Array(7); // [hole0, hole1, board0..board4]
  for (let i = 0; i < bl; i++) buf[2 + i] = board[i] as number;
  const scores = new Int32Array(players);
  const wins = new Int32Array(players);
  const width = players + 1;
  const ties = new Int32Array(players * width); // ties[p * width + size]: tied with size − 1 others

  let n = 0;
  for (const stop of boundaries(total)) {
    for (; n < stop; n++) {
      for (let i = 0; i < draw; i++) {
        const j = i + rand(rng, m - i);
        const t = pool[i] as number;
        pool[i] = pool[j] as number;
        pool[j] = t;
      }
      for (let k = 0; k < r; k++) buf[2 + bl + k] = pool[2 * nRandom + k] as number;
      let top = -1;
      for (let p = 0; p < players; p++) {
        if (p < nFixed) {
          buf[0] = holes[2 * p] as number;
          buf[1] = holes[2 * p + 1] as number;
        } else {
          const q = 2 * (p - nFixed);
          buf[0] = pool[q] as number;
          buf[1] = pool[q + 1] as number;
        }
        const s = score(buf, 7);
        scores[p] = s;
        if (s > top) top = s;
      }
      let tied = 0;
      for (let p = 0; p < players; p++) if (scores[p] === top) tied++;
      for (let p = 0; p < players; p++) {
        if (scores[p] !== top) continue;
        if (tied === 1) wins[p] = (wins[p] as number) + 1;
        else ties[p * width + tied] = (ties[p * width + tied] as number) + 1;
      }
    }
    if (stop !== total && !PROGRESS_MARKS.includes(stop)) {
      yield null;
      continue;
    }
    const out: EquityResult[] = [];
    for (let p = 0; p < (reportAll ? players : 1); p++) {
      let share = 0;
      for (let size = 2; size <= players; size++)
        share += (ties[p * width + size] as number) / size;
      const win = (wins[p] as number) / n;
      const split = share / n;
      out.push({
        n,
        win,
        split,
        equity: win + split,
        exact: false,
        final: n === total,
        truncated: false,
      });
    }
    yield out;
  }
}

// ── Exact enumeration ─────────────────────────────────────────────────────────────────────────

/** Advance `idx` (ascending indices into 0..m−1) to the next combination; false after the last. */
function nextCombo(idx: Int32Array, m: number): boolean {
  const r = idx.length;
  let i = r - 1;
  while (i >= 0 && (idx[i] as number) === m - r + i) i--;
  if (i < 0) return false;
  idx[i] = (idx[i] as number) + 1;
  for (let j = i + 1; j < r; j++) idx[j] = (idx[j - 1] as number) + 1;
  return true;
}

function firstCombo(r: number): Int32Array {
  const idx = new Int32Array(r);
  for (let i = 0; i < r; i++) idx[i] = i;
  return idx;
}

/**
 * Exact equity of the hero against `nOpp` unknown hands: every runout, and for each the hero's
 * score once and the score of each of the 990 possible opponent hands once ("hero score cached
 * per runout"); then every unordered set of `nOpp` disjoint hands.
 */
function* exactRandom(
  hero: readonly Card[],
  board: readonly Card[],
  nOpp: number,
): Generator<Step, void, undefined> {
  const bl = board.length;
  const r = 5 - bl;
  const pool = unseen([...hero, ...board]);
  const m = pool.length;
  const HANDS = 990; // C(45, 2): what is left once the hero and a full board are out
  const rest = new Uint8Array(45);
  const hc0 = new Uint8Array(HANDS);
  const hc1 = new Uint8Array(HANDS);
  const sc = new Int32Array(HANDS);
  const used = new Uint8Array(52);
  const buf = new Uint8Array(7);
  buf[0] = hero[0] as number;
  buf[1] = hero[1] as number;
  for (let i = 0; i < bl; i++) buf[2 + i] = board[i] as number;

  let wins = 0;
  let deals = 0;
  const ties = new Int32Array(nOpp + 1); // ties[t]: the hero tied with t opponents at the top
  let hs = 0;

  const rec = (from: number, left: number, best: number, count: number): void => {
    if (left === 0) {
      deals++;
      if (hs > best) wins++;
      else if (hs === best) ties[count] = (ties[count] as number) + 1;
      return;
    }
    for (let h = from; h < HANDS; h++) {
      const a = hc0[h] as number;
      const b = hc1[h] as number;
      if (used[a] === 1 || used[b] === 1) continue;
      const s = sc[h] as number;
      used[a] = 1;
      used[b] = 1;
      rec(h + 1, left - 1, s > best ? s : best, s > best ? 1 : s === best ? count + 1 : count);
      used[a] = 0;
      used[b] = 0;
    }
  };

  const idx = firstCombo(r);
  let lastCheck = 0;
  do {
    for (let k = 0; k < r; k++) buf[2 + bl + k] = pool[idx[k] as number] as number;
    hs = score(buf, 7);
    let ri = 0;
    let next = 0;
    for (let q = 0; q < m; q++) {
      if (next < r && (idx[next] as number) === q) next++;
      else rest[ri++] = pool[q] as number;
    }
    let h = 0;
    for (let a = 0; a < 44; a++) {
      for (let b = a + 1; b < 45; b++) {
        const c0 = rest[a] as number;
        const c1 = rest[b] as number;
        hc0[h] = c0;
        hc1[h] = c1;
        buf[0] = c0;
        buf[1] = c1;
        sc[h] = score(buf, 7);
        h++;
      }
    }
    buf[0] = hero[0] as number;
    buf[1] = hero[1] as number;
    for (let h1 = 0; h1 < HANDS; h1++) {
      const s = sc[h1] as number;
      if (nOpp === 1) {
        deals++;
        if (hs > s) wins++;
        else if (hs === s) ties[1] = (ties[1] as number) + 1;
      } else {
        const a = hc0[h1] as number;
        const b = hc1[h1] as number;
        used[a] = 1;
        used[b] = 1;
        rec(h1 + 1, nOpp - 1, s, 1);
        used[a] = 0;
        used[b] = 0;
      }
      if (deals - lastCheck >= CHECK_DEALS) {
        lastCheck = deals;
        yield null;
      }
    }
  } while (nextCombo(idx, m));

  let share = 0;
  for (let t = 1; t <= nOpp; t++) share += (ties[t] as number) / (t + 1);
  const win = wins / deals;
  const split = share / deals;
  yield [{ n: deals, win, split, equity: win + split, exact: true, final: true, truncated: false }];
}

/** Exact equities of known hands: every board, one result per player. */
function* exactRunout(
  hands: readonly (readonly Card[])[],
  board: readonly Card[],
): Generator<Step, void, undefined> {
  const bl = board.length;
  const r = 5 - bl;
  const players = hands.length;
  const pool = unseen([...hands.flat(), ...board]);
  const m = pool.length;
  const bufs = hands.map((h) => {
    const b = new Uint8Array(7);
    b[0] = h[0] as number;
    b[1] = h[1] as number;
    for (let i = 0; i < bl; i++) b[2 + i] = board[i] as number;
    return b;
  });
  const scores = new Int32Array(players);
  const wins = new Int32Array(players);
  const width = players + 1;
  const ties = new Int32Array(players * width);

  const idx = firstCombo(r);
  let boards = 0;
  do {
    for (let k = 0; k < r; k++) {
      const c = pool[idx[k] as number] as number;
      for (let p = 0; p < players; p++) (bufs[p] as Uint8Array)[2 + bl + k] = c;
    }
    let top = -1;
    for (let p = 0; p < players; p++) {
      const s = score(bufs[p] as Uint8Array, 7);
      scores[p] = s;
      if (s > top) top = s;
    }
    let tied = 0;
    for (let p = 0; p < players; p++) if (scores[p] === top) tied++;
    for (let p = 0; p < players; p++) {
      if (scores[p] !== top) continue;
      if (tied === 1) wins[p] = (wins[p] as number) + 1;
      else ties[p * width + tied] = (ties[p * width + tied] as number) + 1;
    }
    boards++;
    if (boards % CHECK_DEALS === 0) yield null;
  } while (nextCombo(idx, m));

  const out: EquityResult[] = [];
  for (let p = 0; p < players; p++) {
    let share = 0;
    for (let size = 2; size <= players; size++) share += (ties[p * width + size] as number) / size;
    const win = (wins[p] as number) / boards;
    const split = share / boards;
    out.push({
      n: boards,
      win,
      split,
      equity: win + split,
      exact: true,
      final: true,
      truncated: false,
    });
  }
  yield out;
}

// ── Public entry points ───────────────────────────────────────────────────────────────────────

/** Which method a request uses and its n (deals to enumerate, or Monte Carlo trials). */
export function equityPlan(
  boardLen: number,
  nOpp: number,
  opts: EquityOptions = {},
): { exact: boolean; n: number } {
  const size = dealCount(boardLen, nOpp);
  const exact =
    opts.mode !== undefined ? opts.mode === 'exact' : size <= (opts.exactLimit ?? EXACT_LIMIT);
  return { exact, n: exact ? size : (opts.trials ?? finalTrials(nOpp)) };
}

/**
 * The hero's equity against `nOpp` unknown random hands, step by step (see the file header).
 * Throws `RangeError` at once (not at the first `next()`) for a bad request.
 */
export function equitySteps(
  req: EquityRequest,
  opts: EquityOptions = {},
): Generator<EquityResult | null, void, undefined> {
  checkCards('equity', [req.hero], req.board);
  if (!Number.isInteger(req.nOpp) || req.nOpp < 1 || req.nOpp > 8) {
    throw new RangeError(`equity: nOpp must be 1..8, got ${req.nOpp}`);
  }
  const plan = equityPlan(req.board.length, req.nOpp, opts);
  if (!plan.exact && (!Number.isInteger(plan.n) || plan.n < 1)) throwBadTrials(plan.n);
  const inner = plan.exact
    ? exactRandom(req.hero, req.board, req.nOpp)
    : monteCarlo(
        [req.hero],
        req.nOpp,
        req.board,
        plan.n,
        opts.seed ?? equitySeed(req.hero, req.board, req.nOpp),
        false,
      );
  return (function* () {
    for (const step of inner) yield step === null ? null : (step[0] as EquityResult);
  })();
}

function last<T>(steps: Iterable<T | null>): T {
  let result: T | null = null;
  for (const step of steps) if (step !== null) result = step;
  if (result === null) throw new Error('equity: no result'); // unreachable: the last step is final
  return result;
}

/** The final `EquityResult`, without progress (tests, scripts, the coach when it has no worker). */
export function equity(req: EquityRequest, opts: EquityOptions = {}): EquityResult {
  return last(equitySteps(req, opts));
}

/**
 * Known hands, run to the river (all-in reveal, PLAN §7.2): one result per player, in the order of
 * `hands`. Exact when boards × players ≤ 500,000 (flop 990 boards, turn 44), else a 20,000-trial
 * seeded Monte Carlo.
 */
export function runoutSteps(
  req: RunoutRequest,
  opts: EquityOptions = {},
): Generator<EquityResult[] | null, void, undefined> {
  checkCards('runout', req.hands, req.board);
  if (req.hands.length < 2 || req.hands.length > 9) {
    throw new RangeError(`runout: need 2..9 players, got ${req.hands.length}`);
  }
  const exact =
    opts.mode !== undefined
      ? opts.mode === 'exact'
      : runoutCost(req.hands.length, req.board.length) <= (opts.exactLimit ?? EXACT_LIMIT);
  if (exact) return exactRunout(req.hands, req.board);
  const trials = opts.trials ?? RUNOUT_TRIALS;
  if (!Number.isInteger(trials) || trials < 1) throwBadTrials(trials);
  return monteCarlo(
    req.hands,
    0,
    req.board,
    trials,
    opts.seed ?? runoutSeed(req.hands, req.board),
    true,
  );
}

/** The final run-out equities, one per player. */
export function runoutEquity(req: RunoutRequest, opts: EquityOptions = {}): EquityResult[] {
  return last(runoutSteps(req, opts));
}
