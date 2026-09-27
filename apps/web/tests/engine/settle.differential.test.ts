import { describe, expect, it } from 'vitest';
import { testSeed } from '../helpers/seed.ts';
import { expectEveryFeature, runDifferential } from './settle.differential.ts';

const ROOT = testSeed('2026092800000000000000000000a24d');

describe('settlement agrees with the independent oracle (Stage 2 acceptance 3)', () => {
  it('on 100,000 random multi-way all-in hands played through the real engine', () => {
    const c = runDifferential(ROOT, 0, 100_000);
    expect(c.hands).toBe(100_000);
    expectEveryFeature(c, (name, count, min) => expect(count, name).toBeGreaterThan(min));
  }, 600_000);
});
