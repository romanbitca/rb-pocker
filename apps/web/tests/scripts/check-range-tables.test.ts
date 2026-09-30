import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  decodePushFold,
  decodeRanges,
  PUSH_FOLD_KNOWN_MISSES,
  PUSH_MAX_STACK_BB,
  RANGE_CLASSES,
  RANGE_KNOTS,
  rangeWordIndex,
  type PushFoldTable,
  type RangesTable,
} from '../../src/data/rangesLayout.ts';
import {
  CHECK_CELLS,
  checkPushFoldTable,
  checkRangeParameters,
  checkRangesTable,
  checkRangeTables,
  pickRangeCells,
  resampleRanges,
  TOLERANCE_POINTS,
} from '../../scripts/check-range-tables.ts';
import { GENERATOR as PUSH_GENERATOR, PUSH_FOLD_FILE } from '../../scripts/gen-pushfold.ts';
import { GENERATOR as RANGES_GENERATOR, RANGES_FILE } from '../../scripts/gen-ranges.ts';
import {
  CHECKSUMS_FILE,
  GENERATED_DIR,
  parseChecksums,
  readBase64Export,
  verifyChecksums,
} from '../../scripts/generated.ts';

const read = (file: string, name: string): string =>
  readBase64Export(readFileSync(join(GENERATED_DIR, file), 'utf8'), name);
const committedRanges = (): RangesTable => decodeRanges(read(RANGES_FILE, 'RANGES_B64'));
const committedPushFold = (): PushFoldTable =>
  decodePushFold(read(PUSH_FOLD_FILE, 'PUSH_FOLD_B64'));
const copyOf = (t: RangesTable): RangesTable => ({ order: t.order.slice(), eq: t.eq.slice() });

describe('the committed range tables', () => {
  it('match their checksums and the generators that are in the repository', () => {
    expect(verifyChecksums(GENERATED_DIR)).toEqual([]);
    expect(checkRangeParameters(GENERATED_DIR)).toEqual([]);
    const { files } = parseChecksums(readFileSync(join(GENERATED_DIR, CHECKSUMS_FILE), 'utf8'));
    expect(files[RANGES_FILE]).toMatchObject({ generator: RANGES_GENERATOR, trials: 200_000 });
    expect(files[PUSH_FOLD_FILE]).toMatchObject({ generator: PUSH_GENERATOR, trials: 40_000 });
  });

  it('are sound: a ranking that passes the §8.3 acceptance, and a push/fold table whose only misses are the known ones', () => {
    expect(checkRangesTable(committedRanges())).toEqual([]);
    const { problems, known } = checkPushFoldTable(committedPushFold());
    expect(problems).toEqual([]);
    expect(known).toHaveLength(PUSH_FOLD_KNOWN_MISSES.length);
  });

  it('agree with cells sampled again: each within 0.5 points, and no drift one way', async () => {
    const checks = await resampleRanges(committedRanges(), pickRangeCells());
    expect(checks).toHaveLength(CHECK_CELLS);
    for (const check of checks) expect(check.worst).toBeLessThanOrEqual(TOLERANCE_POINTS);
    // Two independent estimates differ by 0.16 points (1 sd), so the mean of 20 is within 0.12.
    const mean = checks.reduce((sum, c) => sum + (c.sampled - c.committed), 0) / checks.length;
    expect(Math.abs(mean)).toBeLessThan(0.12);
  }, 60_000);

  it('pass the whole check, and say which spots miss the published charts', async () => {
    const { problems, lines } = await checkRangeTables({ cells: 5, threads: 2 });
    expect(problems).toEqual([]);
    expect(lines.filter((line) => line.includes('KNOWN MISS'))).toHaveLength(3);
    expect(lines.some((line) => line.startsWith('ranges: 5 cells re-sampled'))).toBe(true);
  }, 60_000);
});

describe('which cells are sampled again', () => {
  it('are distinct, chosen by the seed, and cover every range first', () => {
    const cells = pickRangeCells();
    expect(cells).toHaveLength(CHECK_CELLS);
    expect(new Set(cells.map((c) => rangeWordIndex(c.cls, c.knot))).size).toBe(CHECK_CELLS);
    expect(new Set(cells.slice(0, RANGE_KNOTS.length).map((c) => c.knot)).size).toBe(
      RANGE_KNOTS.length,
    );
    expect(pickRangeCells()).toEqual(cells);
    expect(pickRangeCells(CHECK_CELLS, 'ab'.repeat(16))).not.toEqual(cells);
    for (const cell of cells) {
      expect(cell.cls).toBeGreaterThanOrEqual(0);
      expect(cell.cls).toBeLessThan(RANGE_CLASSES);
    }
  });

  it('refuses a bad count', () => {
    expect(() => pickRangeCells(0)).toThrow(RangeError);
    expect(() => pickRangeCells(1.5)).toThrow(RangeError);
    expect(() => pickRangeCells(RANGE_CLASSES * RANGE_KNOTS.length + 1)).toThrow(RangeError);
  });
});

