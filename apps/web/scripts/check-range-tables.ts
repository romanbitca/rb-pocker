/**
 * The CI check of the range tables (PLAN §7.5, "Testing strategy" → Data): from apps/web
 * `node scripts/check-range-tables.ts [generatedDir] [--cells N]` (`npm run gen:check` runs it with
 * the preflop check). Exits 1 with one line per problem.
 *
 * 1. Every module in `src/data/generated/` matches its SHA-256 in `checksums.json` (nobody edited
 *    a generated file by hand).
 * 2. The generator version, seed and trial count on record are the ones `gen-ranges.ts` and
 *    `gen-pushfold.ts` use now: a changed method needs a regeneration.
 * 3. The `ranges` table is sound: the order is a ranking of the 169 classes, it passes the §8.3
 *    acceptance, and every equity row grows with the width of the range (within the noise).
 * 4. The `pushfold` table is sound: percentages in range, the small blind shoves every hand with
 *    1 bb (the big blind's call is free), and it passes the §8.4 acceptance at 10 and 12 bb (the
 *    published no-ante chart ± 3 points).
 * 5. 20 cells of the `eqVsRange` table, chosen at random with a fixed seed (every range at least
 *    once), are sampled again with 200,000 trials and a seed of this script's own: each must be
 *    within 0.5 points of the committed cell (two independent estimates differ by up to 0.16
 *    points, one standard deviation, so 0.5 is 3 sigma, §7.5).
 *
 * The seeds are fixed, so a run is deterministic: it passes or fails the same way every time.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { className } from '../src/core/cards.ts';
import { deriveSeed, randInt, rngFromSeed, ZERO_SEED, type Seed128 } from '../src/core/rng.ts';
import {
  decodePushFold,
  decodeRanges,
  orderProblem,
  PUSH_MAX_STACK_BB,
  pushFoldAcceptance,
  RANGE_CLASSES,
  RANGE_KNOTS,
  rangeAcceptance,
  rangeWordIndex,
  rankPctFromOrder,
  topWeights,
  type PushFoldTable,
  type RangesTable,
} from '../src/data/rangesLayout.ts';
import {
  GENERATOR as PUSH_GENERATOR,
  PAIR_TRIALS,
  PUSH_FOLD_FILE,
  TABLE_SEED as PUSH_SEED,
} from './gen-pushfold.ts';
import {
  GENERATOR as RANGES_GENERATOR,
  RANGES_FILE,
  rangeSeed,
  TABLE_SEED as RANGES_SEED,
  TRIALS as RANGES_TRIALS,
} from './gen-ranges.ts';
import {
  CHECKSUMS_FILE,
  GENERATED_DIR,
  parseChecksums,
  readBase64Export,
  readNumberExport,
  verifyChecksums,
} from './generated.ts';
import { defaultThreads } from './pool.ts';
import { ITERATIONS as PUSH_ROUNDS } from './pushfold-solver.ts';
import { runRangeJobs, type RangeJob } from './range-jobs.ts';

/** Cells re-sampled, trials per re-sampled cell, and the allowed difference in percentage points. */
export const CHECK_CELLS = 20;
export const CHECK_TRIALS = 200_000;
export const TOLERANCE_POINTS = 0.5;

/** How far an equity may fall as the range widens before the row counts as damaged (noise ≈ 0.3). */
export const MONOTONE_SLACK_POINTS = 1;

/** The seed of the re-sampling: not the table seed, so the two estimates are independent. */
export const CHECK_SEED: Seed128 = deriveSeed(ZERO_SEED, 'check-range-tables');

export interface RangeCell {
  readonly cls: number;
  readonly knot: number;
}

/**
 * `count` distinct (class, range) cells, chosen at random from the seed: the first 13 cover each
 * range once (a damaged column cannot hide), the rest are free picks.
 */
export function pickRangeCells(
  count: number = CHECK_CELLS,
  seed: Seed128 = CHECK_SEED,
): RangeCell[] {
  const total = RANGE_CLASSES * RANGE_KNOTS.length;
  if (!Number.isInteger(count) || count < 1 || count > total) {
    throw new RangeError(`pickRangeCells: bad count ${count}`);
  }
  const rng = rngFromSeed(seed);
  const cells: RangeCell[] = [];
  const seen = new Set<number>();
  for (let i = 0; cells.length < count; i++) {
    const knot = i < RANGE_KNOTS.length ? i : randInt(rng, RANGE_KNOTS.length);
    const cls = randInt(rng, RANGE_CLASSES);
    const key = rangeWordIndex(cls, knot);
    if (seen.has(key)) continue;
    seen.add(key);
    cells.push({ cls, knot });
  }
  return cells;
}

