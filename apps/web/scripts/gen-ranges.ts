/**
 * Build-time starting-hand ranking and range equities (PLAN §0.1, §7.5, §8.3): from apps/web
 * `node scripts/gen-ranges.ts` (`npm run gen:ranges`). Writes `src/data/generated/ranges.ts` and its
 * entry in `checksums.json`; commit both. ⚠️ Never edit them by hand.
 *
 * - `rankPct[169]`, in two passes. First: for every class, the equity against 1 random hand and
 *   against 4 random hands (200,000 trials each, `equity()` itself), `w·z(eqVs1) + (1 − w)·z(shareVs4)`
 *   with w = 0.25 (`RANK_WEIGHT`), sorted best first. Then each class's equity against ONE caller,
 *   a hand from the top 25% of that first order (§8.6's "call a raise"; 200,000 trials), and the
 *   final score `0.5·z(eqVsCaller) + 0.5·z(shareVs4)` (`CALLER_WEIGHT`), sorted best first. The
 *   equity against random hands alone ranks the small pairs far too low (22 at 54%, folded on the
 *   button): a pair is a coin flip against the overcards that call, which a random hand is not
 *   (fix/coach-strategy-audit). The table stores the final order; `rankPct` is the combo-weighted
 *   percentile derived from it (`rankPctFromOrder`).
 * - `eqVsRange[169][14]`: each class's equity against ONE rival holding a hand from the top X% of
 *   the 1,326 combos in the final order, X in 2.5, 3, 5, 8, 12, 15, 20, 25, 30, 40, 50, 65, 80, 100
 *   (the class on the edge of a range counts in part, so the range is exactly X% of the combos).
 *   200,000 trials per cell, the rival drawn from the range with card removal.
 *
 * Every step is seeded from the fixed table seed and dealt across `worker_threads`.
 *
 * Options: `--threads N` (default: one per core); for trial runs `--trials N` with `--out DIR` (a
 * different `--trials` never writes into the committed folder); `--scan` prints which caller
 * weights pass the §8.3 acceptance and writes nothing.
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { className } from '../src/core/cards.ts';
import { deriveSeed, ZERO_SEED, type Seed128 } from '../src/core/rng.ts';
import {
  classByName,
  COMBOS_TOTAL,
  comboCount,
  RANGE_CLASSES,
  RANGE_KNOTS,
  RANGES_BYTES,
  RANGES_EQ_WORDS,
  rangeAcceptance,
  rankPctFromOrder,
  topWeights,
} from '../src/data/rangesLayout.ts';
import { binaryModule, GENERATED_DIR, writeGenerated } from './generated.ts';
import { defaultThreads } from './pool.ts';
import { runRangeJobs, type RandomJob, type RangeJob, type Shares } from './range-jobs.ts';

/** Bumped whenever the method or the layout changes: `check-tables` then demands a regeneration. */
export const GENERATOR = 'gen-ranges@2';

/** Monte Carlo trials of every ranking cell and every range cell (PLAN §8.3). */
export const TRIALS = 200_000;

/**
 * The weight of `z(eqVs1)` in the first pass; `z(shareVs4)` gets the rest. The plan starts at 0.5
 * and says "tune the 0.5 weight if any fails": at 0.5 the only failure is "72o is in the bottom 1%"
 * (42o and 32o rank below it), which holds from 0 to 0.35 and fails from 0.4 up. 0.25 sits in the
 * middle of that range (chunk 5.1). The first pass was the whole ranking until
 * fix/coach-strategy-audit; now it only picks the caller's range.
 */
export const RANK_WEIGHT = 0.25;

/** The caller's range of the second pass: the top 25% of the first order (§8.6, "call a raise"). */
export const CALLER_RANGE_PCT = 25;

/**
 * The weight of `z(eqVsCaller)` in the final score; `z(shareVs4)` gets the rest: heads-up against
 * the hands that call an open, and the share of a five-way pot (the suited connectors' strength).
 * At 0.5 the §8.3 acceptance passes with the late-position opens (`--scan`).
 */
export const CALLER_WEIGHT = 0.5;

/** The rivals of the two ranking cells: one random hand, and four (the equity share of five). */
export const RANK_OPPONENTS: readonly [number, number] = [1, 4];

export const RANGES_FILE = 'ranges.ts';

