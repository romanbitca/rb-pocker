/**
 * The random-play harness of the Stage 2 property runs (§18 Stage 2 acceptance 2): random tables
 * (2–9 seats, big blinds from 2 to 1,000, stacks from one chip to 500 big blinds, with empty,
 * tiny and short seats) and random legal play (fold, check, call, bet and raise; amounts at the
 * minimum, all-in, natural sizes and anywhere in the legal range; now and then an undo
 * `reshuffle`), with every invariant checked after every step: `step` runs `checkInvariants` on
 * each state it returns, and the harness runs it again with the I12 log replay.
 *
 * It is built for volume (100,000 hands in `unit`, 10 million steps in `slow`): one seeded RNG
 * per hand instead of fast-check, and plain throws instead of `expect` in the loop. The checks are
 * never reduced. A failure throws with the hand's `ReplayRecord` (table, seed, inputs), so the
 * hand can be replayed exactly; hand `i` of a run is also reproducible from the run's seed alone.
 */
import {
  deriveSeed,
  randInt,
  rngFromSeed,
  seedFromWords,
  type Rng,
  type Seed128,
} from '../../src/core/rng.ts';
import { checkInvariants } from '../../src/engine/invariants.ts';
import { legalActions } from '../../src/engine/legal.ts';
import { startHand } from '../../src/engine/start.ts';
import { step } from '../../src/engine/step.ts';
import type {
  EngineInput,
  HandState,
  LegalActions,
  PlayerAction,
  ReplayRecord,
  TableState,
} from '../../src/engine/types.ts';
import { tableWith } from './helpers.ts';

/** §18 Stage 2: every hand reaches 'complete' in at most this many inputs. */
export const MAX_INPUTS = 400;

const BIG_BLINDS = [2, 10, 20, 100, 1000] as const;

const seedOf = (rng: Rng): Seed128 => seedFromWords(rng.next(), rng.next(), rng.next(), rng.next());

/**
 * A stack for a random seat, as `handArb` draws them: 1 in 12 empty (not dealt in, engine mode),
 * 2 in 12 tiny (one chip to one big blind), 3 in 12 short (up to 20 bb), 6 in 12 up to 500 bb.
 */
function randomStack(rng: Rng, bb: number): number {
  const kind = randInt(rng, 12);
  if (kind === 0) return 0;
  if (kind <= 2) return 1 + randInt(rng, bb);
  if (kind <= 5) return 1 + randInt(rng, 20 * bb);
  return 1 + randInt(rng, 500 * bb);
}

/** A random table (at least two seats with chips), drawn from `rng`. */
export function randomTable(rng: Rng): TableState {
  const seatCount = 2 + randInt(rng, 8);
  const bb = BIG_BLINDS[randInt(rng, BIG_BLINDS.length)] as number;
  const stacks = Array.from({ length: seatCount }, () => randomStack(rng, bb));
  if (stacks.filter((s) => s > 0).length < 2) {
    stacks[0] = stacks[0] === 0 ? 100 * bb : (stacks[0] as number);
    stacks[1] = stacks[1] === 0 ? 3 * bb : (stacks[1] as number);
  }
  const startingStack = Math.min(1_000_000, Math.max(200, 100 * bb));
  return tableWith(stacks, { sb: bb / 2, bb, startingStack, tableSeed: seedOf(rng) });
}

/** A "to" amount in [min, max]: the minimum, all-in, a natural size (≤ 2 × min) or anywhere. */
function randomAmount(bounds: { min: number; max: number }, rng: Rng): number {
  const r = randInt(rng, 20);
  if (r < 7) return bounds.min;
  if (r < 9) return bounds.max;
  if (r < 16) return bounds.min + randInt(rng, Math.min(bounds.max - bounds.min, bounds.min) + 1);
  return bounds.min + randInt(rng, bounds.max - bounds.min + 1);
}

/** A random legal action for the seat to act; `aggression` (0–100) is the bet/raise rate. */
function randomAction(legal: LegalActions, rng: Rng, aggression: number): PlayerAction {
  const aggressive = randInt(rng, 100) < aggression;
  if (aggressive && legal.bet !== null) return { type: 'bet', to: randomAmount(legal.bet, rng) };
  if (aggressive && legal.raise !== null) {
    return { type: 'raise', to: randomAmount(legal.raise, rng) };
  }
  if (legal.canCheck) return { type: 'check' };
  return randInt(rng, 4) === 0 ? { type: 'fold' } : { type: 'call' };
}

/** What happened over a run of random hands (to show the run reaches every kind of hand). */
export interface RandomPlayStats {
  hands: number;
  steps: number;
  longest: number;
  seatCounts: number[]; // index = seats at the table
  showdowns: number;
  foldWins: number;
  runouts: number;
  sidePots: number;
  splitPots: number;
  riverBets: number;
  reshuffles: number;
  emptySeats: number; // hands with a seat that is not dealt in
  tinyStacks: number; // hands with a dealt-in seat that starts below one big blind
  allInBlinds: number; // hands where a blind post is all-in
}

