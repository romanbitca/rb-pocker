/**
 * PLAN §19.4, §19.9 and §18 Stage 10, acceptance 6: `publicHand` never leaks a hidden card. The
 * proof is §9.6's, for this function: for random hands and viewers, at every state the hands pass
 * through, re-dealing every card the viewer cannot see (other seats' unrevealed hole cards, the
 * burn cards and the undealt stub, `permuteHidden`) leaves the view deep-equal. The re-deal keeps
 * the state consistent, so it is a real other deal of what the viewer cannot see.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { rngFromSeed, type Seed128 } from '../../src/core/rng.ts';
import { checkInvariants } from '../../src/engine/invariants.ts';
import { legalActions } from '../../src/engine/legal.ts';
import { publicHand } from '../../src/engine/project.ts';
import { step } from '../../src/engine/step.ts';
import type { HandState, LegalActions } from '../../src/engine/types.ts';
import { FC_SEED, deal, tableWith } from './helpers.ts';
import { permuteHidden } from './permute.ts';
import {
  ADVANCE,
  call,
  check,
  deepFreeze,
  fold,
  handArb,
  play,
  raise,
  randomInput,
  seatOf,
  seedArb,
} from './play.ts';

/** Every seat of the hand, dealt in or not, and null: someone not at the table. */
const viewersOf = (s: HandState): (number | null)[] => [null, ...s.seats.keys()];

