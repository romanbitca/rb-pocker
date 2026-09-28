/**
 * PLAN Appendix B: the rules edge-case vectors, run through the real engine: `createTable` +
 * `startHand` (`tableWith` + `deal`), then `step` with every invariant (the log replay included)
 * checked after each input (`play`). Blinds 50/100 and stacks 10,000 unless a vector says
 * otherwise; amounts are "to" amounts.
 *
 * Seats are numbered clockwise. Each vector names the seats it uses in a comment, so the letters
 * of Appendix B can be followed.
 *
 * The betting and order vectors come first (chunk 2.3); vectors that end in a settlement are
 * played to 'complete' in the last section (chunk 2.4), with rigged decks where cards matter.
 * B21–B24 (evaluator) are in tests/eval; B30–B31 (button between hands) in the table and start
 * tests; B40 (reshuffle) in step.test.ts; B33 (undo restore) is in undo.test.ts, next to the
 * rest of the engine-level undo tests it shares setup with; B41 and B42 (JSON, replay) are below.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseCards } from '../../src/core/cards.ts';
import { rngFromSeed } from '../../src/core/rng.ts';
import { score5 } from '../../src/eval/evaluate.ts';
import { replay } from '../../src/engine/replay.ts';
import { step } from '../../src/engine/step.ts';
import type { EngineInput, HandResult, HandState, ReplayRecord } from '../../src/engine/types.ts';
import { FC_SEED, deal, rigDeck, tableWith } from './helpers.ts';
import {
  ADVANCE,
  advanceWhileRoundComplete,
  bet,
  call,
  check,
  engineError,
  fold,
  handArb,
  legalOf,
  play,
  raise,
  randomInput,
  seatOf,
} from './play.ts';

const refunds = (h: HandState): { seat: number; amount: number }[] =>
  h.log.flatMap((ev) => (ev.e === 'refund' ? [{ seat: ev.seat, amount: ev.amount }] : []));

/** Plays preflop to the flop: every listed seat calls (or checks) in turn. */
function limpToFlop(h: HandState): HandState {
  let s = h;
  while (s.phase === 'betting') {
    const legal = legalOf(s);
    s = play(s, legal.canCheck ? check(legal.seat) : call(legal.seat));
  }
  return play(s, ADVANCE);
}

describe('Appendix B: order of play (§3.3, §3.7)', () => {
  it('B1: heads-up, A = BTN/SB posts 50, B = BB posts 100; A acts first; B gets the first card', () => {
    const h = deal(tableWith([10000, 10000], { button: 0 }));
    expect(h.log.slice(0, 2)).toEqual([
      { e: 'post', seat: 0, blind: 'sb', amount: 50, allIn: false },
      { e: 'post', seat: 1, blind: 'bb', amount: 100, allIn: false },
    ]);
    expect(h.toAct).toBe(0);
    expect(seatOf(h, 1).hole?.[0]).toBe(h.deck[0]);
  });

  it('B2: 4 players, D call, A call, B call: the BB gets its option, checks, round over', () => {
    // A = 0 (BTN), B = 1 (SB), C = 2 (BB), D = 3 (UTG).
    const h = play(deal(tableWith([10000, 10000, 10000, 10000], { button: 0 })), call(3), call(0));
    expect(h.toAct).toBe(1);
    const atBB = play(h, call(1));
    expect(atBB.toAct).toBe(2);
    const legal = legalOf(atBB);
    expect(legal).toMatchObject({ canCheck: true, canFold: false, canCall: false, toCall: 0 });
    expect(legal.raise?.min).toBe(200);
    const done = play(atBB, check(2));
    expect(done).toMatchObject({ phase: 'roundComplete', toAct: null, street: 'preflop' });
    expect(done.board).toEqual([]);
  });

  it('B3: heads-up, A (BTN/SB) calls; B checks; advance deals the flop and B acts first', () => {
    // A = 0 (BTN/SB), B = 1 (BB).
    const h = play(deal(tableWith([10000, 10000], { button: 0 })), call(0));
    expect(h.toAct).toBe(1);
    const legal = legalOf(h);
    expect(legal.canCheck).toBe(true);
    expect(legal.raise).toEqual({ min: 200, max: 10000 });
    const over = play(h, check(1));
    expect(over).toMatchObject({ phase: 'roundComplete', toAct: null });
    const flop = play(over, ADVANCE);
    expect(flop).toMatchObject({ phase: 'betting', street: 'flop', toAct: 1 });
    expect(flop.board).toHaveLength(3);
  });

  it('B39: a fold that leaves one live seat ends the betting; no cards until advance', () => {
    const h = play(deal(tableWith([10000, 10000], { button: 0 })), fold(0));
    expect(h).toMatchObject({ phase: 'roundComplete', toAct: null, result: null, revealed: [] });
    expect(h.board).toEqual([]);
    expect(refunds(h)).toEqual([{ seat: 1, amount: 50 }]); // the BB's uncalled 50
  });

  it('B29: a called river bet: the bettor shows first; a checked river: first live seat left of the button', () => {
    // 3 players: 0 = BTN, 1 = SB, 2 = BB. Everyone checks to the river.
    const toRiver = (): HandState => {
      let s = limpToFlop(deal(tableWith([10000, 10000, 10000], { button: 0 })));
      for (const street of ['flop', 'turn'] as const) {
        expect(s.street).toBe(street);
        s = play(s, check(1), check(2), check(0), ADVANCE);
      }
      expect(s).toMatchObject({ street: 'river', toAct: 1 });
      return s;
    };
    const betRiver = play(toRiver(), check(1), bet(2, 300), call(0), call(1), ADVANCE);
    expect(betRiver).toMatchObject({ phase: 'showdown', revealed: [2, 0, 1] });
    expect(betRiver.log.at(-1)).toEqual({ e: 'reveal', seats: [2, 0, 1], reason: 'showdown' });

    const checkedRiver = play(toRiver(), check(1), check(2), check(0), ADVANCE);
    expect(checkedRiver).toMatchObject({ phase: 'showdown', revealed: [1, 2, 0] });
  });
});

