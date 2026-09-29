/**
 * PLAN §4.7 and §18 Stage 2 acceptance 4: `replay(record)` rebuilds a hand from nothing but its
 * seed, its starting table and its inputs, and `step` never mutates a (deep-frozen) input. Both
 * halves share one 10,000-hand run: every step re-freezes the state before the next `step` call,
 * so a mutation of the "previous" state would throw immediately (`Object.freeze` is strict-mode
 * enforced), and the same run's recorded inputs feed `replay` at the end.
 *
 * B41 (JSON round trip of 1,000 random states) and B42 (a recorded 6-player hand with a side pot)
 * are Appendix B vectors and live in `appendix-b.test.ts` with the others.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { rngFromSeed } from '../../src/core/rng.ts';
import { deepFreeze } from '../../src/engine/clone.ts';
import { replay } from '../../src/engine/replay.ts';
import { step } from '../../src/engine/step.ts';
import type { EngineInput, ReplayRecord } from '../../src/engine/types.ts';
import { FC_SEED, SEED, tableWith } from './helpers.ts';
import { handArb, randomInput } from './play.ts';

describe('replay (§4.7, acceptance 4)', () => {
  it(
    'reproduces the final state of 10,000 random hands from {table, seed, inputs} alone; ' +
      'step never mutates a deep-frozen input',
    () => {
      let count = 0;
      fc.assert(
        fc.property(handArb, ({ h, policySeed, table }) => {
          const rng = rngFromSeed(policySeed);
          const inputs: EngineInput[] = [];
          let s = deepFreeze(h);
          while (s.phase !== 'complete') {
            const input = randomInput(s, rng);
            inputs.push(input);
            // If `step` ever wrote to the frozen `s` instead of its clone, this throws here.
            s = deepFreeze(step(s, input));
          }
          const record: ReplayRecord = {
            engineVersion: s.engineVersion,
            seed: s.seed,
            commit: null,
            table,
            inputs,
          };
          expect(replay(record)).toStrictEqual(s);
          count++;
        }),
        { seed: FC_SEED, numRuns: 10_000 },
      );
      expect(count).toBe(10_000);
    },
    120_000,
  );

  it('replaying an empty-input hand is just startHand(table, seed)', () => {
    const table = tableWith([10000, 10000], { button: 0 });
    const record: ReplayRecord = {
      engineVersion: '0.1.0',
      seed: SEED,
      commit: null,
      table,
      inputs: [],
    };
    const replayed = replay(record);
    expect(replayed.phase).toBe('betting');
    expect(replayed.log.length).toBeGreaterThan(0);
  });
});
