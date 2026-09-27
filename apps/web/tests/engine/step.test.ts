import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EngineError, InvariantError } from '../../src/core/assert.ts';
import { rngFromSeed } from '../../src/core/rng.ts';
import { legalActions } from '../../src/engine/legal.ts';
import { step } from '../../src/engine/step.ts';
import type { EngineInput, HandState } from '../../src/engine/types.ts';
import { clone } from './fixtures.ts';
import { FC_SEED, deal, tableWith } from './helpers.ts';
import {
  ADVANCE,
  bet,
  call,
  check,
  deepFreeze,
  engineError,
  fold,
  handArb,
  legalOf,
  play,
  raise,
  randomInput,
  seatOf,
} from './play.ts';

describe('step: errors (§4.5)', () => {
  const start = (): HandState => deal(tableWith([10000, 10000, 10000], { button: 0 }));

  it('an action outside the betting phase is BAD_PHASE; advance while betting too', () => {
    const over = play(start(), fold(0), fold(1));
    expect(engineError(() => step(over, check(2))).code).toBe('BAD_PHASE');
    expect(engineError(() => step(start(), ADVANCE)).code).toBe('BAD_PHASE');
  });

  it('an action by a seat that is not to act is NOT_YOUR_TURN', () => {
    const h = start();
    expect(h.toAct).toBe(0);
    for (const seat of [1, 2, 7, -1, 0.5]) {
      expect(engineError(() => step(h, call(seat))).code).toBe('NOT_YOUR_TURN');
    }
    const odd = { kind: 'act', seat: '0', action: { type: 'call' } } as unknown as EngineInput;
    expect(engineError(() => step(h, odd)).code).toBe('NOT_YOUR_TURN');
  });

  it('a malformed input or an action the seat may not take is ILLEGAL_ACTION', () => {
    const h = start();
    const bad = [
      null,
      42,
      'advance',
      {},
      { kind: 'deal' },
      { kind: 'act', seat: 0 },
      { kind: 'act', seat: 0, action: null },
      { kind: 'act', seat: 0, action: { type: 'allin' } },
      { kind: 'act', seat: 0, action: { type: 'check' } }, // facing 100
      { kind: 'act', seat: 0, action: { type: 'bet', to: 300 } }, // there is a bet already
    ];
    for (const input of bad) {
      expect(engineError(() => step(h, input as unknown as EngineInput)).code).toBe(
        'ILLEGAL_ACTION',
      );
    }
    const bbOption = play(start(), call(0), call(1));
    expect(engineError(() => step(bbOption, call(2))).code).toBe('ILLEGAL_ACTION');
    expect(engineError(() => step(bbOption, fold(2))).code).toBe('ILLEGAL_ACTION');
    const flop = play(bbOption, check(2), ADVANCE);
    expect(engineError(() => step(flop, raise(1, 200))).code).toBe('ILLEGAL_ACTION');
  });

  it('a raise the seat may not make is ILLEGAL_ACTION (not reopened, no responder)', () => {
    // B6: back at UTG after a short all-in.
    const h = play(
      deal(tableWith([10000, 450, 10000, 10000], { button: 1 })),
      raise(0, 300),
      raise(1, 450),
      call(2),
      fold(3),
    );
    expect(engineError(() => step(h, raise(0, 1000))).code).toBe('ILLEGAL_ACTION');
    // B35: both opponents all-in.
    const alone = deal(tableWith([10000, 20, 60], { button: 0 }));
    expect(engineError(() => step(alone, raise(0, 300))).code).toBe('ILLEGAL_ACTION');
  });

  it('a bet or raise outside the bounds, or not a whole number, is BAD_AMOUNT', () => {
    const h = start(); // seat 0 may raise to 200..10,000
    for (const to of [199, 100, 0, -200, 10001, 250.5, Number.NaN, Infinity]) {
      expect(engineError(() => step(h, raise(0, to))).code).toBe('BAD_AMOUNT');
    }
    const noTo = { kind: 'act', seat: 0, action: { type: 'raise' } } as unknown as EngineInput;
    expect(engineError(() => step(h, noTo)).code).toBe('BAD_AMOUNT');
    const text = { kind: 'act', seat: 0, action: { type: 'raise', to: '300' } };
    expect(engineError(() => step(h, text as unknown as EngineInput)).code).toBe('BAD_AMOUNT');
    expect(play(h, raise(0, 200)).currentBet).toBe(200);
    expect(play(start(), raise(0, 10000)).currentBet).toBe(10000);
  });

  it('a state that breaks an invariant is refused with InvariantError, never returned', () => {
    const h = clone(start());
    (h.seats[1] as HandState['seats'][number]).stack += 1; // a chip from nowhere
    expect(() => step(h, call(0))).toThrow(InvariantError);
  });
});

