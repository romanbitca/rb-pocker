import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CHECK_CELLS,
  CHECK_SEED,
  checkFinals,
  checkParameters,
  checkTables,
  FINALS_CHECKS,
  pickCells,
  pickClasses,
  recount,
  resample,
  SEVEN_CARD_COUNTS,
  TOLERANCE_POINTS,
} from '../../scripts/check-tables.ts';
import { EQUITY_FILE, FINALS_FILE, GENERATOR } from '../../scripts/gen-preflop.ts';
import {
  binaryModule,
  CHECKSUMS_FILE,
  formatChecksums,
  GENERATED_DIR,
  parseChecksums,
  readBase64Export,
  verifyChecksums,
  writeGenerated,
  type ChecksumEntry,
} from '../../scripts/generated.ts';
import {
  decodeEquityTable,
  decodeFinalsTable,
  equityWordIndex,
  FINALS_BOARDS,
  PREFLOP_CLASSES,
  PREFLOP_MAX_OPPONENTS,
} from '../../src/data/preflopLayout.ts';

const SCRIPT = fileURLToPath(new URL('../../scripts/check-tables.ts', import.meta.url));

let copy: string;

beforeEach(() => {
  copy = mkdtempSync(join(tmpdir(), 'check-tables-'));
  cpSync(GENERATED_DIR, copy, { recursive: true });
});

afterEach(() => {
  rmSync(copy, { recursive: true, force: true });
});

/** Changes one character inside the base64 string of a generated module, as a hand edit would. */
function tamper(dir: string, file: string): void {
  const path = join(dir, file);
  const text = readFileSync(path, 'utf8');
  const at = text.indexOf("'", text.indexOf('_B64 =')) + 20;
  writeFileSync(path, text.slice(0, at) + (text[at] === 'A' ? 'B' : 'A') + text.slice(at + 1));
}

function tablesOf(dir: string): { equity: Uint16Array; finals: Uint32Array } {
  const read = (file: string, name: string): string =>
    readBase64Export(readFileSync(join(dir, file), 'utf8'), name);
  return {
    equity: decodeEquityTable(read(EQUITY_FILE, 'PREFLOP_EQUITY_B64')),
    finals: decodeFinalsTable(read(FINALS_FILE, 'FINALS_B64')),
  };
}

describe('scripts/check-tables.ts: the committed tables', () => {
  it('match their checksums and the generator that is in the repository', () => {
    expect(verifyChecksums(GENERATED_DIR)).toEqual([]);
    expect(checkParameters(GENERATED_DIR)).toEqual([]);
    const { files } = parseChecksums(readFileSync(join(GENERATED_DIR, CHECKSUMS_FILE), 'utf8'));
    // The range tables (chunk 5.1) share the folder and the checksum file.
    expect(Object.keys(files)).toEqual([FINALS_FILE, EQUITY_FILE, 'pushfold.ts', 'ranges.ts']);
    expect(files[EQUITY_FILE]).toMatchObject({ generator: GENERATOR, trials: 500_000 });
    expect(files[FINALS_FILE]).toMatchObject({ generator: GENERATOR, seed: null, trials: null });
  });

  it('have finals that add up to C(50,5) and equal Appendix C.1 over all starting hands', () => {
    const { finals } = tablesOf(GENERATED_DIR);
    expect(checkFinals(finals)).toEqual([]);
    expect(SEVEN_CARD_COUNTS.reduce((sum, n) => sum + n, 0)).toBe(133_784_560); // C(52,7)
  });

  it('pass the whole check, re-sampling cells with the CI settings', async () => {
    const result = await checkTables({ cells: 3 });
    expect(result.problems).toEqual([]);
    expect(result.lines.join('\n')).toMatch(/3 cells re-sampled with 200000 trials/);
  }, 120_000);
});

