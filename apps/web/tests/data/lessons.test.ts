/**
 * Learn's lessons (PLAN §12.1, Appendix F.8; chunk 9.2): seven, in F.8's order, each at most 150
 * words with one card picture; every word is in docs/PLAN.md; and every number a lesson states is
 * right (the evaluator, Appendix C.5's outs table, the pot-odds formula).
 */
import { describe as suite, expect, it } from 'vitest';
import { LESSON_COUNT } from '../../src/app/store.ts';
import { newDeck, parseCard, suitOf, type Card } from '../../src/core/cards.ts';
import { LESSONS, type DiagramGroup, type Lesson } from '../../src/data/lessons.ts';
import { describe } from '../../src/eval/describe.ts';
import { categoryOf, score5 } from '../../src/eval/evaluate.ts';
import { learnWords } from '../../src/i18n/learn.ts';
import {
  checkLessons,
  lessonLines,
  lessonWords,
  MAX_LESSON_WORDS,
} from '../../scripts/copy-rules.ts';

const PLAN = Object.values(
  import.meta.glob<string>('../../../../docs/PLAN.md', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
)[0] as string;

const lesson = (key: Lesson['key']): Lesson => {
  const found = LESSONS.find((l) => l.key === key);
  if (found === undefined) throw new Error(`no lesson ${key}`);
  return found;
};
const cards = (texts: readonly (string | null)[]): Card[] =>
  texts.flatMap((t) => (t === null ? [] : [parseCard(t)]));
const group = (l: Lesson, label: string) => {
  const found = l.diagram.groups.find((g) => g.label === label);
  if (found === undefined) throw new Error(`no group ${label}`);
  return found;
};
/** C(n, k) for small numbers. */
const choose = (n: number, k: number): number => {
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return r;
};
/** Appendix C.5: the chance (%) that at least one of `outs` comes in `cards` cards from `unseen`. */
const hitChance = (outs: number, unseen: number, drawn: number): number =>
  100 * (1 - choose(unseen - outs, drawn) / choose(unseen, drawn));

suite('data/lessons.ts (Appendix F.8)', () => {
  it('has the seven F.8 lessons in order, as many as the store knows', () => {
    expect(LESSONS.map((l) => l.title)).toEqual([
      'The goal',
      'A hand, step by step',
      'Your options',
      'Which hand wins',
      'Position',
      'Pot odds',
      'Outs',
    ]);
    expect(LESSONS).toHaveLength(LESSON_COUNT);
    expect(new Set(LESSONS.map((l) => l.key)).size).toBe(LESSONS.length);
  });

  it('each lesson: at most 150 words, short sentences, whole numbers (check-copy part 4)', () => {
    expect(checkLessons()).toEqual([]);
    for (const l of LESSONS) {
      const words = lessonWords(l);
      expect(words, l.title).toBeLessThanOrEqual(MAX_LESSON_WORDS);
      expect(words, l.title).toBeGreaterThan(30);
    }
  });

  it('the rules catch a long lesson, a long sentence and a decimal number', () => {
    const goal = lesson('goal');
    const long = { ...goal, body: [...goal.body, 'word '.repeat(150).trim()] };
    const sentence = {
      ...goal,
      body: [
        'One two three four five six seven eight nine ten eleven twelve thirteen fourteen x y.',
      ],
    };
    const decimal = { ...goal, body: ['It comes 34.97% of the time.'] };
    expect(checkLessons([long]).join()).toMatch(/words \(at most 150\)/);
    expect(checkLessons([sentence]).join()).toMatch(/a sentence of 16 words/);
    expect(checkLessons([decimal]).join()).toMatch(/a decimal number/);
  });

  it('F.8 is kept: its own sentences are in the lessons', () => {
    const text = (key: Lesson['key']) => lessonLines(lesson(key)).join(' ');
    expect(text('goal')).toContain(
      'Win chips. Have the best 5-card hand at the end, or make everyone else fold.',
    );
    expect(text('goal')).toContain('You get 2 private cards; 5 shared cards come to the middle.');
    expect(text('whichWins')).toContain('Same hand? Higher cards win. Suits never break a tie.');
    expect(text('position')).toContain('Acting last shows you what others did first.');
    expect(text('position')).toContain('The button is the best seat.');
    expect(text('position')).toContain('Play more hands near the button.');
    expect(text('potOdds')).toContain('Need % = the call ÷ (pot + the call).');
    expect(text('potOdds')).toContain(
      'If your win chance is higher, calling wins chips over time.',
    );
    expect(text('outs')).toContain('Outs are cards that improve your hand.');
    expect(lesson('whichWins').link).toBe('rankings');
  });

  it('every line of every lesson is written in docs/PLAN.md (Appendix F.8)', () => {
    // `includes`, not `toContain`: a failure names the line, not the whole plan.
    const missing = LESSONS.flatMap((l) => [l.title, ...lessonLines(l)]).filter(
      (line) => !PLAN.includes(line),
    );
    expect(missing).toEqual([]);
  });

  it('every picture has real cards and never shows one card twice', () => {
    for (const l of LESSONS) {
      expect(l.diagram.groups.length, l.title).toBeGreaterThan(0);
      const shown = l.diagram.groups.flatMap((g) => cards(g.cards));
      expect(new Set(shown).size, l.title).toBe(shown.length);
      for (const g of l.diagram.groups) {
        for (const i of [...(g.core ?? []), ...(g.kickers ?? [])]) {
          expect(g.cards[i], `${l.title} card ${i}`).toBeTypeOf('string');
        }
      }
    }
  });
});

suite('the numbers the lessons state', () => {
  it('lesson 1: the best five have the gold edge, a pair of Kings', () => {
    const l = lesson('goal');
    const hole = cards(group(l, 'Your 2 cards').cards) as [Card, Card];
    const shared = group(l, '5 shared cards');
    const info = describe(hole, cards(shared.cards));
    expect(info.category).toBe('pair');
    expect(info.name).toMatch(/Kings/);
    const marked = (g: DiagramGroup, marks: readonly number[] | undefined): Card[] =>
      cards(g.cards.filter((_, i) => (marks ?? []).includes(i)));
    const own = group(l, 'Your 2 cards');
    const core = [...marked(own, own.core), ...marked(shared, shared.core)].sort();
    const kickers = [...marked(own, own.kickers), ...marked(shared, shared.kickers)].sort();
    expect(core).toEqual([...info.core].sort());
    expect(kickers).toEqual([...info.kickers].sort());
    expect([...core, ...kickers].sort()).toEqual([...info.best5].sort());
  });

  it('lesson 4: both are a pair of Kings and the Ace kicker wins (hand 1, the marked one)', () => {
    const l = lesson('whichWins');
    const one = cards(group(l, 'Hand 1').cards);
    const two = cards(group(l, 'Hand 2').cards);
    expect(categoryOf(score5(one))).toBe('pair');
    expect(categoryOf(score5(two))).toBe('pair');
    expect(score5(one)).toBeGreaterThan(score5(two));
    expect(group(l, 'Hand 1').mark).toBe(true);
  });

  it('lesson 6: need = 20 ÷ (60 + 20) = 25%; a flush draw hits by the river 35% of the time', () => {
    const l = lesson('potOdds');
    expect(l.diagram.price).toEqual({ win: 35, need: 25 });
    expect(Math.round((100 * 20) / (60 + 20))).toBe(25);
    const hole = cards(group(l, 'Your 2 cards').cards);
    const flop = cards(group(l, 'The flop').cards);
    const hearts = [...hole, ...flop].filter((c) => suitOf(c) === 2);
    expect(hearts).toHaveLength(4);
    expect(Math.round(hitChance(13 - 4, 47, 2))).toBe(35);
    expect(l.diagram.caption).toBe('You win more often than you need.');
    expect(learnWords.price(35, 25)).toBe('Win 35% · Need 25%');
  });

  it('lesson 7: the 9 outs are exactly the hearts not seen; C.5 gives 19% and 35%, 54% for 15', () => {
    const l = lesson('outs');
    const seen = [...cards(group(l, 'Your 2 cards').cards), ...cards(group(l, 'The flop').cards)];
    const unseenHearts = newDeck().filter((c) => suitOf(c) === 2 && !seen.includes(c));
    expect([...cards(group(l, 'Your 9 outs').cards)].sort()).toEqual([...unseenHearts].sort());
    expect(unseenHearts).toHaveLength(9);
    // Appendix C.5: 9 outs, 19.1% for the turn, 35.0% by the river; the rule says 18 and 36.
    expect(Math.round(hitChance(9, 47, 1))).toBe(19);
    expect(Math.round(hitChance(9, 47, 2))).toBe(35);
    // 15 outs: 54.1% by the river; the rule of 4 says 60.
    expect(Math.round(hitChance(15, 47, 2))).toBe(54);
    const text = lessonLines(l).join(' ');
    expect(text).toContain('With 9 outs it says 18% and 36%. The exact numbers are 19% and 35%.');
    expect(text).toContain('With 15 outs it says 60%, but the truth is 54%.');
  });
});
