/**
 * The CI check of the generated tables (PLAN §7.5, "Testing strategy" → Data): `npm run gen:check`
 * (root, or `-w @rb/web`), or from apps/web `node scripts/check-tables.ts [generatedDir] [--cells N]`
 * (N cells instead of 20, for a quick look). Exits 1 with one line per problem.
 *
 * 1. Every module in `src/data/generated/` matches its SHA-256 in `checksums.json`, and nothing is
 *    missing or unlisted: nobody edited a generated file by hand.
 * 2. The generator version, seed and trial count on record are the ones `gen-preflop.ts` uses now:
 *    a changed method needs a regeneration.
 * 3. The finals table is sound. Each row adds up to C(50,5) boards. And all classes together, each
 *    counted once per suit combination (6 / 4 / 12), reproduce the published 7-card category
 *    counts of Appendix C.1, times 21: every 7-card hand is a hole pair plus a board in
 *    C(7,2) = 21 ways, so this is an exact check of all 169 rows against an outside source.
 * 4. Three rows of the finals table are counted again from scratch, exactly (the aggregate check
 *    cannot see two rows swapped).
 * 5. 20 cells of the equity table, chosen at random with a fixed seed (every opponent count at
 *    least once), are sampled again with 200,000 trials and a seed of this script's own. `win`,
 *    `split` and `equity` must each be within 0.5 points of the committed cell. Two independent
 *    estimates differ by up to 0.13 points (one standard deviation), so 0.5 is 3.8 sigma, and 0.3
 *    would fail about one run in three by chance (§7.5).
 *
 * The seeds are fixed, so a run is deterministic: it passes or fails the same way every time.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { className, classCombos } from '../src/core/cards.ts';
import { deriveSeed, randInt, rngFromSeed, ZERO_SEED, type Seed128 } from '../src/core/rng.ts';
import {
  decodeEquityTable,
  decodeFinalsTable,
  equityWordIndex,
  FINAL_CATEGORIES,
  FINALS_BOARDS,
  PREFLOP_CLASSES,
  PREFLOP_MAX_OPPONENTS,
} from '../src/data/preflopLayout.ts';
import {
  cellSeed,
  EQUITY_FILE,
  EQUITY_TRIALS,
  FINALS_FILE,
  GENERATOR,
  TABLE_SEED,
} from './gen-preflop.ts';
import {
  CHECKSUMS_FILE,
  GENERATED_DIR,
  parseChecksums,
  readBase64Export,
  readNumberExport,
  verifyChecksums,
} from './generated.ts';
import {
  defaultThreads,
  runJobs,
  type FinalsJob,
  type FinalsResult,
  type McJob,
  type McResult,
} from './table-jobs.ts';

/** Cells re-sampled, trials per re-sampled cell, and the allowed difference in percentage points. */
export const CHECK_CELLS = 20;
export const CHECK_TRIALS = 200_000;
export const TOLERANCE_POINTS = 0.5;

/** Finals rows counted again from scratch: exact, about 70 ms each. */
export const FINALS_CHECKS = 3;

/** The seed of the re-sampling: not the table seed, so the two estimates are independent. */
export const CHECK_SEED: Seed128 = deriveSeed(ZERO_SEED, 'check-tables');

/**
 * Appendix C.1: all C(52,7) = 133,784,560 seven-card hands by display category (high card, pair,
 * two pair, trips, straight, flush, full house, quads, straight flush, royal flush).
 */
export const SEVEN_CARD_COUNTS: readonly number[] = [
  23_294_460, 58_627_800, 31_433_400, 6_461_620, 6_180_020, 4_047_644, 3_473_184, 224_848, 37_260,
  4_324,
];

/** The ways to choose 2 hole cards out of 7: each 7-card hand is counted this often. */
const HOLE_CHOICES = 21;

export interface Cell {
  readonly cls: number;
  readonly nOpp: number;
}

/**
 * `count` distinct cells, chosen at random from the seed: the first eight cover each opponent
 * count once (a damaged column cannot hide), the rest are free picks.
 */
export function pickCells(count: number = CHECK_CELLS, seed: Seed128 = CHECK_SEED): Cell[] {
  if (!Number.isInteger(count) || count < 1 || count > PREFLOP_CLASSES * PREFLOP_MAX_OPPONENTS) {
    throw new RangeError(`pickCells: bad count ${count}`);
  }
  const rng = rngFromSeed(seed);
  const cells: Cell[] = [];
  const seen = new Set<number>();
  for (let i = 0; cells.length < count; i++) {
    const nOpp = i < PREFLOP_MAX_OPPONENTS ? i + 1 : 1 + randInt(rng, PREFLOP_MAX_OPPONENTS);
    const cls = randInt(rng, PREFLOP_CLASSES);
    const key = cls * PREFLOP_MAX_OPPONENTS + nOpp;
    if (seen.has(key)) continue;
    seen.add(key);
    cells.push({ cls, nOpp });
  }
  return cells;
}

