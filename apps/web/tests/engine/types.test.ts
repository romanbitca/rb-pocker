import { describe, expect, it } from 'vitest';
import webPackage from '../../package.json' with { type: 'json' };
import * as assert from '../../src/core/assert.ts';
import {
  ENGINE_VERSION,
  EngineError,
  InvariantError,
  observationKey,
  type LegalActions,
  type Observation,
} from '../../src/engine/types.ts';
import { allInShowdown, clone, foldedToBigBlind, handAtStart, headsUpFlop } from './fixtures.ts';

describe('engine/types', () => {
  it('ENGINE_VERSION is the version in apps/web/package.json (§4.6)', () => {
    expect(ENGINE_VERSION).toBe(webPackage.version);
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('re-exports the error classes of core/assert (A.1, A.3)', () => {
    expect(EngineError).toBe(assert.EngineError);
    expect(InvariantError).toBe(assert.InvariantError);
  });

  it('hand states are plain JSON: the round trip is deep-equal (§2.4, §4.6)', () => {
    const states = [
      handAtStart({ stacks: [10000, 0, 30, 10000], button: 3 }),
      headsUpFlop(),
      foldedToBigBlind().complete,
      allInShowdown().complete,
    ];
    for (const h of states) expect(clone(h)).toStrictEqual(h);
  });
});

const legal: LegalActions = {
  seat: 0,
  toCall: 50,
  callAmount: 50,
  callIsAllIn: false,
  canFold: true,
  canCheck: false,
  canCall: true,
  bet: null,
  raise: { min: 200, max: 10000 },
};

const observation = (): Observation => ({
  seat: 0,
  hole: [50, 46],
  board: [],
  street: 'preflop',
  handSeq: 7,
  sb: 50,
  bb: 100,
  button: 0,
  sbSeat: 0,
  bbSeat: 1,
  pot: 150,
  legal,
  stacks: [9950, 9900],
  streetBets: [50, 100],
  totalBets: [50, 100],
  dealtIn: [true, true],
  folded: [false, false],
  allIn: [false, false],
  history: [
    {
      seat: 0,
      street: 'preflop',
      type: 'postSB',
      to: null,
      amountIn: 50,
      allIn: false,
      full: false,
      potBefore: 0,
    },
  ],
  revealedHoles: [null, null],
  seatStats: [null, null],
  visiblePersonality: [null, 'station'],
  seatLevels: ['easy', 'easy'],
});

describe('observationKey', () => {
  it('is canonical JSON: sorted keys, no whitespace, parses back to the observation', () => {
    const o = observation();
    const key = observationKey(o);
    expect(JSON.parse(key)).toStrictEqual(o);
    expect(key).not.toMatch(/\s/);
    expect(key.startsWith('{"allIn":[false,false],"bb":100,"bbSeat":1,"board":[],')).toBe(true);
  });

  it('does not depend on the order the keys were written in', () => {
    const o = observation();
    const reversed = Object.fromEntries(Object.entries(o).reverse()) as unknown as Observation;
    reversed.legal = Object.fromEntries(
      Object.entries(o.legal).reverse(),
    ) as unknown as LegalActions;
    expect(observationKey(reversed)).toBe(observationKey(o));
  });

  it('changes with any value, and array order matters', () => {
    const base = observationKey(observation());
    const variants: ((o: Observation) => void)[] = [
      (o) => (o.handSeq = 8),
      (o) => (o.hole = [46, 50]),
      (o) => (o.legal.raise = null),
      (o) => (o.visiblePersonality[1] = null),
      (o) => ((o.history[0] as Observation['history'][number]).potBefore = 1),
    ];
    for (const change of variants) {
      const o = observation();
      change(o);
      expect(observationKey(o)).not.toBe(base);
    }
  });

  it('throws on values that are not plain JSON', () => {
    const bad: ((o: Observation) => void)[] = [
      (o) => ((o as unknown as Record<string, unknown>).extra = undefined),
      (o) => (o.pot = Number.NaN),
      (o) => (o.pot = Infinity),
      (o) => ((o as unknown as Record<string, unknown>).when = new Date(0)),
      (o) => ((o as unknown as Record<string, unknown>).f = () => 1),
      (o) => (o.board = new Array<number>(2)),
    ];
    for (const change of bad) {
      const o = observation();
      change(o);
      expect(() => observationKey(o)).toThrow(TypeError);
    }
  });
});
