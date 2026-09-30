/**
 * Draws, outs, risky outs, beaters and nuts (PLAN §6.2–6.5): every Appendix D.2 vector, the D.1
 * "Best possible hand" rows, pitfall 11 (board-pair "outs") and the draw edge cases. The
 * brute-force oracle comparison is in `handinfo.property.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { analyzeHand, countBeaters, findDraws, findOuts } from '../../src/analysis/handinfo.ts';
import type { DrawKind, OutCard, RiskRule } from '../../src/analysis/types.ts';
import { formatCard, type Card } from '../../src/core/cards.ts';
import { HAND_CATEGORIES, type HandCategory } from '../../src/eval/evaluate.ts';
import { card, cards } from '../helpers/cards.ts';

interface Group {
  makes: HandCategory;
  cards: string;
  /** Risky rules of every card in the group, unless `except` names the card. */
  risky: RiskRule[];
  except?: Record<string, RiskRule[]>;
}

interface OutsVector {
  hole: string;
  board: string;
  draws: DrawKind[];
  groups: Group[];
  total: number;
}

/** Appendix D.2, row by row ("all 5s" etc. written out). */
const D2: OutsVector[] = [
  {
    hole: 'A♥ K♥',
    board: 'Q♥ 7♥ 2♣',
    draws: ['nutFlush', 'overcards'],
    groups: [
      {
        makes: 'flush',
        cards: '2♥ 3♥ 4♥ 5♥ 6♥ 8♥ 9♥ 10♥ J♥',
        risky: [],
        except: { '2♥': ['R2'] },
      },
      { makes: 'pair', cards: 'A♣ A♦ A♠ K♣ K♦ K♠', risky: ['R5'] },
    ],
    total: 15,
  },
  {
    hole: '9♠ 8♠',
    board: '7♦ 6♣ 2♥',
    draws: ['oesd', 'overcards'],
    groups: [
      { makes: 'straight', cards: '5♣ 5♦ 5♥ 5♠ 10♣ 10♦ 10♥ 10♠', risky: [] },
      { makes: 'pair', cards: '8♣ 8♦ 8♥ 9♣ 9♦ 9♥', risky: ['R3', 'R5'] },
    ],
    total: 14,
  },
  {
    hole: '9♠ 8♠',
    board: 'J♦ 7♣ 2♥',
    draws: ['gutshot'],
    groups: [
      { makes: 'straight', cards: '10♣ 10♦ 10♥ 10♠', risky: [] },
      { makes: 'pair', cards: '9♣ 9♦ 9♥ 8♣ 8♦ 8♥', risky: ['R3', 'R5'] },
    ],
    total: 10,
  },
  {
    hole: '9♥ 9♦',
    board: 'K♠ 7♣ 2♦',
    draws: [],
    groups: [{ makes: 'trips', cards: '9♣ 9♠', risky: [] }],
    total: 2,
  },
  {
    hole: '7♠ 7♦',
    board: 'K♣ 7♥ 2♦',
    draws: [],
    groups: [
      { makes: 'fullHouse', cards: 'K♦ K♥ K♠ 2♣ 2♥ 2♠', risky: [] },
      { makes: 'quads', cards: '7♣', risky: [] },
    ],
    total: 7,
  },
  {
    hole: 'A♣ 2♣',
    board: '3♦ 4♥ K♠',
    draws: ['gutshot'],
    groups: [
      { makes: 'straight', cards: '5♣ 5♦ 5♥ 5♠', risky: ['R3'] },
      { makes: 'pair', cards: '2♦ 2♥ 2♠ A♦ A♥ A♠', risky: ['R3', 'R5'] },
    ],
    total: 10,
  },
  {
    hole: 'J♠ 10♠',
    board: 'Q♠ 9♦ 2♠',
    draws: ['flush', 'oesd'],
    groups: [
      {
        makes: 'flush',
        cards: '3♠ 4♠ 5♠ 6♠ 7♠ 8♠ 9♠ K♠ A♠',
        risky: ['R4'],
        except: { '9♠': ['R2', 'R4'] },
      },
      { makes: 'straight', cards: '8♣ 8♦ 8♥ K♣ K♦ K♥', risky: [] },
      { makes: 'pair', cards: 'J♣ J♦ J♥ 10♣ 10♦ 10♥', risky: ['R3', 'R5'] },
    ],
    total: 21,
  },
  {
    hole: 'A♠ A♦',
    board: '5♣ 6♦ 7♥ 8♠',
    draws: [],
    groups: [{ makes: 'trips', cards: 'A♣ A♥', risky: ['R3'] }],
    total: 2,
  },
  {
    hole: '9♣ 7♦',
    board: 'J♠ 8♥ 5♣',
    draws: ['doubleGutshot'],
    groups: [
      {
        makes: 'straight',
        cards: '6♣ 6♦ 6♥ 6♠ 10♣ 10♦ 10♥ 10♠',
        risky: [],
        except: { '10♣': ['R3'], '10♦': ['R3'], '10♥': ['R3'], '10♠': ['R3'] },
      },
      { makes: 'pair', cards: '9♦ 9♥ 9♠ 7♣ 7♥ 7♠', risky: ['R3', 'R5'] },
    ],
    total: 14,
  },
];