describe('step: purity (§4.2)', () => {
  it('never changes a deep-frozen input, over random legal play', () => {
    fc.assert(
      fc.property(handArb, ({ h, policySeed }) => {
        const rng = rngFromSeed(policySeed);
        let s = deepFreeze(clone(h));
        for (let i = 0; i < 400 && s.phase !== 'complete'; i++) {
          const before = JSON.stringify(s);
          const next = step(s, randomInput(s, rng));
          expect(JSON.stringify(s)).toBe(before);
          s = deepFreeze(clone(next));
        }
      }),
      { seed: FC_SEED, numRuns: 300 },
    );
  });

  it('returns a new, deep-frozen state in development builds and shares nothing with the input', () => {
    const h = deal(tableWith([10000, 10000], { button: 0 }));
    const input = raise(0, 300);
    const next = step(h, input);
    expect(Object.isFrozen(next)).toBe(true);
    expect(Object.isFrozen(next.seats[0])).toBe(true);
    expect(Object.isFrozen(next.log.at(-1))).toBe(true);
    expect(next.seats).not.toBe(h.seats);
    expect(next.deck).not.toBe(h.deck);
    // The logged action is a copy: changing the caller's input object later changes nothing.
    const logged = next.log.at(-1);
    expect(logged).toMatchObject({ e: 'act', action: { type: 'raise', to: 300 } });
    expect(logged?.e === 'act' && logged.action).not.toBe(
      input.kind === 'act' ? input.action : null,
    );
    expect(Object.isFrozen(h)).toBe(false); // the input is not frozen by step
  });

  it('is deterministic: the same inputs give the same states', () => {
    fc.assert(
      fc.property(handArb, ({ h, policySeed }) => {
        const inputs: EngineInput[] = [];
        const rng = rngFromSeed(policySeed);
        let s = h;
        for (let i = 0; i < 400 && s.phase !== 'complete'; i++) {
          const input = randomInput(s, rng);
          inputs.push(input);
          s = step(s, input);
        }
        const again = inputs.reduce(step, h);
        expect(again).toStrictEqual(s);
      }),
      { seed: FC_SEED, numRuns: 200 },
    );
  });
});