/** Plays `h` to its end with a policy that never folds. */
function toEnd(h: HandState): HandState {
  let s = h;
  for (let i = 0; i < 1000 && s.phase !== 'complete'; i++) {
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
  viewed: number;
  redealt: number;
}

/**
 * For every viewer of `s`: only the viewer's own cards and the revealed seats' are in the view,
 * and the view of `s` and of a re-deal of everything that viewer cannot see are deep-equal. The
 * re-deal must be a valid state and must really move cards, so the check is never vacuous.
 */
function assertNonLeaking(s: HandState, permSeed: Seed128, stats: LeakStats): void {
  for (const viewer of viewersOf(s)) {
    const view = publicHand(s, viewer);
    expect(view.seats.map((seat) => seat.hole)).toStrictEqual(
      s.seats.map((seat, i) => (i === viewer || s.revealed.includes(i) ? seat.hole : null)),
    );
    const other = permuteHidden(s, viewer ?? -1, permSeed);
    checkInvariants(other);
    if (JSON.stringify(other.deck) !== JSON.stringify(s.deck)) stats.redealt++;
    expect(publicHand(other, viewer)).toStrictEqual(view);
    stats.viewed++;
  }
}

/** Every object key anywhere in `x` (L3 walks the structure, it does not search strings). */
function keysIn(x: unknown, into = new Set<string>()): Set<string> {
  if (typeof x === 'object' && x !== null) {
    for (const [key, value] of Object.entries(x)) {
      into.add(key);
      keysIn(value, into);
    }
  }
  return into;
}

/** Empties every array and object inside `x`: throws on anything frozen. */
function scrub(x: unknown): void {
  if (typeof x !== 'object' || x === null) return;
  for (const value of Object.values(x)) scrub(value);
  if (Array.isArray(x)) x.length = 0;
  else for (const key of Object.keys(x)) delete (x as Record<string, unknown>)[key];
}

describe('publicHand: the leak proof (§19.9, acceptance 6)', () => {
  it(
    'at every state of random hands, for every viewer, re-dealing the hidden cards changes nothing',
    { timeout: 120_000 },
    () => {
      const stats: LeakStats = { viewed: 0, redealt: 0 };
      const seen = new Set<string>();
      fc.assert(
        fc.property(handArb, seedArb, ({ h, policySeed }, permSeed) => {
          const rng = rngFromSeed(policySeed);
          let s = h;
          assertNonLeaking(s, permSeed, stats);
          for (let i = 0; i < 400 && s.phase !== 'complete'; i++) {
            s = step(s, randomInput(s, rng));
            seen.add(`${s.phase}:${s.street}`);
            if (s.runout) seen.add('runout');
            if (s.seats.some((seat) => !seat.dealtIn)) seen.add('a seat not dealt in');
            if (s.seats.some((seat) => seat.folded)) seen.add('a folded seat');
            assertNonLeaking(s, permSeed, stats);
          }
          expect(s.phase).toBe('complete');
        }),
        { seed: FC_SEED, numRuns: 150 },
      );
      expect(stats.viewed).toBeGreaterThan(0);
      expect(stats.redealt).toBe(stats.viewed); // every re-deal moved at least one hidden card
      for (const street of ['preflop', 'flop', 'turn', 'river']) {
        expect(seen).toContain(`betting:${street}`);
        expect(seen).toContain(`roundComplete:${street}`);
      }
      for (const state of [
        'showdown:river',
        'complete:river',
        'runout',
        'a seat not dealt in',
        'a folded seat',
      ]) {
        expect(seen).toContain(state);
      }
    },
  );
});

describe('publicHand: what each player sees (§19.4)', () => {
  it('copies the public fields of a dealt hand, and only those', () => {
    const h = deal(tableWith([10000, 10000, 0, 10000], { button: 0 }));
    expect(publicHand(h, 1)).toStrictEqual({
      handSeq: h.handSeq,
      sb: 50,
      bb: 100,
      seats: h.seats.map((seat, i) => ({
        dealtIn: seat.dealtIn,
        stack: seat.stack,
        hole: i === 1 ? seat.hole : null,
        folded: false,
        allIn: false,
        streetBet: seat.streetBet,
        totalBet: seat.totalBet,
      })),
      button: h.button,
      sbSeat: h.sbSeat,
      bbSeat: h.bbSeat,
      street: 'preflop',
      phase: 'betting',
      board: [],
      currentBet: 100,
      minRaiseInc: 100,
      toAct: h.toAct,
      runout: false,
      revealed: [],
      startStacks: [10000, 10000, 0, 10000],
      log: h.log,
      result: null,
    });
  });

  it('a seat not dealt in, or nobody, sees no cards at all before a reveal', () => {
    const h = deal(tableWith([10000, 10000, 0, 10000], { button: 0 }));
    expect(seatOf(h, 2).dealtIn).toBe(false);
    for (const viewer of [2, null, 99, -1]) {
      expect(publicHand(h, viewer).seats.map((seat) => seat.hole)).toEqual([
        null,
        null,
        null,
        null,
      ]);
    }
  });

  it('a hand won by folds shows nobody else’s cards, even at its end', () => {
    const h = deal(tableWith([10000, 10000, 10000], { button: 0 }));
    const done = play(h, fold(0), fold(1), ADVANCE);
    expect(done.phase).toBe('complete');
    expect(done.result?.endedBy).toBe('fold');
    expect(done.revealed).toEqual([]);
    for (const viewer of [0, 1, 2]) {
      const view = publicHand(done, viewer);
      expect(view.revealed).toEqual([]);
      expect(view.result?.shown).toEqual([]);
      view.seats.forEach((seat, i) => {
        expect(seat.hole).toStrictEqual(i === viewer ? seatOf(done, i).hole : null);
      });
    }
  });

  it('at a showdown the live hands are public and a folded hand is never shown', () => {
    const h = deal(tableWith([10000, 10000, 10000], { button: 0 }));
    const done = toEnd(step(h, fold(0)));
    expect(done.result?.endedBy).toBe('showdown');
    expect([...done.revealed].sort()).toEqual([1, 2]);
    const others = publicHand(done, 1);
    expect(others.seats[0]?.hole).toBeNull();
    expect(others.seats[1]?.hole).toStrictEqual(seatOf(done, 1).hole);
    expect(others.seats[2]?.hole).toStrictEqual(seatOf(done, 2).hole);
    expect(others.result?.shown.map((s) => s.seat).sort()).toEqual([1, 2]);
    // The player who folded still sees their own two cards.
    expect(publicHand(done, 0).seats[0]?.hole).toStrictEqual(seatOf(done, 0).hole);
    expect(publicHand(done, null).seats.map((seat) => seat.hole === null)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('an all-in run-out shows the live hands while the board still comes', () => {
    const h = deal(tableWith([10000, 10000], { button: 0 }));
    let s = step(step(h, raise(0, 10000)), call(1));
    while (!s.runout) s = step(s, ADVANCE);
    expect(s.board.length).toBeLessThan(5);
    expect(publicHand(s, null).seats.map((seat) => seat.hole)).toStrictEqual([
      seatOf(s, 0).hole,
      seatOf(s, 1).hole,
    ]);
  });

  it('never has a key for the deck, the seed or the engine’s private fields (L3)', () => {
    const h = deal(tableWith([10000, 10000, 10000], { button: 0 }));
    for (const state of [h, toEnd(h), toEnd(step(h, fold(0)))]) {
      const keys = keysIn(publicHand(state, 0));
      for (const hidden of [
        'deck',
        'deckPos',
        'seed',
        'tableSeed',
        'startTotal',
        'undoneDecisions',
        'lastActedAtBet',
        'lastAggressor',
        'preflopAggressor',
        'schema',
        'engineVersion',
      ]) {
        expect(keys).not.toContain(hidden);
      }
    }
  });

  it('shares nothing with the hand, and leaves it as it was', () => {
    const h = deal(tableWith([10000, 10000, 10000], { button: 0 }));
    const done = deepFreeze(toEnd(step(h, fold(0))));
    expect(done.log.map((event) => event.e)).toEqual(
      expect.arrayContaining(['post', 'act', 'street', 'reveal', 'award']),
    );
    const view = publicHand(done, 1);
    const before = JSON.stringify(done);
    expect(() => scrub(view)).not.toThrow();
    expect(JSON.stringify(done)).toBe(before);
  });

  it('is pure: two calls give equal views', () => {
    const done = toEnd(deal(tableWith([10000, 10000, 10000], { button: 0 })));
    expect(publicHand(done, 2)).toStrictEqual(publicHand(done, 2));
  });
});