/** Card text → "makes / risky rules", comparable with toEqual. */
function describeOuts(outs: readonly OutCard[]): Record<string, string> {
  return Object.fromEntries(
    outs.map((o) => [formatCard(o.card), `${o.makes} [${o.risky.join(',')}]`]),
  );
}

function expectedOuts(groups: readonly Group[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const g of groups) {
    for (const c of cards(g.cards)) {
      const text = formatCard(c);
      const plain = Object.entries(g.except ?? {}).find(([k]) => card(k) === c);
      out[text] = `${g.makes} [${(plain?.[1] ?? g.risky).join(',')}]`;
    }
  }
  return out;
}

const level = (c: HandCategory): number => HAND_CATEGORIES.indexOf(c);

/** The draw chips: backdoor draws are shown only in the coach sheet (§6.2), so D.2 omits them. */
const chips = (draws: readonly { kind: DrawKind }[]): DrawKind[] =>
  draws.map((d) => d.kind).filter((k) => !k.startsWith('backdoor'));

describe('Appendix D.2: outs, risky outs and draw chips', () => {
  for (const v of D2) {
    it(`${v.hole} on ${v.board}: ${v.total} outs, draws [${v.draws.join(', ')}]`, () => {
      const hole = cards(v.hole);
      const board = cards(v.board);
      const outs = findOuts(hole, board);
      expect(describeOuts(outs)).toEqual(expectedOuts(v.groups));
      expect(outs).toHaveLength(v.total);
      // Grouped for the UI: strongest category first, then cards high to low.
      for (let i = 1; i < outs.length; i++) {
        const a = outs[i - 1] as OutCard;
        const b = outs[i] as OutCard;
        const order = level(a.makes) - level(b.makes) || a.card - b.card;
        expect(order).toBeGreaterThan(0);
      }
      expect(chips(findDraws(hole, board))).toEqual(v.draws);
      const all = analyzeHand(hole, board);
      expect(all.outs).toEqual(outs);
      expect(all.draws).toEqual(findDraws(hole, board));
    });
  }

  it('each draw counts the outs that complete it; a combo draw is the union, not the sum', () => {
    const draws = (h: string, b: string) =>
      findDraws(cards(h), cards(b)).map((d) => `${d.kind} ${d.outs}`);
    // A-K-Q is also a backdoor straight (coach sheet only: no one-card outs).
    expect(draws('A♥ K♥', 'Q♥ 7♥ 2♣')).toEqual(['nutFlush 9', 'overcards 6', 'backdoorStraight 0']);
    expect(draws('9♠ 8♠', '7♦ 6♣ 2♥')).toEqual(['oesd 8', 'overcards 6']);
    expect(draws('9♠ 8♠', 'J♦ 7♣ 2♥')).toEqual(['gutshot 4']);
    expect(draws('A♣ 2♣', '3♦ 4♥ K♠')).toEqual(['gutshot 4']);
    expect(draws('9♣ 7♦', 'J♠ 8♥ 5♣')).toEqual(['doubleGutshot 8']);
    // 8♠ and K♠ complete both the flush and the straight: 9 + 8 draw outs, 15 distinct cards.
    expect(draws('J♠ 10♠', 'Q♠ 9♦ 2♠')).toEqual(['flush 9', 'oesd 8']);
    const combo = findOuts(cards('J♠ 10♠'), cards('Q♠ 9♦ 2♠'));
    expect(combo.filter((o) => o.makes === 'flush' || o.makes === 'straight')).toHaveLength(15);
  });
});

