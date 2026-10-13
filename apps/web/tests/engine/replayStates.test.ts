/**
 * `replayStates(record)` (PLAN §4.7, §12.10): every state of a hand, for Review. It is `replay` of
 * every prefix of the inputs in one pass: the deal first, the final state last.
 */
import { describe, expect, it } from 'vitest';
import { EngineError } from '../../src/core/assert.ts';
import { deriveSeed, rngFromSeed } from '../../src/core/rng.ts';
import { replay, replayStates } from '../../src/engine/replay.ts';
import { startHand } from '../../src/engine/start.ts';
import { step } from '../../src/engine/step.ts';
import type { EngineInput, ReplayRecord } from '../../src/engine/types.ts';
import { SEED, tableWith } from './helpers.ts';
import { randomInput } from './play.ts';
import { randomTable } from './random-play.ts';

/** A random hand of random legal play, as a replay record. */
function randomRecord(i: number): ReplayRecord {
  const rng = rngFromSeed(deriveSeed(SEED, 'replay-states', i));
  const table = randomTable(rng);
  const seed = deriveSeed(SEED, 'hand', i);
  const inputs: EngineInput[] = [];
  let h = startHand(table, seed);
  while (h.phase !== 'complete') {
    const input = randomInput(h, rng);
    inputs.push(input);
    h = step(h, input);
  }
  return { engineVersion: h.engineVersion, seed, commit: null, table, inputs };
}

describe('replayStates (§12.10)', () => {
  it('gives the deal, then the state after each input; every prefix agrees with replay()', () => {
    for (let i = 0; i < 150; i++) {
      const record = randomRecord(i);
      const states = replayStates(record);
      expect(states).toHaveLength(record.inputs.length + 1);
      expect(states[0]).toStrictEqual(startHand(record.table, record.seed));
      states.forEach((state, k) => {
        expect(state).toStrictEqual(replay({ ...record, inputs: record.inputs.slice(0, k) }));
      });
      expect(states[states.length - 1]?.phase).toBe('complete');
    }
  }, 60_000);

  it('a hand with no inputs is just the deal', () => {
    const table = tableWith([10000, 10000], { button: 0 });
    const record: ReplayRecord = {
      engineVersion: '0.1.0',
      seed: SEED,
      commit: null,
      table,
      inputs: [],
    };
    expect(replayStates(record)).toStrictEqual([startHand(table, SEED)]);
  });

  it('refuses an illegal input like replay() does, and leaves the record alone', () => {
    const table = tableWith([10000, 10000, 10000], { button: 0 });
    const inputs: EngineInput[] = [{ kind: 'advance' }];
    const record: ReplayRecord = {
      engineVersion: '0.1.0',
      seed: SEED,
      commit: null,
      table,
      inputs,
    };
    expect(() => replayStates(record)).toThrow(EngineError);
    expect(() => replay(record)).toThrow(EngineError);
    expect(record.inputs).toEqual([{ kind: 'advance' }]);
  });
});