/** What the generators say now, against what `checksums.json` and the modules recorded. */
export function checkRangeParameters(dir: string): string[] {
  const problems: string[] = [];
  const { files } = parseChecksums(readFileSync(join(dir, CHECKSUMS_FILE), 'utf8'));
  const expected = [
    {
      file: RANGES_FILE,
      generator: RANGES_GENERATOR,
      seed: RANGES_SEED,
      trials: RANGES_TRIALS,
      run: 'gen:ranges',
    },
    {
      file: PUSH_FOLD_FILE,
      generator: PUSH_GENERATOR,
      seed: PUSH_SEED,
      trials: PAIR_TRIALS,
      run: 'gen:pushfold',
    },
  ];
  for (const { file, generator, seed, trials, run } of expected) {
    const entry = files[file];
    if (entry === undefined) {
      problems.push(`${CHECKSUMS_FILE} has no entry for ${file}`);
    } else if (entry.generator !== generator || entry.seed !== seed || entry.trials !== trials) {
      problems.push(
        `${file} was made by ${entry.generator} (seed ${entry.seed ?? 'none'}, trials ${entry.trials ?? 'none'}) ` +
          `but the script is now ${generator} (seed ${seed}, trials ${trials}): run \`npm run ${run}\``,
      );
    }
  }
  const moduleNumber = (file: string, name: string): number =>
    readNumberExport(readFileSync(join(dir, file), 'utf8'), name);
  if (moduleNumber(RANGES_FILE, 'RANGES_TRIALS') !== RANGES_TRIALS) {
    problems.push(`${RANGES_FILE} says a different number of trials than ${RANGES_TRIALS}`);
  }
  if (moduleNumber(PUSH_FOLD_FILE, 'PUSH_FOLD_TRIALS') !== PAIR_TRIALS) {
    problems.push(`${PUSH_FOLD_FILE} says a different number of trials than ${PAIR_TRIALS}`);
  }
  if (moduleNumber(PUSH_FOLD_FILE, 'PUSH_FOLD_ITERATIONS') !== PUSH_ROUNDS) {
    problems.push(`${PUSH_FOLD_FILE} says a different number of rounds than ${PUSH_ROUNDS}`);
  }
  return problems;
}

/** The ranking and the equities: see the file header, 3. */
export function checkRangesTable(table: RangesTable): string[] {
  const order = orderProblem(table.order);
  if (order !== null) return [`ranges: the order is not a ranking: ${order}`];
  const problems: string[] = [];
  const pct = rankPctFromOrder(table.order);
  problems.push(...rangeAcceptance((cls) => pct[cls] as number).map((p) => `ranges: ${p}`));
  for (let cls = 0; cls < RANGE_CLASSES; cls++) {
    for (let knot = 0; knot < RANGE_KNOTS.length; knot++) {
      const bp = table.eq[rangeWordIndex(cls, knot)] as number;
      if (bp > 10_000)
        problems.push(`ranges: ${className(cls)} against range ${knot} is ${bp / 100}%`);
      if (knot > 0) {
        const before = table.eq[rangeWordIndex(cls, knot - 1)] as number;
        if (bp < before - MONOTONE_SLACK_POINTS * 100) {
          problems.push(
            `ranges: ${className(cls)} falls from ${before / 100}% to ${bp / 100}% as the range widens from ` +
              `${RANGE_KNOTS[knot - 1]}% to ${RANGE_KNOTS[knot]}%`,
          );
        }
      }
    }
  }
  return problems;
}

/** The shoving and calling ranges: see the file header, 4. */
export function checkPushFoldTable(table: PushFoldTable): string[] {
  const problems: string[] = [];
  const at = (k: number, S: number): number =>
    (table.push[(k - 1) * PUSH_MAX_STACK_BB + (S - 1)] as number) / 100;
  for (const [i, word] of [...table.push, ...table.call].entries()) {
    if (word > 10_000) problems.push(`pushfold: value ${i} is ${word / 100}%`);
  }
  if (at(1, 1) !== 100) {
    problems.push(`pushfold: the small blind with 1 bb shoves ${at(1, 1)}%, not 100%`);
  }
  problems.push(...pushFoldAcceptance(at).map((miss) => `pushfold: ${miss}`));
  return problems;
}

export interface RangeCellCheck {
  readonly cell: RangeCell;
  /** Committed and sampled equity, in percent. */
  readonly committed: number;
  readonly sampled: number;
  readonly worst: number;
}