describe('pitfall 11: board-pairing cards are not outs up to two pair (§6.3 rule 3)', () => {
  const outCards = (h: string, b: string): string[] =>
    findOuts(cards(h), cards(b)).map((o) => formatCard(o.card));

  it('an overpair gains nothing from a card that pairs the board', () => {
    // A♠A♦ on K♣7♥2♦: a King gives "Aces and Kings", but everyone has the Kings.
    const outs = outCards('A♠ A♦', 'K♣ 7♥ 2♦');
    expect(outs).toEqual(['Ah', 'Ac']);
  });

  it('a pocket pair under the board: only the set cards (D.2 row 4)', () => {
    const outs = outCards('9♥ 9♦', 'K♠ 7♣ 2♦');
    expect(outs.sort()).toEqual(['9c', '9s']);
  });

  it('a card of a hole rank that is also on the board still counts', () => {
    // K♠Q♦ on K♣7♥2♦: another King makes trips with the hero's own King.
    const outs = findOuts(cards('K♠ Q♦'), cards('K♣ 7♥ 2♦'));
    const text = describeOuts(outs);
    expect(text.Kd).toBe('trips []');
    expect(text.Kh).toBe('trips []');
    // A Queen makes two pair with both hole cards: allowed (rank Q is not on the board).
    expect(text.Qs).toBe('twoPair []');
    // A Seven or a Two pairs the board only: two pair for everyone, not an out.
    expect(text['7s']).toBeUndefined();
    expect(text['2s']).toBeUndefined();
  });

  it('a board-pairing card that makes a full house or better is an out (D.2 row 5)', () => {
    const text = describeOuts(findOuts(cards('7♠ 7♦'), cards('K♣ 7♥ 2♦')));
    expect(text.Kd).toBe('fullHouse []');
    expect(text['2c']).toBe('fullHouse []');
  });

  it('with a pair on the board, pairing the board again (two pair on board) is not an out', () => {
    // A♠J♦ on 8♣8♥3♦: a 3 makes 8-8-3-3 on the board; an Ace or Jack pairs the hero's card.
    const text = describeOuts(findOuts(cards('A♠ J♦'), cards('8♣ 8♥ 3♦')));
    expect(text['3c']).toBeUndefined();
    expect(text.Ac).toBe('twoPair []');
    expect(text.Jc).toBe('twoPair []');
    // An 8 makes trips of the board's Eights: category 3 > two pair, rule 3 no longer applies.
    expect(text['8s']).toBe('trips []');
  });

  it('on the turn, a card that completes a board straight is not an out (D.2 row 8)', () => {
    const outs = outCards('A♠ A♦', '5♣ 6♦ 7♥ 8♠');
    expect(outs).not.toContain('4c');
    expect(outs).not.toContain('9c');
  });

  it('on the turn, a straight card that only the board uses is not an out (§6.3 rule 2)', () => {
    // 10♣2♦ on 5♠6♦7♥8♣: a 9 makes 6-7-8-9-10 with the hero's Ten (an out); a 4 makes the
    // board's own 4-8 straight, higher than anything the hero adds.
    const outs = findOuts(cards('10♣ 2♦'), cards('5♠ 6♦ 7♥ 8♣'));
    expect(outs.map((o) => formatCard(o.card)).filter((t) => t[0] === '4')).toEqual([]);
    expect(outs.filter((o) => o.makes === 'straight').map((o) => formatCard(o.card))).toEqual([
      '9s',
      '9h',
      '9d',
      '9c',
    ]);
    expect(findDraws(cards('10♣ 2♦'), cards('5♠ 6♦ 7♥ 8♣'))).toEqual([
      { kind: 'gutshot', outs: 4 },
    ]);
  });
});