describe('Appendix B: raise sizes and reopening (§3.5, §3.6)', () => {
  it('B4: preflop facing 100 the min raise-to is 200; after a raise to 300 it is 500', () => {
    // 0 = BTN, 1 = SB, 2 = BB, 3 = UTG.
    const h = deal(tableWith([10000, 10000, 10000, 10000], { button: 0 }));
    expect(legalOf(h).raise).toEqual({ min: 200, max: 10000 });
    const after = play(h, raise(3, 300));
    expect(after).toMatchObject({ currentBet: 300, minRaiseInc: 200, toAct: 0 });
    expect(legalOf(after).raise).toEqual({ min: 500, max: 10000 });
  });

  it('B5: first to act on the flop may bet from 100; after a bet of 150 the min raise-to is 300', () => {
    const flop = limpToFlop(deal(tableWith([10000, 10000], { button: 0 })));
    expect(flop.toAct).toBe(1);
    const legal = legalOf(flop);
    expect(legal.bet).toEqual({ min: 100, max: 9900 });
    expect(legal.raise).toBeNull();
    const after = play(flop, bet(1, 150));
    expect(legalOf(after).raise).toEqual({ min: 300, max: 9900 });
  });

  it('B6: UTG raise 300, BTN all-in 450, SB call, BB fold: back at UTG, call 150 or fold only', () => {
    // A = 0 (UTG), B = 1 (BTN, 450), C = 2 (SB), D = 3 (BB).
    const h = play(
      deal(tableWith([10000, 450, 10000, 10000], { button: 1 })),
      raise(0, 300),
      raise(1, 450), // all-in: 150 more than 300 is less than the 200 raise, an incomplete raise
      call(2),
      fold(3),
    );
    expect(h.toAct).toBe(0);
    expect(h).toMatchObject({ currentBet: 450, minRaiseInc: 200 });
    expect(legalOf(h)).toMatchObject({
      canFold: true,
      canCall: true,
      canCheck: false,
      toCall: 150,
      callAmount: 150,
      raise: null,
    });
  });

  it('B7: as B6 before the BB acts: the BB has not acted yet, so it may raise, min to 650', () => {
    const h = play(
      deal(tableWith([10000, 450, 10000, 10000], { button: 1 })),
      raise(0, 300),
      raise(1, 450),
      call(2),
    );
    expect(h.toAct).toBe(3);
    expect(legalOf(h).raise).toEqual({ min: 650, max: 10000 });
  });

  it('B8: two short all-ins that add up to a full raise reopen the betting (min to 320)', () => {
    // Flop order A, B, C, D: A = 0 (SB), B = 1 (BB, 150 behind), C = 2 (UTG, 220), D = 3 (BTN).
    const flop = limpToFlop(deal(tableWith([10000, 250, 320, 10000], { button: 3 })));
    expect(flop.toAct).toBe(0);
    const h = play(flop, bet(0, 100), raise(1, 150), raise(2, 220), call(3));
    expect(h.log.filter((ev) => ev.e === 'act').map((ev) => ev.e === 'act' && ev.full)).toEqual([
      ...new Array<boolean>(4).fill(false), // preflop calls and the check
      true, // A bets 100
      false, // B all-in 150: +50
      false, // C all-in 220: +70
      false, // D calls
    ]);
    expect(h.toAct).toBe(0);
    expect(legalOf(h).raise).toEqual({ min: 320, max: 9900 });
  });

  it('B9: an all-in raise of exactly the minimum is a full raise and reopens (min to 300)', () => {
    // Flop order A, B, C: A = 0 (SB), B = 1 (BB, 200 behind), C = 2 (BTN).
    const flop = limpToFlop(deal(tableWith([10000, 300, 10000], { button: 2 })));
    const h = play(flop, bet(0, 100), raise(1, 200), call(2));
    const allIn = h.log.at(-2);
    expect(allIn).toMatchObject({ e: 'act', seat: 1, allIn: true, full: true });
    expect(h).toMatchObject({ toAct: 0, minRaiseInc: 100, currentBet: 200 });
    expect(legalOf(h).raise).toEqual({ min: 300, max: 9900 });
  });

  it('B10: a call of exactly the whole stack is an all-in call, not a raise', () => {
    // Heads-up: B = 0 (BTN, 300 behind on the flop), A = 1 (BB).
    const flop = limpToFlop(deal(tableWith([400, 10000], { button: 0 })));
    const facing = play(flop, bet(1, 300));
    expect(legalOf(facing)).toMatchObject({ callAmount: 300, callIsAllIn: true, raise: null });
    const h = play(facing, call(0));
    expect(seatOf(h, 0)).toMatchObject({ allIn: true, stack: 0 });
    expect(h.currentBet).toBe(300);
    expect(h.lastAggressor).toBe(1);
    expect(h.log.at(-1)).toEqual({
      e: 'act',
      seat: 0,
      street: 'flop',
      action: { type: 'call' },
      amountIn: 300,
      allIn: true,
      full: false,
    });
  });

  it('B37: an all-in bet below the bb is legal and incomplete: no reopening for the checker', () => {
    // Flop order C, A, B: C = 0 (SB), A = 1 (BB, 40 behind), B = 2 (BTN).
    const flop = limpToFlop(deal(tableWith([10000, 140, 10000], { button: 2 })));
    const h = play(flop, check(0));
    expect(legalOf(h).bet).toEqual({ min: 40, max: 40 });
    const afterBet = play(h, bet(1, 40));
    expect(afterBet).toMatchObject({ currentBet: 40, minRaiseInc: 100, lastAggressor: 1 });
    expect(afterBet.log.at(-1)).toMatchObject({ allIn: true, full: false });
    expect(legalOf(afterBet).raise).toEqual({ min: 140, max: 9900 });
    const backAtC = play(afterBet, call(2));
    expect(backAtC.toAct).toBe(0);
    expect(legalOf(backAtC)).toMatchObject({ canFold: true, canCall: true, raise: null });
  });

  it('B38: 250 behind facing a bet of 200: the only raise is all-in to 250', () => {
    // Heads-up: B = 0 (BTN, 250 behind on the flop), A = 1 (BB).
    const flop = limpToFlop(deal(tableWith([350, 10000], { button: 0 })));
    const h = play(flop, bet(1, 200));
    expect(legalOf(h).raise).toEqual({ min: 250, max: 250 });
  });

  it('B35: with both opponents all-in there is nobody to respond: no bet or raise', () => {
    // 0 = BTN, 1 = SB all-in for 20, 2 = BB all-in for 60.
    const h = deal(tableWith([10000, 20, 60], { button: 0 }));
    expect(legalOf(h)).toMatchObject({ canCall: true, canFold: true, bet: null, raise: null });
  });

  it('B32: folding when a check is free throws ILLEGAL_ACTION and changes nothing', () => {
    const h = play(deal(tableWith([10000, 10000], { button: 0 })), call(0));
    const before = JSON.stringify(h);
    expect(engineError(() => step(h, fold(1))).code).toBe('ILLEGAL_ACTION');
    expect(JSON.stringify(h)).toBe(before);
  });
});

