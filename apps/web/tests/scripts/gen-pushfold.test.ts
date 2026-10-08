import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rankOfClass } from '../../src/brain/rangesData.ts';
import {
  classByName,
  comboCount,
  decodePushFold,
  PUSH_FOLD_BYTES,
  PUSH_MAX_PLAYERS_BEHIND,
  PUSH_MAX_STACK_BB,
  RANGE_CLASSES,
} from '../../src/data/rangesLayout.ts';
import {
  encodePushFold,
  freeCombos,
  generate,
  GENERATOR,
  hundredths,
  matchupsFrom,
  PAIR_TRIALS,
  pairJobs,
  pairSeed,
  PUSH_FOLD_FILE,
  solveTables,
  TABLE_SEED,
} from '../../scripts/gen-pushfold.ts';
import {
  BLINDS,
  game,
  HANDS_LEFT,
  ITERATIONS,
  solvePushFold,
  type Matchups,
} from '../../scripts/pushfold-solver.ts';
import {
  parseChecksums,
  readBase64Export,
  readNumberExport,
  verifyChecksums,
} from '../../scripts/generated.ts';

const N = RANGE_CLASSES;
const at = (name: string): number => classByName(name);

/** A made-up matchup matrix: a class beats a weaker one by a margin of its rank distance. */
function synthetic(): Matchups {
  const strength = Array.from({ length: N }, (_, c) => 1 - rankOfClass(c) / (N - 1));
  const eq = new Float64Array(N * N);
  for (let h = 0; h < N; h++) {
    for (let c = 0; c < N; c++) {
      eq[h * N + c] = Math.min(
        0.97,
        Math.max(0.03, 0.5 + 0.45 * ((strength[h] as number) - (strength[c] as number))),
      );
    }
  }
  return { eq, free: freeCombos() };
}

describe('combos that are free', () => {
  const free = freeCombos();

  it('counts the rival combos that share no card with the hero: 1,225 in all', () => {
    for (let h = 0; h < N; h++) {
      let sum = 0;
      for (let c = 0; c < N; c++) sum += free[h * N + c] as number;
      expect(sum).toBe(1225);
    }
  });

  it('knows the small cases: one pair of aces left, six kings, three suited, six offsuit', () => {
    expect(free[at('AA') * N + at('AA')]).toBe(1);
    expect(free[at('AA') * N + at('KK')]).toBe(6);
    expect(free[at('AKs') * N + at('AKs')]).toBe(3);
    expect(free[at('AKs') * N + at('AKo')]).toBe(6);
  });

  it('is symmetric once each class is weighted by its combos', () => {
    for (let h = 0; h < N; h += 7) {
      for (let c = 0; c < N; c += 5) {
        expect(comboCount(h) * (free[h * N + c] as number)).toBe(
          comboCount(c) * (free[c * N + h] as number),
        );
      }
    }
  });
});

describe('the matrix and the jobs', () => {
  it('has one job for each pair of different classes, each its own seed', () => {
    const jobs = pairJobs(1000);
    expect(jobs).toHaveLength((N * (N - 1)) / 2);
    expect(jobs.every((j) => j.hero < j.villain)).toBe(true);
    expect(new Set(jobs.map((j) => j.seed)).size).toBe(jobs.length);
    expect(jobs[0]).toEqual({
      kind: 'pair',
      hero: 0,
      villain: 1,
      trials: 1000,
      seed: pairSeed(TABLE_SEED, 0, 1),
    });
  });

  it('fills the other half with the complement and the diagonal with one half', () => {
    const jobs = pairJobs(10).slice(0, 3);
    const mu = matchupsFrom(jobs, [
      { win: 0.6, split: 0.01 },
      { win: 0.3, split: 0.02 },
      { win: 0.5, split: 0 },
    ]);
    expect(mu.eq[0 * N + 1]).toBeCloseTo(0.61, 12);
    expect(mu.eq[1 * N + 0]).toBeCloseTo(0.39, 12);
    expect(mu.eq[0 * N + 2]).toBeCloseTo(0.32, 12);
    expect(mu.eq[2 * N + 0]).toBeCloseTo(0.68, 12);
    expect(mu.eq[5 * N + 5]).toBe(0.5);
  });
});