describe('step: turn order and round end (§3.7, §4.3)', () => {
  it('a raise gives every other active seat a new turn, in clockwise order', () => {
    // 0 = BTN, 1 = SB, 2 = BB, 3 = UTG.
    let h = play(deal(tableWith([10000, 10000, 10000, 10000], { button: 0 })), call(3), call(0));
    h = play(h, call(1), raise(2, 400));
    expect(h.toAct).toBe(3);
    h = play(h, call(3));
    expect(h.toAct).toBe(0);
    h = play(h, fold(0), call(1));
    expect(h).toMatchObject({ phase: 'roundComplete', toAct: null });
  });

  it('skips folded and all-in seats and ends when the only active seat faces no bet', () => {
    // 0 = BTN (1,000), 1 = SB, 2 = BB, 3 = UTG (500).
    let h = deal(tableWith([1000, 10000, 10000, 500], { button: 0 }));
    h = play(h, raise(3, 500)); // UTG all-in
    h = play(h, raise(0, 1000)); // BTN all-in
    expect(h.toAct).toBe(1);
    h = play(h, fold(1), call(2));
    expect(h.phase).toBe('roundComplete');
    // The BB covered both: nobody can bet on the next streets.
    const end = play(h, ADVANCE);
    expect(end).toMatchObject({ phase: 'roundComplete', runout: true, street: 'flop' });
  });

  it('heads-up: the button acts first preflop and last after the flop (pitfall 3)', () => {
    for (const button of [0, 1]) {
      const bb = 1 - button;
      let h = deal(tableWith([10000, 10000], { button }));
      expect(h.toAct).toBe(button);
      h = play(h, call(button), check(bb), ADVANCE);
      expect(h.toAct).toBe(bb);
      h = play(h, check(bb));
      expect(h.toAct).toBe(button);
      h = play(h, check(button));
      expect(h).toMatchObject({ phase: 'roundComplete', street: 'flop' });
    }
  });

  it('after the flop the first active seat left of the button starts, skipping all-in seats', () => {
    // 0 = BTN, 1 = SB (all-in preflop), 2 = BB, 3 = UTG.
    let h = deal(tableWith([10000, 300, 10000, 10000], { button: 0 }));
    h = play(h, call(3), call(0), raise(1, 300), call(2), call(3), call(0), ADVANCE);
    expect(h).toMatchObject({ street: 'flop', toAct: 2 });
  });

  it('new cards come only on advance: the closing action leaves the board as it was (pitfall 23)', () => {
    const h = play(deal(tableWith([10000, 10000], { button: 0 })), call(0), check(1));
    expect(h).toMatchObject({ phase: 'roundComplete', board: [], street: 'preflop' });
    const flop = play(h, ADVANCE);
    const k = 2;
    expect(flop.board).toEqual(h.deck.slice(2 * k + 1, 2 * k + 4));
    expect(flop.deckPos).toBe(2 * k + 4);
    expect(flop.log.at(-1)).toEqual({ e: 'street', street: 'flop', cards: flop.board });
    const turn = play(flop, check(1), check(0), ADVANCE);
    expect(turn.board.slice(3)).toEqual([h.deck[2 * k + 5]]);
    const river = play(turn, check(1), check(0), ADVANCE);
    expect(river.board.slice(4)).toEqual([h.deck[2 * k + 7]]);
    expect(river.deckPos).toBe(2 * k + 8);
  });

  it('each street starts with no bets, the minimum raise back at the bb and no aggressor', () => {
    let h = play(deal(tableWith([10000, 10000], { button: 0 })), raise(0, 500), raise(1, 1500));
    expect(h).toMatchObject({ minRaiseInc: 1000, preflopAggressor: 1, lastAggressor: 1 });
    h = play(h, call(0), ADVANCE);
    expect(h).toMatchObject({
      currentBet: 0,
      minRaiseInc: 100,
      lastAggressor: null,
      preflopAggressor: 1,
    });
    expect(h.seats.map((s) => [s.streetBet, s.lastActedAtBet])).toEqual([
      [0, null],
      [0, null],
    ]);
  });

  it('a full raise preflop sets the preflop aggressor; an incomplete one does not', () => {
    // 0 = BTN (150), 1 = SB, 2 = BB. The button's all-in to 150 is incomplete (+50 < 100).
    const h = play(deal(tableWith([150, 10000, 10000], { button: 0 })), raise(0, 150));
    expect(h).toMatchObject({ preflopAggressor: null, lastAggressor: 0, currentBet: 150 });
    expect(h.minRaiseInc).toBe(100);
    const reraise = play(h, raise(1, 400));
    expect(reraise).toMatchObject({ preflopAggressor: 1, minRaiseInc: 250 });
  });

  it('the showdown after a normal river reveals once, with reason showdown', () => {
    let h = play(deal(tableWith([10000, 10000], { button: 0 })), call(0), check(1));
    for (let i = 0; i < 3; i++) h = play(h, ADVANCE, check(1), check(0));
    const sd = play(h, ADVANCE);
    expect(sd).toMatchObject({ phase: 'showdown', runout: false, revealed: [1, 0] });
    expect(sd.log.filter((ev) => ev.e === 'reveal')).toEqual([
      { e: 'reveal', seats: [1, 0], reason: 'showdown' },
    ]);
    expect(engineError(() => step(sd, call(0))).code).toBe('BAD_PHASE');
  });

  it('an all-in called on the river is a run-out that starts on the river', () => {
    let h = play(deal(tableWith([1000, 10000], { button: 0 })), call(0), check(1));
    for (let i = 0; i < 2; i++) h = play(h, ADVANCE, check(1), check(0));
    h = play(h, ADVANCE, bet(1, 900), call(0));
    expect(h).toMatchObject({ phase: 'roundComplete', street: 'river' });
    const sd = play(h, ADVANCE);
    // The river bettor shows first (§3.9).
    expect(sd).toMatchObject({ phase: 'showdown', runout: true, revealed: [1, 0] });
    expect(sd.log.at(-1)).toEqual({ e: 'reveal', seats: [1, 0], reason: 'runout' });
  });
});

