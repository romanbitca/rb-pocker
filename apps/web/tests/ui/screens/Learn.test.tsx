// @vitest-environment jsdom
// Learn's pages (PLAN §12.1, §12.12, §13.2, Appendix F.8–F.10; chunk 9.2): the list of lessons and
// the ways on, a lesson with its Next, the full-page hand rankings with "Which hand wins?", and the
// searchable glossary. Headings, landmarks, names and tap targets (≥ 44 px).
import '../../../src/ui/styles/tokens.css';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LESSONS } from '../../../src/data/lessons.ts';
import { enCoach } from '../../../src/i18n/enCoach.ts';
import { en } from '../../../src/i18n/en.ts';
import {
  GlossaryPage,
  HandRankingsPage,
  LearnIndex,
  LessonPage,
} from '../../../src/ui/screens/Learn.tsx';
import styles from '../../../src/ui/screens/Screen.module.css';
import { controlCount, cssClass, smallTargets } from './targets.ts';

afterEach(cleanup);

// Role queries over a whole page take up to a second in jsdom here, more on a busy machine.

const PRIMARY = cssClass(styles, 'primary');
const isPrimary = (el: Element): boolean => el.classList.contains(PRIMARY);
const heading = (): HTMLElement => screen.getByRole('heading', { level: 1 });

function renderIndex(extra: Partial<Parameters<typeof LearnIndex>[0]> = {}) {
  const props = {
    onBack: vi.fn(),
    onOpenLesson: vi.fn(),
    onOpenRankings: vi.fn(),
    onOpenGlossary: vi.fn(),
    ...extra,
  };
  return { ...props, ...render(<LearnIndex {...props} />) };
}

function renderLesson(n: number) {
  const props = {
    n,
    onBack: vi.fn(),
    onOpenLesson: vi.fn(),
    onOpenList: vi.fn(),
    onOpenRankings: vi.fn(),
  };
  return { ...props, ...render(<LessonPage {...props} />) };
}

