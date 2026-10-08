// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cardAriaLabel,
  newDeck,
  rankLabel,
  rankOf,
  SUIT_CHARS,
  suitOf,
} from '../../../src/core/cards.ts';
import { en } from '../../../src/i18n/en.ts';
import { Card, type CardSize } from '../../../src/ui/components/Card.tsx';
import { SUIT_SYMBOLS } from '../../../src/ui/components/SvgSprite.tsx';
import { card } from '../../helpers/cards.ts';

afterEach(cleanup);

const SIZES: CardSize[] = ['xs', 'sm', 'md', 'lg', 'xl', 'xxl', 'board'];
const CARD_NAME =
  /\b(Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|Jack|Queen|King|Ace) of (clubs|diamonds|hearts|spades)\b/;

const raw = (files: Record<string, unknown>): string => String(Object.values(files)[0]);
const CARD_CSS = raw(
  import.meta.glob('../../../src/ui/components/Card.module.css', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
);
const SPRITE = raw(
  import.meta.glob('../../../src/ui/components/SvgSprite.tsx', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
);

describe('Card (PLAN §13.4)', () => {
  it('shows every card with its rank text, its suit and its name, in one element', () => {
    for (const c of newDeck()) {
      const { container, unmount } = render(<Card card={c} size="sm" />);
      const el = screen.getByRole('img');
      expect(el.getAttribute('aria-label')).toBe(cardAriaLabel(c));
      expect(el.textContent).toBe(rankLabel(rankOf(c)));
      expect(el.getAttribute('data-suit')).toBe(SUIT_CHARS[suitOf(c)]);
      // §15.3: no child elements; the suit is the CSS mask of its suit class.
      expect(el.children).toHaveLength(0);
      expect(container.querySelectorAll('*')).toHaveLength(1);
      unmount();
    }
  });

  it('masks each suit with the sprite path of that suit (one source of shapes, pitfall 31)', () => {
    const suits = ['clubs', 'diamonds', 'hearts', 'spades'] as const;
    suits.forEach((name, suit) => {
      const symbol = new RegExp(`<symbol id="${SUIT_SYMBOLS[suit]}"[\\s\\S]*?d="([^"]+)"`).exec(
        SPRITE,
      );
      const rule = new RegExp(`\\.${name} \\{[^}]*--suit-mask: url\\("([^"]+)"\\)`).exec(CARD_CSS);
      expect(symbol?.[1], name).toBeDefined();
      expect(rule?.[1], name).toContain(`d='${symbol?.[1] ?? ''}'`);
    });
  });

  it('writes "10", never "T"', () => {
    render(<Card card={card('Th')} size="board" />);
    const el = screen.getByRole('img', { name: 'Ten of hearts' });
    expect(el.textContent).toBe('10');
    expect(el.textContent).not.toContain('T');
  });

  it('adds the big corner pip on the larger sizes only (their corner layout)', () => {
    // The pip is the corner layout's `::before` (Card.module.css); the index-only sizes have none.
    expect(CARD_CSS).toMatch(/\.corner::before \{\s*position: absolute;/);
    for (const size of SIZES) {
      const { unmount } = render(<Card card={card('Kd')} size={size} />);
      const el = screen.getByRole('img');
      const small = size === 'xs' || size === 'sm' || size === 'md';
      expect(el.className, size).toMatch(small ? /indexOnly/ : /corner/);
      expect(el.className, size).not.toMatch(small ? /corner/ : /indexOnly/);
      expect(el.children, size).toHaveLength(0);
      unmount();
    }
  });

  it('draws a face-down card with no rank, no suit and a neutral label', () => {
    for (const size of SIZES) {
      const { container, unmount } = render(<Card card={null} size={size} />);
      const el = screen.getByRole('img');
      expect(el.getAttribute('aria-label')).toBe(en.cards.hidden);
      expect(el.textContent).toBe('');
      expect(el.hasAttribute('data-suit')).toBe(false);
      expect(el.className).not.toMatch(/face|clubs|diamonds|hearts|spades/);
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
