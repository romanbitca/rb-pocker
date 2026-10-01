/**
 * The Monte Carlo work units of the range table scripts (PLAN §7.5, §8.3, §8.4) and a pool of
 * `worker_threads` that runs them: `gen-ranges.ts` uses it for the ranking cells and the class
 * against range cells, `gen-pushfold.ts` for the class against class matchups, `check-range-tables`
 * for the cells it samples again.
 *
 * A job is a pure function of its fields (each has its own seed), so the results never depend on
 * how many threads run the jobs or in which order they finish. Suits are symmetric, so one hand
 * stands for a whole class (`classCards`); its rivals are all the combos that do not share a card
 * with it (card removal is exact).
 */
import { fileURLToPath } from 'node:url';
import { equity } from '../src/analysis/equity.ts';
import { classCards, classOf, type Card } from '../src/core/cards.ts';
import { randInt, rngFromSeed, type Rng, type Seed128 } from '../src/core/rng.ts';
import { score7 } from '../src/eval/evaluate.ts';
import { runPool } from './pool.ts';

// Module-local references, as in `analysis/equity.ts`: a hot loop must not look names up on a
// module namespace.
const score = score7;
const rand = randInt;

/** One class against `nOpp` random hands: `equity()` itself, the same sampler as the HUD. */
export interface RandomJob {
  readonly kind: 'random';
  readonly cls: number;
  readonly nOpp: number;
  readonly trials: number;
  readonly seed: Seed128;
}

/**
 * One class against ONE rival whose hand is drawn from a weighted range: `weights[c]` (169
 * numbers, 0 to 1) is the weight of every combo of class `c`. Each trial draws a rival combo that
 * does not share a card with the hero, then a random board.
 */
export interface RangeJob {
  readonly kind: 'range';
  readonly cls: number;
  readonly weights: readonly number[];
  readonly trials: number;
  readonly seed: Seed128;
}

/**
 * The hero class against ONE rival class: about `trials` trials spread evenly over the rival
 * combos that do not share a card with the hero (the result is the mean over those combos, so the
 * choice of combo adds no noise).
 */
export interface PairJob {
  readonly kind: 'pair';
  readonly hero: number;
  readonly villain: number;
  readonly trials: number;
  readonly seed: Seed128;
}

export type Job = RandomJob | RangeJob | PairJob;

/** The hero's `win` and `split` (the share of ties) as fractions of 1: `equity = win + split`. */
export interface Shares {
  readonly win: number;
  readonly split: number;
}

interface Combos {
  readonly a: Uint8Array;
  readonly b: Uint8Array;
  /** Running total of the weights: `cum[i]` ends combo `i`. */
  readonly cum: Float64Array;
  readonly total: number;
}

/** Every two-card hand without a card of `hero` whose class has a positive weight. */
function comboList(hero: readonly Card[], weightOf: (cls: number) => number): Combos {
  const a: number[] = [];
  const b: number[] = [];
  const cum: number[] = [];
  let total = 0;
  for (let x = 0; x < 52; x++) {
    if (x === hero[0] || x === hero[1]) continue;
    for (let y = x + 1; y < 52; y++) {
      if (y === hero[0] || y === hero[1]) continue;
      const w = weightOf(classOf(x, y));
      if (!(w > 0)) continue;
      total += w;
      a.push(x);
      b.push(y);
      cum.push(total);
    }
  }
  return { a: Uint8Array.from(a), b: Uint8Array.from(b), cum: Float64Array.from(cum), total };
}

/**
 * `trials` showdowns of the hero against a rival drawn from the combos (by weight), each on a
 * fresh random board. Returns how often the hero won outright and how often it tied (two ways).
 */
function duel(
  hero: readonly Card[],
  a: Uint8Array,
  b: Uint8Array,
  cum: Float64Array,
  total: number,
  trials: number,
  rng: Rng,
): { wins: number; ties: number } {
  const m = a.length;
  const used = new Uint8Array(52);
  used[hero[0] as number] = 1;
  used[hero[1] as number] = 1;
  const mine = new Uint8Array(7);
  const theirs = new Uint8Array(7);
  mine[0] = hero[0] as number;
  mine[1] = hero[1] as number;
  let wins = 0;
  let ties = 0;
  for (let t = 0; t < trials; t++) {
    let pick = 0;
    if (m > 1) {
      const u = (rng.next() / 4294967296) * total;
      let lo = 0;
      let hi = m - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if ((cum[mid] as number) > u) hi = mid;
        else lo = mid + 1;
      }
      pick = lo;
    }
    const x = a[pick] as number;
    const y = b[pick] as number;
    used[x] = 1;
    used[y] = 1;
    theirs[0] = x;
    theirs[1] = y;
    for (let j = 2; j < 7; j++) {
      let c: number;
      do c = rand(rng, 52);
      while (used[c] === 1);
      used[c] = 1;
      mine[j] = c;
      theirs[j] = c;
    }
    for (let j = 2; j < 7; j++) used[mine[j] as number] = 0;
    used[x] = 0;
    used[y] = 0;
    const s = score(mine, 7);
    const r = score(theirs, 7);
    if (s > r) wins++;
    else if (s === r) ties++;
  }
  return { wins, ties };
}

const ONE = Float64Array.of(1);

/** Runs one job in this thread. */
export function runJob(job: Job): Shares {
  if (job.kind === 'random') {
    const hero = classCards(job.cls);
    const r = equity(
      { hero, board: [], nOpp: job.nOpp },
      { mode: 'montecarlo', trials: job.trials, seed: job.seed },
    );
    return { win: r.win, split: r.split };
  }
  if (job.kind === 'range') {
    const hero = classCards(job.cls);
    const weights = job.weights;
    const v = comboList(hero, (cls) => weights[cls] as number);
    if (v.a.length === 0) throw new RangeError('range job: the range has no combo');
    const { wins, ties } = duel(hero, v.a, v.b, v.cum, v.total, job.trials, rngFromSeed(job.seed));
    return { win: wins / job.trials, split: ties / (2 * job.trials) };
  }
  const hero = classCards(job.hero);
  const v = comboList(hero, (cls) => (cls === job.villain ? 1 : 0));
  const m = v.a.length;
  if (m === 0) throw new RangeError('pair job: no combo of the rival class is free');
  const each = Math.max(1, Math.round(job.trials / m));
  const rng = rngFromSeed(job.seed);
  let win = 0;
  let split = 0;
  for (let i = 0; i < m; i++) {
    const { wins, ties } = duel(
      hero,
      v.a.subarray(i, i + 1),
      v.b.subarray(i, i + 1),
      ONE,
      1,
      each,
      rng,
    );
    win += wins / each;
    split += ties / (2 * each);
  }
  return { win: win / m, split: split / m };
}

const WORKER_FILE = fileURLToPath(new URL('./range-worker.ts', import.meta.url));

/** The results in the order of `jobs`; see `runPool`. */
export function runRangeJobs(
  jobs: readonly Job[],
  threads: number,
  onDone?: (done: number) => void,
): Promise<Shares[]> {
  return runPool<Job, Shares>(WORKER_FILE, runJob, jobs, threads, onDone);
}