describe('Appendix B: uncalled chips, all-ins and run-outs (§3.7, §3.8)', () => {
  it('B11: a river bet that is folded to is refunded to the bettor; round over', () => {
    // Heads-up: B = 0 (BTN), A = 1 (BB, acts first after the flop).
    let h = limpToFlop(deal(tableWith([10000, 10000], { button: 0 })));
    h = play(h, check(1), check(0), ADVANCE, check(1), check(0), ADVANCE);
    expect(h.street).toBe('river');
    const done = play(h, bet(1, 400), fold(0));
    expect(done).toMatchObject({ phase: 'roundComplete', toAct: null, revealed: [] });
    expect(refunds(done)).toEqual([{ seat: 1, amount: 400 }]);
    expect(seatOf(done, 1)).toMatchObject({ streetBet: 0, totalBet: 100, stack: 9900 });
  });

  it('B12: everyone folds to the BB: its uncalled 50 goes back', () => {
    // 0 = BTN, 1 = SB, 2 = BB.
    const h = play(deal(tableWith([10000, 10000, 10000], { button: 0 })), fold(0), fold(1));
    expect(h).toMatchObject({ phase: 'roundComplete', toAct: null });
    expect(refunds(h)).toEqual([{ seat: 2, amount: 50 }]);
    expect(seatOf(h, 2)).toMatchObject({ totalBet: 50, stack: 9950 });
  });

  it('B13: a flop bet of 500 called all-in for 200: 300 back, then a run-out with no betting', () => {
    // Heads-up: B = 0 (BTN, 200 behind on the flop), A = 1 (BB).
    const flop = limpToFlop(deal(tableWith([300, 10000], { button: 0 })));
    const h = play(flop, bet(1, 500), call(0));
    expect(h.phase).toBe('roundComplete');
    expect(refunds(h)).toEqual([{ seat: 1, amount: 300 }]);
    expect(seatOf(h, 1)).toMatchObject({ streetBet: 200, totalBet: 300 });
    const phases: string[] = [];
    let s = h;
    while (s.phase === 'roundComplete') {
      s = play(s, ADVANCE);
      phases.push(s.phase);
    }
    expect(phases).toEqual(['roundComplete', 'roundComplete', 'showdown']);
    expect(s.board).toHaveLength(5);
    expect(s).toMatchObject({ runout: true, revealed: [1, 0] });
  });

  it('B25: BB all-in for 60, BTN folds, SB calls the full 100: 40 back, 60 against 60', () => {
    // 0 = BTN, 1 = SB, 2 = BB (60).
    const h = deal(tableWith([10000, 10000, 60], { button: 0 }));
    expect(h.currentBet).toBe(100);
    expect(legalOf(h).raise?.min).toBe(200);
    const done = play(h, fold(0), call(1));
    expect(done.log.at(-2)).toMatchObject({ e: 'act', seat: 1, amountIn: 50 }); // 100 in total
    expect(done).toMatchObject({ phase: 'roundComplete', toAct: null });
    expect(refunds(done)).toEqual([{ seat: 1, amount: 40 }]);
    expect(seatOf(done, 1).totalBet).toBe(60);
    expect(seatOf(done, 2).totalBet).toBe(60);
    const runout = play(done, ADVANCE);
    expect(runout).toMatchObject({ phase: 'roundComplete', street: 'flop', runout: true });
    expect(runout.revealed).toEqual([1, 2]);
  });

  it('B26: a small blind with 30 posts 30 and is all-in', () => {
    const h = deal(tableWith([10000, 30, 10000], { button: 0 }));
    expect(h.log[0]).toEqual({ e: 'post', seat: 1, blind: 'sb', amount: 30, allIn: true });
    expect(seatOf(h, 1).allIn).toBe(true);
  });

  it('B27: heads-up all-in and call preflop: no more betting, five cards via advance, both face up at once', () => {
    const h = play(deal(tableWith([10000, 10000], { button: 0 })), raise(0, 10000), call(1));
    expect(h).toMatchObject({ phase: 'roundComplete', revealed: [], board: [] });
    const first = play(h, ADVANCE);
    expect(first).toMatchObject({ street: 'flop', runout: true, revealed: [1, 0] });
    expect(first.log.at(-2)).toEqual({ e: 'reveal', seats: [1, 0], reason: 'runout' });
    let s = first;
    const boards = [first.board.length];
    while (s.phase === 'roundComplete') {
      s = play(s, ADVANCE);
      expect(s.phase).not.toBe('betting');
      boards.push(s.board.length);
    }
    expect(boards).toEqual([3, 4, 5, 5]);
    expect(s.phase).toBe('showdown');
    expect(s.log.filter((ev) => ev.e === 'reveal')).toHaveLength(1);
  });

  it('B28: flop all-in and call with the third player already all-in: the board runs out', () => {
    // A = 0 (SB), B = 1 (BB), C = 2 (BTN, all-in for 100 preflop).
    let h = deal(tableWith([5000, 5000, 100], { button: 2 }));
    h = play(h, call(2), call(0), check(1), ADVANCE);
    expect(seatOf(h, 2).allIn).toBe(true);
    expect(h).toMatchObject({ street: 'flop', toAct: 0 });
    h = play(h, bet(0, 4900), call(1));
    expect(h.phase).toBe('roundComplete');
    const end = advanceWhileRoundComplete(h);
    expect(end).toMatchObject({ phase: 'showdown', runout: true, revealed: [0, 1, 2] });
    expect(end.board).toHaveLength(5);
  });

  it('B34: SB 50 against a BB all-in for 30; the others fold; the SB folds: 20 back to the folded SB', () => {
    // 0 = BTN, 1 = SB, 2 = BB (30).
    const h = deal(tableWith([10000, 10000, 30], { button: 0 }));
    const atSB = play(h, fold(0));
    expect(atSB.toAct).toBe(1);
    expect(legalOf(atSB)).toMatchObject({ toCall: 50, canFold: true, raise: null });
    const done = play(atSB, fold(1));
    expect(done).toMatchObject({ phase: 'roundComplete', toAct: null });
    expect(refunds(done)).toEqual([{ seat: 1, amount: 20 }]);
    expect(seatOf(done, 1)).toMatchObject({ folded: true, totalBet: 30, stack: 9970 });
    expect(seatOf(done, 2)).toMatchObject({ totalBet: 30, allIn: true });
  });

  it('B36: heads-up SB 40 and BB 80: over at once, 40 back, then a 40 against 40 run-out', () => {
    const h = deal(tableWith([40, 80], { button: 0 }));
    expect(h.phase).toBe('roundComplete');
    expect(refunds(h)).toEqual([{ seat: 1, amount: 40 }]);
    const end = advanceWhileRoundComplete(h);
    expect(end).toMatchObject({ phase: 'showdown', runout: true, revealed: [1, 0] });
  });

  it('B43: an all-in run-out with a folded seat: every live seat is face up, the folded one never', () => {
    // 0 = BTN, 1 = SB, 2 = BB. The button folds, the blinds are all-in.
    const h = play(deal(tableWith([10000, 10000, 10000], { button: 0 })), fold(0), raise(1, 10000));
    const called = play(h, call(2));
    const first = play(called, ADVANCE);
    expect(first.revealed).toEqual([1, 2]);
    const end = advanceWhileRoundComplete(first);
    expect(end.revealed).toEqual([1, 2]);
    expect(end.revealed).not.toContain(0);
  });
});

