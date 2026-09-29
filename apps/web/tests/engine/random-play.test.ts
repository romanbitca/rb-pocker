/**
 * §18 Stage 2 acceptance 2, `unit` half: 100,000 hands of random legal play (2–9 seats, stacks
 * from one chip to 500 bb, tiny and empty seats included, random legal actions and amounts) keep
 * every invariant after every step (I1–I15, the I12 log replay included), and every hand reaches
 * 'complete' in at most 400 inputs. The harness is `random-play.ts`; the 10-million-step run is
 * `random-play.slow.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { testSeed } from '../helpers/seed.ts';
import { MAX_INPUTS, describeStats, runRandomHands } from './random-play.ts';

const HANDS = 100_000;

describe('random legal play (Stage 2 acceptance 2, unit)', () => {
  it(
    '100,000 random hands: every step keeps every invariant, every hand ends in ≤ 400 inputs',
    { timeout: 600_000 },
    () => {
      const t0 = performance.now();
      const stats = runRandomHands(testSeed('20260929000000000000000000002600'), {
        hands: HANDS,
      });
      const seconds = (performance.now() - t0) / 1000;
      console.info(`random play: ${describeStats(stats)}; ${seconds.toFixed(1)} s`);

      expect(stats.hands).toBe(HANDS);
      expect(stats.longest).toBeLessThanOrEqual(MAX_INPUTS);
      // The run reaches every kind of table and hand, so the property means something.
      for (let seats = 2; seats <= 9; seats++) {
        expect(stats.seatCounts[seats]).toBeGreaterThan(HANDS / 16);
      }
      expect(stats.showdowns).toBeGreaterThan(HANDS / 4);
      expect(stats.foldWins).toBeGreaterThan(HANDS / 20);
      expect(stats.runouts).toBeGreaterThan(HANDS / 10);
      expect(stats.sidePots).toBeGreaterThan(HANDS / 10);
      expect(stats.splitPots).toBeGreaterThan(HANDS / 100);
      expect(stats.riverBets).toBeGreaterThan(HANDS / 20);
      expect(stats.reshuffles).toBeGreaterThan(HANDS / 20);
      expect(stats.emptySeats).toBeGreaterThan(HANDS / 10);
      expect(stats.tinyStacks).toBeGreaterThan(HANDS / 10);
      expect(stats.allInBlinds).toBeGreaterThan(HANDS / 50);
    },
  );
});
