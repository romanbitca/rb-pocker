/**
 * Timing of the chances enumeration (§6.6). On the flop it enumerates 1,081 boards inside the
 * `handInfo` job, which §6 expects to take "typically < 20 ms" on a phone; the first postflop
 * number must show within 150 ms at 6× CPU throttle (§15.3). Preflop the app uses the `finals`
 * table (§7.5) instead; the 2,118,760-board enumeration is timed for its generator. Prints the
 * numbers and fails only far above the budgets, since CI runners are slower and noisier.
 */
import { describe, expect, it } from 'vitest';
import { chancesByRiver } from '../../src/analysis/chances.ts';
import { HandSource } from '../eval/hands.ts';

const HANDS = 2_000;
/** 20 ms at 6× throttle. */
const MEAN_LIMIT_MS = 20 / 6;

function time(boardLength: number, hands: number): { mean: number; p95: number; max: number } {
  const src = new HandSource('20260930000000000000000000004201');
  const deals = Array.from({ length: hands }, () => src.uniform(2 + boardLength));
  for (const cs of deals.slice(0, 20)) chancesByRiver(cs.slice(0, 2), cs.slice(2)); // warm-up
  const ms: number[] = [];
  for (const cs of deals) {
    const t0 = performance.now();
    chancesByRiver(cs.slice(0, 2), cs.slice(2));
    ms.push(performance.now() - t0);
  }
  ms.sort((a, b) => a - b);
  return {
    mean: ms.reduce((a, b) => a + b, 0) / ms.length,
    p95: ms[Math.floor(ms.length * 0.95)] as number,
    max: ms[ms.length - 1] as number,
  };
}

const show = (name: string, t: { mean: number; p95: number; max: number }): void => {
  const f = (x: number): string => x.toFixed(3);
  console.info(
    `chancesByRiver ${name}: mean ${f(t.mean)} ms, p95 ${f(t.p95)} ms, max ${f(t.max)} ms`,
  );
};

describe('chancesByRiver timing', () => {
  it(`${HANDS} random flops (1,081 boards each)`, { timeout: 60_000 }, () => {
    const t = time(3, HANDS);
    show('flop', t);
    expect(t.mean).toBeLessThan(MEAN_LIMIT_MS);
  });

  it(`${HANDS} random turns (46 boards each)`, { timeout: 60_000 }, () => {
    const t = time(4, HANDS);
    show('turn', t);
    expect(t.mean).toBeLessThan(MEAN_LIMIT_MS);
  });

  it(
    '5 random preflop hands (2,118,760 boards each; the finals-table generator)',
    {
      timeout: 120_000,
    },
    () => {
      const t = time(0, 5);
      show('preflop', t);
      expect(t.mean).toBeLessThan(2_000);
    },
  );
});