describe('scripts/check-tables.ts: tampered files (PLAN §7.5: nobody edits generated files)', () => {
  it.each([EQUITY_FILE, FINALS_FILE])(
    'reports a hand edit of %s as a checksum mismatch',
    (file) => {
      tamper(copy, file);
      expect(verifyChecksums(copy)).toEqual([
        `${file} does not match its checksum: edited by hand, or not regenerated`,
      ]);
    },
  );

  it('stops at once with a message and exit code 1 (the command CI runs)', () => {
    const good = spawnSync(process.execPath, [SCRIPT, copy, '--cells', '2'], { encoding: 'utf8' });
    expect(good.status, good.stderr).toBe(0);
    expect(good.stdout).toContain('2 cells re-sampled');
    expect(good.stdout).toContain('check-tables: ok');

    tamper(copy, EQUITY_FILE);
    const run = spawnSync(process.execPath, [SCRIPT, copy, '--cells', '2'], { encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(`${EQUITY_FILE} does not match its checksum`);
    expect(run.stdout).not.toContain('re-sampled'); // no sampling of damaged files

    const bad = spawnSync(process.execPath, [SCRIPT, copy, '--cells', '0'], { encoding: 'utf8' });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('--cells needs a positive integer');
  }, 120_000);

  it('notices a missing file, an unlisted file and a missing checksums.json', () => {
    rmSync(join(copy, FINALS_FILE));
    writeFileSync(join(copy, 'extra.ts'), 'export const x = 1;\n');
    expect(verifyChecksums(copy)).toEqual([
      `${FINALS_FILE} is listed in ${CHECKSUMS_FILE} but missing`,
      `extra.ts is not listed in ${CHECKSUMS_FILE}`,
    ]);
    rmSync(join(copy, CHECKSUMS_FILE));
    expect(verifyChecksums(copy)).toEqual([`${CHECKSUMS_FILE} is missing from ${copy}`]);
  });

  it('catches finals that were changed and given a matching checksum (the counts no longer fit)', () => {
    const bytes = Buffer.from(
      readBase64Export(readFileSync(join(copy, FINALS_FILE), 'utf8'), 'FINALS_B64'),
      'base64',
    );
    bytes[0] = (bytes[0] as number) ^ 1; // one board more or less for Aces: high card
    const text = binaryModule(['forged'], {}, 'FINALS_B64', bytes);
    writeGenerated(copy, FINALS_FILE, text, { generator: GENERATOR, seed: null, trials: null });
    expect(verifyChecksums(copy)).toEqual([]); // the checksum cannot see it
    const problems = checkFinals(tablesOf(copy).finals);
    expect(problems.length).toBeGreaterThanOrEqual(2);
    expect(problems[0]).toContain(`not ${FINALS_BOARDS}`); // the row of Aces
    expect(problems.join('\n')).toContain('Appendix C.1'); // and the published totals
  });

  it('asks for a regeneration when the recorded generator, seed or trials are not the current ones', () => {
    const path = join(copy, CHECKSUMS_FILE);
    const { files } = parseChecksums(readFileSync(path, 'utf8'));
    const equity = files[EQUITY_FILE] as ChecksumEntry;
    const finals = files[FINALS_FILE] as ChecksumEntry;
    const record = (entries: Record<string, ChecksumEntry>): void =>
      writeFileSync(path, formatChecksums({ files: entries }));

    record({ ...files, [EQUITY_FILE]: { ...equity, trials: 20_000 } });
    const problems = checkParameters(copy);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('run `npm run gen`');

    record({ ...files, [EQUITY_FILE]: { ...equity, seed: '0'.repeat(32) } });
    expect(checkParameters(copy)).toHaveLength(1);

    record({ ...files, [FINALS_FILE]: { ...finals, generator: 'gen-preflop@0' } });
    expect(checkParameters(copy)[0]).toContain('gen-preflop@0');

    record({ [EQUITY_FILE]: equity });
    expect(checkParameters(copy).join('\n')).toContain(`no entry for ${FINALS_FILE}`);
  });
});

describe('scripts/check-tables.ts: re-sampling', () => {
  it('picks 20 distinct cells from a fixed seed, every opponent count at least once', () => {
    const cells = pickCells();
    expect(cells).toHaveLength(CHECK_CELLS);
    expect(pickCells()).toEqual(cells);
    expect(new Set(cells.map((c) => `${c.cls}/${c.nOpp}`)).size).toBe(CHECK_CELLS);
    expect(new Set(cells.map((c) => c.nOpp))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8]));
    for (const { cls, nOpp } of cells) {
      expect(cls).toBeGreaterThanOrEqual(0);
      expect(cls).toBeLessThan(PREFLOP_CLASSES);
      expect(nOpp).toBeLessThanOrEqual(PREFLOP_MAX_OPPONENTS);
    }
    expect(pickCells(20, '0'.repeat(32))).not.toEqual(cells);
    expect(pickCells(3, CHECK_SEED)).toEqual(cells.slice(0, 3));
    expect(() => pickCells(0)).toThrow(RangeError);
    expect(() => pickCells(1353)).toThrow(RangeError);
  });

  it('picks 3 distinct classes from a fixed seed, and counts their boards again exactly', async () => {
    const classes = pickClasses();
    expect(classes).toHaveLength(FINALS_CHECKS);
    expect(new Set(classes).size).toBe(FINALS_CHECKS);
    expect(pickClasses()).toEqual(classes);
    expect(pickClasses(3, '0'.repeat(32))).not.toEqual(classes);
    expect(classes.every((c) => Number.isInteger(c) && c >= 0 && c < PREFLOP_CLASSES)).toBe(true);
    expect(() => pickClasses(0)).toThrow(RangeError);
    expect(() => pickClasses(170)).toThrow(RangeError);
    const { finals } = tablesOf(GENERATED_DIR);
    expect(await recount(finals, classes, 2)).toEqual([]);
  }, 120_000);

  it('notices two finals rows swapped, which the totals over all classes cannot see', async () => {
    const { finals } = tablesOf(GENERATED_DIR);
    const swapped = Uint32Array.from(finals);
    for (let k = 0; k < 10; k++) {
      // Classes 1 and 2 are AKs and AQs: both suited, four combos each, so the C.1 totals hold.
      swapped[10 + k] = finals[20 + k] as number;
      swapped[20 + k] = finals[10 + k] as number;
    }
    expect(checkFinals(swapped)).toEqual([]);
    const problems = await recount(swapped, [1, 2, 3], 1);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('AKs');
    expect(problems[1]).toContain('AQs');
  }, 120_000);

  it('accepts the committed cells and fails a cell that is off by more than 0.5 points', async () => {
    const { equity } = tablesOf(GENERATED_DIR);
    const cell = { cls: 13, nOpp: 2 };
    const [ok] = await resample(equity, [cell], { threads: 1 });
    expect(ok?.worst).toBeLessThanOrEqual(TOLERANCE_POINTS);

    const off = Uint16Array.from(equity);
    const at = equityWordIndex(cell.cls, cell.nOpp);
    off[at] = (off[at] as number) + 100; // +1.00 point of win, and so of equity
    const [bad] = await resample(off, [cell], { threads: 1 });
    expect(bad?.worst).toBeGreaterThan(TOLERANCE_POINTS);
    expect(bad?.committed.win).toBeCloseTo((ok?.committed.win ?? 0) + 1, 9);
    expect(bad?.sampled).toEqual(ok?.sampled); // same seed: the same fresh sample
  }, 120_000);
});
