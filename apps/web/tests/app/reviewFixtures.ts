/**
 * Finished hands for the Review tests: a table and a seed are played to the end by a policy, and
 * the result is kept the way the controller keeps it (`ReviewHand`, app/review.ts).
 */
import type { ReviewHand } from '../../src/app/review.ts';
import { handEndViewOf } from '../../src/app/tableViews.ts';
import type { Grade } from '../../src/brain/types.ts';
import { deriveSeed, randInt, rngFromSeed, type Rng, type Seed128 } from '../../src/core/rng.ts';
import { legalActions } from '../../src/engine/legal.ts';
import { replay, replayStates } from '../../src/engine/replay.ts';
import { startHand } from '../../src/engine/start.ts';
import { step } from '../../src/engine/step.ts';
import type { DecisionRecord } from '../../src/persist/schema.ts';
import {
  ENGINE_VERSION,
  type EngineInput,
  type HandState,
  type LegalActions,
  type PlayerAction,
  type ReplayRecord,
  type Street,
  type TableState,
} from '../../src/engine/types.ts';
import { tableWith } from '../engine/helpers.ts';

export const REVIEW_SEED: Seed128 = '7e57ed0000000000000000000000ab12';

/** A table of `players` seats (you and bots) with 2,000 chips each, blinds 10/20. */
export function reviewTable(
  players: number,
  seed: Seed128,
  handSeq = 1,
  handsDealt = 0,
): TableState {
  const table = tableWith(new Array<number>(players).fill(2000), {
    sb: 10,
    bb: 20,
    startingStack: 2000,
    tableSeed: seed,
    nextHandSeq: handSeq,
  });
  return { ...table, handsDealt };
}

/** The next input of `h` from `choose` (an action while betting, else `advance`). */
export type Policy = (h: HandState, legal: LegalActions) => PlayerAction;

/** Plays the hand to the end; returns the final state and the record `replay()` takes. */
export function playToEnd(
  table: TableState,
  seed: Seed128,
  policy: Policy,
): { final: HandState; record: ReplayRecord } {
  const inputs: EngineInput[] = [];
  let h = startHand(table, seed);
  while (h.phase !== 'complete') {
    const input: EngineInput =
      h.phase === 'betting'
        ? {
            kind: 'act',
            seat: h.toAct as number,
            action: policy(h, legalActions(h) as LegalActions),
          }
        : { kind: 'advance' };
    inputs.push(input);
    h = step(h, input);
  }
  return {
    final: h,
    record: { engineVersion: h.engineVersion, seed, commit: null, table, inputs },
  };
}

/** What the controller keeps of a finished hand (one Undo for each logged reshuffle, §11.3). */
export function keep(final: HandState, record: ReplayRecord, handSeq = final.handSeq): ReviewHand {
  const end = handEndViewOf(final, record.table);
  if (end === null) throw new Error('the hand is not complete');
  return {
    handSeq,
    at: '2026-10-09T00:00:00.000Z',
    record,
    heroHole: final.seats[0]?.hole ?? null,
    board: [...final.board],
    undoCount: record.inputs.filter((input) => input.kind === 'reshuffle').length,
    commitBeforeDeal: false,
    decisions: [],
    end,
  };
}

/** Folds when facing a bet, else checks: the hand is won by the blinds' first raiser or ends at a showdown. */
export const passiveFolder: Policy = (_h, legal) =>
  legal.canCheck ? { type: 'check' } : { type: 'fold' };

/**
 * Random but mostly folding play: bets now and then, folds to bets, calls rarely. Many hands end
 * by folds, some on the flop or later; a few reach a showdown.
 */
export function foldyPolicy(rng: Rng): Policy {
  return (_h, legal) => {
    const roll = randInt(rng, 100);
    if (legal.canCheck) {
      if (roll < 30 && legal.bet !== null) return { type: 'bet', to: legal.bet.min * 2 };
      return { type: 'check' };
    }
    if (roll < 12 && legal.raise !== null) return { type: 'raise', to: legal.raise.min };
    return roll < 35 ? { type: 'call' } : { type: 'fold' };
  };
}

/** Check or call to the end: every hand reaches a showdown (or a run-out). */
export const callStation: Policy = (_h, legal) =>
  legal.canCheck ? { type: 'check' } : { type: 'call' };

/** One decision record (A.7), the coach's move the same as the hero's unless `rec` says another. */
export function decisionOf(
  decisionId: number,
  street: Street,
  taken: PlayerAction,
  grade: Grade | null,
  extra: Partial<DecisionRecord> = {},
): DecisionRecord {
  return {
    decisionId,
    street,
    taken,
    rec: taken,
    grade,
    lossMilliBB: 0,
    eRandom: 0.4,
    need: 0.2,
    hintSeen: true,
    undone: false,
    leak: null,
    quiz: null,
    ...extra,
  };
}

/**
 * `hand` with one record per hero move of its replay (decisionId = the moves before it, as the
 * controller numbers them), each graded `gradeOf(n)`.
 */
export function withDecisions(
  hand: ReviewHand,
  gradeOf: (n: number) => Grade | null = () => 'good',
): ReviewHand {
  const states = replayStates(hand.record);
  const decisions: DecisionRecord[] = [];
  hand.record.inputs.forEach((input, i) => {
    if (input.kind !== 'act' || input.seat !== 0) return;
    const n = decisions.length;
    decisions.push(decisionOf(n, (states[i] as HandState).street, input.action, gradeOf(n)));
  });
  return { ...hand, decisions };
}

/**
 * An Undo's hand: the hero acts first, and a Big mistake was taken back before anything else
 * happened, so the replay (the inputs the controller leaves) has the reshuffle's step and only the
 * move that stood.
 */
export function undoneHand(): ReviewHand {
  const table = tableWith([2000, 2000, 2000], { sb: 10, bb: 20, button: 0, nextHandSeq: 12 });
  const record: ReplayRecord = {
    engineVersion: ENGINE_VERSION,
    seed: REVIEW_SEED,
    commit: null,
    table: { ...table, handsDealt: 11 },
    inputs: [
      { kind: 'reshuffle', decisionId: 0, undoIndex: 0 },
      { kind: 'act', seat: 0, action: { type: 'fold' } },
      { kind: 'act', seat: 1, action: { type: 'fold' } },
      { kind: 'advance' },
    ],
  };
  return {
    ...keep(replay(record), record),
    decisions: [
      decisionOf(0, 'preflop', { type: 'call' }, 'blunder', {
        rec: { type: 'fold' },
        undone: true,
      }),
      decisionOf(0, 'preflop', { type: 'fold' }, 'best'),
    ],
  };
}

/** `count` finished hands of the kind `want`, played from `REVIEW_SEED`, newest last. */
export function collectHands(count: number, want: 'fold' | 'showdown', players = 6): ReviewHand[] {
  const out: ReviewHand[] = [];
  for (let i = 0; out.length < count; i++) {
    if (i > 2000) throw new Error(`could not find ${count} ${want} hands`);
    const rng = rngFromSeed(deriveSeed(REVIEW_SEED, `collect-${want}`, i));
    const table = reviewTable(players, deriveSeed(REVIEW_SEED, 'table', i), i + 1, i);
    const seed = deriveSeed(REVIEW_SEED, 'hand', i);
    const policy = want === 'fold' ? foldyPolicy(rng) : callStation;
    const { final, record } = playToEnd(table, seed, policy);
    if (final.result?.endedBy !== want) continue;
    out.push(keep(final, record));
  }
  return out;
}