const newStats = (): RandomPlayStats => ({
  hands: 0,
  steps: 0,
  longest: 0,
  seatCounts: new Array<number>(10).fill(0),
  showdowns: 0,
  foldWins: 0,
  runouts: 0,
  sidePots: 0,
  splitPots: 0,
  riverBets: 0,
  reshuffles: 0,
  emptySeats: 0,
  tinyStacks: 0,
  allInBlinds: 0,
});

function tally(stats: RandomPlayStats, h: HandState, inputs: number): void {
  const r = h.result;
  if (r === null) throw new Error('complete without a result');
  stats.hands++;
  stats.steps += inputs;
  stats.longest = Math.max(stats.longest, inputs);
  stats.seatCounts[h.seats.length] = (stats.seatCounts[h.seats.length] as number) + 1;
  if (r.endedBy === 'showdown') stats.showdowns++;
  else stats.foldWins++;
  if (h.runout) stats.runouts++;
  if (r.pots.length > 1) stats.sidePots++;
  if (r.potWinners.some((w) => w.length > 1)) stats.splitPots++;
  if (h.log.some((ev) => ev.e === 'act' && ev.street === 'river' && ev.amountIn > 0)) {
    stats.riverBets++;
  }
  if (h.undoneDecisions.length > 0) stats.reshuffles++;
  if (h.seats.some((s) => !s.dealtIn)) stats.emptySeats++;
  if (h.startStacks.some((x) => x > 0 && x < h.bb)) stats.tinyStacks++;
  if (h.log.some((ev) => ev.e === 'post' && ev.allIn)) stats.allInBlinds++;
}

/**
 * Plays one random hand to 'complete' with random legal inputs, checking every invariant (the I12
 * log replay included) after the deal and after every step. Throws (with the replay record) on a
 * broken invariant, a refused input, or a hand that needs more than `MAX_INPUTS` inputs.
 * `record`, when given, sees each state and the input about to be applied to it (the benchmark's
 * corpus).
 */
export function playRandomHand(
  rng: Rng,
  record?: (before: HandState, input: EngineInput) => void,
): { final: HandState; inputs: number } {
  const table = randomTable(rng);
  const seed = seedOf(rng);
  const aggression = randInt(rng, 61);
  const inputs: EngineInput[] = [];
  let s: HandState | null = null;
  try {
    s = startHand(table, seed);
    checkInvariants(s, { replayLog: true });
    let decisionId = 0;
    while (s.phase !== 'complete') {
      if (inputs.length === MAX_INPUTS) throw new Error(`not complete after ${MAX_INPUTS} inputs`);
      let input: EngineInput;
      if (s.revealed.length === 0 && s.phase !== 'showdown' && randInt(rng, 50) === 0) {
        // An undo (§11.3): a fresh decision id each time, a random undo counter.
        input = { kind: 'reshuffle', decisionId: decisionId++, undoIndex: randInt(rng, 3) };
      } else if (s.phase === 'betting') {
        const legal = legalActions(s) as LegalActions;
        input = { kind: 'act', seat: legal.seat, action: randomAction(legal, rng, aggression) };
      } else {
        input = { kind: 'advance' };
      }
      inputs.push(input);
      if (record !== undefined) record(s, input);
      s = step(s, input);
      checkInvariants(s, { replayLog: true });
    }
    return { final: s, inputs: inputs.length };
  } catch (e) {
    const record: ReplayRecord = {
      engineVersion: s?.engineVersion ?? '',
      seed,
      commit: null,
      table,
      inputs,
    };
    throw new Error(`random hand failed: ${String(e)}\nreplay record: ${JSON.stringify(record)}`, {
      cause: e,
    });
  }
}

/**
 * Plays random hands until `hands` hands or at least `steps` inputs, whichever the caller gives;
 * hand `i` draws everything from `deriveSeed(seed, 'random-play', i)`.
 */
export function runRandomHands(
  seed: Seed128,
  until: { hands: number } | { steps: number },
): RandomPlayStats {
  const stats = newStats();
  const done = (): boolean =>
    'hands' in until ? stats.hands >= until.hands : stats.steps >= until.steps;
  for (let i = 0; !done(); i++) {
    const { final, inputs } = playRandomHand(rngFromSeed(deriveSeed(seed, 'random-play', i)));
    tally(stats, final, inputs);
  }
  return stats;
}

/** One line for the log: how many hands of each kind the run reached. */
export function describeStats(stats: RandomPlayStats): string {
  const seats = stats.seatCounts
    .map((n, k) => (k >= 2 ? `${k}:${n}` : ''))
    .filter((x) => x !== '')
    .join(' ');
  return (
    `${stats.hands} hands, ${stats.steps} steps (longest ${stats.longest}); ` +
    `showdowns ${stats.showdowns}, fold wins ${stats.foldWins}, run-outs ${stats.runouts}, ` +
    `side pots ${stats.sidePots}, split pots ${stats.splitPots}, river bets ${stats.riverBets}, ` +
    `reshuffles ${stats.reshuffles}, empty seats ${stats.emptySeats}, tiny stacks ` +
    `${stats.tinyStacks}, all-in blinds ${stats.allInBlinds}; seats ${seats}`
  );
}
