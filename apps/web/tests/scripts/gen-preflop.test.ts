import { describe, expect, it } from 'vitest';
import {
  decodeEquityTable,
  decodeFinalsTable,
  FINALS_BOARDS,
  PREFLOP_CLASSES,
  PREFLOP_MAX_OPPONENTS,
} from '../../src/data/preflopLayout.ts';
import {
  basisPoints,
  cellIndex,
  cellSeed,
  collect,
  encodeEquity,
  encodeFinals,
  EQUITY_TRIALS,
  TABLE_SEED,
  tableJobs,
} from '../../scripts/gen-preflop.ts';
import { runJob, runJobs, type Job, type McResult } from '../../scripts/table-jobs.ts';

const CELLS = PREFLOP_CLASSES * PREFLOP_MAX_OPPONENTS;
const base64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

/** A synthetic but varied table: win and split differ in every cell. */
function syntheticCells(): McResult[] {
  return Array.from({ length: CELLS }, (_, i) => ({
    kind: 'mc' as const,
    win: ((i * 37) % 9000) / 10_000,
    split: ((i * 11) % 500) / 10_000,
  }));
}

describe('scripts/gen-preflop.ts: encoding the tables (PLAN §7.5)', () => {
  it('rounds to basis points and numbers the cells class by class', () => {
    expect(basisPoints(0.8524)).toBe(8524);
    expect(basisPoints(0.85245)).toBe(8525);
    expect(basisPoints(0)).toBe(0);
    expect(basisPoints(1)).toBe(10_000);
    expect(cellIndex(0, 1)).toBe(0);
    expect(cellIndex(0, 8)).toBe(7);
    expect(cellIndex(1, 1)).toBe(8);
    expect(cellIndex(168, 8)).toBe(CELLS - 1);
  });

  it('writes the equity cells so that decodeEquityTable reads them back (win, split)', () => {
    const cells = syntheticCells();
    const words = decodeEquityTable(base64(encodeEquity(cells)));
    expect(words).toHaveLength(CELLS * 2);
    cells.forEach((cell, i) => {
      expect(words[2 * i], `win of cell ${i}`).toBe(basisPoints(cell.win));
      expect(words[2 * i + 1], `split of cell ${i}`).toBe(basisPoints(cell.split));
    });
  });

  it('keeps the high bytes apart from the low bytes (the layout gzip likes)', () => {
    const bytes = encodeEquity(syntheticCells());
    const words = CELLS * 2;
    expect(bytes).toHaveLength(words * 2);
    expect(Math.max(...bytes.subarray(0, words))).toBeLessThanOrEqual(0x27); // ≤ 10,000 = 0x2710
  });

  it('refuses a table that is the wrong size or impossible', () => {
    expect(() => encodeEquity(syntheticCells().slice(1))).toThrow(RangeError);
    const cells = syntheticCells();
    cells[5] = { kind: 'mc', win: 0.7, split: 0.4 };
    expect(() => encodeEquity(cells)).toThrow(/cell 5/);
  });

  it('writes the finals rows so that decodeFinalsTable reads them back', () => {
    const rows = Array.from({ length: PREFLOP_CLASSES }, (_, cls) => {
      const row = Array.from({ length: 10 }, (_, k) => (cls + 1) * (k + 1) * 3);
      row[0] = FINALS_BOARDS - row.slice(1).reduce((sum, n) => sum + n, 0);
      return row;
    });
    const words = decodeFinalsTable(base64(encodeFinals(rows)));
    expect(Array.from(words)).toEqual(rows.flat());
  });

  it('refuses finals rows that are the wrong size or do not add up to C(50,5)', () => {
    const row = (first: number): number[] =>
      Array.from({ length: 10 }, (_, k) => (k === 0 ? first : 0));
    const good = Array.from({ length: PREFLOP_CLASSES }, () => row(FINALS_BOARDS));
    expect(() => encodeFinals(good.slice(1))).toThrow(RangeError);
    expect(() => encodeFinals([...good.slice(1), row(FINALS_BOARDS - 1)])).toThrow(/C\(50,5\)/);
    expect(() => encodeFinals([...good.slice(1), [FINALS_BOARDS, 0, 0]])).toThrow(/10 counts/);
    expect(() => encodeFinals(good)).not.toThrow();
  });
});