describe('step: reshuffle (§4.3, §11.3; B40)', () => {
  const reshuffle = (decisionId: number, undoIndex = 0): EngineInput => ({
    kind: 'reshuffle',
    decisionId,
    undoIndex,
  });

  it('B40: shuffles only the undealt cards, once per decision', () => {
    const h = play(deal(tableWith([10000, 10000, 10000], { button: 0 })), call(0));
    const r = play(h, reshuffle(1));
    expect(r.deck.slice(0, r.deckPos)).toEqual(h.deck.slice(0, h.deckPos));
    expect([...r.deck.slice(r.deckPos)].sort((a, b) => a - b)).toEqual(
      [...h.deck.slice(h.deckPos)].sort((a, b) => a - b),
    );
    expect(r.deck.slice(r.deckPos)).not.toEqual(h.deck.slice(h.deckPos));
    expect(r.seats.map((s) => s.hole)).toEqual(h.seats.map((s) => s.hole));
    expect(r.board).toEqual(h.board);
    expect(r.undoneDecisions).toEqual([1]);
    expect(r.log.at(-1)).toEqual({ e: 'reshuffle', decisionId: 1, undoIndex: 0 });
    expect(engineError(() => step(r, reshuffle(1, 1))).code).toBe('UNDO_USED');
    // Deterministic: the same decision and index give the same stub.
    expect(play(h, reshuffle(1)).deck).toEqual(r.deck);
    expect(play(h, reshuffle(1, 1)).deck).not.toEqual(r.deck);
  });

  it('B40: allowed between streets, refused after a reveal, in the showdown or with bad counters', () => {
    const h = play(deal(tableWith([10000, 10000], { button: 0 })), call(0), check(1));
    expect(h.phase).toBe('roundComplete');
    const flop = play(h, reshuffle(0), ADVANCE);
    expect(flop.board).not.toEqual(play(h, ADVANCE).board);

    const allIn = play(deal(tableWith([10000, 10000], { button: 0 })), raise(0, 10000), call(1));
    const runout = play(allIn, ADVANCE);
    expect(runout.revealed).not.toEqual([]);
    expect(engineError(() => step(runout, reshuffle(0))).code).toBe('BAD_PHASE');
    let sd = runout;
    while (sd.phase !== 'showdown') sd = play(sd, ADVANCE);
    expect(engineError(() => step(sd, reshuffle(5))).code).toBe('BAD_PHASE');
    for (const [d, u] of [
      [-1, 0],
      [0, -1],
      [1.5, 0],
    ] as const) {
      expect(engineError(() => step(h, reshuffle(d, u))).code).toBe('BAD_AMOUNT');
    }
  });
});

