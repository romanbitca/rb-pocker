// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { en } from '../../../src/i18n/en.ts';
import { Board } from '../../../src/ui/components/Board.tsx';
import { Pot, sidePotLine } from '../../../src/ui/components/Pot.tsx';
import { card } from '../../helpers/cards.ts';

afterEach(cleanup);

describe('Board (PLAN §12.3)', () => {
  it('always has five slots: dealt cards, then dashed empty slots', () => {
    const { container } = render(
      <Board
        cards={[{ card: card('Qh') }, { card: card('7h') }, { card: card('2c') }]}
        card={{ w: 40, h: 56 }}
      />,
    );
    const board = screen.getByRole('group', { name: en.board.label });
    expect(board.children).toHaveLength(5);
    expect(screen.getAllByRole('img').map((c) => c.getAttribute('aria-label'))).toEqual([
      'Queen of hearts',
      'Seven of hearts',
      'Two of clubs',
    ]);
    expect(board.querySelectorAll(':scope > [aria-hidden="true"]')).toHaveLength(2);
    expect(container.querySelectorAll('[role="img"]')).toHaveLength(3);
  });

  it('sizes its cards from the geometry and passes highlights on', () => {
    render(
      <Board
        cards={[
          { card: card('Ah'), highlight: 'core' },
          { card: card('2c'), highlight: 'off' },
        ]}
        card={{ w: 37, h: 52 }}
        place={{ x: 72, y: 173, w: 201, h: 52 }}
      />,
    );
    const board = screen.getByRole('group');
    expect(board.style.getPropertyValue('--board-card-w')).toBe('37px');
    expect(board.style.getPropertyValue('--board-card-h')).toBe('52px');
    expect([board.style.left, board.style.top]).toEqual(['72px', '173px']);
    const [a, b] = screen.getAllByRole('img');
    expect(a?.className).toMatch(/core/);
    expect(b?.className).toMatch(/off/);
  });
});

describe('Pot (PLAN §12.3)', () => {
  it('shows the pot with thousands separators', () => {
    render(<Pot pot={{ total: 2340, pots: [2340] }} />);
    expect(screen.getByText('Pot 2,340')).toBeTruthy();
  });

  it('adds the main and side pots once there are side pots', () => {
    render(<Pot pot={{ total: 700, pots: [300, 400] }} />);
    expect(screen.getByText('Pot 700')).toBeTruthy();
    expect(screen.getByText('Main 300 · Side 400')).toBeTruthy();
    expect(sidePotLine([300, 400, 1200])).toBe('Main 300 · Side 400 · Side 1,200');
    expect(sidePotLine([300])).toBeNull();
  });

  it('is empty between hands', () => {
    const { container } = render(<Pot pot={{ total: 0, pots: [] }} />);
    expect(container.innerHTML).toBe('');
  });
});