/** The fixed seed of the table; every cell derives its own from it. */
export const TABLE_SEED: Seed128 = deriveSeed(ZERO_SEED, 'gen-ranges');

/** The seed of the ranking cell (class, opponents) under `parent`. */
export function rankSeed(parent: Seed128, cls: number, nOpp: number): Seed128 {
  return deriveSeed(parent, 'rank', cls, nOpp);
}

/** The seed of the range cell (class, range number) under `parent`. */
export function rangeSeed(parent: Seed128, cls: number, knot: number): Seed128 {
  return deriveSeed(parent, 'range', cls, knot);
}

/** The seed of the second pass's cell (class against the caller's range) under `parent`. */
export function callerSeed(parent: Seed128, cls: number): Seed128 {
  return deriveSeed(parent, 'caller', cls);
}

/** z-scores: (x − mean) / standard deviation, over the classes (population deviation). */
export function zScores(values: readonly number[]): number[] {
  const n = values.length;
  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  const sd = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n);
  if (!(sd > 0)) throw new RangeError('zScores: the values do not vary');
  return values.map((v) => (v - mean) / sd);
}

/**
 * The classes from the best to the worst by `weight·z(first) + (1 − weight)·z(share4)`; equal
 * scores keep the order of the class index. The first pass passes `eqVs1` and `RANK_WEIGHT`, the
 * final one `eqVsCaller` and `CALLER_WEIGHT` (`finalOrder`).
 */
export function rankOrder(
  first: readonly number[],
  share4: readonly number[],
  weight: number = RANK_WEIGHT,
): number[] {
  if (first.length !== RANGE_CLASSES || share4.length !== RANGE_CLASSES) {
    throw new RangeError(`rankOrder: need ${RANGE_CLASSES} values each`);
  }
  if (!(weight >= 0 && weight <= 1)) throw new RangeError(`rankOrder: weight ${weight}`);
  const z1 = zScores(first);
  const z4 = zScores(share4);
  const score = z1.map((a, i) => weight * a + (1 - weight) * (z4[i] as number));
  return [...score.keys()].sort((a, b) => (score[b] as number) - (score[a] as number) || a - b);
}

/** The final order: `CALLER_WEIGHT·z(eqVsCaller) + (1 − CALLER_WEIGHT)·z(shareVs4)`. */
export function finalOrder(
  eqCaller: readonly number[],
  share4: readonly number[],
  weight: number = CALLER_WEIGHT,
): number[] {
  return rankOrder(eqCaller, share4, weight);
}

/** The second pass's jobs: every class against one hand from the top 25% of the first order. */
export function callerJobs(
  firstOrder: readonly number[],
  trials: number,
  parent: Seed128 = TABLE_SEED,
): RangeJob[] {
  const weights = Array.from(topWeights(firstOrder, CALLER_RANGE_PCT));
  return Array.from({ length: RANGE_CLASSES }, (_, cls) => ({
    kind: 'range' as const,
    cls,
    weights,
    trials,
    seed: callerSeed(parent, cls),
  }));
}

/** The ranking jobs: every class against 1 and against 4 random hands. */
export function rankJobs(trials: number, parent: Seed128 = TABLE_SEED): RandomJob[] {
  const jobs: RandomJob[] = [];
  for (const nOpp of RANK_OPPONENTS) {
    for (let cls = 0; cls < RANGE_CLASSES; cls++) {
      jobs.push({ kind: 'random', cls, nOpp, trials, seed: rankSeed(parent, cls, nOpp) });
    }
  }
  return jobs;
}

/** The range cells of a ranking, class by class: `jobs[rangeWordIndex(class, knot)]`. */
export function rangeJobs(
  order: readonly number[],
  trials: number,
  parent: Seed128 = TABLE_SEED,
): RangeJob[] {
  const weights = RANGE_KNOTS.map((pct) => Array.from(topWeights(order, pct)));
  const jobs: RangeJob[] = [];
  for (let cls = 0; cls < RANGE_CLASSES; cls++) {
    RANGE_KNOTS.forEach((_, knot) => {
      jobs.push({
        kind: 'range',
        cls,
        weights: weights[knot] as number[],
        trials,
        seed: rangeSeed(parent, cls, knot),
      });
    });
  }
  return jobs;
}

/** A probability in [0, 1] as basis points (1 = 0.01 %). */
export function basisPoints(p: number): number {
  return Math.round(p * 10_000);
}

