/**
 * The Hard and Expert bots at random decision points of hands played by the real engine (PLAN
 * §9.2, §9.5, §9.6; fast-check; Stage 7 acceptance 4, chunk 7.1): every Hard and Expert profile
 * (5 personalities × 2 levels) decides at each point with the run's seed, with random seat
 * statistics (the hero's often past the exploits' thresholds), 1,000 runs per profile: legal,
 * guarded, and blind to the cards it cannot see (`botProperty.ts`). With the Easy and Medium
 * profiles (`decide.property.test.ts`) and the coach (`hint.property.test.ts`) that is all 20
 * personality × level profiles and the coach.
 */
import { describe, expect, it } from 'vitest';
import { profileFor } from '../../src/brain/profiles.ts';
import type { BrainProfile } from '../../src/brain/types.ts';
import { PERSONALITY_IDS } from '../../src/engine/types.ts';
import { checkBots, extrasWithStatsArb } from './botProperty.ts';

const RUNS = 1000;

const PROFILES: readonly BrainProfile[] = PERSONALITY_IDS.flatMap((id) => [
  profileFor(id, 'hard'),
  profileFor(id, 'expert'),
]);

describe('the Hard and Expert bots at random decision points (§9.2, §9.5, §9.6)', () => {
  it(
    'every profile: legal, guarded, and blind to the cards it cannot see (1,000 runs each)',
    { timeout: 900_000 },
    () => {
      expect(PROFILES).toHaveLength(10);
      const seen = checkBots(PROFILES, RUNS, extrasWithStatsArb);
      expect(seen.runs).toBe(RUNS);
      expect(seen.mixed).toBeGreaterThan(RUNS / 10); // the profiles do play differently
      expect([...seen.kinds].sort()).toEqual(['allin', 'bet', 'call', 'check', 'fold', 'raise']);
      // The chunk 7.1 paths ran: balanced river bluffs and the Expert exploits.
      expect(seen.riverAir).toBeGreaterThan(0);
      expect(seen.exploited).toBeGreaterThan(0);
    },
  );
});
