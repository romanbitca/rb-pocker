import { describe as suite, expect, it } from 'vitest';
import { formatCards, type Card } from '../../src/core/cards.ts';
import { describe, type HandInfo } from '../../src/eval/describe.ts';
import { score7, type HandCategory } from '../../src/eval/evaluate.ts';
import { cards, hole } from '../helpers/cards.ts';

/**
 * Appendix D.1, copied verbatim (hole, board, name, subLabel, best5 in order, notes).
 * The sub-label suffix " · Best possible hand" is not part of `describe()`: the UI appends it
 * from the hand analysis (`nuts`, Stage 4), as Appendix A.2 says.
 */
// prettier-ignore
const D1: [string, string, string, string, string, string][] = [
  ['A♥ K♥', 'Q♥ 7♥ 2♣', 'Ace-high', '—', 'A♥ K♥ Q♥ 7♥ 2♣', 'highCard'],
  ['A♠ K♦', 'K♣ 7♥ 2♦', 'Pair of Kings', 'Top pair, Ace kicker', 'K♦ K♣ A♠ 7♥ 2♦', 'holeUsed 2'],
  ['Q♠ Q♦', 'J♣ 7♥ 2♦', 'Pair of Queens', 'Overpair', 'Q♠ Q♦ J♣ 7♥ 2♦', ''],
  ['5♠ 5♦', 'K♣ Q♥ 9♦', 'Pair of Fives', 'Pocket pair under the board', '5♠ 5♦ K♣ Q♥ 9♦', ''],
  ['7♠ 7♦', '7♣ K♥ 2♦', 'Three of a Kind, Sevens', 'A set: well hidden and strong', '7♠ 7♦ 7♣ K♥ 2♦', ''],
  ['K♠ 7♦', '7♣ 7♥ 2♦', 'Three of a Kind, Sevens', 'Trips: others may share your card', '7♥ 7♦ 7♣ K♠ 2♦', 'holeUsed 2 (K kicker)'],
  ['K♣ K♦', 'K♠ 7♥ 7♣ 2♦ 3♠', 'Full House, Kings full of Sevens', 'Uses 2 of your cards', 'K♠ K♦ K♣ 7♥ 7♣', 'core = all 5'],
  ['9♠ 9♦', '8♣ 8♥ 7♦ 7♠ K♣', 'Two Pair, Nines and Eights', 'One pair is on the board', '9♠ 9♦ 8♥ 8♣ K♣', 'kickers [K♣]'],
  ['9♠ 9♦', '8♣ 8♥ 7♦ 7♠ 2♣', 'Two Pair, Nines and Eights', 'One pair is on the board', '9♠ 9♦ 8♥ 8♣ 7♠', 'kicker 7 from the third pair'],
  ['A♠ 5♦', 'K♣ K♥ 7♦ 7♠ 2♣', 'Two Pair, Kings and Sevens', 'Both pairs are on the board: your kicker decides', 'K♥ K♣ 7♠ 7♦ A♠', 'kickers [A♠], holeUsed 1'],
  ['A♠ K♦', '7♣ 7♥ 7♦ 5♠ 2♣', 'Three of a Kind, Sevens', 'The three are on the board: everyone has them', '7♥ 7♦ 7♣ A♠ K♦', 'kickers [A♠ K♦]'],
  ['2♣ 3♦', 'A♠ K♦ Q♣ J♥ 10♠', 'Straight, Ace-high', 'The board plays: everyone shares this hand', 'A♠ K♦ Q♣ J♥ 10♠', 'holeUsed 0, playsTheBoard'],
  ['10♣ 2♦', 'A♠ K♦ Q♣ J♥ 10♠', 'Straight, Ace-high', 'The board plays: everyone shares this hand', 'A♠ K♦ Q♣ J♥ 10♠', 'holeUsed 0 although a hole 10 duplicates a board rank'],
  ['7♦ 2♣', 'A♠ A♥ K♣ K♦ Q♠', 'Two Pair, Aces and Kings', 'The board plays: everyone shares this hand', 'A♠ A♥ K♦ K♣ Q♠', 'playsTheBoard'],
  ['A♥ 2♣', '3♦ 4♠ 5♥ K♣ Q♦', 'Straight, Five-high', 'Uses 2 of your cards', '5♥ 4♠ 3♦ 2♣ A♥', 'wheel'],
  ['Q♠ K♦', 'A♥ 2♣ 3♦ 9♠ 8♥', 'Ace-high', '—', 'A♥ K♦ Q♠ 9♠ 8♥', 'Q-K-A-2-3 is not a straight'],
  ['4♥ 7♥', '3♥ 5♥ 6♥ K♥ 2♥', 'Straight Flush, Seven-high', 'Uses 2 of your cards', '7♥ 6♥ 5♥ 4♥ 3♥', 'beats the flush in the same cards'],
  ['A♥ 2♥', 'K♥ Q♥ 9♥ 5♥ 3♥', 'Flush, Ace-high', 'Uses 1 of your cards', 'A♥ K♥ Q♥ 9♥ 5♥', 'top five of the suit; not the nuts (J♥10♥ makes a straight flush)'],
  ['A♥ 5♥', 'K♥ 9♥ 2♥', 'Flush, Ace-high', 'Uses 2 of your cards · Best possible hand', 'A♥ K♥ 9♥ 5♥ 2♥', '`nuts: true` (0 beaters)'],
  ['A♠ K♠', 'Q♠ J♠ 10♠ 2♦ 3♣', 'Royal Flush', 'Uses 2 of your cards · Best possible hand', 'A♠ K♠ Q♠ J♠ 10♠', 'category royalFlush'],
  ['7♠ 7♦', '7♣ K♥ K♦ K♠ 2♣', 'Full House, Kings full of Sevens', 'Uses 2 of your cards', 'K♠ K♥ K♦ 7♠ 7♦', 'two trips; pair taken from hole cards'],
  ['Q♣ Q♦', 'Q♥ Q♠ 7♦ 7♣ 2♠', 'Four of a Kind, Queens', 'Uses 2 of your cards', 'Q♠ Q♥ Q♦ Q♣ 7♦', 'kicker 7♦ (higher suit than 7♣)'],
  ['K♠ 7♣', '— (preflop)', 'King-Seven offsuit', '—', '[]', 'category highCard'],
  ['9♥ 9♣', '— (preflop)', 'Pocket Nines', '—', '[]', 'category pair'],
];

