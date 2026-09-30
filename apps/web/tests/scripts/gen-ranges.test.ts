import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  COMBOS_TOTAL,
  comboCount,
  decodeRanges,
  RANGE_CLASSES,
  RANGE_KNOTS,
  RANGES_EQ_WORDS,
  rangeWordIndex,
  rankPctFromOrder,
  topWeights,
} from '../../src/data/rangesLayout.ts';
import {
  basisPoints,
  encodeRanges,
  generate,
  GENERATOR,
  RANGES_FILE,
  rangeJobs,
  rangeSeed,
  rankJobs,
  rankOrder,
  rankSeed,
  RANK_OPPONENTS,
  RANK_WEIGHT,
  TABLE_SEED,
  TRIALS,
  zScores,
} from '../../scripts/gen-ranges.ts';
import {
  parseChecksums,
  readBase64Export,
  readNumberExport,
  verifyChecksums,
} from '../../scripts/generated.ts';

const ascending = Array.from({ length: RANGE_CLASSES }, (_, i) => 1 - i / RANGE_CLASSES);
const descending = [...ascending].reverse();
const identity = Array.from({ length: RANGE_CLASSES }, (_, i) => i);

describe('z-scores and the ranking', () => {
  it('centres on 0 with a deviation of 1', () => {
    const z = zScores([1, 2, 3, 4, 10]);
    expect(z.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 12);
    expect(Math.sqrt(z.reduce((a, b) => a + b * b, 0) / z.length)).toBeCloseTo(1, 12);
    expect(() => zScores([3, 3, 3])).toThrow(RangeError);
  });

  it('sorts by the weighted score, best first', () => {
    // eqVs1 falls with the class index, shareVs4 rises: weight 1 follows the first, 0 the second.
    expect(rankOrder(ascending, descending, 1)).toEqual(identity);
    expect(rankOrder(ascending, descending, 0)).toEqual([...identity].reverse());
    expect(rankOrder(ascending, ascending, RANK_WEIGHT)).toEqual(identity);
  });

  it('keeps equal scores in class order and refuses bad input', () => {
    const steps = identity.map((i) => Math.floor(i / 2));
    const order = rankOrder(
      steps.map((s) => -s),
      steps.map((s) => -s),
      0.5,
    );
    expect(order).toEqual(identity);
    expect(() => rankOrder(ascending.slice(1), ascending, 0.5)).toThrow(RangeError);
    expect(() => rankOrder(ascending, ascending, 1.5)).toThrow(RangeError);
    expect(() => rankOrder(ascending, ascending, -0.1)).toThrow(RangeError);
  });

  it('uses the weight chosen after the scan of PLAN §8.3 (0.5 fails "72o in the bottom 1%")', () => {
    expect(RANK_WEIGHT).toBe(0.25);
    expect(RANK_OPPONENTS).toEqual([1, 4]);
    expect(TRIALS).toBe(200_000);
  });
});

describe('the jobs', () => {
  it('ranking cells: every class against 1 and against 4 random hands, each its own seed', () => {
    const jobs = rankJobs(123);
    expect(jobs).toHaveLength(2 * RANGE_CLASSES);
    expect(new Set(jobs.map((j) => j.seed)).size).toBe(jobs.length);
    expect(jobs[0]).toEqual({
      kind: 'random',
      cls: 0,
      nOpp: 1,
      trials: 123,
      seed: rankSeed(TABLE_SEED, 0, 1),
    });
    expect(jobs.at(-1)).toMatchObject({ cls: 168, nOpp: 4 });
  });

  it('range cells: class by class, in table order, each range the exact top X% of the order', () => {
    const order = [...identity].reverse();
    const jobs = rangeJobs(order, 77);
    expect(jobs).toHaveLength(RANGES_EQ_WORDS);
    expect(new Set(jobs.map((j) => j.seed)).size).toBe(jobs.length);
    for (const [cls, knot] of [
      [0, 0],
      [5, 7],
      [168, 12],
    ] as const) {
      const job = jobs[rangeWordIndex(cls, knot)];
      expect(job).toMatchObject({
        kind: 'range',
        cls,
        trials: 77,
        seed: rangeSeed(TABLE_SEED, cls, knot),
      });
      expect(job?.weights).toEqual(Array.from(topWeights(order, RANGE_KNOTS[knot] as number)));
    }
  });

  it('seeds depend on every argument', () => {
    expect(rankSeed(TABLE_SEED, 1, 4)).not.toBe(rankSeed(TABLE_SEED, 4, 1));
    expect(rangeSeed(TABLE_SEED, 1, 4)).not.toBe(rangeSeed(TABLE_SEED, 4, 1));
    expect(rangeSeed(TABLE_SEED, 1, 4)).not.toBe(rankSeed(TABLE_SEED, 1, 4));
  });
});

