import { isSeed128, randomSeed, type Seed128 } from '../../src/core/rng.ts';

/** An environment variable (tests run in Node; the web tsconfig has no Node types). */
export function env(name: string): string | undefined {
  const g = globalThis as { process?: { env: Record<string, string | undefined> } };
  return g.process?.env[name];
}

/**
 * Seed for a statistical or randomised test (PLAN "Testing strategy" → Rules).
 * CI uses the fixed seed, so a run is deterministic. `TEST_SEED=<32 hex>` reproduces a run and
 * `TEST_SEED=random` draws a fresh seed; either way the seed is printed so a failure can be
 * replayed.
 */
export function testSeed(fixed: Seed128): Seed128 {
  const value = env('TEST_SEED');
  if (value === undefined || value === '') return fixed;
  const seed = value === 'random' ? randomSeed() : value;
  if (!isSeed128(seed)) throw new RangeError(`TEST_SEED must be 32 lowercase hex or "random"`);
  console.info(`TEST_SEED=${seed}`);
  return seed;
}