/** A.2: `preflopClass` is the §7.5 class name preflop ("AKs"), else null. */
const PREFLOP_CLASS: Record<string, string> = { 'K♠ 7♣': 'K7o', '9♥ 9♣': '99' };

/** Category implied by an Appendix F.2 name. */
function categoryOfName(name: string): HandCategory {
  const prefixes: [string, HandCategory][] = [
    ['Royal Flush', 'royalFlush'],
    ['Straight Flush', 'straightFlush'],
    ['Four of a Kind', 'quads'],
    ['Full House', 'fullHouse'],
    ['Flush', 'flush'],
    ['Straight', 'straight'],
    ['Three of a Kind', 'trips'],
    ['Two Pair', 'twoPair'],
    ['Pair of', 'pair'],
    ['Pocket', 'pair'],
  ];
  return prefixes.find(([p]) => name.startsWith(p))?.[1] ?? 'highCard';
}

const CORE_SIZE: Record<HandCategory, number> = {
  highCard: 1,
  pair: 2,
  twoPair: 4,
  trips: 3,
  straight: 5,
  flush: 5,
  fullHouse: 5,
  quads: 4,
  straightFlush: 5,
  royalFlush: 5,
};

const show = (cs: readonly Card[]): string => formatCards(cs);

suite('describe(): Appendix D.1 vectors', () => {
  D1.forEach(([holeText, boardText, name, subText, best5Text, notes], i) => {
    const rowNo = i + 1;
    it(`row ${rowNo}: ${holeText} | ${boardText} → ${name}`, () => {
      const preflop = boardText.startsWith('—');
      const h = hole(holeText);
      const board = preflop ? [] : cards(boardText);
      const info: HandInfo = describe(h, board);

      const category = categoryOfName(name);
      const best5 = best5Text === '[]' ? [] : cards(best5Text);
      const coreSize = preflop ? 0 : CORE_SIZE[category];
      const expectedSub = subText === '—' ? null : subText.replace(' · Best possible hand', '');

      expect(info.name).toBe(name);
      expect(info.subLabel).toBe(expectedSub);
      expect(info.category).toBe(category);
      expect(show(info.best5)).toBe(show(best5));
      expect(show(info.core)).toBe(show(best5.slice(0, coreSize)));
      expect(show(info.kickers)).toBe(show(best5.slice(coreSize)));
      expect(info.holeUsed).toBe(best5.filter((c) => h.includes(c)).length);
      expect(info.playsTheBoard).toBe(subText.startsWith('The board plays'));
      expect(info.preflopClass).toBe(preflop ? PREFLOP_CLASS[holeText] : null);
      expect(info.score).toBe(preflop ? 0 : score7([...h, ...board], 2 + board.length));

      // The explicit notes of the row.
      if (notes === 'holeUsed 2' || notes.startsWith('holeUsed 2 ')) expect(info.holeUsed).toBe(2);
      if (notes.includes('holeUsed 1')) expect(info.holeUsed).toBe(1);
      if (notes.includes('holeUsed 0')) expect(info.holeUsed).toBe(0);
      if (notes.includes('playsTheBoard')) expect(info.playsTheBoard).toBe(true);
      if (notes === 'core = all 5') expect(info.core).toHaveLength(5);
      const kickers = /kickers \[(.+)\]/.exec(notes);
      if (kickers) expect(show(info.kickers)).toBe(show(cards(kickers[1] as string)));
      if (notes.startsWith('kicker 7♦')) expect(show(info.kickers)).toBe(show(cards('7♦')));
      const cat = /^category (\w+)$/.exec(notes);
      if (cat) expect(info.category).toBe(cat[1]);
    });
  });

  it('gives the preflop class', () => {
    expect(describe(hole('K♠ 7♣'), []).preflopClass).toBe('K7o');
    expect(describe(hole('9♥ 9♣'), []).preflopClass).toBe('99');
    expect(describe(hole('A♠ K♠'), []).preflopClass).toBe('AKs');
    expect(describe(hole('A♠ K♠'), []).name).toBe('Ace-King suited');
    expect(describe(hole('7♠ K♠'), []).name).toBe('King-Seven suited');
  });

  // PLAN §5.4 / Appendix D.1 row 6 (v1.3.12): a rank's cards in `best5` are always listed by suit
  // (s > h > d > c), never hole-cards-first; only which cards are *selected* prefers hole cards.
  it('row 6: cards within the trips are listed by suit, not hole-cards-first', () => {
    const info = describe(hole('K♠ 7♦'), cards('7♣ 7♥ 2♦'));
    expect(show(info.best5)).toBe(show(cards('7♥ 7♦ 7♣ K♠ 2♦')));
  });
});

