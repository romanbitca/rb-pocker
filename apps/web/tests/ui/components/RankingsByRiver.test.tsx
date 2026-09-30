// @vitest-environment jsdom
/**
 * The rankings panel's "By river" column (PLAN §6.6, §13.2): one cell per row while the hero
 * plays a hand, "—" for 0, empty while the analysis is on its way, its header explained on a tap,
 * and the cell in each row's screen-reader label.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { describe as describeHand } from '../../../src/eval/describe.ts';
import { en } from '../../../src/i18n/en.ts';
import { RankingsList } from '../../../src/ui/components/RankingsList.tsx';
import { heroHandView } from '../../../src/ui/rankings.ts';
import type { HeroHandView } from '../../../src/ui/views.ts';
import { cards, hole } from '../../helpers/cards.ts';

afterEach(cleanup);

function view(holeText: string, boardText: string): HeroHandView {
  const h = hole(holeText);
  return heroHandView(describeHand(h, cards(boardText)), h, false, 1);
}

const exactly = {
  highCard: 17.4,
  pair: 43.8,
  twoPair: 23.5,
  trips: 4.8,
  straight: 4.6,
  flush: 3.0,
  fullHouse: 2.6,
  quads: 0.17,
  straightFlush: 0.028,
  royalFlush: 0,
} as const;

const cells = (root: HTMLElement): string[] =>
  [...root.querySelectorAll('[data-by-river]')].map((c) => c.textContent ?? '');

describe('RankingsList "By river" column', () => {
  it('none without a hand being played (and no column headers then)', () => {
    const { container } = render(<RankingsList hero={null} cardSize="sm" />);
    expect(cells(container)).toEqual([]);
    expect(screen.queryByText(en.rankings.howOften)).toBeNull();
    expect(screen.queryByRole('button', { name: en.rankings.byRiver })).toBeNull();
  });

  it('one cell per row, strongest first: "—" for 0, "<1%" for a tiny chance', () => {
    const { container } = render(
      <RankingsList hero={view('A♥ K♥', '')} cardSize="sm" byRiver={{ handSeq: 1, exactly }} />,
    );
    expect(cells(container)).toEqual([
      '—',
      '<1%',
      '<1%',
      '3%',
      '3%',
      '5%',
      '5%',
      '24%',
      '44%',
      '17%',
    ]);
    expect(screen.getByText(en.rankings.howOften)).toBeTruthy();
    const row = container.querySelector('li[data-category="pair"] button') as HTMLElement;
    expect(row.getAttribute('aria-label')).toContain('By river: 44%.');
  });

  it('on the river only the made hand has a number: "100%"', () => {
    const river = { ...exactly, highCard: 0, pair: 0, twoPair: 100, trips: 0, straight: 0 };
    const zero = { flush: 0, fullHouse: 0, quads: 0, straightFlush: 0, royalFlush: 0 };
    const { container } = render(
      <RankingsList
        hero={view('A♥ K♥', 'A♠ K♣ 7♦ 3♥ 2♠')}
        cardSize="sm"
        byRiver={{ handSeq: 1, exactly: { ...river, ...zero } }}
      />,
    );
    expect(cells(container)).toEqual(['—', '—', '—', '—', '—', '—', '—', '100%', '—', '—']);
  });

  it('empty cells while the analysis is on its way', () => {
    const { container } = render(
      <RankingsList
        hero={view('A♥ K♥', '')}
        cardSize="md"
        byRiver={{ handSeq: 1, exactly: null }}
      />,
    );
    expect(cells(container)).toEqual(new Array<string>(10).fill(''));
  });

  it('its header explains it on a tap', () => {
    render(
      <RankingsList hero={view('A♥ K♥', '')} cardSize="sm" byRiver={{ handSeq: 1, exactly }} />,
    );
    const header = screen.getByRole('button', { name: en.rankings.byRiver });
    expect(screen.queryByText(en.rankings.byRiverInfo)).toBeNull();
    fireEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(en.rankings.byRiverInfo)).toBeTruthy();
  });
});