describe('scripts/gen-preflop.ts: the jobs and their seeds', () => {
  it('gives every cell its own reproducible seed under the table seed', () => {
    expect(TABLE_SEED).toMatch(/^[0-9a-f]{32}$/);
    const seeds = new Set<string>();
    for (let cls = 0; cls < PREFLOP_CLASSES; cls++) {
      for (let nOpp = 1; nOpp <= PREFLOP_MAX_OPPONENTS; nOpp++) {
        seeds.add(cellSeed(TABLE_SEED, cls, nOpp));
      }
    }
    expect(seeds.size).toBe(CELLS);
    expect(cellSeed(TABLE_SEED, 3, 4)).toBe(cellSeed(TABLE_SEED, 3, 4));
    expect(cellSeed(TABLE_SEED, 3, 4)).not.toBe(cellSeed(TABLE_SEED, 4, 3));
    expect(cellSeed(TABLE_SEED, 3, 4)).not.toBe(cellSeed('0'.repeat(32), 3, 4));
  });

  it('lists 1,352 sampled cells, the slowest first, then the 169 exact rows', () => {
    expect(EQUITY_TRIALS).toBe(500_000);
    const jobs = tableJobs(1234);
    expect(jobs).toHaveLength(CELLS + PREFLOP_CLASSES);
    const mc = jobs.slice(0, CELLS);
    expect(mc.every((job) => job.kind === 'mc')).toBe(true);
    expect(jobs.slice(CELLS).every((job) => job.kind === 'finals')).toBe(true);
    const opponents = mc.map((job) => (job.kind === 'mc' ? job.nOpp : 0));
    expect(opponents).toEqual([...opponents].sort((a, b) => b - a));
    const first = mc[0] as Job;
    expect(first).toEqual({
      kind: 'mc',
      cls: 0,
      nOpp: 8,
      trials: 1234,
      seed: cellSeed(TABLE_SEED, 0, 8),
    });
  });

  it('puts the results of the jobs back in table order, whatever order the jobs had', () => {
    const jobs = tableJobs(10);
    const results = jobs.map((job) =>
      job.kind === 'mc'
        ? { kind: 'mc' as const, win: job.cls / 1000, split: job.nOpp / 100_000 }
        : { kind: 'finals' as const, counts: [job.cls], total: FINALS_BOARDS },
    );
    const { cells, rows } = collect(jobs, results);
    expect(cells).toHaveLength(CELLS);
    expect(rows).toHaveLength(PREFLOP_CLASSES);
    expect(cells[cellIndex(7, 3)]).toEqual({ kind: 'mc', win: 0.007, split: 0.00003 });
    expect(cells[cellIndex(168, 8)]).toEqual({ kind: 'mc', win: 0.168, split: 0.00008 });
    expect(rows[42]).toEqual([42]);
  });
});

describe('scripts/table-jobs.ts: the worker pool', () => {
  const JOBS: Job[] = [
    { kind: 'mc', cls: 0, nOpp: 3, trials: 3000, seed: cellSeed(TABLE_SEED, 0, 3) },
    { kind: 'mc', cls: 100, nOpp: 1, trials: 2000, seed: cellSeed(TABLE_SEED, 100, 1) },
    { kind: 'finals', cls: 168 },
    { kind: 'mc', cls: 13, nOpp: 8, trials: 1000, seed: cellSeed(TABLE_SEED, 13, 8) },
  ];

  it('gives the same results on one thread, two or many, in the order of the jobs', async () => {
    const inline = await runJobs(JOBS, 1);
    expect(inline).toEqual(JOBS.map(runJob));
    expect(await runJobs(JOBS, 2)).toEqual(inline);
    expect(await runJobs(JOBS, 7)).toEqual(inline);
    expect(inline[2]).toMatchObject({ kind: 'finals', total: FINALS_BOARDS });
  }, 60_000);

  it('counts the finished jobs', async () => {
    const seen: number[] = [];
    await runJobs(JOBS, 2, (done) => seen.push(done));
    expect(seen).toEqual([1, 2, 3, 4]);
    const inline: number[] = [];
    await runJobs(JOBS.slice(0, 2), 1, (done) => inline.push(done));
    expect(inline).toEqual([1, 2]);
  }, 60_000);

  it('rejects a bad thread count, and a job that fails, on any number of threads', async () => {
    await expect(runJobs(JOBS, 0)).rejects.toThrow(RangeError);
    await expect(runJobs(JOBS, 1.5)).rejects.toThrow(/threads/);
    const bad: Job[] = [...JOBS, { kind: 'finals', cls: 999 }];
    await expect(runJobs(bad, 1)).rejects.toThrow(RangeError);
    await expect(runJobs(bad, 3)).rejects.toThrow(/class index/);
    expect(await runJobs([], 4)).toEqual([]);
  }, 60_000);
});
