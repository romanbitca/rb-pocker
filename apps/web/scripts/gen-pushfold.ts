/**
 * Build-time push/fold ranges (PLAN §0.1, §7.5, §8.4): from apps/web `node scripts/gen-pushfold.ts`
 * (`npm run gen:pushfold`). Writes `src/data/generated/pushfold.ts` and its entry in
 * `checksums.json`; commit both. ⚠️ Never edit them by hand.
 *
 * Fictitious play over the 169 classes (`pushfold-solver.ts`: positional callers, the pusher's
 * cards removed) for every `k` = 1..8 players behind and `S` = 1..15 big blinds, no antes,
 * 3,000 rounds (`ITERATIONS`): `pushPct[k][S]` is the share of all combos
 * the pusher shoves, `callPct[S]` the share the big blind calls a small-blind shove with (the
 * `k = 1` game). The game needs the equity of every class against every class: 14,196 pairs,
 * each the mean over the rival's free combos (`PairJob`), sampled with a fixed seed and dealt
 * across `worker_threads`; the diagonal is exactly one half.
 *
 * Options: `--threads N` (default: one per core); for trial runs `--trials N` with `--out DIR` (a
 * different `--trials` never writes into the committed folder).
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { classCards, classOf } from '../src/core/cards.ts';
import { deriveSeed, ZERO_SEED, type Seed128 } from '../src/core/rng.ts';
import {
  CALL_WORDS,
  PUSH_FOLD_BYTES,
  PUSH_MAX_PLAYERS_BEHIND,
  PUSH_MAX_STACK_BB,
  PUSH_WORDS,
  pushFoldAcceptance,
  RANGE_CLASSES,
} from '../src/data/rangesLayout.ts';
import { binaryModule, GENERATED_DIR, writeGenerated } from './generated.ts';
import { defaultThreads } from './pool.ts';
import { runRangeJobs, type PairJob, type Shares } from './range-jobs.ts';
import { ITERATIONS, solvePushFold, type Matchups } from './pushfold-solver.ts';

/** Bumped whenever the method or the layout changes: `check-tables` then demands a regeneration. */
export const GENERATOR = 'gen-pushfold@2';

/** Monte Carlo trials behind every class-against-class equity (spread over the rival's combos). */
export const PAIR_TRIALS = 40_000;

export const PUSH_FOLD_FILE = 'pushfold.ts';

/** The fixed seed of the table; every pair derives its own from it. */
export const TABLE_SEED: Seed128 = deriveSeed(ZERO_SEED, 'gen-pushfold');

/** The seed of the pair (hero class, rival class) under `parent`. */
export function pairSeed(parent: Seed128, hero: number, villain: number): Seed128 {
  return deriveSeed(parent, 'pair', hero, villain);
}

/** The 14,196 class pairs `hero < villain`, in a fixed order. */
export function pairJobs(trials: number, parent: Seed128 = TABLE_SEED): PairJob[] {
  const jobs: PairJob[] = [];
  for (let hero = 0; hero < RANGE_CLASSES; hero++) {
    for (let villain = hero + 1; villain < RANGE_CLASSES; villain++) {
      jobs.push({ kind: 'pair', hero, villain, trials, seed: pairSeed(parent, hero, villain) });
    }
  }
  return jobs;
}

/**
 * How many combos of class `c` share no card with the hero class `h` (`free[h * 169 + c]`), for
 * the canonical hand of `h` (`classCards`): suits are symmetric, so any hand of the class counts
 * the same.
 */
export function freeCombos(): Float64Array {
  const free = new Float64Array(RANGE_CLASSES * RANGE_CLASSES);
  for (let h = 0; h < RANGE_CLASSES; h++) {
    const hero = classCards(h);
    for (let x = 0; x < 52; x++) {
      if (x === hero[0] || x === hero[1]) continue;
      for (let y = x + 1; y < 52; y++) {
        if (y === hero[0] || y === hero[1]) continue;
        const at = h * RANGE_CLASSES + classOf(x, y);
        free[at] = (free[at] as number) + 1;
      }
    }
  }
  return free;
}