// Appendix B vectors 19–24 (evaluation, and for B19–B20 the engine showdown too) run in
// tests/engine/appendix-b.test.ts, with the other 38 vectors: one test per vector, in one file.

suite('describe(): other sub-labels (§6.1)', () => {
  const sub = (h: string, b: string): string | null => describe(hole(h), cards(b)).subLabel;

  it('covers every pair row', () => {
    expect(sub('A♠ K♦', 'K♣ 7♥ 2♦')).toBe('Top pair, Ace kicker');
    expect(sub('K♠ 3♦', 'K♣ 7♥ 2♦ 9♣')).toBe('Top pair, Three kicker');
    expect(sub('7♠ A♦', 'K♣ 7♥ 2♦')).toBe('Second pair');
    expect(sub('2♠ A♦', 'K♣ 7♥ 2♦')).toBe('Weak pair');
    expect(sub('Q♠ Q♦', 'J♣ 7♥ 2♦')).toBe('Overpair');
    expect(sub('9♠ 9♦', 'K♣ 7♥ 2♦')).toBe('Pocket pair under the board');
    expect(sub('A♠ Q♦', 'K♣ K♥ 2♦')).toBe('The pair is on the board: everyone has it');
  });

  it('covers every two-pair and trips row', () => {
    expect(sub('A♠ K♦', 'A♣ K♥ 2♦')).toBe('Both your cards make pairs');
    expect(sub('A♠ 5♦', 'A♣ K♥ K♦')).toBe('One pair is on the board');
    expect(sub('5♠ 5♦', 'A♣ K♥ K♦')).toBe('One pair is on the board');
    expect(sub('A♠ 5♦', 'K♣ K♥ 7♦ 7♠')).toBe('Both pairs are on the board: your kicker decides');
    // Three pairs: the hand's 7 only plays as the kicker, so one scored pair is on the board.
    expect(sub('A♠ 7♦', 'A♥ 7♣ K♦ K♣ 2♠')).toBe('One pair is on the board');
    expect(sub('7♠ 7♦', '7♣ K♥ 2♦')).toBe('A set: well hidden and strong');
    expect(sub('K♠ 7♦', '7♣ 7♥ 2♦')).toBe('Trips: others may share your card');
    expect(sub('A♠ K♦', '7♣ 7♥ 7♦')).toBe('The three are on the board: everyone has them');
  });

  it('counts the cards used for made hands', () => {
    expect(sub('A♥ 2♣', '3♦ 4♠ 5♥ K♣ Q♦')).toBe('Uses 2 of your cards');
    expect(sub('A♥ 2♠', 'K♥ Q♥ 9♥ 5♥ 3♥')).toBe('Uses 1 of your cards');
    expect(sub('A♠ 2♠', 'K♣ K♥ K♦ K♠ 7♣')).toBe('Uses 1 of your cards');
  });

  it('never derives playsTheBoard from holeUsed (pitfall 10)', () => {
    const info = describe(hole('10♣ 2♦'), cards('A♠ K♦ Q♣ J♥ 10♠'));
    expect(info.playsTheBoard).toBe(true);
    expect(info.holeUsed).toBe(0);
    // A better kicker in hand: the board does not play.
    const kicker = describe(hole('A♣ 3♦'), cards('K♠ K♦ Q♣ Q♥ 2♠'));
    expect(kicker.playsTheBoard).toBe(false);
    expect(kicker.subLabel).toBe('Both pairs are on the board: your kicker decides');
    // Four cards on the board never "play": the hand must use a hole card.
    expect(describe(hole('2♣ 3♦'), cards('A♠ K♦ Q♣ J♥')).playsTheBoard).toBe(false);
  });

  it('prefers hole cards, then the higher suit, when choosing among equal ranks', () => {
    // The kicker 7 could be 7♣ (hand) or 7♦ (board, higher suit): the hand's card is shown.
    const info = describe(hole('A♠ 7♣'), cards('A♥ 7♦ K♦ K♣ 2♠'));
    expect(show(info.best5)).toBe(show(cards('A♠ A♥ K♦ K♣ 7♣')));
    expect(info.holeUsed).toBe(2);
    // Two trips: the pair comes from the hand (7♣ 7♦) even though the board has 7♠.
    const full = describe(hole('7♣ 7♦'), cards('7♠ K♥ K♦ K♠ 2♣'));
    expect(show(full.best5)).toBe(show(cards('K♠ K♥ K♦ 7♦ 7♣')));
    // Among board cards only, the higher suit: 7♠ over 7♦ as the third-pair kicker.
    const board = describe(hole('9♠ 9♦'), cards('8♣ 8♥ 7♦ 7♠ 2♣'));
    expect(show(board.kickers)).toBe(show(cards('7♠')));
  });
});

suite('describe(): input checks', () => {
  it('rejects bad input', () => {
    expect(() => describe(hole('A♠ K♦'), cards('Q♣ J♥'))).toThrow(RangeError);
    expect(() => describe(hole('A♠ K♦'), cards('Q♣ J♥ 10♠ 9♠ 8♠ 7♠'))).toThrow(RangeError);
    expect(() => describe(hole('A♠ K♦'), cards('A♠ J♥ 10♠'))).toThrow(RangeError);
    expect(() => describe([5, 5], [])).toThrow(RangeError);
    expect(() => describe([5, 60], [])).toThrow(RangeError);
  });
});