/** What `gen-preflop.ts` now says about the modules, against what `checksums.json` recorded. */
export function checkParameters(dir: string): string[] {
  const problems: string[] = [];
  const { files } = parseChecksums(readFileSync(join(dir, CHECKSUMS_FILE), 'utf8'));
  const expected = [
    { file: EQUITY_FILE, seed: TABLE_SEED, trials: EQUITY_TRIALS },
    { file: FINALS_FILE, seed: null, trials: null },
  ];
  for (const { file, seed, trials } of expected) {
    const entry = files[file];
    if (entry === undefined) {
      problems.push(`${CHECKSUMS_FILE} has no entry for ${file}`);
    } else if (entry.generator !== GENERATOR || entry.seed !== seed || entry.trials !== trials) {
      problems.push(
        `${file} was made by ${entry.generator} (seed ${entry.seed ?? 'none'}, trials ${entry.trials ?? 'none'}) ` +
          `but gen-preflop.ts is now ${GENERATOR} (seed ${seed ?? 'none'}, trials ${trials ?? 'none'}): run \`npm run gen\``,
      );
    }
  }
  const moduleTrials = readNumberExport(
    readFileSync(join(dir, EQUITY_FILE), 'utf8'),
    'PREFLOP_EQUITY_TRIALS',
  );
  if (moduleTrials !== EQUITY_TRIALS) {
    problems.push(`${EQUITY_FILE} says ${moduleTrials} trials per cell, not ${EQUITY_TRIALS}`);
  }
  return problems;
}

/** Row sums and the Appendix C.1 cross-check of the finals table (see the file header, 3). */
export function checkFinals(words: Uint32Array): string[] {
  const problems: string[] = [];
  const weighted = new Array<number>(FINAL_CATEGORIES).fill(0);
  for (let cls = 0; cls < PREFLOP_CLASSES; cls++) {
    let total = 0;
    for (let k = 0; k < FINAL_CATEGORIES; k++) {
      const n = words[cls * FINAL_CATEGORIES + k] as number;
      total += n;
      weighted[k] = (weighted[k] as number) + classCombos(cls) * n;
    }
    if (total !== FINALS_BOARDS) {
      problems.push(`finals: class ${cls} adds up to ${total} boards, not ${FINALS_BOARDS}`);
    }
  }
  SEVEN_CARD_COUNTS.forEach((count, k) => {
    if (weighted[k] !== HOLE_CHOICES * count) {
      problems.push(
        `finals: category ${k} over all starting hands is ${weighted[k]}, ` +
          `not ${HOLE_CHOICES * count} (Appendix C.1 x ${HOLE_CHOICES})`,
      );
    }
  });
  return problems;
}

/** A cell's three numbers in percent. */
export interface Shares {
  readonly win: number;
  readonly split: number;
  readonly equity: number;
}

export interface CellCheck {
  readonly cell: Cell;
  readonly committed: Shares;
  readonly sampled: Shares;
  /** The largest of the three differences, in percentage points. */
  readonly worst: number;
}

function shares(win: number, split: number): Shares {
  return { win, split, equity: win + split };
}

/**
 * Samples each cell again (`trials` Monte Carlo trials, seeds under `seed`, `threads` threads)
 * and compares it with the committed table `words` (basis points).
 */
export async function resample(
  words: Uint16Array,
  cells: readonly Cell[],
  options: { trials?: number; threads?: number; seed?: Seed128 } = {},
): Promise<CellCheck[]> {
  const trials = options.trials ?? CHECK_TRIALS;
  const seed = options.seed ?? CHECK_SEED;
  const jobs: McJob[] = cells.map(({ cls, nOpp }) => ({
    kind: 'mc',
    cls,
    nOpp,
    trials,
    seed: cellSeed(seed, cls, nOpp),
  }));
  const threads = Math.max(1, Math.min(options.threads ?? defaultThreads(), jobs.length));
  const results = await runJobs(jobs, threads);
  return cells.map((cell, i) => {
    const at = equityWordIndex(cell.cls, cell.nOpp);
    const committed = shares((words[at] as number) / 100, (words[at + 1] as number) / 100);
    const { win, split } = results[i] as McResult;
    const sampled = shares(win * 100, split * 100);
    const worst = Math.max(
      Math.abs(sampled.win - committed.win),
      Math.abs(sampled.split - committed.split),
      Math.abs(sampled.equity - committed.equity),
    );
    return { cell, committed, sampled, worst };
  });
}