describe('the game (PLAN §8.4)', () => {
  it('heads-up the small blind has posted 0.5 and the big blind 1', () => {
    expect(game(1, 10)).toEqual({
      gain: BLINDS,
      pusherPosted: 0.5,
      risk: 9.5,
      callers: [{ posted: 1, cost: 9, pot: 20 }],
    });
  });

  it('otherwise the players behind are those with nothing posted, then the small and the big blind', () => {
    expect(game(4, 10)).toEqual({
      gain: BLINDS,
      pusherPosted: 0,
      risk: 10,
      callers: [
        { posted: 0, cost: 10, pot: 21.5 },
        { posted: 0, cost: 10, pot: 21.5 },
        { posted: 0.5, cost: 9.5, pot: 21 },
        { posted: 1, cost: 9, pot: 20.5 },
      ],
    });
    expect(game(2, 6).callers.map((c) => c.posted)).toEqual([0.5, 1]);
    expect(HANDS_LEFT).toBe(1225);
    expect(() => game(0, 10)).toThrow(RangeError);
    expect(() => game(2, 0.5)).toThrow(RangeError);
  });

  it('solves in 3,000 rounds by default and refuses fewer than two', () => {
    expect(ITERATIONS).toBe(3000);
    expect(() => solvePushFold(synthetic(), 2, 10, 1)).toThrow(RangeError);
  });

  it('gives averaged strategies in [0, 1], the same every time', () => {
    const mu = synthetic();
    const a = solvePushFold(mu, 3, 8, 300);
    const b = solvePushFold(mu, 3, 8, 300);
    expect(a.push).toEqual(b.push);
    expect(a.call).toEqual(b.call);
    expect(a.pushPct).toBe(b.pushPct);
    for (const v of [...a.push, ...a.call]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(a.pushPct).toBeGreaterThan(0);
    expect(a.pushPct).toBeLessThanOrEqual(100);
    expect(Math.abs(a.pushPct - a.halfwayPushPct)).toBeLessThan(10);
  }, 30_000);

  it('shoves strong hands at least as often as weak ones', () => {
    const { push, call } = solvePushFold(synthetic(), 2, 10, 300);
    for (const [strong, weak] of [
      ['AA', '72o'],
      ['KK', '93o'],
      ['AKs', '42o'],
    ] as const) {
      expect(push[at(strong)]).toBeGreaterThanOrEqual(push[at(weak)] as number);
      expect(call[at(strong)]).toBeGreaterThanOrEqual(call[at(weak)] as number);
    }
    expect(push[at('AA')]).toBe(1);
  }, 30_000);

  it('shoves fewer hands with a deeper stack and with more players behind', () => {
    const mu = synthetic();
    const pct = (k: number, S: number): number => solvePushFold(mu, k, S, 300).pushPct;
    expect(pct(2, 12)).toBeLessThan(pct(2, 4));
    expect(pct(6, 9)).toBeLessThan(pct(1, 9));
    expect(pct(4, 9)).toBeLessThan(pct(2, 9));
  }, 60_000);

  it('the small blind shoves every hand with one big blind, which the big blind calls for free', () => {
    const mu = synthetic();
    const s = solvePushFold(mu, 1, 1, 300);
    expect(s.pushPct).toBeCloseTo(100, 6);
    expect(s.callPct).toBeCloseTo(100, 6); // the big blind is all-in already: calling is free
    // From the button, the small blind calls every hand for half a blind and is always first.
    expect(solvePushFold(mu, 2, 1, 300).pushPct).toBeLessThan(100);
  }, 30_000);

  it('the blinds call at their discount: wider than a player with nothing posted', () => {
    const s = solvePushFold(synthetic(), 3, 10, 300);
    expect(s.callers.map((c) => c.posted)).toEqual([0, 0.5, 1]);
    const [none, small, big] = s.callers.map((c) => c.callPct) as [number, number, number];
    expect(none).toBeGreaterThan(0);
    expect(small).toBeGreaterThanOrEqual(none);
    expect(big).toBeGreaterThan(none);
    expect(s.callPct).toBe(big);
  }, 30_000);
});

describe('the tables', () => {
  it('stores pushPct and callPct in hundredths of a percent, little-endian', () => {
    const push = Array.from(
      { length: PUSH_MAX_PLAYERS_BEHIND * PUSH_MAX_STACK_BB },
      (_, i) => i / 3,
    );
    const call = Array.from({ length: PUSH_MAX_STACK_BB }, (_, i) => 100 - i);
    const bytes = encodePushFold({ push, call });
    expect(bytes).toHaveLength(PUSH_FOLD_BYTES);
    const table = decodePushFold(Buffer.from(bytes).toString('base64'));
    expect(Array.from(table.push)).toEqual(push.map(hundredths));
    expect(Array.from(table.call)).toEqual(call.map(hundredths));
    expect(() => encodePushFold({ push: push.slice(1), call })).toThrow(RangeError);
    expect(() => encodePushFold({ push: [101, ...push.slice(1)], call })).toThrow(RangeError);
  });

  it('solves every stack and number of players behind, and reports the drift', () => {
    const mu = synthetic();
    const tables = solveTables(mu, 20);
    expect(tables.push).toHaveLength(PUSH_MAX_PLAYERS_BEHIND * PUSH_MAX_STACK_BB);
    expect(tables.call).toHaveLength(PUSH_MAX_STACK_BB);
    expect(tables.drift).toBeGreaterThanOrEqual(0);
    // The call column is the k = 1 game.
    expect(tables.call[4]).toBeCloseTo(solvePushFold(mu, 1, 5, 20).callPct, 12);
    expect(tables.push[0]).toBeCloseTo(solvePushFold(mu, 1, 1, 20).pushPct, 12);
  }, 60_000);
});

describe('generate (a trial run, into a temporary folder)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gen-pushfold-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes a module and its checksum that verify and decode, the same on any thread count', async () => {
    await generate({ trials: 20, threads: 2, out: dir, iterations: 12 });
    const text = readFileSync(join(dir, PUSH_FOLD_FILE), 'utf8');
    expect(verifyChecksums(dir)).toEqual([]);
    const entry = parseChecksums(readFileSync(join(dir, 'checksums.json'), 'utf8')).files[
      PUSH_FOLD_FILE
    ];
    expect(entry).toMatchObject({ generator: GENERATOR, seed: TABLE_SEED, trials: 20 });
    expect(readNumberExport(text, 'PUSH_FOLD_TRIALS')).toBe(20);
    expect(readNumberExport(text, 'PUSH_FOLD_ITERATIONS')).toBe(12);
    expect(text).toContain('Never edit by hand');
    const table = decodePushFold(readBase64Export(text, 'PUSH_FOLD_B64'));
    expect(table.push[0]).toBe(10_000); // k = 1, S = 1 bb: every hand shoves
    expect(PAIR_TRIALS).toBe(40_000);

    const other = mkdtempSync(join(tmpdir(), 'gen-pushfold-'));
    try {
      await generate({ trials: 20, threads: 3, out: other, iterations: 12 });
      expect(readFileSync(join(other, PUSH_FOLD_FILE), 'utf8')).toBe(text);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  }, 120_000);
});