/**
 * The `ranges` blob (`decodeRanges` reads it back): the class at each rank, best first; then the
 * equity of every (class, range) in basis points as two byte planes (all high bytes, then all low
 * bytes: the high bytes barely change, which gzips better). `cells` is in `rangeWordIndex` order.
 */
export function encodeRanges(order: readonly number[], cells: readonly Shares[]): Uint8Array {
  if (cells.length !== RANGES_EQ_WORDS) {
    throw new RangeError(`need ${RANGES_EQ_WORDS} cells, got ${cells.length}`);
  }
  const out = new Uint8Array(RANGES_BYTES);
  order.forEach((cls, i) => {
    out[i] = cls;
  });
  cells.forEach((cell, i) => {
    const bp = basisPoints(cell.win + cell.split);
    if (bp < 0 || bp > 10_000) throw new RangeError(`cell ${i}: equity out of range`);
    out[RANGE_CLASSES + i] = bp >> 8;
    out[RANGE_CLASSES + RANGES_EQ_WORDS + i] = bp & 255;
  });
  return out;
}

function rangesModule(bytes: Uint8Array, trials: number): string {
  const knots = RANGE_KNOTS.length;
  return binaryModule(
    [
      `Generated by scripts/gen-ranges.ts (${GENERATOR}). Never edit by hand: \`npm run gen\``,
      'rewrites this file and `npm run gen:check` fails when it changes (PLAN section 7.5).',
      '',
      'The starting-hand ranking of the 169 classes and their equity against ranges (PLAN 8.3).',
      `First pass: ${RANK_WEIGHT}·z(equity vs 1 random hand) + ${1 - RANK_WEIGHT}·z(equity vs 4 random hands).`,
      `Final score: ${CALLER_WEIGHT}·z(equity vs one hand from the top ${CALLER_RANGE_PCT}% of the first pass)`,
      `+ ${1 - CALLER_WEIGHT}·z(equity vs 4 random hands). ${trials} trials each, table seed ${TABLE_SEED}.`,
      'rankPct is derived from the order: the percent of the 1,326 combos that rank at least as',
      'well as the class (AA = 0.45).',
      '',
      `Layout: ${bytes.length} bytes. First ${RANGE_CLASSES} bytes: the class at each rank, best first`,
      `(class index: core/cards.ts classOf; AA = 0, AKs = 1, AKo = 13, 22 = 168). Then 169 x ${knots}`,
      'words in two planes (all the high bytes, then all the low bytes): the equity of class c',
      `against the top X% of the combos, word c * ${knots} + j for X = ${RANGE_KNOTS.join(', ')},`,
      'in basis points (1 = 0.01 %). A class on the edge of a range counts in part. One rival,',
      "drawn from the range without the hero's cards.",
    ],
    {
      RANGES_TRIALS: trials,
      RANK_WEIGHT_PERCENT: Math.round(RANK_WEIGHT * 100),
      CALLER_WEIGHT_PERCENT: Math.round(CALLER_WEIGHT * 100),
    },
    'RANGES_B64',
    bytes,
  );
}

export interface GenerateOptions {
  /** Monte Carlo trials per cell. */
  readonly trials: number;
  readonly threads: number;
  /** Where the module and `checksums.json` are written. */
  readonly out: string;
  readonly log?: (line: string) => void;
}

/** Runs the ranking cells and returns `eq1` and `share4` by class. */
export async function sampleRanking(
  trials: number,
  threads: number,
  onDone?: (done: number) => void,
): Promise<{ eq1: number[]; share4: number[] }> {
  const jobs = rankJobs(trials);
  const results = await runRangeJobs(jobs, threads, onDone);
  const eq1: number[] = [];
  const share4: number[] = [];
  jobs.forEach((job, i) => {
    const r = results[i] as Shares;
    (job.nOpp === RANK_OPPONENTS[0] ? eq1 : share4)[job.cls] = r.win + r.split;
  });
  return { eq1, share4 };
}

/** Each class's equity against one hand from the top 25% of `firstOrder` (the second pass). */
export async function sampleCaller(
  firstOrder: readonly number[],
  trials: number,
  threads: number,
): Promise<number[]> {
  const results = await runRangeJobs(callerJobs(firstOrder, trials), threads);
  return results.map((r) => r.win + r.split);
}