// ---------------------------------------------------------------------------------------------

/** Plays to 'complete': checks when free, otherwise calls; `advance` between streets. */
function checkDown(h: HandState): HandState {
  let s = h;
  while (s.phase !== 'complete') {
    if (s.phase !== 'betting') {
      s = play(s, ADVANCE);
      continue;
    }
    const legal = legalOf(s);
    s = play(s, legal.canCheck ? check(legal.seat) : call(legal.seat));
  }
  return s;
}

function resultOf(h: HandState): HandResult {
  if (h.result === null) throw new Error(`no result in the ${h.phase} phase`);
  return h.result;
}

const awards = (h: HandState): { pot: number; seats: number[]; amounts: number[] }[] =>
  h.log.flatMap((ev) =>
    ev.e === 'award' ? [{ pot: ev.pot, seats: ev.seats, amounts: ev.amounts }] : [],
  );

const ROYAL = 'As Ks Qs Js Ts'; // on the board every live hand ties: a royal flush for all

describe('Appendix B: settlement (§3.8) and showdown (§3.9)', () => {
  it('B11: river bet folded to: 400 back to the bettor, who wins the 200 pot; no cards shown', () => {
    let h = limpToFlop(deal(tableWith([10000, 10000], { button: 0 })));
    h = play(h, check(1), check(0), ADVANCE, check(1), check(0), ADVANCE, bet(1, 400), fold(0));
    const end = play(h, ADVANCE);
    expect(end).toMatchObject({ phase: 'complete', toAct: null, revealed: [] });
    expect(resultOf(end)).toStrictEqual({
      endedBy: 'fold',
      pots: [{ amount: 200, eligible: [1] }],
      potWinners: [[1]],
      payouts: [0, 200],
      net: [-100, 100],
      shown: [],
    });
    expect(end.seats.map((x) => x.stack)).toEqual([9900, 10100]);
  });

  it('B12: all fold to the BB: 50 back, the BB wins 100; net BB +50, SB −50', () => {
    const h = play(deal(tableWith([10000, 10000, 10000], { button: 0 })), fold(0), fold(1));
    const end = play(h, ADVANCE);
    expect(resultOf(end)).toMatchObject({
      endedBy: 'fold',
      pots: [{ amount: 100, eligible: [2] }],
      payouts: [0, 0, 100],
      net: [0, -50, 50],
      shown: [],
    });
    expect(awards(end)).toEqual([{ pot: 0, seats: [2], amounts: [100] }]);
  });

  it('B13: after the 300 refund the flop all-in plays out: one 600 pot for the two of them', () => {
    const flop = limpToFlop(deal(tableWith([300, 10000], { button: 0 })));
    const end = checkDown(play(flop, bet(1, 500), call(0)));
    const r = resultOf(end);
    expect(r.endedBy).toBe('showdown');
    expect(r.pots).toEqual([{ amount: 600, eligible: [0, 1] }]);
    expect(r.payouts.reduce((a, b) => a + b, 0)).toBe(600);
    expect(end.seats.map((x) => x.totalBet)).toEqual([300, 300]);
  });

  /**
   * B14/B16 setup, preflop: A = 0 (SB, 100), B = 1 (BB, 300), C = 2 (BTN). C raises to 600, A
   * and B call all-in: totals 100 / 300 / 600 before C's uncalled 300 goes back.
   */
  function b14(holes?: Record<number, string>, board?: string): HandState {
    let h = deal(tableWith([100, 300, 10000], { button: 2 }));
    if (holes !== undefined) h = rigDeck(h, { holes, ...(board === undefined ? {} : { board }) });
    return play(h, raise(2, 600), call(0), call(1));
  }

  it('B14: totals 100 / 300 / 600: C gets 300 back; main 300 (A, B, C), side 400 (B, C)', () => {
    const h = b14();
    expect(h.phase).toBe('roundComplete');
    expect(refunds(h)).toEqual([{ seat: 2, amount: 300 }]);
    const done = checkDown(h);
    expect(resultOf(done).pots).toEqual([
      { amount: 300, eligible: [0, 1, 2] },
      { amount: 400, eligible: [1, 2] },
    ]);
  });

  it('B16: as B14 with A best and B second: A wins 300, B wins 400, C wins 0', () => {
    const h = b14({ 0: 'Ah Ad', 1: 'Kh Kd', 2: '7c 8d' }, '2c 5d 9h Js 3s');
    const end = checkDown(h);
    const r = resultOf(end);
    expect(r.potWinners).toEqual([[0], [1]]);
    expect(r.payouts).toEqual([300, 400, 0]);
    expect(r.net).toEqual([200, 100, -300]);
    expect(end.seats.map((x) => x.stack)).toEqual([300, 400, 9700]);
    // Side pots are pushed first, the main pot last.
    expect(awards(end)).toEqual([
      { pot: 1, seats: [1], amounts: [400] },
      { pot: 0, seats: [0], amounts: [300] },
    ]);
  });

  it('B15: A folds after 200, B all-in 150, C 500: C gets 300 back; main 450 (B, C), side 100 to C unseen', () => {
    // A = 0 (BTN), B = 1 (SB, 150), C = 2 (BB). B holds the best hand.
    const start = rigDeck(deal(tableWith([10000, 150, 10000], { button: 0 })), {
      holes: { 1: 'Ah Ad', 2: '7c 2d' },
      board: '3c 8d 9h Js 4s',
    });
    const h = play(start, raise(0, 200), call(1), raise(2, 500), fold(0));
    expect(refunds(h)).toEqual([{ seat: 2, amount: 300 }]);
    expect(h.seats.map((x) => x.totalBet)).toEqual([200, 150, 200]);
    const end = checkDown(h);
    const r = resultOf(end);
    expect(r.pots).toEqual([
      { amount: 450, eligible: [1, 2] },
      { amount: 100, eligible: [2] },
    ]);
    expect(r.potWinners).toEqual([[1], [2]]); // the side pot needs no comparison
    expect(r.payouts).toEqual([0, 450, 100]);
    expect(r.net).toEqual([-200, 300, -100]);
    expect(end.revealed).not.toContain(0);
  });

  it('B17: a 301-chip pot split two ways: 151 to the first winner after the button, 150 to the other', () => {
    // Blinds 1/2. 0 = BTN, 1 = SB (folds its 1 chip), 2 = BB. Both remaining hands play the board.
    const start = rigDeck(
      deal(tableWith([200, 200, 200], { sb: 1, bb: 2, startingStack: 200, button: 0 })),
      { board: ROYAL },
    );
    const end = checkDown(play(start, raise(0, 150), fold(1), call(2)));
    const r = resultOf(end);
    expect(r.pots).toEqual([{ amount: 301, eligible: [0, 2] }]);
    expect(r.potWinners).toEqual([[2, 0]]); // clockwise from seat 1: the button comes last
    expect(awards(end)).toEqual([{ pot: 0, seats: [2, 0], amounts: [151, 150] }]);
    expect(r.payouts).toEqual([150, 0, 151]);
  });

  it('B18: a 100-chip pot split three ways: 34 / 33 / 33, the 34 to the first winner after the button', () => {
    // Blinds 1/2. 0 = BTN, 1 = SB (folds), 2 = BB, 3 = UTG. Three hands play the board.
    const start = rigDeck(
      deal(tableWith([200, 200, 200, 200], { sb: 1, bb: 2, startingStack: 200, button: 0 })),
      { board: ROYAL },
    );
    const end = checkDown(play(start, raise(3, 33), call(0), fold(1), call(2)));
    const r = resultOf(end);
    expect(r.pots).toEqual([{ amount: 100, eligible: [0, 2, 3] }]);
    expect(awards(end)).toEqual([{ pot: 0, seats: [2, 3, 0], amounts: [34, 33, 33] }]);
    expect(r.payouts).toEqual([33, 0, 34, 33]);
  });

  it('B19: board A♠ K♦ Q♣ J♥ 10♠, 2♣3♦ against 4♥5♠: split, both play the board', () => {
    const board = 'As Kd Qc Jh Ts';
    const start = rigDeck(deal(tableWith([10000, 10000], { button: 0 })), {
      holes: { 0: '2c 3d', 1: '4h 5s' },
      board,
    });
    const end = checkDown(start);
    const r = resultOf(end);
    expect(r.potWinners).toEqual([[1, 0]]);
    expect(r.payouts).toEqual([100, 100]);
    const boardScore = score5(parseCards(board));
    for (const shown of r.shown) {
      expect(shown.score).toBe(boardScore); // the board plays: nobody improves on it
      expect(shown.category).toBe('straight');
      expect(shown.best5).toEqual(parseCards(board));
    }
  });

  it('B20: board A-7-7-3-2, A♣K♦ beats A♦Q♣ with two pair, Aces and Sevens, King kicker', () => {
    const start = rigDeck(deal(tableWith([10000, 10000], { button: 0 })), {
      holes: { 0: 'Ac Kd', 1: 'Ad Qc' },
      board: 'Ah 7s 7d 3c 2h',
    });
    const end = checkDown(start);
    const r = resultOf(end);
    expect(r.potWinners).toEqual([[0]]);
    expect(r.payouts).toEqual([200, 0]);
    const winner = r.shown.find((x) => x.seat === 0);
    expect(winner?.category).toBe('twoPair');
    expect(winner?.best5).toEqual(parseCards('Ah Ac 7s 7d Kd'));
  });

  it('B25: 60 against 60 after the SB gets 40 back: one 120 pot', () => {
    const h = play(deal(tableWith([10000, 10000, 60], { button: 0 })), fold(0), call(1));
    const end = checkDown(h);
    expect(resultOf(end).pots).toEqual([{ amount: 120, eligible: [1, 2] }]);
    expect(end.revealed).toEqual([1, 2]);
  });

  it('B34: the SB folds against a BB all-in for 30: 20 back to the SB, the BB wins 60 (net +30 / −30)', () => {
    const h = play(deal(tableWith([10000, 10000, 30], { button: 0 })), fold(0), fold(1));
    const end = play(h, ADVANCE);
    const r = resultOf(end);
    expect(r).toMatchObject({
      endedBy: 'fold',
      pots: [{ amount: 60, eligible: [2] }],
      payouts: [0, 0, 60],
      net: [0, -30, 30],
      shown: [],
    });
    expect(end.seats.map((x) => x.stack)).toEqual([10000, 9970, 60]);
    expect(seatOf(end, 2).allIn).toBe(false); // it has chips again (I7)
  });

  it('B36: heads-up blinds of 40 and 80: a 40 against 40 run-out to the end', () => {
    const start = rigDeck(deal(tableWith([40, 80], { button: 0 })), {
      holes: { 0: 'Ac As', 1: 'Kh 7c' },
      board: '2d 5h 9c Jd 3s',
    });
    expect(start.phase).toBe('roundComplete');
    const end = checkDown(start);
    const r = resultOf(end);
    expect(r).toMatchObject({
      endedBy: 'showdown',
      pots: [{ amount: 80, eligible: [0, 1] }],
      potWinners: [[0]],
      payouts: [80, 0],
      net: [40, -40],
    });
    expect(end.seats.map((x) => x.stack)).toEqual([80, 40]);
    expect(end.log.filter((ev) => ev.e === 'reveal')).toEqual([
      { e: 'reveal', seats: [1, 0], reason: 'runout' },
    ]);
  });

  it('B39: a hand won by folds settles on advance and shows nothing', () => {
    const h = play(deal(tableWith([10000, 10000], { button: 0 })), fold(0));
    expect(h.result).toBeNull();
    const end = play(h, ADVANCE);
    expect(end).toMatchObject({ phase: 'complete', revealed: [], board: [] });
    expect(resultOf(end)).toMatchObject({ endedBy: 'fold', shown: [], net: [-50, 50] });
  });

  it('B27, B28, B43: run-outs end in a showdown of exactly the live hands, in the reveal order', () => {
    const b27 = checkDown(
      play(deal(tableWith([10000, 10000], { button: 0 })), raise(0, 10000), call(1)),
    );
    expect(resultOf(b27).shown.map((x) => x.seat)).toEqual([1, 0]);
    let b28 = play(deal(tableWith([5000, 5000, 100], { button: 2 })), call(2), call(0), check(1));
    b28 = checkDown(play(b28, ADVANCE, bet(0, 4900), call(1)));
    expect(resultOf(b28).shown.map((x) => x.seat)).toEqual([0, 1, 2]);
    const b43 = checkDown(
      play(
        deal(tableWith([10000, 10000, 10000], { button: 0 })),
        fold(0),
        raise(1, 10000),
        call(2),
      ),
    );
    expect(resultOf(b43).shown.map((x) => x.seat)).toEqual([1, 2]);
    expect(resultOf(b43).pots.every((p) => !p.eligible.includes(0))).toBe(true);
  });

  it('B29: at the showdown the hands are shown in the reveal order', () => {
    let h = limpToFlop(deal(tableWith([10000, 10000, 10000], { button: 0 })));
    h = play(h, check(1), check(2), check(0), ADVANCE, check(1), check(2), check(0), ADVANCE);
    const end = checkDown(play(h, check(1), bet(2, 300), call(0), call(1)));
    expect(end.revealed).toEqual([2, 0, 1]);
    expect(resultOf(end).shown.map((x) => x.seat)).toEqual([2, 0, 1]);
  });

  it('B44: main pot 3 ways and side pot 2 ways: each odd chip goes to its own first winner', () => {
    // Blinds 1/2. 0 = BTN, 1 = SB (34), 2 = BB, 3 = UTG. Every live hand plays the board.
    const start = rigDeck(
      deal(tableWith([200, 34, 200, 200], { sb: 1, bb: 2, startingStack: 200, button: 0 })),
      { board: ROYAL },
    );
    let h = play(start, raise(3, 34), call(0), call(1), call(2), ADVANCE);
    expect(seatOf(h, 1).allIn).toBe(true);
    h = play(h, bet(2, 51), call(3), call(0), ADVANCE); // flop
    h = play(h, bet(2, 100), fold(3), call(0), ADVANCE); // turn: UTG folds with 85 in
    const end = checkDown(h);
    const r = resultOf(end);
    expect(end.seats.map((x) => x.totalBet)).toEqual([185, 34, 185, 85]);
    expect(r.pots).toEqual([
      { amount: 136, eligible: [0, 1, 2] }, // 4 × 34, the folded UTG's chips included
      { amount: 353, eligible: [0, 2] }, // 2 × 151 + the UTG's other 51
    ]);
    expect(awards(end)).toEqual([
      { pot: 1, seats: [2, 0], amounts: [177, 176] },
      { pot: 0, seats: [1, 2, 0], amounts: [46, 45, 45] },
    ]);
    expect(r.payouts).toEqual([221, 46, 222, 0]);
    expect(r.net).toEqual([36, 12, 37, -85]);
  });
});

