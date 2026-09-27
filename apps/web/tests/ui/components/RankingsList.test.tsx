// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe as suite, expect, it } from 'vitest';
import { cardAriaLabel, type Card } from '../../../src/core/cards.ts';
import { RANKINGS } from '../../../src/data/rankings.ts';
import { describe } from '../../../src/eval/describe.ts';
import { en } from '../../../src/i18n/en.ts';
import { RankingsList } from '../../../src/ui/components/RankingsList.tsx';
import { heroHandView } from '../../../src/ui/rankings.ts';
import type { HeroHandView } from '../../../src/ui/views.ts';
import { cards, hole } from '../../helpers/cards.ts';
import { testSeed } from '../../helpers/seed.ts';
import { HandSource } from '../../eval/hands.ts';

afterEach(cleanup);

/** The highlighted rows (there must be exactly one while a hand runs). */
const current = (root: HTMLElement): HTMLElement[] => [
  ...root.querySelectorAll<HTMLElement>('li[aria-current="true"]'),
];

/** The card names on the "You" line of the highlighted row. */
function youCards(row: HTMLElement): string[] {
  const line = within(row).getByText(en.rankings.yourCards).parentElement as HTMLElement;
  return within(line)
    .getAllByRole('img')
    .map((c) => c.getAttribute('aria-label') ?? '');
}

function view(holeText: string, boardText: string, folded = false): HeroHandView {
  const h = hole(holeText);
  return heroHandView(describe(h, cards(boardText)), h, folded, 1);
}

suite('RankingsList live highlight (Stage 3 acceptance 4)', () => {
  it('over 200 random seeded hands: the highlighted row is describe().category and "You" shows the actual best five', () => {
    const src = new HandSource(testSeed('5eed0000000000000000000000000004'));
    const { container, rerender } = render(<RankingsList hero={null} cardSize="sm" />);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const boardSize = [0, 3, 4, 5][src.int(4)] as number;
      const dealt = i % 2 === 0 ? src.biased(2 + boardSize) : src.uniform(2 + boardSize);
      const h: [Card, Card] = [dealt[0] as Card, dealt[1] as Card];
      const board = dealt.slice(2);
      const info = describe(h, board);
      rerender(<RankingsList hero={heroHandView(info, h, false, i)} cardSize="sm" />);

      const rows = current(container);
      expect(rows, `hand ${i}`).toHaveLength(1);
      const row = rows[0] as HTMLElement;
      expect(row.dataset.category, `hand ${i}`).toBe(info.category);
      const shown = board.length === 0 ? h : info.best5;
      expect(youCards(row), `hand ${i}`).toEqual(shown.map(cardAriaLabel));
      // Every other row says whether it beats the hero or not.
      const index = RANKINGS.findIndex((r) => r.key === info.category);
      container.querySelectorAll<HTMLElement>('li[data-category]').forEach((li, j) => {
        if (j === index) return;
        expect(li.textContent).toContain(j < index ? en.rankings.beatsYou : en.rankings.youBeat);
      });
      seen.add(info.category);
    }
    expect(seen.size).toBeGreaterThanOrEqual(8); // the small-deck samples reach the rare rows
  });

  it('highlights every one of the ten rows for a hand of that category', () => {
    const hands: [string, string][] = [
      ['Ah Kh', 'Qh Jh Th 2c 3d'],
      ['9s 8s', '7s 6s 5s Kd 2c'],
      ['Qc Qd', 'Qh Qs 7d 2c 3h'],
      ['Ks Kh', 'Kd 4c 4h 9s 2d'],
      ['Ad Jd', '8d 5d 2d Kc 3s'],
      ['Tc 9d', '8s 7h 6c Kd 2s'],
      ['7s 7h', '7c Kd 2s 9h 4d'],
      ['Jh Jc', '5s 5d Ac 8h 3d'],
      ['Th Ts', 'Kc 6d 3h 9s 2c'],
      ['Ac Qd', '9s 6h 3c 2d 8h'],
    ];
    const { container, rerender } = render(<RankingsList hero={null} cardSize="md" />);
    hands.forEach(([h, b], i) => {
      rerender(<RankingsList hero={view(h, b)} cardSize="md" />);
      expect(current(container).map((r) => r.dataset.category)).toEqual([RANKINGS[i]?.key]);
      expect(within(current(container)[0] as HTMLElement).getByText(en.rankings.you)).toBeTruthy();
    });
  });

  it('greys the hero’s row with "You folded" after a fold, without beats-you captions', () => {
    const { container } = render(
      <RankingsList hero={view('Kh Kc', 'Kd 4s 2h', true)} cardSize="sm" />,
    );
    const [row] = current(container);
    expect(row?.dataset.category).toBe('trips');
    expect(row?.textContent).toContain(en.rankings.youFolded);
    expect(container.textContent).not.toContain(en.rankings.beatsYou);
    expect(container.textContent).not.toContain(en.rankings.youBeat);
  });

  it('highlights nothing between hands', () => {
    const { container } = render(<RankingsList hero={null} cardSize="sm" />);
    expect(current(container)).toEqual([]);
    expect(container.textContent).not.toContain(en.rankings.yourCards);
  });

  it('shows ten rows with mini cards, tips, how often, and the tie-break footer', () => {
    const { container } = render(<RankingsList hero={null} cardSize="sm" />);
    const rows = container.querySelectorAll('li[data-category]');
    expect(rows).toHaveLength(10);
    expect(rows[0]?.querySelectorAll('[role="img"]')).toHaveLength(5);
    expect(container.textContent).toContain(RANKINGS[5].tip);
    expect(container.textContent).toContain('0.003%');
    expect(container.textContent).toContain('1 in 30,900');
    for (const line of en.rankings.footer) expect(container.textContent).toContain(line);
    // Kickers of the examples are dimmed: One pair has three.
    const pair = container.querySelector('li[data-category="pair"]') as HTMLElement;
    const dimmed = [...pair.querySelectorAll('[role="img"]')].filter((c) =>
      /dim/.test(c.className),
    );
    expect(dimmed).toHaveLength(3);
  });

  it('can hide the tips (Intermediate, §10.2)', () => {
    const { container } = render(<RankingsList hero={null} cardSize="sm" showTips={false} />);
    expect(container.textContent).not.toContain(RANKINGS[0].tip);
  });

  it('opens and closes a row’s details on tap', () => {
    render(<RankingsList hero={null} cardSize="sm" />);
    const button = screen.getByRole('button', { name: /^Rank 4, Full house/ });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(RANKINGS[3].detail)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Rank 5, Flush/ }));
    expect(screen.queryByText(RANKINGS[3].detail)).toBeNull();
    expect(screen.getByText(RANKINGS[4].detail)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Rank 5, Flush/ }));
    expect(screen.queryByText(RANKINGS[4].detail)).toBeNull();
  });

  it('pulses the hero’s row once when the hand improves', () => {
    const { container, rerender } = render(
      <RankingsList hero={view('Kh Qc', 'Kd 7s 2h')} cardSize="sm" />,
    );
    const pulses = () => container.querySelectorAll('[class*="pulse"]').length;
    expect(pulses()).toBe(0);
    rerender(<RankingsList hero={view('Kh Qc', 'Kd 7s 2h 9c Qd')} cardSize="sm" />);
    expect(pulses()).toBe(1);
    expect(current(container)[0]?.querySelector('[class*="pulse"]')).not.toBeNull();
  });
});
