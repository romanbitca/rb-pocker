import { describe, expect, it } from 'vitest';
import {
  cardAriaLabel,
  classCards,
  classCombos,
  classOf,
  className,
  formatCard,
  formatCards,
  isCard,
  makeCard,
  newDeck,
  parseCard,
  parseCards,
  rankLabel,
  rankOf,
  suitOf,
  type Suit,
} from '../../src/core/cards.ts';

const RANKS = '23456789TJQKA';
const SUITS = 'cdhs';
const ALL_TEXT = [...RANKS].flatMap((r) => [...SUITS].map((s) => r + s));

describe('card encoding (PLAN §0.3)', () => {
  it('is rank * 4 + suit, with clubs, diamonds, hearts, spades', () => {
    expect(parseCard('2c')).toBe(0);
    expect(parseCard('2d')).toBe(1);
    expect(parseCard('2h')).toBe(2);
    expect(parseCard('2s')).toBe(3);
    expect(parseCard('Tc')).toBe(32);
    expect(parseCard('Ah')).toBe(50);
    expect(parseCard('As')).toBe(51);
    expect(rankOf(50)).toBe(12);
    expect(suitOf(50)).toBe(2);
    expect(makeCard(12, 2)).toBe(50);
  });

  it('round-trips all 52 cards through parse and format', () => {
    expect(ALL_TEXT).toHaveLength(52);
    ALL_TEXT.forEach((text, i) => {
      expect(parseCard(text)).toBe(i);
      expect(formatCard(i)).toBe(text);
    });
    for (let c = 0; c < 52; c++) {
      expect(parseCard(formatCard(c))).toBe(c);
      expect(makeCard(rankOf(c), suitOf(c))).toBe(c);
    }
  });

  it('accepts "10" as the Ten and formats it as "T"', () => {
    for (const s of SUITS) expect(parseCard(`10${s}`)).toBe(parseCard(`T${s}`));
    expect(formatCard(parseCard('10h'))).toBe('Th');
  });

  it('round-trips card lists', () => {
    expect(parseCards('Ah Kd 10c')).toEqual([50, 45, 32]);
    expect(parseCards('  Ah\tKd  ')).toEqual([50, 45]);
    expect(parseCards('')).toEqual([]);
    expect(formatCards([50, 45, 32])).toBe('Ah Kd Tc');
    expect(parseCards(formatCards(newDeck()))).toEqual(newDeck());
  });

  it('rejects anything that is not a card', () => {
    for (const bad of [
      '',
      'A',
      'Ahh',
      '1h',
      '11h',
      '0h',
      'AH',
      'ah',
      'tc',
      'Ax',
      ' Ah',
      'Ah ',
      'A♥',
    ]) {
      expect(() => parseCard(bad), bad).toThrow(RangeError);
    }
    for (const bad of [-1, 52, 1.5, Number.NaN]) {
      expect(() => formatCard(bad), String(bad)).toThrow(RangeError);
      expect(isCard(bad)).toBe(false);
    }
    expect(isCard(0)).toBe(true);
    expect(isCard(51)).toBe(true);
    expect(isCard('0')).toBe(false);
  });

  it('builds a fresh ordered deck', () => {
    const deck = newDeck();
    expect(deck).toEqual(Array.from({ length: 52 }, (_, i) => i));
    deck[0] = 51;
    expect(newDeck()[0]).toBe(0);
  });
});

describe('display: the UI shows "10", never "T" (PLAN §0.3)', () => {
  it('labels card faces 2..10, J, Q, K, A', () => {
    const labels = Array.from({ length: 13 }, (_, r) => rankLabel(r));
    expect(labels).toEqual(['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']);
    expect(rankLabel(rankOf(parseCard('Td')))).toBe('10');
    for (const label of labels) expect(label).not.toContain('T');
    expect(() => rankLabel(13)).toThrow(RangeError);
    expect(() => rankLabel(-1)).toThrow(RangeError);
  });

  it('names cards for screen readers', () => {
    expect(cardAriaLabel(50)).toBe('Ace of hearts');
    expect(cardAriaLabel(parseCard('Tc'))).toBe('Ten of clubs');
    expect(cardAriaLabel(parseCard('2d'))).toBe('Two of diamonds');
    expect(cardAriaLabel(parseCard('Qs'))).toBe('Queen of spades');
    const labels = newDeck().map(cardAriaLabel);
    expect(new Set(labels).size).toBe(52);
    for (const label of labels) {
      expect(label).toMatch(/^[A-Z][a-z]+ of (clubs|diamonds|hearts|spades)$/);
      expect(label).not.toMatch(/\bT\b/);
    }
  });
});