describe('Appendix B: serialisation and replay (§4.6, §4.7)', () => {
  it('B41: 1,000 random states survive a JSON round trip unchanged', () => {
    let count = 0;
    fc.assert(
      fc.property(handArb, fc.nat(400), ({ h, policySeed }, depth) => {
        const rng = rngFromSeed(policySeed);
        let s = h;
        for (let i = 0; i < depth && s.phase !== 'complete'; i++) s = step(s, randomInput(s, rng));
        expect(JSON.parse(JSON.stringify(s))).toStrictEqual(s);
        count++;
      }),
      { seed: FC_SEED, numRuns: 1000 },
    );
    expect(count).toBe(1000);
  });

  it('B42: replaying a recorded 6-player hand with a side pot reproduces the final state and stacks', () => {
    // 0 = BTN, 1 = SB, 2 = BB (300, short), 3 = UTG, 4, 5. UTG raises, everyone calls the BB's
    // all-in of 300; a flop bet is called by the five seats still active, so seat 2 (all-in since
    // preflop) is eligible only for the main pot, and the rest fight over the side pot too.
    const stacks = [10000, 10000, 300, 10000, 10000, 10000];
    const table = tableWith(stacks, { button: 0 });
    const start = deal(table);
    const inputs: EngineInput[] = [
      raise(3, 300),
      call(4),
      call(5),
      call(0),
      call(1),
      call(2), // seat 2 all-in for its remaining 200 (total 300)
      ADVANCE,
      bet(1, 500),
      call(3),
      call(4),
      call(5),
      call(0),
      ADVANCE,
      check(1),
      check(3),
      check(4),
      check(5),
      check(0),
      ADVANCE,
      check(1),
      check(3),
      check(4),
      check(5),
      check(0),
      ADVANCE,
      ADVANCE,
    ];
    const final = play(start, ...inputs);
    expect(final.phase).toBe('complete');
    const r = resultOf(final);
    expect(r.pots).toEqual([
      { amount: 1800, eligible: [0, 1, 2, 3, 4, 5] },
      { amount: 2500, eligible: [0, 1, 3, 4, 5] },
    ]);
    const record: ReplayRecord = {
      engineVersion: final.engineVersion,
      seed: final.seed,
      commit: null,
      table,
      inputs,
    };
    const replayed = replay(record);
    expect(replayed).toStrictEqual(final);
    expect(replayed.seats.map((s) => s.stack)).toEqual(final.seats.map((s) => s.stack));
  });
});
