/**
 * Helpers for tests that drive the real reducer: input builders, `play` (step + every invariant,
 * the log replay included, after each input), `engineError`, `deepFreeze`, and a seeded random
 * legal-play policy for the property tests.
 */
import fc from 'fast-check';
import { EngineError } from '../../src/core/assert.ts';
import { randInt, seedFromWords, type Rng, type Seed128 } from '../../src/core/rng.ts';
import { checkInvariants } from '../../src/engine/invariants.ts';
import { legalActions } from '../../src/engine/legal.ts';
import { step } from '../../src/engine/step.ts';
import type {
  EngineInput,
  HandState,
  LegalActions,
  PlayerAction,
  SeatState,
} from '../../src/engine/types.ts';
import { deal, tableWith } from './helpers.ts';

export const fold = (seat: number): EngineInput => ({
  kind: 'act',
  seat,
  action: { type: 'fold' },
});
export const check = (seat: number): EngineInput => ({
  kind: 'act',
  seat,
  action: { type: 'check' },
});
export const call = (seat: number): EngineInput => ({
  kind: 'act',
  seat,
  action: { type: 'call' },
});
export const bet = (seat: number, to: number): EngineInput => ({
  kind: 'act',
  seat,
  action: { type: 'bet', to },
});
export const raise = (seat: number, to: number): EngineInput => ({
  kind: 'act',
  seat,
  action: { type: 'raise', to },
});
export const ADVANCE: EngineInput = { kind: 'advance' };

export const seatOf = (h: HandState, seat: number): SeatState => h.seats[seat] as SeatState;

/** `legalActions` for a state that must be betting. */
export function legalOf(h: HandState): LegalActions {
  const legal = legalActions(h);
  if (legal === null) throw new Error(`no legal actions in the ${h.phase} phase`);
  return legal;
}

/** Applies the inputs in order with `step`, checking every invariant (I12 too) after each. */
export function play(h: HandState, ...inputs: EngineInput[]): HandState {
  let s = h;
  for (const input of inputs) {
    s = step(s, input);
    checkInvariants(s, { replayLog: true });
  }
  return s;
}

/** Advances until the phase is not 'roundComplete' (stops at 'betting' or 'showdown'). */
export function advanceWhileRoundComplete(h: HandState): HandState {
  let s = h;
  while (s.phase === 'roundComplete') s = play(s, ADVANCE);
  return s;
}

/** The `EngineError` that `f` throws (fails the test if it throws nothing or something else). */
export function engineError(f: () => unknown): EngineError {
  try {
    f();
  } catch (e) {
    if (e instanceof EngineError) return e;
    throw e;
  }
  throw new Error('expected an EngineError');
}

export function deepFreeze<T>(x: T): T {
  if (typeof x === 'object' && x !== null && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x)) deepFreeze(v as unknown);
  }
  return x;
}

/**
 * A "to" amount in [min, max] of a natural size: the minimum 40% of the time, all-in 10%, and
 * otherwise anything up to twice the minimum (so hands also go to the river with chips behind).
 */
function amountIn(bounds: { min: number; max: number }, rng: Rng): number {
  const r = randInt(rng, 10);
  if (r < 4) return bounds.min;
  if (r === 4) return bounds.max;
  return bounds.min + randInt(rng, Math.min(bounds.max - bounds.min, bounds.min) + 1);
}

/**
 * One random legal action for the seat to act (the property tests' policy). Mostly checks and
 * calls, so hands reach the showdown; bets and raises of random legal sizes (the minimum, all-in
 * and in between) with `aggression` in 0..100; folds only when there is something to call.
 */
export function randomAction(legal: LegalActions, rng: Rng, aggression = 30): PlayerAction {
  const aggressive = randInt(rng, 100) < aggression;
  if (aggressive && legal.bet !== null) return { type: 'bet', to: amountIn(legal.bet, rng) };
  if (aggressive && legal.raise !== null) return { type: 'raise', to: amountIn(legal.raise, rng) };
  if (legal.canCheck) return { type: 'check' };
  return randInt(rng, 4) === 0 ? { type: 'fold' } : { type: 'call' };
}

/** The next input of random legal play: an action while betting, otherwise `advance`. */
export function randomInput(h: HandState, rng: Rng, aggression = 30): EngineInput {
  if (h.phase !== 'betting') return ADVANCE;
  const legal = legalOf(h);
  return { kind: 'act', seat: legal.seat, action: randomAction(legal, rng, aggression) };
}

export const liveCount = (h: HandState): number =>
  h.seats.filter((s) => s.dealtIn && !s.folded).length;

/** The next `advance` settles the hand: after the showdown, or a hand won by folds. */
export const settlesNext = (h: HandState): boolean =>
  h.phase === 'showdown' || (h.phase === 'roundComplete' && liveCount(h) === 1);

export const seedArb: fc.Arbitrary<Seed128> = fc
  .tuple(fc.nat(), fc.nat(), fc.nat(), fc.nat())
  .map(([a, b, c, d]) => seedFromWords(a, b, c, d));

/**
 * A stack for the property tests (§18 Stage 2: "stacks 1–500 bb including tiny stacks"):
 * kind 0 = no chips (not dealt in, engine mode), 1–2 = tiny (1 chip to 1 bb), 3–5 = short (up
 * to 20 bb), 6–11 = anything up to 500 bb.
 */
function stackOf(kind: number, x: number, bb: number): number {
  if (kind === 0) return 0;
  if (kind <= 2) return 1 + (x % bb);
  if (kind <= 5) return 1 + (x % (20 * bb));
  return 1 + (x % (500 * bb));
}

/**
 * A random dealt hand: 2–9 seats, a big blind of 2 to 1,000, stacks from one chip to 500 big
 * blinds (at least two seats with chips), random table and hand seeds, plus a seed for the
 * random-play policy.
 */
export const handArb = fc
  .record({
    seatCount: fc.integer({ min: 2, max: 9 }),
    bb: fc.constantFrom(2, 10, 20, 100, 1000),
    kinds: fc.array(fc.integer({ min: 0, max: 11 }), { minLength: 9, maxLength: 9 }),
    xs: fc.array(fc.integer({ min: 0, max: 1_000_000_000 }), { minLength: 9, maxLength: 9 }),
    tableSeed: seedArb,
    handSeed: seedArb,
    policySeed: seedArb,
  })
  .map(({ seatCount, bb, kinds, xs, tableSeed, handSeed, policySeed }) => {
    const stacks = kinds.slice(0, seatCount).map((kind, i) => stackOf(kind, xs[i] as number, bb));
    if (stacks.filter((s) => s > 0).length < 2) {
      stacks[0] = stacks[0] === 0 ? 100 * bb : (stacks[0] as number);
      stacks[1] = stacks[1] === 0 ? 3 * bb : (stacks[1] as number);
    }
    const startingStack = Math.min(1_000_000, Math.max(200, 100 * bb));
    const table = tableWith(stacks, { sb: bb / 2, bb, startingStack, tableSeed });
    return { h: deal(table, handSeed), policySeed, stacks };
  });