describe('starting-hand classes (PLAN §7.5 grid)', () => {
  it('places pairs on the diagonal, suited above and offsuit below', () => {
    expect(classOf(parseCard('As'), parseCard('Ah'))).toBe(0);
    expect(classOf(parseCard('As'), parseCard('Ks'))).toBe(1);
    expect(classOf(parseCard('As'), parseCard('Kh'))).toBe(13);
    expect(classOf(parseCard('2c'), parseCard('2d'))).toBe(168);
    expect(className(0)).toBe('AA');
    expect(className(1)).toBe('AKs');
    expect(className(13)).toBe('AKo');
    expect(className(168)).toBe('22');
    expect(className(classOf(parseCard('Th'), parseCard('9c')))).toBe('T9o');
    expect(className(classOf(parseCard('9h'), parseCard('Th')))).toBe('T9s');
    expect(className(classOf(parseCard('7c'), parseCard('7s')))).toBe('77');
  });

  it('does not depend on the order of the two cards', () => {
    for (let a = 0; a < 52; a++) {
      for (let b = 0; b < 52; b++) {
        if (a !== b) expect(classOf(a, b)).toBe(classOf(b, a));
      }
    }
  });

  it('covers 169 classes with 6 / 4 / 12 combos (1,326 in total)', () => {
    const combos = new Array<number>(169).fill(0);
    for (let a = 0; a < 52; a++) {
      for (let b = a + 1; b < 52; b++) combos[classOf(a, b)] = (combos[classOf(a, b)] ?? 0) + 1;
    }
    expect(combos.reduce((s, n) => s + n, 0)).toBe(1326);
    const names = new Set<string>();
    for (let idx = 0; idx < 169; idx++) {
      const name = className(idx);
      names.add(name);
      expect(classCombos(idx)).toBe(combos[idx]);
      const row = Math.floor(idx / 13);
      const col = idx % 13;
      if (row === col) {
        expect(name).toMatch(/^([2-9TJQKA])\1$/);
        expect(combos[idx]).toBe(6);
      } else {
        expect(name).toMatch(row < col ? /^[2-9TJQKA]{2}s$/ : /^[2-9TJQKA]{2}o$/);
        expect(combos[idx]).toBe(row < col ? 4 : 12);
        // The higher rank comes first.
        expect(RANKS.indexOf(name.charAt(0))).toBeGreaterThan(RANKS.indexOf(name.charAt(1)));
      }
    }
    expect(names.size).toBe(169);
  });

  it('matches the class name of every two-card combination', () => {
    for (let a = 0; a < 52; a++) {
      for (let b = a + 1; b < 52; b++) {
        const hi = Math.max(rankOf(a), rankOf(b));
        const lo = Math.min(rankOf(a), rankOf(b));
        const suffix = hi === lo ? '' : suitOf(a) === suitOf(b) ? 's' : 'o';
        expect(className(classOf(a, b))).toBe(RANKS.charAt(hi) + RANKS.charAt(lo) + suffix);
      }
    }
  });

  it('rejects bad input', () => {
    expect(() => classOf(5, 5)).toThrow(RangeError);
    expect(() => classOf(-1, 5)).toThrow(RangeError);
    expect(() => className(169)).toThrow(RangeError);
    expect(() => className(-1)).toThrow(RangeError);
    expect(() => classCombos(169)).toThrow(RangeError);
    expect(() => classCombos(0.5)).toThrow(RangeError);
    expect(() => classCards(169)).toThrow(RangeError);
    expect(() => classCards(-1)).toThrow(RangeError);
    expect(() => classCards(1.5)).toThrow(RangeError);
    const suit: Suit = 3;
    expect(suitOf(makeCard(0, suit))).toBe(3);
  });

  it('classCards is the inverse of classOf: a real two-card hand of every class', () => {
    expect(formatCards(classCards(0))).toBe('As Ah');
    expect(formatCards(classCards(1))).toBe('As Ks');
    expect(formatCards(classCards(13))).toBe('As Kh');
    expect(formatCards(classCards(168))).toBe('2s 2h');
    for (let idx = 0; idx < 169; idx++) {
      const [a, b] = classCards(idx);
      expect(a).not.toBe(b);
      expect(classOf(a, b)).toBe(idx);
      expect(rankOf(a)).toBeGreaterThanOrEqual(rankOf(b)); // the higher card first
    }
  });
});
