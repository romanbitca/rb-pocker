import { describe, expect, it } from 'vitest';
import { testSeed } from '../helpers/seed.ts';
import { expectEveryFeature, runDifferential } from './settle.differential.ts';

// The slow run of the settlement differential (PLAN "Testing strategy": settlement vs the
// independent oracle, 100k every push, 1M in the slow job). A different root from the unit run,
// in ten parts so each one reports on its own.
const ROOT = testSeed('2026092800000000000000000001a24d');
const PART = 100_000;

describe('settlement agrees with the independent oracle on 1,000,000 hands (slow)', () => {
  for (let part = 0; part < 10; part++) {
    it(`hands ${part * PART} to ${(part + 1) * PART - 1}`, () => {
      const c = runDifferential(ROOT, part * PART, PART);
      expect(c.hands).toBe(PART);
      expectEveryFeature(c, (name, count, min) => expect(count, name).toBeGreaterThan(min));
    }, 900_000);
  }
});