/** The matrix from the pair results (`jobs` order): the other half is the complement. */
export function matchupsFrom(jobs: readonly PairJob[], results: readonly Shares[]): Matchups {
  const eq = new Float64Array(RANGE_CLASSES * RANGE_CLASSES);
  for (let c = 0; c < RANGE_CLASSES; c++) eq[c * RANGE_CLASSES + c] = 0.5;
  jobs.forEach((job, i) => {
    const r = results[i] as Shares;
    const p = r.win + r.split;
    eq[job.hero * RANGE_CLASSES + job.villain] = p;
    eq[job.villain * RANGE_CLASSES + job.hero] = 1 - p;
  });
  return { eq, free: freeCombos() };
}

/** Hundredths of a percent, as a Uint16 word. */
export function hundredths(pct: number): number {
  return Math.round(pct * 100);
}

export interface Tables {
  /** `push[(k - 1) * 15 + (S - 1)]`, percent. */
  readonly push: number[];
  /** `call[S - 1]`, percent. */
  readonly call: number[];
  /** The largest change of a `pushPct` between round 150 and round 300, in points. */
  readonly drift: number;
}

/** Solves every (k, S). `log` hears each stack as it finishes. */
export function solveTables(
  mu: Matchups,
  iterations: number,
  log?: (line: string) => void,
): Tables {
  const push = new Array<number>(PUSH_WORDS).fill(0);
  const call = new Array<number>(CALL_WORDS).fill(0);
  let drift = 0;
  for (let S = 1; S <= PUSH_MAX_STACK_BB; S++) {
    for (let k = 1; k <= PUSH_MAX_PLAYERS_BEHIND; k++) {
      const solution = solvePushFold(mu, k, S, iterations);
      push[(k - 1) * PUSH_MAX_STACK_BB + (S - 1)] = solution.pushPct;
      drift = Math.max(drift, Math.abs(solution.pushPct - solution.halfwayPushPct));
      if (k === 1) call[S - 1] = solution.callPct;
    }
    log?.(`  S = ${S} bb solved`);
  }
  return { push, call, drift };
}

/** The blob `decodePushFold` reads: `pushPct` then `callPct`, hundredths of a percent, LE words. */
export function encodePushFold(tables: Pick<Tables, 'push' | 'call'>): Uint8Array {
  const words = [...tables.push, ...tables.call];
  if (words.length !== PUSH_WORDS + CALL_WORDS) throw new RangeError('wrong number of values');
  const out = new Uint8Array(PUSH_FOLD_BYTES);
  const view = new DataView(out.buffer);
  words.forEach((pct, i) => {
    const w = hundredths(pct);
    if (w < 0 || w > 10_000) throw new RangeError(`value ${i}: ${pct} is not a percent`);
    view.setUint16(2 * i, w, true);
  });
  return out;
}

function pushFoldModule(bytes: Uint8Array, trials: number, iterations: number): string {
  return binaryModule(
    [
      `Generated by scripts/gen-pushfold.ts (${GENERATOR}). Never edit by hand: \`npm run gen\``,
      'rewrites this file and `npm run gen:check` fails when it changes (PLAN section 7.5).',
      '',
      'Push/fold ranges (PLAN 8.4): fictitious play over the 169 starting-hand classes, no antes,',
      'positional callers (the blinds call at their own price), the cards of the pusher removed,',
      `${iterations} rounds, for k = 1..8 players behind and S = 1..15 big blinds. The class against`,
      `class equities: ${trials} trials per pair, table seed ${TABLE_SEED}.`,
      '',
      `Layout: ${bytes.length} bytes = ${bytes.length / 2} little-endian Uint16 words, in hundredths of a percent`,
      `(1 = 0.01 %) of all 1,326 combos. Words 0..${PUSH_WORDS - 1}: pushPct, word (k - 1) * 15 + (S - 1), the`,
      `share the pusher shoves. Words ${PUSH_WORDS}..${PUSH_WORDS + CALL_WORDS - 1}: callPct, word ${PUSH_WORDS} + (S - 1), the share the big blind`,
      'calls a small-blind shove with (the k = 1 game).',
    ],
    { PUSH_FOLD_TRIALS: trials, PUSH_FOLD_ITERATIONS: iterations },
    'PUSH_FOLD_B64',
    bytes,
  );
}