/** `count` distinct classes, chosen at random from the seed. */
export function pickClasses(count: number = FINALS_CHECKS, seed: Seed128 = CHECK_SEED): number[] {
  if (!Number.isInteger(count) || count < 1 || count > PREFLOP_CLASSES) {
    throw new RangeError(`pickClasses: bad count ${count}`);
  }
  const rng = rngFromSeed(deriveSeed(seed, 'finals'));
  const classes = new Set<number>();
  while (classes.size < count) classes.add(randInt(rng, PREFLOP_CLASSES));
  return [...classes];
}

/**
 * Counts the boards of each class again, exactly, and compares them with the committed rows. The
 * Appendix C.1 check sees only the totals over all classes: this one sees a single row (two rows
 * of equal weight swapped, say).
 */
export async function recount(
  words: Uint32Array,
  classes: readonly number[],
  threads: number = defaultThreads(),
): Promise<string[]> {
  const jobs: FinalsJob[] = classes.map((cls) => ({ kind: 'finals', cls }));
  const results = await runJobs(jobs, Math.max(1, Math.min(threads, jobs.length)));
  const problems: string[] = [];
  classes.forEach((cls, i) => {
    const counted = (results[i] as FinalsResult).counts;
    const row = words.subarray(cls * FINAL_CATEGORIES, (cls + 1) * FINAL_CATEGORIES);
    if (counted.some((n, k) => n !== row[k])) {
      problems.push(
        `finals: ${className(cls)} counted again is [${counted.join(', ')}], the table has [${row.join(', ')}]`,
      );
    }
  });
  return problems;
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
export async function checkTables(options: CheckOptions = {}): Promise<CheckResult> {
  const dir = options.dir ?? GENERATED_DIR;
  const lines: string[] = [];
  const sums = verifyChecksums(dir);
  if (sums.length > 0) return { problems: sums, lines };
  lines.push(`checksums: ${EQUITY_FILE} and ${FINALS_FILE} match ${CHECKSUMS_FILE}`);

  const problems = checkParameters(dir);
  const read = (file: string, name: string): string =>
    readBase64Export(readFileSync(join(dir, file), 'utf8'), name);
  const finals = decodeFinalsTable(read(FINALS_FILE, 'FINALS_B64'));
  problems.push(...checkFinals(finals));
  lines.push(
    `finals: ${PREFLOP_CLASSES} rows add up to ${FINALS_BOARDS} boards; all classes together ` +
      `equal Appendix C.1 x ${HOLE_CHOICES}`,
  );
  const classes = pickClasses();
  problems.push(...(await recount(finals, classes, options.threads)));
  lines.push(`finals: ${classes.map(className).join(', ')} counted again exactly, same rows`);

  const words = decodeEquityTable(read(EQUITY_FILE, 'PREFLOP_EQUITY_B64'));
  const cells = pickCells(options.cells ?? CHECK_CELLS);
  const started = performance.now();
  const checks = await resample(words, cells, {
    ...(options.trials === undefined ? {} : { trials: options.trials }),
    ...(options.threads === undefined ? {} : { threads: options.threads }),
  });
  for (const check of checks) {
    if (check.worst > TOLERANCE_POINTS) {
      const { cls, nOpp } = check.cell;
      problems.push(
        `equity: class ${cls} against ${nOpp}: committed ${check.committed.equity.toFixed(2)}%, ` +
          `sampled ${check.sampled.equity.toFixed(2)}% (off by up to ${check.worst.toFixed(2)} points, limit ${TOLERANCE_POINTS})`,
      );
    }
  }
  const worst = Math.max(...checks.map((check) => check.worst));
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  lines.push(
    `equity: ${checks.length} cells re-sampled with ${options.trials ?? CHECK_TRIALS} trials in ${seconds} s, ` +
      `worst difference ${worst.toFixed(2)} points (limit ${TOLERANCE_POINTS})`,
  );
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
    const { problems, lines } = await checkTables({ dir, cells });
    for (const line of lines) console.log(line);
    if (problems.length > 0) {
      for (const problem of problems) console.error(`check-tables: ${problem}`);
      console.error(`check-tables: ${problems.length} problem${problems.length === 1 ? '' : 's'}.`);
      process.exitCode = 1;
    } else {
      console.log('check-tables: ok');
    }
  } catch (error) {
    console.error(`check-tables: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