describe('the blob', () => {
  it('stores the order and the equities in basis points, read back by decodeRanges', () => {
    const order = [...identity].reverse();
    const cells = Array.from({ length: RANGES_EQ_WORDS }, (_, i) => ({
      win: (i % 100) / 200,
      split: (i % 7) / 1000,
    }));
    const bytes = encodeRanges(order, cells);
    const table = decodeRanges(Buffer.from(bytes).toString('base64'));
    expect(Array.from(table.order)).toEqual(order);
    cells.forEach((cell, i) => expect(table.eq[i]).toBe(basisPoints(cell.win + cell.split)));
  });

  it('refuses the wrong number of cells and an equity outside 0 to 100%', () => {
    const cells = Array.from({ length: RANGES_EQ_WORDS }, () => ({ win: 0.5, split: 0 }));
    expect(() => encodeRanges(identity, cells.slice(1))).toThrow(RangeError);
    expect(() => encodeRanges(identity, [{ win: 1.2, split: 0 }, ...cells.slice(1)])).toThrow(
      RangeError,
    );
    expect(basisPoints(0.12345)).toBe(1235);
  });
});

describe('generate (a trial run, into a temporary folder)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gen-ranges-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes a module and its checksum that verify and decode, the same on any thread count', async () => {
    const logs: string[] = [];
    await generate({ trials: 60, threads: 2, out: dir, log: (line) => logs.push(line) });
    const text = readFileSync(join(dir, RANGES_FILE), 'utf8');
    expect(verifyChecksums(dir)).toEqual([]);
    const entry = parseChecksums(readFileSync(join(dir, 'checksums.json'), 'utf8')).files[
      RANGES_FILE
    ];
    expect(entry).toMatchObject({ generator: GENERATOR, seed: TABLE_SEED, trials: 60 });
    expect(readNumberExport(text, 'RANGES_TRIALS')).toBe(60);
    expect(readNumberExport(text, 'RANK_WEIGHT_PERCENT')).toBe(25);
    expect(text).toContain('Never edit by hand');
    const table = decodeRanges(readBase64Export(text, 'RANGES_B64'));
    const pct = rankPctFromOrder(table.order);
    expect(pct.reduce((_, v) => v, 0)).toBeGreaterThan(0);
    let combos = 0;
    for (let cls = 0; cls < RANGE_CLASSES; cls++) combos += comboCount(cls);
    expect(combos).toBe(COMBOS_TOTAL);
    expect(logs.some((line) => line.includes('acceptance'))).toBe(true);

    const other = mkdtempSync(join(tmpdir(), 'gen-ranges-'));
    try {
      await generate({ trials: 60, threads: 3, out: other });
      expect(readFileSync(join(other, RANGES_FILE), 'utf8')).toBe(text);
      expect(readFileSync(join(other, 'checksums.json'), 'utf8')).toBe(
        readFileSync(join(dir, 'checksums.json'), 'utf8'),
      );
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  }, 60_000);
});
