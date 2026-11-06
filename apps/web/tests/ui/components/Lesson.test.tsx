// @vitest-environment jsdom
// The lesson renderer (PLAN §12.1, Appendix F.8, §12.12, §13.4; chunk 9.2): a lesson's card picture
// (RB's `Card`s, never Unicode suits; dimmed cards said to not count; face-down cards hidden; the
// row the picture is about outlined), lesson 6's price bar, and the text blocks.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LESSONS, type Lesson } from '../../../src/data/lessons.ts';
import { LessonPicture, LessonView } from '../../../src/ui/components/Lesson.tsx';

afterEach(cleanup);

// Role queries over a whole page take up to a second in jsdom here, more on a busy machine.

const SUITS = /[♠-♧]/u;

const lesson = (key: Lesson['key']): Lesson => {
  const found = LESSONS.find((l) => l.key === key);
  if (found === undefined) throw new Error(`no lesson ${key}`);
  return found;
};
const names = (root: HTMLElement): string[] =>
  within(root)
    .getAllByRole('img')
    .map((el) => el.getAttribute('aria-label') ?? '');

describe('LessonPicture', () => {
  it('a figure named by its line: one group per row, each card named, dimmed ones "do not count"', () => {
    const { container } = render(<LessonPicture diagram={lesson('goal').diagram} />);
    const figure = screen.getByRole('figure', {
      name: 'Your best 5 cards make a pair of Kings. The dim cards do not count.',
    });
    expect(figure.hasAttribute('data-examples')).toBe(true);
    const mine = screen.getByRole('group', { name: 'Your 2 cards' });
    expect(names(mine)).toEqual(['Ace of hearts', 'King of diamonds']);
    const shared = screen.getByRole('group', { name: '5 shared cards' });
    expect(names(shared)).toEqual([
      'King of spades',
      'Nine of hearts',
      'Five of clubs, does not count',
      'Two of diamonds, does not count',
      'Jack of spades',
    ]);
    // RB's cards: one element each, the suit a CSS mask, the rank as text ("10", never "T").
    expect(container.querySelectorAll('[data-suit]')).toHaveLength(7);
    expect(SUITS.test(container.innerHTML)).toBe(false);
  }, 15_000);

  it('face-down cards are hidden cards; the row it is about is marked (and named by its label)', () => {
    render(<LessonPicture diagram={lesson('position').diagram} />);
    const button = screen.getByRole('group', { name: 'Button: acts last' });
    expect(names(button)).toEqual(['Hidden card', 'Hidden card']);
    expect(button.hasAttribute('data-mark')).toBe(true);
    expect(
      screen.getByRole('group', { name: 'Small blind: acts first' }).hasAttribute('data-mark'),
    ).toBe(false);
    expect(document.querySelectorAll('[data-suit]')).toHaveLength(0);
  }, 15_000);

  it('lesson 6: the price bar is an image named by both numbers, with them written under it', () => {
    render(<LessonPicture diagram={lesson('potOdds').diagram} />);
    const bar = screen.getByRole('img', { name: 'Win chance 35%. Need 25%.' });
    expect(bar.getAttribute('data-good')).toBe('true');
    expect(bar.style.getPropertyValue('--win')).toBe('0.35');
    expect(bar.style.getPropertyValue('--need')).toBe('0.25');
    expect(screen.getByText('Win 35% · Need 25%')).toBeTruthy();
    expect(screen.getByText('You win more often than you need.')).toBeTruthy();
  }, 15_000);

  it('lesson 7: the nine outs in one marked row', () => {
    render(<LessonPicture diagram={lesson('outs').diagram} />);
    const outs = screen.getByRole('group', { name: 'Your 9 outs' });
    expect(names(outs)).toHaveLength(9);
    expect(names(outs).every((n) => n.endsWith('of hearts'))).toBe(true);
    expect(outs.hasAttribute('data-mark')).toBe(true);
  }, 15_000);
});

describe('LessonView', () => {
  it('draws the picture first, then paragraphs, numbered steps, a plain list and terms', () => {
    const { container } = render(
      <LessonView
        lesson={{
          key: 'goal',
          title: 'Test',
          diagram: { groups: [{ label: 'Row', cards: ['As'] }], caption: 'Line.' },
          body: [
            'A paragraph.',
            { steps: ['First.', 'Second.'] },
            { points: ['A point.'] },
            { terms: [['Fold', 'Give up the hand.']] },
          ],
        }}
      />,
    );
    const children = [...container.children].map((el) => el.tagName);
    expect(children).toEqual(['FIGURE', 'P', 'OL', 'UL', 'DL']);
    expect(
      within(container.querySelector('ol') as HTMLElement).getAllByRole('listitem'),
    ).toHaveLength(2);
    expect(container.querySelector('dt')?.textContent).toBe('Fold');
    expect(container.querySelector('dd')?.textContent).toBe('Give up the hand.');
  }, 15_000);

  it('every lesson renders: its picture, all its text, and no Unicode suit', () => {
    for (const l of LESSONS) {
      const { container, unmount } = render(<LessonView lesson={l} />);
      expect(container.querySelector('figure figcaption')?.textContent, l.title).toBe(
        l.diagram.caption,
      );
      for (const block of l.body) {
        const lines =
          typeof block === 'string'
            ? [block]
            : 'steps' in block
              ? block.steps
              : 'points' in block
                ? block.points
                : block.terms.map(([, meaning]) => meaning);
        for (const line of lines) expect(container.textContent, l.title).toContain(line);
      }
      expect(SUITS.test(container.innerHTML), l.title).toBe(false);
      unmount();
    }
  }, 15_000);
});
