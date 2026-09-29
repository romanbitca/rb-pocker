/**
 * §15.3 budget "Engine `step` + invariants ≤ 0.2 ms", as a unit benchmark. A warning, never a
 * failure (like the evaluator benchmark). `step` runs `checkInvariants` on every state it returns,
 * so timing `step` times both. The corpus is every (state, input) pair of 500 random hands
 * (`random-play.ts`: all table sizes, stack depths and input kinds). The warning looks at the mean
 * (the best of ten passes); p50, p99 and the maximum are reported too, but single steps are noisy
 * on a shared runner (garbage collection, the other test worker). Vitest is a development build,
 * so the times also include `step`'s deep-freeze of its output, which production skips: they are
 * an upper bound. The coverage run leaves this file out (instrumented code is several times
 * slower; see `vitest.config.ts`).
 */
import { describe, expect, it } from 'vitest';
import { deriveSeed, rngFromSeed } from '../../src/core/rng.ts';
import { step } from '../../src/engine/step.ts';
import type { EngineInput, HandState } from '../../src/engine/types.ts';
import { env } from '../helpers/seed.ts';
import { playRandomHand } from './random-play.ts';

const BUDGET_MS = 0.2;
const HANDS = 500;
const SEED = '20260929000000000000000000002620';

describe('engine step benchmark (§15.3)', () => {
  it(
    'reports the time of step + invariants (warns above 0.2 ms mean)',
    { timeout: 120_000 },
    () => {
      const corpus: { h: HandState; input: EngineInput }[] = [];
      for (let i = 0; i < HANDS; i++) {
        playRandomHand(rngFromSeed(deriveSeed(SEED, 'bench', i)), (h, input) =>
          corpus.push({ h, input }),
        );
      }
      // A local binding: Vitest turns calls of an imported function into getter lookups.
      const run = step;
      const pass = (): number => {
        let acc = 0;
        for (const { h, input } of corpus) acc += run(h, input).deckPos;
        return acc;
      };

      const checksum = pass(); // warm-up (JIT)
      let best = Number.POSITIVE_INFINITY;
      for (let i = 0; i < 10; i++) {
        const t = performance.now();
        expect(pass()).toBe(checksum);
        best = Math.min(best, performance.now() - t);
      }
      const mean = best / corpus.length;

      // One timed pass per input for the tail (the slowest steps: a showdown settles every pot).
      const times = corpus.map(({ h, input }) => {
        const t = performance.now();
        run(h, input);
        return performance.now() - t;
      });
      times.sort((a, b) => a - b);
      const at = (q: number): number =>
        times[Math.min(times.length - 1, Math.floor(q * times.length))] as number;
      const us = (ms: number): string => `${(ms * 1000).toFixed(1)} µs`;
      const line =
        `engine step + invariants: mean ${us(mean)}, p50 ${us(at(0.5))}, p99 ${us(at(0.99))}, ` +
        `max ${us(times.at(-1) as number)} over ${corpus.length} steps (budget ≤ ${BUDGET_MS} ms)`;
      console.info(line);
      if (mean > BUDGET_MS) {
        // A GitHub Actions annotation when running there, a console warning anywhere.
        if (env('GITHUB_ACTIONS') === 'true') console.info(`::warning title=Engine speed::${line}`);
        console.warn(`WARNING: ${line}`);
      }
      expect(mean).toBeGreaterThan(0);
    },
  );
});
