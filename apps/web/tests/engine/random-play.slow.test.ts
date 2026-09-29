/**
 * §18 Stage 2 acceptance 2, `slow` half (the weekly CI job, `npm run test:slow`): 10 million steps
 * of random legal play keep every invariant after every step (the I12 log replay included), and
 * every hand reaches 'complete' in at most 400 inputs. Same harness as the 100,000-hand unit run
 * (`random-play.ts`), with its own seed; `TEST_SEED` reruns it with another.
 */
import { describe, expect, it } from 'vitest';
import { testSeed } from '../helpers/seed.ts';
import { MAX_INPUTS, describeStats, runRandomHands } from './random-play.ts';

const STEPS = 10_000_000;

describe('random legal play (Stage 2 acceptance 2, slow)', () => {
  it(
    '10,000,000 steps: every step keeps every invariant, every hand ends in ≤ 400 inputs',
    { timeout: 3_600_000 },
    () => {
      const t0 = performance.now();
      const stats = runRandomHands(testSeed('20260929000000000000000000002610'), { steps: STEPS });
      const seconds = (performance.now() - t0) / 1000;
      console.info(`random play (slow): ${describeStats(stats)}; ${seconds.toFixed(0)} s`);

      expect(stats.steps).toBeGreaterThanOrEqual(STEPS);
      expect(stats.longest).toBeLessThanOrEqual(MAX_INPUTS);
      for (let seats = 2; seats <= 9; seats++) {
        expect(stats.seatCounts[seats]).toBeGreaterThan(stats.hands / 16);
      }
    },
  );
});