export interface GenerateOptions {
  /** Monte Carlo trials per class pair. */
  readonly trials: number;
  readonly threads: number;
  /** Where the module and `checksums.json` are written. */
  readonly out: string;
  /** Fictitious-play rounds per game (default: `ITERATIONS`, PLAN §8.4); fewer only in tests. */
  readonly iterations?: number;
  readonly log?: (line: string) => void;
}

/** Samples the matrix, solves every (k, S) and writes the table. Returns the seconds it took. */
export async function generate(options: GenerateOptions): Promise<number> {
  const log = options.log ?? (() => undefined);
  const started = performance.now();
  const seconds = (): string => ((performance.now() - started) / 1000).toFixed(0);
  const jobs = pairJobs(options.trials);
  log(`${jobs.length} class pairs x ${options.trials} trials on ${options.threads} threads`);
  let lastPercent = -1;
  const results = await runRangeJobs(jobs, options.threads, (done) => {
    const percent = Math.floor((100 * done) / jobs.length / 25) * 25;
    if (percent > lastPercent) {
      lastPercent = percent;
      log(`  ${percent}%  ${seconds()} s`);
    }
  });
  const mu = matchupsFrom(jobs, results);
  const rounds = options.iterations ?? ITERATIONS;
  log(`solving ${PUSH_MAX_PLAYERS_BEHIND * PUSH_MAX_STACK_BB} games, ${rounds} rounds each`);
  const tables = solveTables(mu, rounds);
  const pct = (k: number, S: number): number =>
    tables.push[(k - 1) * PUSH_MAX_STACK_BB + (S - 1)] as number;
  const problems = pushFoldAcceptance(pct);
  log(
    `  ${seconds()} s; largest change over the second half of the rounds ${tables.drift.toFixed(2)} points; ` +
      `acceptance (PLAN 8.4): ${problems.length === 0 ? 'passes' : `FAILS: ${problems.join('; ')}`}`,
  );
  writeGenerated(
    options.out,
    PUSH_FOLD_FILE,
    pushFoldModule(encodePushFold(tables), options.trials, rounds),
    { generator: GENERATOR, seed: TABLE_SEED, trials: options.trials },
  );
  log(`wrote ${PUSH_FOLD_FILE} and checksums.json to ${options.out}`);
  return (performance.now() - started) / 1000;
}

function positiveInteger(text: string, name: string): number {
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`--${name} needs a positive integer`);
  return value;
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({
      options: { trials: { type: 'string' }, threads: { type: 'string' }, out: { type: 'string' } },
      strict: true,
    });
    const trials =
      values.trials === undefined ? PAIR_TRIALS : positiveInteger(values.trials, 'trials');
    const threads =
      values.threads === undefined ? defaultThreads() : positiveInteger(values.threads, 'threads');
    if (trials !== PAIR_TRIALS && values.out === undefined) {
      throw new Error(
        `--trials other than ${PAIR_TRIALS} needs --out DIR: a trial run must not replace the committed table`,
      );
    }
    const seconds = await generate({
      trials,
      threads,
      out: values.out === undefined ? GENERATED_DIR : resolve(values.out),
      log: (line) => console.log(line),
    });
    console.log(`done in ${seconds.toFixed(1)} s`);
  } catch (error) {
    console.error(`gen-pushfold: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