describe('step: random legal play (property)', () => {
  it('2–9 seats, stacks from one chip to 500 bb: every step keeps the invariants and every hand completes in ≤ 400 inputs', () => {
    const endings = { showdown: 0, fold: 0, runout: 0, sidePots: 0, split: 0, riverBet: 0 };
    let longest = 0;
    fc.assert(
      fc.property(handArb, ({ h, policySeed }) => {
        const rng = rngFromSeed(policySeed);
        let s = h;
        let inputs = 0;
        while (s.phase !== 'complete') {
          const input = randomInput(s, rng);
          if (input.kind === 'act') {
            // The legal bounds are exact: one chip outside them is refused.
            const legal = legalOf(s);
            if (legal.raise !== null) {
              expect(() => step(s, raise(legal.seat, legal.raise!.min - 1))).toThrow(EngineError);
              expect(() => step(s, raise(legal.seat, legal.raise!.max + 1))).toThrow(EngineError);
            }
          }
          s = play(s, input);
          inputs++;
          expect(inputs).toBeLessThanOrEqual(400);
        }
        longest = Math.max(longest, inputs);
        const r = s.result;
        if (r === null) throw new Error('complete without a result');
        endings[r.endedBy]++;
        if (s.runout) endings.runout++;
        if (r.pots.length > 1) endings.sidePots++;
        if (r.potWinners.some((w) => w.length > 1)) endings.split++;
        if (s.log.some((ev) => ev.e === 'act' && ev.street === 'river' && ev.amountIn > 0)) {
          endings.riverBet++;
        }
        // Nothing is created or lost, and every input after the end is refused.
        expect(s.seats.reduce((a, x) => a + x.stack, 0)).toBe(s.startTotal);
        expect(legalActions(s)).toBeNull();
        expect(engineError(() => step(s, ADVANCE)).code).toBe('BAD_PHASE');
      }),
      { seed: FC_SEED, numRuns: 2500 },
    );
    // The runs reach every ending (so the property means something). Seen with the fixed seed:
    // 2,237 showdowns, 263 fold wins, 1,443 run-outs, 1,666 with side pots, 178 with a split
    // pot, 567 with chips bet on the river; the longest hand took 51 inputs.
    expect(endings.showdown).toBeGreaterThan(1500);
    expect(endings.fold).toBeGreaterThan(150);
    expect(endings.runout).toBeGreaterThan(800);
    expect(endings.sidePots).toBeGreaterThan(800);
    expect(endings.split).toBeGreaterThan(80);
    expect(endings.riverBet).toBeGreaterThan(300);
    expect(longest).toBeLessThanOrEqual(400);
  });

  it('any input either gives a valid state or throws EngineError, and never changes its input', () => {
    const inputArb = fc.oneof(
      fc.constant<EngineInput>(ADVANCE),
      fc.record({
        kind: fc.constant('act' as const),
        seat: fc.integer({ min: -1, max: 9 }),
        action: fc.oneof(
          fc.constantFrom(
            { type: 'fold' as const },
            { type: 'check' as const },
            { type: 'call' as const },
          ),
          fc.record({
            type: fc.constantFrom('bet' as const, 'raise' as const),
            to: fc.integer({ min: -5, max: 600_000 }),
          }),
        ),
      }),
      fc.record({
        kind: fc.constant('reshuffle' as const),
        decisionId: fc.integer({ min: 0, max: 3 }),
        undoIndex: fc.integer({ min: 0, max: 3 }),
      }),
    );
    fc.assert(
      fc.property(handArb, fc.array(inputArb, { maxLength: 60 }), ({ h }, inputs) => {
        let s = deepFreeze(clone(h));
        for (const input of inputs) {
          const before = JSON.stringify(s);
          try {
            s = step(s, input);
          } catch (e) {
            expect(e).toBeInstanceOf(EngineError);
            expect(JSON.stringify(s)).toBe(before);
          }
          if (s.phase === 'complete') break;
        }
      }),
      { seed: FC_SEED, numRuns: 500 },
    );
  });
});

describe('step: seat bookkeeping', () => {
  it('records the bet level of every voluntary action; a fold keeps the old one', () => {
    let h = deal(tableWith([10000, 10000, 10000], { button: 0 }));
    h = play(h, raise(0, 300));
    expect(seatOf(h, 0).lastActedAtBet).toBe(300);
    h = play(h, call(1));
    expect(seatOf(h, 1).lastActedAtBet).toBe(300);
    h = play(h, raise(2, 900));
    expect(seatOf(h, 2).lastActedAtBet).toBe(900);
    h = play(h, fold(0));
    expect(seatOf(h, 0)).toMatchObject({ folded: true, lastActedAtBet: 300 });
  });
});