describe('damaged tables are caught', () => {
  it('a ranking that repeats a class', () => {
    const table = copyOf(committedRanges());
    table.order[5] = table.order[4] as number;
    expect(checkRangesTable(table)).toEqual([expect.stringMatching(/not a ranking/)]);
  });

  it('a ranking that puts 72o up and AA down fails the §8.3 acceptance', () => {
    const table = copyOf(committedRanges());
    const last = RANGE_CLASSES - 1;
    [table.order[0], table.order[last]] = [table.order[last] as number, table.order[0] as number];
    const problems = checkRangesTable(table);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.every((p) => p.startsWith('ranges: '))).toBe(true);
  });

  it('an equity above 100% and one that falls as the range widens', () => {
    const table = copyOf(committedRanges());
    table.eq[rangeWordIndex(3, 4)] = 10_001;
    table.eq[rangeWordIndex(7, 6)] = 0;
    const problems = checkRangesTable(table);
    expect(problems.some((p) => p.includes('10100') || p.includes('100.01%'))).toBe(true);
    expect(problems.some((p) => p.includes('falls from'))).toBe(true);
  });

  it('a push/fold value above 100%, 1 bb that does not shove everything, and a miss that is not known', () => {
    const base = committedPushFold();
    const push = base.push.slice();
    push[0] = 10_001; // k = 1, S = 1
    push[1 * PUSH_MAX_STACK_BB] = 9_000; // k = 2, S = 1: not 100%
    push[0 * PUSH_MAX_STACK_BB + 9] = 3_000; // SB at 10 bb: 30%, outside 55-70%
    const { problems } = checkPushFoldTable({ push, call: base.call });
    expect(problems.some((p) => p.includes('value 0 is 100.01%'))).toBe(true);
    expect(problems.some((p) => p.includes('k = 2 and 1 bb'))).toBe(true);
    expect(problems.some((p) => p.includes('SB at 10 bb'))).toBe(true);
  });

  it('a known miss that has come inside its band must leave the list', () => {
    const base = committedPushFold();
    const push = base.push.slice();
    push[2 * PUSH_MAX_STACK_BB + 9] = 3_000; // k = 3, S = 10: the CO at 10 bb, 30% is inside 28-38%
    const { problems } = checkPushFoldTable({ push, call: base.call });
    expect(problems).toEqual([expect.stringContaining('CO at 10 bb is inside its band now')]);
  });
});

describe('checksum verification', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'check-range-tables-'));
    cpSync(GENERATED_DIR, dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('a copy of the committed folder is clean', async () => {
    expect(verifyChecksums(dir)).toEqual([]);
    expect(checkRangeParameters(dir)).toEqual([]);
  });

  it('an edited module stops the check at once, before any sampling', async () => {
    const path = join(dir, RANGES_FILE);
    writeFileSync(path, readFileSync(path, 'utf8').replace(/'([A-Za-z0-9+/])/, "'A$1"));
    const result = await checkRangeTables({ dir, threads: 1 });
    expect(result.problems).toEqual([
      expect.stringContaining(`${RANGES_FILE} does not match its checksum`),
    ]);
    expect(result.lines).toEqual([]);
  });

  it('a missing module and an unlisted module are named', () => {
    unlinkSync(join(dir, PUSH_FOLD_FILE));
    writeFileSync(join(dir, 'stray.ts'), 'export const X = 1;\n');
    const problems = verifyChecksums(dir);
    expect(problems).toContainEqual(expect.stringContaining(`${PUSH_FOLD_FILE} is listed`));
    expect(problems).toContainEqual(expect.stringContaining('stray.ts is not listed'));
  });

  it("a generator, seed or trial count that is not the script's says which command to run", () => {
    const path = join(dir, CHECKSUMS_FILE);
    const text = readFileSync(path, 'utf8');
    writeFileSync(
      path,
      text.replace(RANGES_GENERATOR, 'gen-ranges@0').replace(/"trials": 40000/, '"trials": 39999'),
    );
    const problems = checkRangeParameters(dir);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('npm run gen:ranges');
    expect(problems[1]).toContain('npm run gen:pushfold');
  });

  it('a module that says another number of trials than the script', () => {
    const path = join(dir, RANGES_FILE);
    writeFileSync(
      path,
      readFileSync(path, 'utf8').replace('RANGES_TRIALS = 200000', 'RANGES_TRIALS = 1'),
    );
    expect(checkRangeParameters(dir)).toContainEqual(
      expect.stringContaining('different number of trials'),
    );
  });
});

describe('scripts/check-range-tables.ts from the command line', () => {
  it('exits 0 on the committed tables and prints what it checked', () => {
    const script = fileURLToPath(new URL('../../scripts/check-range-tables.ts', import.meta.url));
    const run = spawnSync(process.execPath, [script, '--cells', '3'], { encoding: 'utf8' });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('check-range-tables: ok');
    expect(run.stdout).toContain('KNOWN MISS');
  }, 60_000);

  it('exits 1 with one line per problem on a damaged folder', () => {
    const script = fileURLToPath(new URL('../../scripts/check-range-tables.ts', import.meta.url));
    const dir = mkdtempSync(join(tmpdir(), 'check-range-tables-'));
    try {
      cpSync(GENERATED_DIR, dir, { recursive: true });
      unlinkSync(join(dir, RANGES_FILE));
      const run = spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
      expect(run.status).toBe(1);
      expect(run.stderr).toContain(`${RANGES_FILE} is listed in ${CHECKSUMS_FILE} but missing`);
      expect(run.stderr).toContain('1 problem.');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const bad = spawnSync(process.execPath, [script, '--cells', 'x'], { encoding: 'utf8' });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('--cells needs a positive integer');
  }, 60_000);
});
