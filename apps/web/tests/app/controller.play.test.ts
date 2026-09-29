/**
 * Whole games through the TableController (PLAN §18 Stage 3, Testing strategy): SimpleBots plus a
 * seeded scripted hero, fake timers.
 * - 200 hands over 2–9 seats complete; every state passes every invariant (the log replay too) and
 *   every finished hand replays from its table, seed and inputs (§4.7);
 * - the same seed gives the same game, a different seed a different one;
 * - heads-up: the button posts the small blind and acts first preflop, last after the flop (§3.3,
 *   pitfall 3), read from the action log;
 * - gates opened and closed at random never let a bot act or an `advance` happen while closed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveSeed, randInt, rngFromSeed, type Seed128 } from '../../src/core/rng.ts';
import { HERO } from '../../src/app/controller.ts';
import { GATES, type Gate } from '../../src/app/store.ts';
import { checkInvariants } from '../../src/engine/invariants.ts';
import { replay } from '../../src/engine/replay.ts';
import type { EngineInput, HandState, Street } from '../../src/engine/types.ts';
import { testSeed } from '../helpers/seed.ts';
import { drive, heroPolicy, makeHarness, setGate, type Harness } from './harness.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const ROOT: Seed128 = testSeed('3100000000000000000000000000c0de');

/** Checks every new state of the hand (invariants with the log replay) as the store gets it. */
function watchInvariants(h: Harness): () => number {
  let states = 0;
  const unsubscribe = h.store.subscribe((s, prev) => {
    if (s.game.hand !== null && s.game.hand !== prev.game.hand) {
      checkInvariants(s.game.hand, { replayLog: true });
      states++;
    }
  });
  return () => {
    unsubscribe();
    return states;
  };
}

/** The finished hand replays exactly from its table as at hand start, its seed and its inputs. */
function expectReplays(h: Harness, hand: HandState, inputs: EngineInput[]): void {
  const table = h.state().game.table;
  if (table === null) throw new Error('no table');
  const again = replay({
    engineVersion: hand.engineVersion,
    seed: hand.seed,
    commit: null,
    table,
    inputs,
  });
  expect(again).toEqual(hand);
}

interface Game {
  inputs: EngineInput[][];
  results: number[][];
}

/** Plays `hands` hands at one table and returns every hand's inputs and net results. */
async function playGame(seed: Seed128, players: number, hands: number): Promise<Game> {
  const h = makeHarness({ seed, settings: { players } });
  const game: Game = { inputs: [], results: [] };
  h.dispatch({ type: 'play' });
  await drive(h, {
    hands,
    hero: heroPolicy(deriveSeed(seed, 'hero')),
    onComplete: (hand, inputs) => {
      game.inputs.push(inputs);
      game.results.push(hand.result?.net ?? []);
    },
  });
  h.controller.dispose();
  return game;
}

describe('200 seeded hands with SimpleBots and a scripted hero (§18 Stage 3)', () => {
  it('every hand completes, every state keeps the invariants, every hand replays', async () => {
    const rng = rngFromSeed(ROOT);
    let total = 0;
    let states = 0;
    let showdowns = 0;
    // Eight tables, 25 hands each, at 2..9 seats, with the three speeds.
    for (let players = 2; players <= 9; players++) {
      const speed = (['normal', 'fast', 'instant'] as const)[players % 3] as
        'normal' | 'fast' | 'instant';
      const h = makeHarness({
        seed: deriveSeed(ROOT, 'table', players),
        settings: { players, speed, startingStack: 400 + 200 * randInt(rng, 10), sb: 10, bb: 20 },
      });
      const stop = watchInvariants(h);
      h.dispatch({ type: 'play' });
      const hands = await drive(h, {
        hands: 25,
        hero: heroPolicy(deriveSeed(ROOT, 'hero', players)),
        onComplete: (hand, inputs) => {
          expect(inputs.length).toBeLessThanOrEqual(400);
          expectReplays(h, hand, inputs);
          if (hand.result?.endedBy === 'showdown') showdowns++;
        },
      });
      expect(hands.every((hand) => hand.phase === 'complete')).toBe(true);
      // handSeq is consecutive: no hand was skipped or voided.
      const seqs = hands.map((hand) => hand.handSeq);
      expect(seqs).toEqual(seqs.map((_, i) => (seqs[0] as number) + i));
      expect(h.state().game.diag).toEqual({ engineErrors: 0, botFallbacks: 0, voidedHands: 0 });
      states += stop();
      total += hands.length;
      h.controller.dispose();
    }
    expect(total).toBe(200);
    expect(states).toBeGreaterThan(1000);
    expect(showdowns).toBeGreaterThan(20);
  }, 60_000);
});