/** Samples each cell again and compares it with the committed equity. */
export async function resampleRanges(
  table: RangesTable,
  cells: readonly RangeCell[],
  options: { trials?: number; threads?: number; seed?: Seed128 } = {},
): Promise<RangeCellCheck[]> {
  const trials = options.trials ?? CHECK_TRIALS;
  const seed = options.seed ?? CHECK_SEED;
  const weights = RANGE_KNOTS.map((pct) => Array.from(topWeights(table.order, pct)));
  const jobs: RangeJob[] = cells.map(({ cls, knot }) => ({
    kind: 'range',
    cls,
    weights: weights[knot] as number[],
    trials,
    seed: rangeSeed(seed, cls, knot),
  }));
  const threads = Math.max(1, Math.min(options.threads ?? defaultThreads(), jobs.length));
  const results = await runRangeJobs(jobs, threads);
  return cells.map((cell, i) => {
    const r = results[i] as { win: number; split: number };
    const committed = (table.eq[rangeWordIndex(cell.cls, cell.knot)] as number) / 100;
    const sampled = (r.win + r.split) * 100;
    return { cell, committed, sampled, worst: Math.abs(sampled - committed) };
  });
}

export interface CheckOptions {
  readonly dir?: string;
  readonly cells?: number;
  readonly trials?: number;
  readonly threads?: number;
}

export interface CheckResult {
  /** One sentence per problem; empty when every check passed. */
  readonly problems: string[];
  /** What was checked, for the log. */
  readonly lines: string[];
}

/** All the checks. A failed checksum stops the run: damaged files are not worth sampling. */
export async function checkRangeTables(options: CheckOptions = {}): Promise<CheckResult> {
  const dir = options.dir ?? GENERATED_DIR;
  const lines: string[] = [];
  const sums = verifyChecksums(dir);
  if (sums.length > 0) return { problems: sums, lines };
  lines.push(`checksums: ${RANGES_FILE} and ${PUSH_FOLD_FILE} match ${CHECKSUMS_FILE}`);

  const problems = checkRangeParameters(dir);
  const read = (file: string, name: string): string =>
    readBase64Export(readFileSync(join(dir, file), 'utf8'), name);
  const ranges = decodeRanges(read(RANGES_FILE, 'RANGES_B64'));
  problems.push(...checkRangesTable(ranges));
  lines.push(
    `ranges: a ranking of ${RANGE_CLASSES} classes that passes the PLAN 8.3 acceptance; equities grow with the range`,
  );
  const pushFold = decodePushFold(read(PUSH_FOLD_FILE, 'PUSH_FOLD_B64'));
  problems.push(...checkPushFoldTable(pushFold));
  lines.push(
    'pushfold: percentages in range, the small blind shoves everything with 1 bb, the PLAN 8.4 acceptance',
  );

  if (orderProblem(ranges.order) === null) {
    const started = performance.now();
    const checks = await resampleRanges(ranges, pickRangeCells(options.cells ?? CHECK_CELLS), {
      ...(options.trials === undefined ? {} : { trials: options.trials }),
      ...(options.threads === undefined ? {} : { threads: options.threads }),
    });
    for (const check of checks) {
      if (check.worst > TOLERANCE_POINTS) {
        problems.push(
          `ranges: ${className(check.cell.cls)} against the top ${RANGE_KNOTS[check.cell.knot]}%: committed ` +
            `${check.committed.toFixed(2)}%, sampled ${check.sampled.toFixed(2)}% (off by ${check.worst.toFixed(2)} points, limit ${TOLERANCE_POINTS})`,
        );
      }
    }
    const worst = Math.max(...checks.map((check) => check.worst));
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    lines.push(
      `ranges: ${checks.length} cells re-sampled with ${options.trials ?? CHECK_TRIALS} trials in ${seconds} s, ` +
        `worst difference ${worst.toFixed(2)} points (limit ${TOLERANCE_POINTS})`,
    );
  }
  return { problems, lines };
}

if (import.meta.main) {
  try {
    const { values, positionals } = parseArgs({
      options: { cells: { type: 'string' } },
      allowPositionals: true,
      strict: true,
    });
    const cells = values.cells === undefined ? CHECK_CELLS : Number(values.cells);
    if (!Number.isSafeInteger(cells) || cells < 1)
      throw new Error('--cells needs a positive integer');
    const dir = positionals[0] === undefined ? GENERATED_DIR : resolve(positionals[0]);
    const { problems, lines } = await checkRangeTables({ dir, cells });
    for (const line of lines) console.log(line);
    if (problems.length > 0) {
      for (const problem of problems) console.error(`check-range-tables: ${problem}`);
      console.error(
        `check-range-tables: ${problems.length} problem${problems.length === 1 ? '' : 's'}.`,
      );
      process.exitCode = 1;
    } else {
      console.log('check-range-tables: ok');
    }
  } catch (error) {
    console.error(`check-range-tables: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
