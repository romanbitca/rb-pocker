import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatCards, parseCards, type Card } from '../../src/core/cards.ts';
import { rngFromSeed, shuffleRange } from '../../src/core/rng.ts';
import { score5, score7 } from '../../src/eval/evaluate.ts';
import { bestFive, oddChipOrder, sidePots, splitPot } from '../../src/engine/settle.ts';
import { step } from '../../src/engine/step.ts';
import { clone } from './fixtures.ts';
import { FC_SEED, deal, tableWith } from './helpers.ts';
import { handArb, randomInput, seatOf, seedArb } from './play.ts';

/** `bestFive` from text: "hole" and "board" as "Ah Kd" lists. */
function best(hole: string, board: string): string {
  const h = parseCards(hole);
  const b = parseCards(board);
  return formatCards(bestFive(h, b, score7([...h, ...b], 7)));
}

describe('splitPot and oddChipOrder (§3.8 odd chips)', () => {
  it('splits evenly and gives the remainder one chip at a time from the first winner', () => {
    expect(splitPot(301, 2)).toEqual([151, 150]);
    expect(splitPot(100, 3)).toEqual([34, 33, 33]);
    expect(splitPot(302, 3)).toEqual([101, 101, 100]);
    expect(splitPot(7, 9)).toEqual([1, 1, 1, 1, 1, 1, 1, 0, 0]);
    expect(splitPot(600, 1)).toEqual([600]);
  });

  it('orders seats clockwise from the first seat left of the button, the button last', () => {
    const h = deal(tableWith([100, 100, 100, 100, 100, 100], { button: 3 }));
    expect(h.button).toBe(3);
    expect(oddChipOrder(h, [0, 1, 2, 3, 4, 5])).toEqual([4, 5, 0, 1, 2, 3]);
    expect(oddChipOrder(h, [3, 0])).toEqual([0, 3]);
    const headsUp = deal(tableWith([100, 100], { button: 0 }));
    expect(oddChipOrder(headsUp, [0, 1])).toEqual([1, 0]); // the big blind first
  });
});

describe('sidePots (§3.8)', () => {
  it('takes folded chips at their levels and lets only live seats win', () => {
    // B15 by hand: A folded after 200, B all-in 150, C 200 after the refund.
    const h = clone(deal(tableWith([10000, 150, 10000], { button: 0 })));
    Object.assign(seatOf(h, 0), { folded: true, totalBet: 200 });
    Object.assign(seatOf(h, 1), { totalBet: 150 });
    Object.assign(seatOf(h, 2), { totalBet: 200 });
    expect(sidePots(h)).toEqual([
      { amount: 450, eligible: [1, 2] },
      { amount: 100, eligible: [2] },
    ]);
  });

  it('at every hand end: pots hold every chip and their eligible seats shrink from the main pot up', () => {
    fc.assert(
      fc.property(handArb, ({ h, policySeed }) => {
        const rng = rngFromSeed(policySeed);
        let s = h;
        while (s.phase !== 'complete') s = step(s, randomInput(s, rng));
        const pots = sidePots(s);
        expect(pots).toEqual(s.result?.pots);
        const total = s.seats.reduce((x, seat) => x + seat.totalBet, 0);
        expect(pots.reduce((x, p) => x + p.amount, 0)).toBe(total);
        for (let i = 1; i < pots.length; i++) {
          const prev = (pots[i - 1] as { eligible: number[] }).eligible;
          const cur = (pots[i] as { eligible: number[] }).eligible;
          // Strictly smaller and inside the previous pot's seats: so §3.8's merge never applies.
          expect(cur.length).toBeLessThan(prev.length);
          expect(cur.every((seat) => prev.includes(seat))).toBe(true);
        }
      }),
      { seed: FC_SEED, numRuns: 500 },
    );
  });
});

describe('bestFive (§5.4 rules, the cards shown at the showdown)', () => {
  it('the board plays: the five board cards, never a hole card that only ties (pitfall 10)', () => {
    expect(best('Tc 2d', 'Ah Kd Qc Jh Ts')).toBe('Ah Kd Qc Jh Ts');
    expect(best('Qc Jd', 'Ah Ad As Ks Kh')).toBe('As Ah Ad Ks Kh');
    expect(best('Ac Kd', 'Ah Ad As Ks Kh')).toBe('As Ah Ad Ac Kd'); // the hole ace makes quads
  });

  it('flushes and straight flushes: the flush suit, top five ranks; the wheel ends with the ace', () => {
    expect(best('Ah 2c', 'Kh 9h 5h 3h 2h')).toBe('Ah Kh 9h 5h 3h');
    expect(best('4h 7h', '3h 5h 6h Kh 2h')).toBe('7h 6h 5h 4h 3h'); // B24
    expect(best('Ad 2d', '3d 4d 5d Kc Ks')).toBe('5d 4d 3d 2d Ad');
  });

  it('other hands: category cards first, then kickers; hole cards chosen first, higher suit first', () => {
    expect(best('9s 9d', '8c 8h 7d 7s Kc')).toBe('9s 9d 8h 8c Kc'); // B22: third pair kicker
    expect(best('7s 7d', '7c Kh Kd Ks 2c')).toBe('Ks Kh Kd 7s 7d'); // B23: kings full of sevens
    expect(best('Ac Kd', 'Ah 7s 7d 3c 2h')).toBe('Ah Ac 7s 7d Kd'); // B20
    expect(best('5c 2d', '5h 5s 5d Ks Qd')).toBe('5s 5h 5d 5c Ks'); // quads, the hole five
    expect(best('Qc 3d', 'Qh Qs 9d 8c 2h')).toBe('Qs Qh Qc 9d 8c'); // trips with the hole queen
    expect(best('As 3d', 'Ah 9d 8c 5h 2h')).toBe('As Ah 9d 8c 5h'); // pair of aces
    expect(best('Kd Jc', '9h 8d 6c 3s 2h')).toBe('Kd Jc 9h 8d 6c'); // high card
    expect(best('5c 4d', '3h 2s As Kd 9c')).toBe('5c 4d 3h 2s As'); // wheel straight
  });

  it('always scores the hand exactly with five distinct cards of the seven (property)', () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        const deck = Array.from({ length: 52 }, (_, i) => i as Card);
        shuffleRange(deck, 0, 51, rngFromSeed(seed));
        const hole = deck.slice(0, 2);
        const board = deck.slice(2, 7);
        const score = score7([...hole, ...board], 7);
        const five = bestFive(hole, board, score);
        expect(five).toHaveLength(5);
        expect(new Set(five).size).toBe(5);
        expect(five.every((c) => hole.includes(c) || board.includes(c))).toBe(true);
        expect(score5(five)).toBe(score);
        if (score5(board) === score) expect([...five].sort()).toEqual([...board].sort());
      }),
      { seed: FC_SEED, numRuns: 20_000 },
    );
  });
});