/** Builds the ranking and the range equities and writes them with their checksum. Returns seconds. */
export async function generate(options: GenerateOptions): Promise<number> {
  const log = options.log ?? (() => undefined);
  const started = performance.now();
  const seconds = (): string => ((performance.now() - started) / 1000).toFixed(0);
  log(
    `ranking: ${3 * RANGE_CLASSES} cells x ${options.trials} trials on ${options.threads} threads`,
  );
  const { eq1, share4 } = await sampleRanking(options.trials, options.threads);
  const eqCaller = await sampleCaller(rankOrder(eq1, share4), options.trials, options.threads);
  const order = finalOrder(eqCaller, share4);
  const pct = rankPctFromOrder(order);
  const problems = rangeAcceptance((cls) => pct[cls] as number);
  log(
    `  ${seconds()} s; acceptance (PLAN 8.3): ${problems.length === 0 ? 'passes' : `FAILS: ${problems.join('; ')}`}`,
  );
  const jobs = rangeJobs(order, options.trials);
  log(`ranges: ${jobs.length} cells x ${options.trials} trials`);
  let lastPercent = -1;
  const cells = await runRangeJobs(jobs, options.threads, (done) => {
    const percent = Math.floor((100 * done) / jobs.length / 25) * 25;
    if (percent > lastPercent) {
      lastPercent = percent;
      log(`  ${percent}%  ${seconds()} s`);
    }
  });
  writeGenerated(
    options.out,
    RANGES_FILE,
    rangesModule(encodeRanges(order, cells), options.trials),
    {
      generator: GENERATOR,
      seed: TABLE_SEED,
      trials: options.trials,
    },
  );
  log(`wrote ${RANGES_FILE} and checksums.json to ${options.out}`);
  return (performance.now() - started) / 1000;
}

/** The caller weights 0, 0.05, ..., 1 and what each does to the §8.3 acceptance (`--scan`). */
export async function scanWeights(
  trials: number,
  threads: number,
  log: (line: string) => void,
): Promise<void> {
  const { eq1, share4 } = await sampleRanking(trials, threads);
  const eqCaller = await sampleCaller(rankOrder(eq1, share4), trials, threads);
  log(
    'weight of z(eqVsCaller): acceptance problems (percentile = combos strictly better | combos at least as good: the one used)',
  );
  for (let step = 0; step <= 20; step++) {
    const weight = step / 20;
    const order = finalOrder(eqCaller, share4, weight);
    const inclusive = rankPctFromOrder(order);
    const strict = (cls: number): number =>
      (inclusive[cls] as number) - (100 * comboCount(cls)) / COMBOS_TOTAL;
    const at = (name: string): string => (inclusive[classByName(name)] as number).toFixed(1);
    log(
      `w = ${weight.toFixed(2)}: strict [${rangeAcceptance(strict).join('; ') || 'pass'}] | ` +
        `inclusive [${rangeAcceptance((c) => inclusive[c] as number).join('; ') || 'pass'}] | ` +
        `rankPct 22 ${at('22')}, 44 ${at('44')}, 55 ${at('55')}, 76s ${at('76s')}, K2o ${at('K2o')}, 72o ${at('72o')}`,
    );
  }
  const order = finalOrder(eqCaller, share4);
  log(`worst five at w = ${CALLER_WEIGHT}: ${order.slice(-5).map(className).join(' ')}`);
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
      options: {
        trials: { type: 'string' },
        threads: { type: 'string' },
        out: { type: 'string' },
        scan: { type: 'boolean' },
      },
      strict: true,
    });
    const trials = values.trials === undefined ? TRIALS : positiveInteger(values.trials, 'trials');
    const threads =
      values.threads === undefined ? defaultThreads() : positiveInteger(values.threads, 'threads');
    const log = (line: string): void => console.log(line);
    if (values.scan === true) {
      await scanWeights(trials, threads, log);
    } else {
      if (trials !== TRIALS && values.out === undefined) {
        throw new Error(
          `--trials other than ${TRIALS} needs --out DIR: a trial run must not replace the committed table`,
        );
      }
      const seconds = await generate({
        trials,
        threads,
        out: values.out === undefined ? GENERATED_DIR : resolve(values.out),
        log,
      });
      console.log(`done in ${seconds.toFixed(1)} s`);
    }
  } catch (error) {
    console.error(`gen-ranges: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
