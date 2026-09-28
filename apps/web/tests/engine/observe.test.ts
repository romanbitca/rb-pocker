/**
 * PLAN §4.8 and §18 Stage 2 acceptance 5: `observe()` never leaks a hidden card. For random hands,
 * at an in-progress decision point and at a run-out/showdown state, permuting every other seat's
 * unrevealed hole cards and the undealt stub must leave the built `Observation` exactly the same
 * (a permutation is a stand-in for "any other deal of the cards the observer cannot see" — the
 * strongest available way to show none of them are read).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EngineError } from '../../src/core/assert.ts';
import type { Card } from '../../src/core/cards.ts';
import { rngFromSeed, shuffleRange } from '../../src/core/rng.ts';
import { legalActions } from '../../src/engine/legal.ts';
import { observe } from '../../src/engine/observe.ts';
import { step } from '../../src/engine/step.ts';
import type { HandState, LegalActions, ObserveExtras, SeatState } from '../../src/engine/types.ts';
import { FC_SEED, deal, tableWith } from './helpers.ts';
import { ADVANCE, call, check, handArb, randomInput, seatOf, seedArb } from './play.ts';

/** `extras` of the right length; its content is opaque to `observe` (passed through as-is). */
function extrasFor(n: number): ObserveExtras {
  return {
    seatStats: new Array<null>(n).fill(null),
    visiblePersonality: new Array<null>(n).fill(null),
    seatLevels: new Array<'easy'>(n).fill('easy'),
  };
}

/**
 * A deep copy of `h` with every OTHER seat's unrevealed hole cards and the undealt stub
 * (`deck[deckPos..]`) permuted among themselves, with `seed`: the board, `seat`'s own cards and
 * every revealed hole stay exactly where they are (§4.8, §9.6.3).
 */
function permuteHidden(h: HandState, seat: number, seed: string): HandState {
  const c = JSON.parse(JSON.stringify(h)) as HandState;
  const slots: { get: () => Card; set: (v: Card) => void }[] = [];
  c.seats.forEach((s, i) => {
    if (i === seat || s.hole === null || c.revealed.includes(i)) return;
    const hole = s.hole;
    slots.push({ get: () => hole[0], set: (v) => (hole[0] = v) });
    slots.push({ get: () => hole[1], set: (v) => (hole[1] = v) });
  });
  for (let p = c.deckPos; p < c.deck.length; p++) {
    slots.push({ get: () => c.deck[p] as Card, set: (v) => (c.deck[p] = v) });
  }
  const values = slots.map((s) => s.get());
  shuffleRange(values, 0, values.length - 1, rngFromSeed(seed));
  slots.forEach((s, i) => s.set(values[i] as Card));
  return c;
}

/** Drives `h` to the showdown (or a run-out along the way) with a policy that never folds. */
function toShowdown(h: HandState): HandState {
  let s = h;
  for (let i = 0; i < 1000 && s.phase !== 'showdown' && s.phase !== 'complete'; i++) {
    if (s.phase !== 'betting') {
      s = step(s, ADVANCE);
      continue;
    }
    const legal = legalActions(s) as LegalActions;
    s = step(s, legal.canCheck ? check(legal.seat) : call(legal.seat));
  }
  return s;
}

function assertNonLeaking(s: HandState, permSeed: string): number {
  const extras = extrasFor(s.seats.length);
  let checked = 0;
  for (let seat = 0; seat < s.seats.length; seat++) {
    if (seatOf(s, seat).hole === null) continue;
    const obs1 = observe(s, seat, extras);
    const obs2 = observe(permuteHidden(s, seat, permSeed), seat, extras);
    expect(obs2).toStrictEqual(obs1);
    checked++;
  }
  return checked;
}

describe('observe: the non-cheating boundary (§4.8, acceptance 5)', () => {
  it('an in-progress hand: permuting hidden cards leaves the observation unchanged', () => {
    let checked = 0;
    fc.assert(
      fc.property(handArb, fc.nat(30), seedArb, ({ h, policySeed }, steps, permSeed) => {
        const rng = rngFromSeed(policySeed);
        let s = h;
        // Stops the moment betting ends (never calls `advance`), so `s` is always in progress.
        for (let i = 0; i < steps && s.phase === 'betting'; i++) s = step(s, randomInput(s, rng));
        checked += assertNonLeaking(s, permSeed);
      }),
      { seed: FC_SEED, numRuns: 300 },
    );
    expect(checked).toBeGreaterThan(0);
  });

  it('a run-out/showdown state: permuting hidden cards leaves the observation unchanged', () => {
    let sawRunout = 0;
    let checked = 0;
    fc.assert(
      fc.property(handArb, seedArb, ({ h }, permSeed) => {
        const s = toShowdown(h);
        expect(s.phase === 'showdown' || s.phase === 'complete').toBe(true);
        if (s.runout) sawRunout++;
        checked += assertNonLeaking(s, permSeed);
      }),
      { seed: FC_SEED, numRuns: 300 },
    );
    expect(checked).toBeGreaterThan(0);
    expect(sawRunout).toBeGreaterThan(0); // tiny stacks in handArb do trigger real run-outs
  });

  it('never contains the deck, deckPos, the seed, or an unrevealed hole card', () => {
    const h = deal(tableWith([10000, 10000, 10000], { button: 0 }));
    const obs = observe(h, 0, extrasFor(3));
    const json = JSON.stringify(obs);
    expect(json).not.toContain('deckPos');
    expect(json).not.toContain(JSON.stringify(h.seed));
    // Nobody is revealed yet: no other seat's hole cards may appear anywhere in the observation.
    expect(obs.revealedHoles).toEqual([null, null, null]);
    expect(Object.keys(obs)).not.toContain('deck');
  });

  it('throws ILLEGAL_ACTION for a seat out of range or never dealt into the hand', () => {
    const h = deal(tableWith([10000, 0, 10000], { button: 0 }));
    const extras = extrasFor(3);
    expect(() => observe(h, 3, extras)).toThrow(EngineError);
    expect(() => observe(h, -1, extras)).toThrow(EngineError);
    expect((seatOf(h, 1) as SeatState).dealtIn).toBe(false);
    expect(() => observe(h, 1, extras)).toThrow(EngineError);
  });
});
