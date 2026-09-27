/**
 * PLAN Appendix B: the rules edge-case vectors, run through the real engine: `createTable` +
 * `startHand` (`tableWith` + `deal`), then `step` with every invariant (the log replay included)
 * checked after each input (`play`). Blinds 50/100 and stacks 10,000 unless a vector says
 * otherwise; amounts are "to" amounts.
 *
 * Seats are numbered clockwise. Each vector names the seats it uses in a comment, so the letters
 * of Appendix B can be followed.
 *
 * This file has the betting and order vectors (chunk 2.3). Vectors that end in a settlement are
 * checked up to the last `advance` here; their settlement is checked in chunk 2.4. B21–B24
 * (evaluator) are in tests/eval, B30–B31 (button between hands) in table and start tests.
 */
import { describe, expect, it } from 'vitest';
import { step } from '../../src/engine/step.ts';
import type { HandState } from '../../src/engine/types.ts';
import { deal, tableWith } from './helpers.ts';
import {
  ADVANCE,
  advanceWhileRoundComplete,
  bet,
  call,
  check,
  engineError,
  fold,
  legalOf,
  play,
  raise,
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
