/**
 * Stage 5 acceptance 6 in Node: a bot decision at Medium takes at most 100 ms at the 95th
 * percentile (PLAN §18; `decide()` as `brain.worker` runs it). Also reported: Easy, and the coach's
 * hint with the HUD number given and without it (§8.11 budget on a mid-range phone: p50 ≤ 100 ms,
 * p95 ≤ 300 ms; the device numbers come from `#bench`, chunk 4.8). The corpus is decision points
 * of 6-max hands at 100 bb played by the random legal policy, every street. The p95 at Medium is a
 * failure above 100 ms (it is a few ms on a laptop: a CI runner has ample room); the rest is
 * printed. The coverage run leaves this file out (instrumented code is several times slower).
 */
import { describe, expect, it } from 'vitest';
import { decide, hint } from '../../src/brain/decide.ts';
import { profileFor } from '../../src/brain/profiles.ts';
import { deriveSeed, rngFromSeed } from '../../src/core/rng.ts';
import { observe } from '../../src/engine/observe.ts';
import { startHand } from '../../src/engine/start.ts';
import { step } from '../../src/engine/step.ts';
import { PERSONALITY_IDS, type HandState, type Observation } from '../../src/engine/types.ts';
import { tableWith } from '../engine/helpers.ts';
import { randomInput } from '../engine/play.ts';
import { env } from '../helpers/seed.ts';
import { extrasFor } from './fixtures.ts';

const SEED = '20261009000000000000000000005700';
const HANDS = 60;
/** Hints are timed on every fourth point (they take several times longer). */
const HINT_EVERY = 4;
const BOT_P95_BUDGET_MS = 100;

/** Every decision point of `HANDS` 6-max hands at 100 bb. */
function corpus(): Observation[] {
  const out: Observation[] = [];
  for (let i = 0; i < HANDS; i++) {
    const rng = rngFromSeed(deriveSeed(SEED, 'policy', i));
    let h: HandState = startHand(
      tableWith(new Array<number>(6).fill(10000)),
      deriveSeed(SEED, 'hand', i),
    );
    for (let n = 0; n < 400 && h.phase !== 'complete'; n++) {
      if (h.phase === 'betting') out.push(observe(h, h.toAct as number, extrasFor(6)));
      h = step(h, randomInput(h, rng, 20));
    }
  }
  return out;
}

function quantiles(times: number[]): { p50: number; p95: number; max: number } {
  const sorted = [...times].sort((a, b) => a - b);
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number;
  return { p50: at(0.5), p95: at(0.95), max: sorted.at(-1) as number };
}

const ms = (x: number): string => `${x.toFixed(1)} ms`;

describe('decision time (Stage 5 acceptance 6, §8.11)', () => {
  it(
    'a Medium bot decides in at most 100 ms at p95 (Node); Easy and the hint are reported',
    { timeout: 300_000 },
    () => {
      const points = corpus();
      expect(points.length).toBeGreaterThan(500);
      const time = (f: (obs: Observation, i: number) => unknown, every = 1): number[] =>
        points
          .filter((_, i) => i % every === 0)
          .map((obs, i) => {
            const t = performance.now();
            f(obs, i);
            return performance.now() - t;
          });
      const seed = (i: number) => deriveSeed(SEED, 'bot', i);
      const people = PERSONALITY_IDS;
      // Warm-up (JIT), then the timed passes.
      time((obs, i) =>
        decide(obs, profileFor(people[i % 5] as (typeof people)[number], 'medium'), seed(i)),
      );
      const medium = quantiles(
        time((obs, i) =>
          decide(obs, profileFor(people[i % 5] as (typeof people)[number], 'medium'), seed(i)),
        ),
      );
      const easy = quantiles(
        time((obs, i) =>
          decide(obs, profileFor(people[i % 5] as (typeof people)[number], 'easy'), seed(i)),
        ),
      );
      const hintGiven = quantiles(time((obs) => hint(obs, 0.5), HINT_EVERY));
      const hintNull = quantiles(time((obs) => hint(obs, null), HINT_EVERY));
      const line =
        `decision times over ${points.length} points (hints: every ${HINT_EVERY}th): Medium bot p50 ${ms(medium.p50)}, p95 ${ms(medium.p95)}, max ${ms(medium.max)} (budget p95 ≤ ${BOT_P95_BUDGET_MS} ms); ` +
        `Easy bot p50 ${ms(easy.p50)}, p95 ${ms(easy.p95)}; ` +
        `hint with the HUD number p50 ${ms(hintGiven.p50)}, p95 ${ms(hintGiven.p95)}; ` +
        `hint computing it p50 ${ms(hintNull.p50)}, p95 ${ms(hintNull.p95)}, max ${ms(hintNull.max)}`;
      console.info(line);
      if (env('GITHUB_ACTIONS') === 'true') console.info(`::notice title=Brain speed::${line}`);
      expect(medium.p95).toBeLessThanOrEqual(BOT_P95_BUDGET_MS);
    },
  );
});
