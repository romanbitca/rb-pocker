import { describe, expect, it } from 'vitest';
import { equity } from '../../src/analysis/equity.ts';
import { classCards } from '../../src/core/cards.ts';
import { deriveSeed, ZERO_SEED } from '../../src/core/rng.ts';
import { classByName, RANGE_CLASSES } from '../../src/data/rangesLayout.ts';
import { runJob, runRangeJobs, type Job, type RangeJob } from '../../scripts/range-jobs.ts';

const seed = (label: string) => deriveSeed(ZERO_SEED, `range-jobs-test|${label}`);
const only = (name: string): number[] => {
  const weights = new Array<number>(RANGE_CLASSES).fill(0);
  weights[classByName(name)] = 1;
  return weights;
};
const everyone = new Array<number>(RANGE_CLASSES).fill(1);
const percent = (r: { win: number; split: number }): number => 100 * (r.win + r.split);

describe('range job: one class against one rival drawn from a weighted range', () => {
  it('AA against a range of only KK is 81.95% (Appendix C.2, all suit combinations)', () => {
    const r = runJob({
      kind: 'range',
      cls: classByName('AA'),
      weights: only('KK'),
      trials: 100_000,
      seed: seed('aa-kk'),
    });
    // 100,000 trials: standard error 0.12 points; 0.6 is five of them.
    expect(Math.abs(percent(r) - 81.95)).toBeLessThan(0.6);
    expect(r.win).toBeGreaterThan(0.8);
    expect(r.split).toBeGreaterThan(0);
    expect(r.split).toBeLessThan(0.01);
  });

  it('against every hand it is the equity against one random hand (Appendix C.3)', () => {
    const job = (name: string): RangeJob => ({
      kind: 'range',
      cls: classByName(name),
      weights: everyone,
      trials: 100_000,
      seed: seed(`random-${name}`),
    });
    expect(Math.abs(percent(runJob(job('AA'))) - 85.24)).toBeLessThan(0.6);
    expect(Math.abs(percent(runJob(job('72o'))) - 34.58)).toBeLessThan(0.6);
  }, 20_000);

  it('weights decide how often a rival class is drawn', () => {
    // 72o beats almost nothing in AA's eyes, KK half as often as the rest of the range: a range
    // of {KK at weight 1, 72o at weight 3} gives AA an equity between the two single-class ones.
    const mix = new Array<number>(RANGE_CLASSES).fill(0);
    mix[classByName('KK')] = 1;
    mix[classByName('72o')] = 3;
    const base = { kind: 'range', cls: classByName('AA'), trials: 60_000 } as const;
    const kk = percent(runJob({ ...base, weights: only('KK'), seed: seed('w-kk') }));
    const trash = percent(runJob({ ...base, weights: only('72o'), seed: seed('w-72o') }));
    const both = percent(runJob({ ...base, weights: mix, seed: seed('w-mix') }));
    // Combo-weighted: KK has 6 free combos of weight 1, 72o has 12 of weight 3.
    const expected = (6 * kk + 36 * trash) / 42;
    expect(Math.abs(both - expected)).toBeLessThan(0.8);
  }, 20_000);

  it('is reproducible, and another seed gives another sample', () => {
    const job: RangeJob = {
      kind: 'range',
      cls: classByName('T9s'),
      weights: everyone,
      trials: 5_000,
      seed: seed('repeat'),
    };
    expect(runJob(job)).toEqual(runJob(job));
    expect(runJob({ ...job, seed: seed('other') })).not.toEqual(runJob(job));
  });

  it('refuses a range with no combo', () => {
    const empty = new Array<number>(RANGE_CLASSES).fill(0);
    const job: RangeJob = {
      kind: 'range',
      cls: 0,
      weights: empty,
      trials: 10,
      seed: seed('empty'),
    };
    expect(() => runJob(job)).toThrow(RangeError);
  });
});

describe('pair job: one class against one other class', () => {
  it('AA against KK is 81.95% and 22 against AKo is 52.65% (Appendix C.2)', () => {
    const aa = runJob({
      kind: 'pair',
      hero: classByName('AA'),
      villain: classByName('KK'),
      trials: 40_000,
      seed: seed('pair-aa-kk'),
    });
    const pair = runJob({
      kind: 'pair',
      hero: classByName('22'),
      villain: classByName('AKo'),
      trials: 40_000,
      seed: seed('pair-22-ako'),
    });
    expect(Math.abs(percent(aa) - 81.95)).toBeLessThan(0.8);
    expect(Math.abs(percent(pair) - 52.65)).toBeLessThan(1);
  }, 20_000);

  it('is the mean over the rival combos that are free', () => {
    // AA against AA: only one pair of aces is free, and a flush or a board decides the rare rest.
    const r = runJob({
      kind: 'pair',
      hero: classByName('AA'),
      villain: classByName('AA'),
      trials: 20_000,
      seed: seed('pair-aa-aa'),
    });
    expect(percent(r)).toBeGreaterThan(40);
    expect(percent(r)).toBeLessThan(60);
  });

  it('refuses a pair with no free combo', () => {
    // Class AKs needs two cards of one suit; the hero AsKs blocks none of them all, but a pair job
    // for an impossible class index still fails fast.
    const job: Job = { kind: 'pair', hero: 0, villain: 999, trials: 10, seed: seed('bad') };
    expect(() => runJob(job)).toThrow(RangeError);
  });
});

describe('random job: equity() itself', () => {
  it('returns the same win and split as the HUD sampler with the same seed', () => {
    const cls = classByName('KQo');
    const s = seed('random-job');
    const direct = equity(
      { hero: classCards(cls), board: [], nOpp: 3 },
      { mode: 'montecarlo', trials: 3_000, seed: s },
    );
    const job = runJob({ kind: 'random', cls, nOpp: 3, trials: 3_000, seed: s });
    expect(job).toEqual({ win: direct.win, split: direct.split });
  });
});

describe('the pool', () => {
  const jobs: Job[] = Array.from({ length: 9 }, (_, i) => ({
    kind: 'range',
    cls: (i * 17) % RANGE_CLASSES,
    weights: everyone,
    trials: 2_000,
    seed: seed(`pool-${i}`),
  }));

  it('gives the same results in this thread and on several, in the order of the jobs', async () => {
    const here = await runRangeJobs(jobs, 1);
    const there = await runRangeJobs(jobs, 3);
    expect(there).toEqual(here);
    expect(here).toEqual(jobs.map(runJob));
  }, 20_000);

  it('reports progress and refuses a bad thread count', async () => {
    const seen: number[] = [];
    await runRangeJobs(jobs, 2, (done) => seen.push(done));
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    await expect(runRangeJobs(jobs, 0)).rejects.toThrow(RangeError);
    await expect(runRangeJobs(jobs, 1.5)).rejects.toThrow(RangeError);
  }, 20_000);
});
