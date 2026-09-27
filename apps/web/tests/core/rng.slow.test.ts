import { describe, expect, it } from 'vitest';
import { formatCard } from '../../src/core/cards.ts';
import { deriveSeed, ZERO_SEED } from '../../src/core/rng.ts';
import { testSeed } from '../helpers/seed.ts';
import { P_MIN } from '../helpers/stats.ts';
import { randIntUniformityP, shuffleUniformity } from './rngStats.ts';

// Full-size statistical tests (PLAN §5.6, Stage 1 acceptance 1). Fixed seeds; TEST_SEED overrides.
describe('RNG statistics (slow)', () => {
  it(
    'each card lands in each position uniformly over 1,000,000 shuffles',
    { timeout: 300_000 },
    () => {
      const r = shuffleUniformity(testSeed(deriveSeed(ZERO_SEED, 'slow|shuffle')), 1_000_000);
      expect(r.tableP).toBeGreaterThan(P_MIN);
      expect(r.minCardP, `card ${formatCard(r.minCard)}`).toBeGreaterThan(P_MIN / 52);
    },
  );

  it('randInt(3) is uniform over 3,000,000 draws', { timeout: 120_000 }, () => {
    const seed = testSeed(deriveSeed(ZERO_SEED, 'slow|randInt3'));
    expect(randIntUniformityP(seed, 3, 3_000_000)).toBeGreaterThan(P_MIN);
  });

  it('randInt(3·2^30) has no modulo bias over 3,000,000 draws', { timeout: 120_000 }, () => {
    const seed = testSeed(deriveSeed(ZERO_SEED, 'slow|randIntBig'));
    expect(randIntUniformityP(seed, 3 * 2 ** 30, 3_000_000, 12)).toBeGreaterThan(P_MIN);
  });
});
