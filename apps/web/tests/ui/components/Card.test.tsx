// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { cardAriaLabel, newDeck, rankLabel, rankOf, suitOf } from '../../../src/core/cards.ts';
import { en } from '../../../src/i18n/en.ts';
import { Card, type CardSize } from '../../../src/ui/components/Card.tsx';
import { SUIT_SYMBOLS } from '../../../src/ui/components/SvgSprite.tsx';
import { card } from '../../helpers/cards.ts';

afterEach(cleanup);

const SIZES: CardSize[] = ['xs', 'sm', 'md', 'lg', 'xl', 'xxl', 'board'];
const CARD_NAME =
  /\b(Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|Jack|Queen|King|Ace) of (clubs|diamonds|hearts|spades)\b/;

describe('Card (PLAN §13.4)', () => {
  it('shows every card with its rank text, its sprite suit and its name', () => {
    for (const c of newDeck()) {
      const { container, unmount } = render(<Card card={c} size="sm" />);
      const el = screen.getByRole('img');
      expect(el.getAttribute('aria-label')).toBe(cardAriaLabel(c));
      expect(el.textContent).toBe(rankLabel(rankOf(c)));
      const uses = [...container.querySelectorAll('use')].map((u) => u.getAttribute('href'));
      expect(uses).toEqual([`#${SUIT_SYMBOLS[suitOf(c)]}`]);
      unmount();
    }
  });

  it('writes "10", never "T"', () => {
    render(<Card card={card('Th')} size="board" />);
    const el = screen.getByRole('img', { name: 'Ten of hearts' });
    expect(el.textContent).toBe('10');
    expect(el.textContent).not.toContain('T');
  });

  it('adds the big corner suit on the larger sizes only', () => {
    for (const size of SIZES) {
      const { container, unmount } = render(<Card card={card('Kd')} size={size} />);
      const expected = size === 'xs' || size === 'sm' || size === 'md' ? 1 : 2;
      expect(container.querySelectorAll('use'), size).toHaveLength(expected);
      unmount();
    }
  });

  it('draws a face-down card with no rank, no suit and a neutral label', () => {
    for (const size of SIZES) {
      const { container, unmount } = render(<Card card={null} size={size} />);
      const el = screen.getByRole('img');
      expect(el.getAttribute('aria-label')).toBe(en.cards.hidden);
      expect(el.textContent).toBe('');
      expect(container.querySelector('use, svg')).toBeNull();
      expect(container.innerHTML).not.toMatch(CARD_NAME);
      unmount();
    }
  });

  it('renders the same markup for every face-down card of a size', () => {
    const a = render(<Card card={null} size="xs" />).container.innerHTML;
    cleanup();
    const b = render(<Card card={null} size="xs" />).container.innerHTML;
    expect(a).toBe(b);
  });

  it('marks highlights, dimmed kickers and used cards with classes', () => {
    const { container } = render(
      <>
        <Card card={card('Ah')} size="board" highlight="core" />
        <Card card={card('Kh')} size="board" highlight="kicker" />
        <Card card={card('2c')} size="board" highlight="off" />
        <Card card={card('Qs')} size="sm" dim />
        <Card card={card('Js')} size="sm" used />
      </>,
    );
    const classes = [...container.querySelectorAll('[role="img"]')].map((e) => e.className);
    expect(classes[0]).toMatch(/core/);
    expect(classes[1]).toMatch(/kicker/);
    expect(classes[2]).toMatch(/off/);
    expect(classes[3]).toMatch(/dim/);
    expect(classes[4]).toMatch(/used/);
  });
});