describe('LearnIndex', () => {
  it('a main landmark with the heading "Learn", Back, the 7 lessons in order, then More', () => {
    const { onBack, onOpenLesson } = renderIndex();
    expect(screen.getByRole('main')).toBeTruthy();
    expect(heading().textContent).toBe('Learn');
    // The heading takes the focus (§12.12: a new screen is announced).
    expect(document.activeElement).toBe(heading());
    const lessons = within(screen.getByRole('region', { name: 'Lessons' })).getAllByRole('button');
    expect(lessons.map((b) => b.getAttribute('aria-label'))).toEqual(
      LESSONS.map((l, i) => `Lesson ${i + 1}: ${l.title}`),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Lesson 3: Your options' }));
    expect(onOpenLesson).toHaveBeenCalledWith(3);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  }, 15_000);

  it('More: the hand rankings and the glossary; the hand drill only once it is given', () => {
    const { onOpenRankings, onOpenGlossary } = renderIndex();
    const more = screen.getByRole('region', { name: 'More' });
    expect(
      within(more)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual([
      'Poker hands Best at the top. Tap a hand to see more.',
      'Glossary Poker words in plain English.',
    ]);
    expect(screen.queryByRole('button', { name: 'Practise the 10 hands' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Poker hands/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Glossary/ }));
    expect(onOpenRankings).toHaveBeenCalledTimes(1);
    expect(onOpenGlossary).toHaveBeenCalledTimes(1);

    cleanup();
    const onOpenDrill = vi.fn();
    renderIndex({ onOpenDrill });
    fireEvent.click(screen.getByRole('button', { name: 'Practise the 10 hands' }));
    expect(onOpenDrill).toHaveBeenCalledTimes(1);
  }, 15_000);

  it('every control is at least 44×44 px (§12.12)', () => {
    const { container } = renderIndex({ onOpenDrill: () => {} });
    expect(controlCount(container)).toBe(1 + 7 + 3);
    expect(smallTargets(container, isPrimary)).toEqual([]);
  }, 15_000);
});

describe('LessonPage', () => {
  it('"Lesson 3 of 7", the lesson as the heading, its picture and text, Next to lesson 4', () => {
    const { onOpenLesson, onOpenList } = renderLesson(3);
    expect(heading().textContent).toBe('Your options');
    expect(document.activeElement).toBe(heading());
    expect(screen.getByText('Lesson 3 of 7')).toBeTruthy();
    expect(screen.getByRole('figure')).toBeTruthy();
    expect(screen.getByText('Give up the hand.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'See all poker hands' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next: Which hand wins' }));
    expect(onOpenLesson).toHaveBeenCalledWith(4);
    expect(onOpenList).not.toHaveBeenCalled();
    expect(document.querySelector('main')?.getAttribute('data-lesson')).toBe('options');
  }, 15_000);

  it('lesson 4 opens the full-page hand rankings', () => {
    const { onOpenRankings } = renderLesson(4);
    fireEvent.click(screen.getByRole('button', { name: 'See all poker hands' }));
    expect(onOpenRankings).toHaveBeenCalledTimes(1);
  }, 15_000);

  it('the last lesson leads back to the list', () => {
    const { onOpenList, onOpenLesson } = renderLesson(7);
    expect(heading().textContent).toBe('Outs');
    expect(screen.queryByRole('button', { name: /^Next/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'All lessons' }));
    expect(onOpenList).toHaveBeenCalledTimes(1);
    expect(onOpenLesson).not.toHaveBeenCalled();
  }, 15_000);

  it('a lesson number out of range shows lesson 1', () => {
    renderLesson(99);
    expect(heading().textContent).toBe('The goal');
    expect(screen.getByText('Lesson 1 of 7')).toBeTruthy();
  }, 15_000);

  it('Next shows the new lesson from the top, its heading focused', () => {
    const props = { onBack() {}, onOpenLesson() {}, onOpenList() {}, onOpenRankings() {} };
    const { rerender } = render(<LessonPage n={1} {...props} />);
    (screen.getByRole('button', { name: /^Next/ }) as HTMLElement).focus();
    rerender(<LessonPage n={2} {...props} />);
    expect(heading().textContent).toBe('A hand, step by step');
    expect(document.activeElement).toBe(heading());
  }, 15_000);

  it('every lesson: controls at least 44×44 px (Next is a 56 px primary button)', () => {
    LESSONS.forEach((_, i) => {
      const { container, unmount } = renderLesson(i + 1);
      expect(smallTargets(container, isPrimary), `lesson ${i + 1}`).toEqual([]);
      unmount();
    });
  }, 15_000);
});

describe('HandRankingsPage', () => {
  it('the ten rows of the rankings panel, no hand highlighted, row details on a tap', () => {
    render(<HandRankingsPage onBack={() => {}} />);
    expect(heading().textContent).toBe('Poker hands');
    const rows = document.querySelectorAll('li[data-category]');
    expect(rows).toHaveLength(10);
    expect(document.querySelectorAll('[aria-current="true"]')).toHaveLength(0);
    const first = within(rows[0] as HTMLElement).getByRole('button');
    fireEvent.click(first);
    expect(first.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/It cannot be beaten/)).toBeTruthy();
    for (const line of en.rankings.footer) expect(screen.getByText(line)).toBeTruthy();
  }, 15_000);

  it('"Which hand wins?" is always there and opens the quiz in place', async () => {
    render(<HandRankingsPage onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Which hand wins?' }));
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    const quiz = await screen.findByRole('region', { name: 'Which hand wins?' });
    const hands = within(quiz).getAllByRole('button', { name: /^(First|Second) hand:/ });
    expect(hands).toHaveLength(2);
    fireEvent.click(hands[0] as HTMLElement);
    expect(within(quiz).getByRole('status').textContent).toMatch(/^(Right!|Not this time\.) /);
    expect(within(quiz).getByText(/^\d+ of \d+ right$/)).toBeTruthy();
  }, 15_000);

  it('every control is at least 44×44 px', () => {
    const { container } = render(<HandRankingsPage onBack={() => {}} />);
    expect(smallTargets(container, isPrimary)).toEqual([]);
  }, 15_000);
});

describe('GlossaryPage', () => {
  const rows = (): string[] =>
    [...document.querySelectorAll('dt')].map((dt) => dt.textContent ?? '');

  it('every F.9 row, then a search that narrows them and says how many match', () => {
    render(<GlossaryPage onBack={() => {}} />);
    expect(heading().textContent).toBe('Glossary');
    expect(rows()).toEqual(enCoach.glossary.map((g) => g.term));
    expect(screen.getByText('A side card that breaks ties between equal hands.')).toBeTruthy();

    const search = screen.getByRole('searchbox', { name: 'Find a word' });
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('');
    fireEvent.change(search, { target: { value: 'kicker' } });
    expect(rows()).toEqual(['kicker']);
    expect(status.textContent).toBe('1 word');
    fireEvent.change(search, { target: { value: 'draw' } });
    expect(rows().slice(0, 1)).toEqual(['draw']);
    expect(status.textContent).toBe(`${rows().length} words`);
    fireEvent.change(search, { target: { value: 'qqq' } });
    expect(rows()).toEqual([]);
    expect(status.textContent).toBe('No words match.');
    fireEvent.change(search, { target: { value: '' } });
    expect(rows()).toHaveLength(enCoach.glossary.length);
  }, 15_000);

  it('the search field is a 16 px, 44 px tall control with a visible label', () => {
    const { container } = render(<GlossaryPage onBack={() => {}} />);
    expect(screen.getByText('Find a word').tagName).toBe('LABEL');
    expect(smallTargets(container, isPrimary)).toEqual([]);
    const field = screen.getByRole('searchbox');
    expect(getComputedStyle(field).fontSize).toBe('16px');
  }, 15_000);
});