describe('determinism (§2.4): the same seed gives the same game', () => {
  it('two controllers with the same seed and the same hero play identical hands', async () => {
    const seed = deriveSeed(ROOT, 'same');
    const a = await playGame(seed, 6, 30);
    const b = await playGame(seed, 6, 30);
    expect(b).toEqual(a);
    const c = await playGame(deriveSeed(ROOT, 'other'), 6, 30);
    expect(c.inputs).not.toEqual(a.inputs);
  }, 60_000);
});

describe('heads-up order (§3.3, pitfall 3), read from the action log', () => {
  it('the button posts the small blind, acts first preflop and last after the flop', async () => {
    const h = makeHarness({ seed: deriveSeed(ROOT, 'heads-up'), settings: { players: 2 } });
    h.dispatch({ type: 'play' });
    const buttons: number[] = [];
    let postflopStreets = 0;
    await drive(h, {
      hands: 60,
      hero: heroPolicy(deriveSeed(ROOT, 'heads-up hero')),
      onComplete: (hand) => {
        buttons.push(hand.button);
        const other = 1 - hand.button;
        expect(hand.sbSeat).toBe(hand.button);
        expect(hand.bbSeat).toBe(other);
        const [sb, bb] = hand.log;
        expect(sb).toMatchObject({ e: 'post', seat: hand.button, blind: 'sb' });
        expect(bb).toMatchObject({ e: 'post', seat: other, blind: 'bb' });
        const firstActs = new Map<Street, number>();
        for (const ev of hand.log) {
          if (ev.e === 'act' && !firstActs.has(ev.street)) firstActs.set(ev.street, ev.seat);
        }
        if (firstActs.has('preflop')) expect(firstActs.get('preflop')).toBe(hand.button);
        for (const street of ['flop', 'turn', 'river'] as const) {
          if (firstActs.has(street)) {
            expect(firstActs.get(street)).toBe(other);
            postflopStreets++;
          }
        }
      },
    });
    expect(postflopStreets).toBeGreaterThan(10);
    // The button alternates between the two seats while both keep chips.
    expect(new Set(buttons)).toEqual(new Set([0, 1]));
  }, 60_000);
});

describe('random gates: no bot act and no advance while any gate is closed (A.8)', () => {
  it('over 60 hands with gates opened and closed at random times', async () => {
    const rng = rngFromSeed(deriveSeed(ROOT, 'gates'));
    const h = makeHarness({ seed: deriveSeed(ROOT, 'gates table'), settings: { players: 5 } });
    let checked = 0;
    h.store.subscribe((s, prev) => {
      const hand = s.game.hand;
      if (hand === null || prev.game.hand === null || hand === prev.game.hand) return;
      if (hand.handSeq !== prev.game.hand.handSeq) return;
      const inputs = h.controller.snapshot().inputs;
      const input = inputs[inputs.length - 1] as EngineInput;
      if (input.kind === 'advance' || (input.kind === 'act' && input.seat !== HERO)) {
        expect(s.ui.gates).toEqual([]);
        checked++;
      }
    });
    h.dispatch({ type: 'play' });
    const open = new Set<Gate>(GATES);
    await drive(h, {
      hands: 60,
      hero: heroPolicy(deriveSeed(ROOT, 'gates hero')),
      beforeStep: () => {
        if (randInt(rng, 4) !== 0) return;
        const gate = GATES[randInt(rng, GATES.length)] as Gate;
        // Mostly open again, so the game moves on.
        const close = open.has(gate) && randInt(rng, 3) === 0;
        setGate(h, gate, close);
        if (close) open.delete(gate);
        else open.add(gate);
      },
    });
    expect(checked).toBeGreaterThan(300);
  }, 60_000);
});
