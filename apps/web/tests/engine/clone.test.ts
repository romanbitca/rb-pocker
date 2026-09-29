import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { InvariantError } from '../../src/core/assert.ts';
import { rngFromSeed } from '../../src/core/rng.ts';
import { cloneHand, deepFreeze } from '../../src/engine/clone.ts';
import { step } from '../../src/engine/step.ts';
import type { HandState } from '../../src/engine/types.ts';
import { FC_SEED, deal, tableWith } from './helpers.ts';
import { handArb, randomInput } from './play.ts';

/** Every object and array reachable from `x`. */
function objectsIn(x: unknown, out: Set<object> = new Set()): Set<object> {
  if (typeof x === 'object' && x !== null && !out.has(x)) {
    out.add(x);
    for (const v of Object.values(x)) objectsIn(v, out);
  }
  return out;
}

describe('cloneHand and deepFreeze (§4.2)', () => {
  it('copies every state of random hands exactly, sharing no object or array', () => {
    const kinds = new Set<string>();
    fc.assert(
      fc.property(handArb, ({ h, policySeed }) => {
        const rng = rngFromSeed(policySeed);
        const states: HandState[] = [h];
        let s = h;
        while (s.phase !== 'complete') {
          s = step(s, randomInput(s, rng));
          states.push(s);
        }
        for (const state of states) {
          const copy = cloneHand(state);
          expect(copy).toStrictEqual(state);
          const original = objectsIn(state);
          const shared = [...objectsIn(copy)].filter((o) => original.has(o));
          expect(shared).toEqual([]);
          for (const ev of state.log) kinds.add(ev.e);
        }
      }),
      { seed: FC_SEED, numRuns: 200 },
    );
    // Every kind of log event and a result were copied (reshuffle is covered below).
    expect([...kinds].sort()).toEqual(['act', 'award', 'post', 'refund', 'reveal', 'street']);
  });

  it('copies a reshuffle event too', () => {
    const start = deal(tableWith([10000, 10000], { button: 0 }));
    const h = step(start, { kind: 'reshuffle', decisionId: 0, undoIndex: 0 });
    expect(h.log.at(-1)?.e).toBe('reshuffle');
    expect(cloneHand(h)).toStrictEqual(h);
  });

  it('throws InvariantError (I0), not TypeError, for something that is not a hand state', () => {
    for (const bad of [{}, { seats: 3 }, null]) {
      expect(() => cloneHand(bad as unknown as HandState)).toThrow(InvariantError);
    }
    const broken = { ...deal(tableWith([10000, 10000], { button: 0 })), log: 'x' };
    expect(() => step(broken as unknown as HandState, { kind: 'advance' })).toThrow(
      /I0 well-formed/,
    );
  });

  it('deepFreeze freezes every nested object and array', () => {
    const x = deepFreeze({ a: [1, { b: [2] }], c: { d: null } });
    for (const o of objectsIn(x)) expect(Object.isFrozen(o)).toBe(true);
  });

  it('deepFreeze returns an already frozen state as it is (a step output in development)', () => {
    const h = step(deal(tableWith([10000, 10000], { button: 0 })), {
      kind: 'act',
      seat: 0,
      action: { type: 'call' },
    });
    expect(Object.isFrozen(h)).toBe(true); // §4.2: development builds freeze what step returns
    expect(deepFreeze(h)).toBe(h);
    for (const o of objectsIn(h)) expect(Object.isFrozen(o)).toBe(true);
  });
});
