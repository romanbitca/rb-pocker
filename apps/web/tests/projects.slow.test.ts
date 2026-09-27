import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

// Placeholder for the `slow` project (exhaustive and large statistical runs, PLAN "Testing strategy").
// It must never run in `npm test`; it runs in `npm run test:slow`.
describe('slow project', () => {
  it('runs fast-check properties', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        expect(a + b).toBe(b + a);
      }),
      { seed: 1, numRuns: 1_000 },
    );
  });
});
