import { describe, expect, it } from 'vitest';
import { deriveSeed, ZERO_SEED } from '../../src/core/rng.ts';
import { score7 } from '../../src/eval/evaluate.ts';
import { env } from '../helpers/seed.ts';
import { HandSource } from './hands.ts';

/** Stage 1 acceptance 5: at least 5M evaluations/s on the CI runner. A warning, never a failure. */
const TARGET = 5_000_000;
const HANDS = 500_000;

describe('evaluator micro-benchmark', () => {
  it('reports evaluations per second (warns below 5M/s)', { timeout: 60_000 }, () => {
    const src = new HandSource(deriveSeed(ZERO_SEED, 'bench'));
    const pool = new Uint8Array(HANDS * 7);
    for (let h = 0; h < HANDS; h++) pool.set(src.uniform(7), h * 7);

    // Each hand is copied into a seven-card buffer, as the equity code will do. `score` is a local
    // binding: Vitest turns calls of an imported function into module-namespace getter lookups.
    const score = score7;
    const buf = new Uint8Array(7);
    const pass = (): number => {
      let acc = 0;
      for (let h = 0, o = 0; h < HANDS; h++, o += 7) {
        buf[0] = pool[o]!;
        buf[1] = pool[o + 1]!;
        buf[2] = pool[o + 2]!;
        buf[3] = pool[o + 3]!;
        buf[4] = pool[o + 4]!;
        buf[5] = pool[o + 5]!;
        buf[6] = pool[o + 6]!;
        acc += score(buf, 7);
      }
      return acc;
    };

    const checksum = pass(); // warm-up (JIT)
    let best = Number.POSITIVE_INFINITY;
    for (let run = 0; run < 5; run++) {
      const t = performance.now();
      expect(pass()).toBe(checksum);
      best = Math.min(best, performance.now() - t);
    }
    const rate = (HANDS / best) * 1000;
    const line = `evaluator: ${(rate / 1e6).toFixed(1)}M evaluations/s (target ≥ 5M/s)`;
    console.info(line);
    if (rate < TARGET) {
      // A GitHub Actions annotation when running there, a console warning anywhere.
      if (env('GITHUB_ACTIONS') === 'true') {
        console.info(`::warning title=Evaluator speed::${line}`);
      }
      console.warn(`WARNING: ${line}`);
    }
    expect(rate).toBeGreaterThan(0);
  });
});