describe('draw definitions (§6.2)', () => {
  const kinds = (h: string, b: string): DrawKind[] =>
    findDraws(cards(h), cards(b)).map((d) => d.kind);

  it('A-2-3-4 and J-Q-K-A are one-ended: gutshots; 2-3-4-5 and 10-J-Q-K are open-ended', () => {
    expect(kinds('A♣ 2♦', '3♥ 4♠ 9♣')).toEqual(['gutshot']);
    expect(kinds('J♣ Q♦', 'K♥ A♠ 4♣')).toEqual(['gutshot']);
    expect(kinds('2♣ 3♦', '4♥ 5♠ 9♣')).toEqual(['oesd']);
    expect(findDraws(cards('2♣ 3♦'), cards('4♥ 5♠ 9♣'))[0]?.outs).toBe(8);
    expect(kinds('10♣ J♦', 'Q♥ K♠ 4♣')).toEqual(['oesd']);
  });

  it('a straight draw must use a hole card: four to a straight on the board is not a draw', () => {
    // 2♣2♦ on 5♠6♦7♥8♣: a 4 or a 9 makes the board's straight; the hero adds nothing.
    expect(kinds('2♣ 2♦', '5♠ 6♦ 7♥ 8♣')).toEqual([]);
    // A♣K♦: no straight draw either, only the two overcards.
    expect(kinds('A♣ K♦', '5♠ 6♦ 7♥ 8♣')).toEqual(['overcards']);
  });

  it('a flush draw needs exactly four of the suit with at least one hole card', () => {
    expect(kinds('3♣ 3♦', 'K♠ 8♠ 9♠ 2♠')).toEqual([]); // four on the board: not the hero's draw
    expect(kinds('A♠ J♣', '5♠ 6♠ 9♠ K♦')).toEqual(['nutFlush']);
    expect(kinds('K♠ J♣', 'A♠ 6♠ 9♠ 2♦')).toEqual(['nutFlush']); // the Ace is on the board
    expect(kinds('A♣ K♠', '5♠ 6♠ 9♠ 2♦')).toEqual(['flush', 'overcards']); // A♠ is unseen
    expect(kinds('Q♣ Q♠', '5♠ 6♠ 9♠ 2♦')).toEqual(['flush']);
    expect(kinds('A♠ K♠', '5♠ 6♠ 9♠')).toEqual([]); // a flush is made
  });

  it('two overcards: both hole cards above every board card and no pair', () => {
    expect(kinds('A♣ K♦', 'Q♥ 7♠ 2♣')).toEqual(['overcards', 'backdoorStraight']);
    expect(kinds('A♣ Q♦', 'K♥ 7♠ 2♣')).toEqual(['backdoorStraight']); // one overcard only
    expect(kinds('A♣ K♦', '7♥ 7♠ 2♣')).toEqual([]); // a pair (on the board)
  });

  it('overcards: "up to 6" when the board can make a flush by itself', () => {
    // Turn with four spades: A♠ or K♠ makes the board's flush, which beats the hero's pair.
    const d = findDraws(cards('A♦ K♦'), cards('2♠ 5♠ 7♠ 9♠'));
    expect(d).toEqual([{ kind: 'overcards', outs: 4 }]);
  });

  it('a made straight or better has no straight or overcard draws', () => {
    expect(kinds('A♠ K♦', 'Q♥ J♠ 10♣')).toEqual([]); // Broadway made
    // A made flush with an open-ended straight shape: no straight draw.
    expect(kinds('9♠ 8♠', '7♠ 6♦ 2♠ K♠')).toEqual([]);
    // A made straight keeps its flush draw.
    expect(kinds('9♠ 8♠', '7♠ 6♠ 5♦')).toEqual(['flush']);
  });

  it('backdoor draws on the flop only', () => {
    expect(kinds('A♥ 9♥', 'K♥ 6♣ 2♦')).toEqual(['backdoorFlush']);
    expect(kinds('A♥ 9♥', 'K♥ 6♣ 2♦ 3♠')).toEqual([]); // the turn: no backdoor draws
    expect(kinds('A♥ 9♥', 'K♥ 5♣ 2♦')).toEqual(['backdoorFlush', 'backdoorStraight']); // A-2-5
    expect(kinds('9♥ 8♣', 'J♦ 4♠ 2♥')).toEqual(['backdoorStraight']); // 8-9-J: 10 and Q, or 7 and 10
    expect(findDraws(cards('9♥ 8♣'), cards('J♦ 4♠ 2♥'))[0]?.outs).toBe(0);
    // Three ranks of a window all on the board are not the hero's backdoor.
    expect(kinds('A♣ 2♦', '6♥ 7♠ 8♦')).toEqual([]);
    // A hole rank that only pairs the board does not count either.
    expect(kinds('7♣ 2♦', '6♥ 7♠ 8♦')).toEqual([]);
  });

  it('no draws and no outs preflop or on the river', () => {
    expect(findDraws(cards('9♠ 8♠'), [])).toEqual([]);
    expect(findOuts(cards('9♠ 8♠'), [])).toEqual([]);
    expect(findDraws(cards('9♠ 8♠'), cards('7♦ 6♣ 2♥ K♣ Q♦'))).toEqual([]);
    expect(findOuts(cards('9♠ 8♠'), cards('7♦ 6♣ 2♥ K♣ Q♦'))).toEqual([]);
  });

  it('a straight flush card improves a flush; a royal card improves a straight flush', () => {
    const text = describeOuts(findOuts(cards('K♥ Q♥'), cards('J♥ 10♥ 9♥')));
    expect(text.Ah).toBe('royalFlush []');
    expect(Object.keys(text)).toEqual(['Ah']);
    const flush = describeOuts(findOuts(cards('8♥ 7♥'), cards('6♥ 5♥ K♥')));
    expect(flush['9h']).toBe('straightFlush []');
    expect(flush['4h']).toBe('straightFlush []');
  });
});

