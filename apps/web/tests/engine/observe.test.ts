/**
 * PLAN §4.8, §9.6.3 and §18 Stage 2 acceptance 5: `observe()` never leaks a hidden card. For
 * random hands, at every state they pass through (decision points on every street, round ends,
 * run-outs, the showdown and the end), re-dealing every card the observer cannot see must leave
 * the built `Observation` exactly the same. The re-deal permutes other seats' unrevealed hole
 * cards, the burn cards and the undealt stub among themselves and keeps the state consistent
 * (it passes `checkInvariants`, I8 included), so it is a real "other deal of the cards the
 * observer cannot see", the strongest available way to show that none of them are read.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EngineError } from '../../src/core/assert.ts';
import { rngFromSeed, type Seed128 } from '../../src/core/rng.ts';
import { checkInvariants } from '../../src/engine/invariants.ts';
import { legalActions } from '../../src/engine/legal.ts';
import { observe } from '../../src/engine/observe.ts';
import { step } from '../../src/engine/step.ts';
import type { HandState, LegalActions, ObserveExtras, SeatState } from '../../src/engine/types.ts';
import { FC_SEED, deal, tableWith } from './helpers.ts';
import { permuteHidden } from './permute.ts';
import {
  ADVANCE,
  call,
  check,
  fold,
  handArb,
  raise,
  randomInput,
  seatOf,
  seedArb,
} from './play.ts';

/** `extras` of the right length; its content is opaque to `observe` (passed through as-is). */
function extrasFor(n: number): ObserveExtras {
  return {
    seatStats: new Array<null>(n).fill(null),
    visiblePersonality: new Array<null>(n).fill(null),
    seatLevels: new Array<'easy'>(n).fill('easy'),
  };
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

interface LeakStats {
  observed: number;
  redealt: number;
}

/**
 * For every seat dealt into `s`: the observation of `s` and of a re-deal of everything that seat
 * cannot see are deep-equal. The re-deal must itself be a valid state (so the check is never
 * vacuous) and must actually move cards (counted in `stats.redealt`).
 */
function assertNonLeaking(s: HandState, permSeed: Seed128, stats: LeakStats): void {
  const extras = extrasFor(s.seats.length);
  for (let seat = 0; seat < s.seats.length; seat++) {
    if (seatOf(s, seat).hole === null) continue;
    const other = permuteHidden(s, seat, permSeed);
    checkInvariants(other);
    if (JSON.stringify(other.deck) !== JSON.stringify(s.deck)) stats.redealt++;
    expect(observe(other, seat, extras)).toStrictEqual(observe(s, seat, extras));
    stats.observed++;
  }
}

describe('observe: the non-cheating boundary (§4.8, §9.6.3, acceptance 5)', () => {
  it(
    'at every state of random hands, re-dealing the hidden cards leaves every observation unchanged',
    { timeout: 60_000 },
    () => {
      const stats: LeakStats = { observed: 0, redealt: 0 };
      const seen = new Set<string>();
      fc.assert(
        fc.property(handArb, seedArb, ({ h, policySeed }, permSeed) => {
          const rng = rngFromSeed(policySeed);
          let s = h;
          assertNonLeaking(s, permSeed, stats);
          for (let i = 0; i < 400 && s.phase !== 'complete'; i++) {
            s = step(s, randomInput(s, rng));
            seen.add(`${s.phase}:${s.street}`);
            assertNonLeaking(s, permSeed, stats);
          }
          expect(s.phase).toBe('complete');
        }),
        { seed: FC_SEED, numRuns: 300 },
      );
      expect(stats.observed).toBeGreaterThan(0);
      expect(stats.redealt).toBe(stats.observed); // every re-deal moved at least one hidden card
      // Decision points on every street, run-out and round-end states, the showdown and the end.
      for (const street of ['preflop', 'flop', 'turn', 'river']) {
        expect(seen).toContain(`betting:${street}`);
        expect(seen).toContain(`roundComplete:${street}`);
      }
      expect(seen).toContain('showdown:river');
      expect(seen).toContain('complete:river');
    },
  );

  it('a run-out/showdown state: re-dealing the hidden cards leaves the observation unchanged', () => {
    const stats: LeakStats = { observed: 0, redealt: 0 };
    let sawRunout = 0;
    fc.assert(
      fc.property(handArb, seedArb, ({ h }, permSeed) => {
        const s = toShowdown(h);
        expect(s.phase === 'showdown' || s.phase === 'complete').toBe(true);
        if (s.runout) sawRunout++;
        assertNonLeaking(s, permSeed, stats);
      }),
      { seed: FC_SEED, numRuns: 300 },
    );
    expect(stats.observed).toBeGreaterThan(0);
    expect(stats.redealt).toBe(stats.observed);
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

  it('legal: the real bounds on the seat’s own turn, a closed shape with the public numbers otherwise', () => {
    // 0 = BTN, 1 = SB, 2 = BB (150 chips): the button acts first and faces 100.
    const h = deal(tableWith([10000, 10000, 150], { button: 0 }));
    const extras = extrasFor(3);
    expect(observe(h, 0, extras).legal).toStrictEqual(legalActions(h));
    const closed = { canFold: false, canCheck: false, canCall: false, bet: null, raise: null };
    expect(observe(h, 1, extras).legal).toStrictEqual({
      seat: 1,
      toCall: 50,
      callAmount: 50,
      callIsAllIn: false,
      ...closed,
    });
    // The button raises to 400 and the SB folds: the BB (50 behind) can only call all-in.
    const beforeBB = step(h, raise(0, 400));
    const raised = step(beforeBB, fold(1));
    expect(raised.toAct).toBe(2);
    expect(observe(raised, 2, extras).legal).toStrictEqual(legalActions(raised));
    expect(observe(raised, 0, extras).legal).toStrictEqual({
      seat: 0,
      toCall: 0,
      callAmount: 0,
      callIsAllIn: false,
      ...closed,
    });
    // On the SB's turn, the BB's closed shape still carries its public numbers.
    expect(observe(beforeBB, 2, extras).legal).toStrictEqual({
      seat: 2,
      toCall: 300,
      callAmount: 50,
      callIsAllIn: true,
      ...closed,
    });
    // Outside the betting phase nothing is legal for anyone.
    const flop = [call(0), call(1), check(2), ADVANCE].reduce(step, h);
    expect(flop).toMatchObject({ phase: 'betting', street: 'flop' });
    const done = [check(1), check(2), check(0)].reduce(step, flop);
    expect(done.phase).toBe('roundComplete');
    for (let seat = 0; seat < 3; seat++) {
      expect(observe(done, seat, extras).legal).toMatchObject({ seat, toCall: 0, ...closed });
    }
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