describe('beaters and "Best possible hand" (§6.5, Appendix D.1)', () => {
  it('A♥5♥ on K♥9♥2♥: the nut flush, 0 of 1,081', () => {
    expect(countBeaters(cards('A♥ 5♥'), cards('K♥ 9♥ 2♥'))).toEqual({ count: 0, total: 1081 });
    expect(analyzeHand(cards('A♥ 5♥'), cards('K♥ 9♥ 2♥')).nuts).toBe(true);
  });

  it('A♠K♠ on Q♠J♠10♠2♦3♣: a royal flush is the nuts, 0 of 990', () => {
    expect(countBeaters(cards('A♠ K♠'), cards('Q♠ J♠ 10♠ 2♦ 3♣'))).toEqual({
      count: 0,
      total: 990,
    });
    expect(analyzeHand(cards('A♠ K♠'), cards('Q♠ J♠ 10♠ 2♦ 3♣')).nuts).toBe(true);
  });

  it('A♥2♥ on K♥Q♥9♥5♥3♥: not the nuts, J♥10♥ makes a straight flush', () => {
    const b = countBeaters(cards('A♥ 2♥'), cards('K♥ Q♥ 9♥ 5♥ 3♥'));
    // The only beater: J♥10♥ (K-high straight flush). 6♥4♥ would need 2♥ or 7♥ as well, and
    // the hero's A♥ blocks every higher flush.
    expect(b).toEqual({ count: 1, total: 990 });
    expect(analyzeHand(cards('A♥ 2♥'), cards('K♥ Q♥ 9♥ 5♥ 3♥')).nuts).toBe(false);
  });

  it('turn totals and preflop', () => {
    expect(countBeaters(cards('A♠ A♦'), cards('5♣ 6♦ 7♥ 8♠'))?.total).toBe(1035);
    expect(countBeaters(cards('A♠ A♦'), [])).toBeNull();
    const pre = analyzeHand(cards('A♠ A♦'), []);
    expect(pre).toEqual({ draws: [], outs: [], beaters: null, nuts: false });
  });

  it('ties do not count as beaters', () => {
    // Broadway on the board: everyone plays it, nobody beats the hero.
    expect(countBeaters(cards('2♣ 3♦'), cards('A♠ K♦ Q♣ J♥ 10♠'))).toEqual({
      count: 0,
      total: 990,
    });
  });
});

describe('input checks', () => {
  const bad: [string, Card[], Card[]][] = [
    ['one hole card', [card('A♠')], cards('K♦ Q♣ J♥')],
    ['a two-card board', cards('A♠ K♠'), cards('K♦ Q♣')],
    ['a six-card board', cards('A♠ K♠'), cards('K♦ Q♣ J♥ 10♠ 9♠ 8♠')],
    ['a repeated card', cards('A♠ K♠'), cards('A♠ Q♣ J♥')],
    ['not a card', [card('A♠'), 52], cards('K♦ Q♣ J♥')],
  ];
  for (const [name, h, b] of bad) {
    it(`rejects ${name}`, () => {
      expect(() => findOuts(h, b)).toThrow(RangeError);
      expect(() => findDraws(h, b)).toThrow(RangeError);
      expect(() => countBeaters(h, b)).toThrow(RangeError);
      expect(() => analyzeHand(h, b)).toThrow(RangeError);
    });
  }
});
