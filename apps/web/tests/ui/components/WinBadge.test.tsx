// @vitest-environment jsdom
/**
 * The win badge, price chip and big-move line (PLAN §7.6, §12.12, §12.14): what each state
 * renders, the popover (tap, "How is this calculated?", Escape, a tap outside), the hysteresis as
 * the badge lives through a stream of estimates, and the line's 4 s.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EquityResult } from '../../../src/analysis/types.ts';
import type { WinBadgeData } from '../../../src/app/store.ts';
import { cardAriaLabel } from '../../../src/core/cards.ts';
import { en } from '../../../src/i18n/en.ts';
import {
  BIG_MOVE_MS,
  BigMoveLine,
  PriceChip,
  WinBadge,
} from '../../../src/ui/components/WinBadge.tsx';
import { badgeView, bigMoveView, useBadgeView, type BadgeView } from '../../../src/ui/equity.ts';
import { card } from '../../helpers/cards.ts';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const result = (equity: number, final: boolean): EquityResult => ({
  n: 40_000,
  win: equity - 0.02,
  split: 0.02,
  equity,
  exact: false,
  final,
  truncated: false,
});

const data = (patch: Partial<WinBadgeData> = {}): WinBadgeData => ({
  status: 'computing',
  key: 'k',
  result: null,
  nOpp: 3,
  known: false,
  ...patch,
});

/** A badge view for `data` with a fresh memory (no hysteresis history). */
function viewOf(d: WinBadgeData): BadgeView {
  const v = badgeView(d, d.result === null ? null : { key: d.key, shown: 100 * d.result.equity });
  if (v === null) throw new Error('no badge');
  return v;
}

const badgeEl = (): HTMLElement => document.querySelector('[data-win-badge]') as HTMLElement;

describe('WinBadge', () => {
  it('skeleton: "--%" and "win chance", not a button, never "0%"', () => {
    render(<WinBadge view={viewOf(data())} placement="up" />);
    expect(badgeEl().tagName).toBe('DIV');
    expect(badgeEl().textContent).toBe('--%win chance');
    expect(screen.getByRole('img', { name: en.badge.labelComputing })).toBe(badgeEl());
    expect(document.body.textContent).not.toContain('0%');
  });

  it('value: a button named "Win chance 62%", with the popover on a tap', () => {
    render(
      <WinBadge
        view={viewOf(data({ status: 'done', result: result(0.62, true) }))}
        placement="up"
      />,
    );
    const button = screen.getByRole('button', { name: 'Win chance 62%' });
    expect(button.textContent).toBe('62%win chance');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(
      screen.getByText('Wins 60% · splits 2% · vs 3 players (any cards) · 40,000 deals'),
    ).toBeTruthy();
    // The explanation opens from its link.
    expect(screen.queryByText(/We play out the rest of the hand/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: en.badge.howLink }));
    expect(screen.getByText(/You won in 62% of them/)).toBeTruthy();
    // A second tap closes it.
    fireEvent.click(button);
    expect(screen.queryByText(/Wins 60%/)).toBeNull();
  });

  it('provisional: "~62%" and "Win chance about 62%"', () => {
    render(<WinBadge view={viewOf(data({ result: result(0.62, false) }))} placement="up" />);
    expect(screen.getByRole('button', { name: 'Win chance about 62%' }).textContent).toBe(
      '~62%win chance',
    );
  });

  it('closes on Escape and on a press outside, not on a press inside', () => {
    render(
      <div>
        <p>outside</p>
        <WinBadge
          view={viewOf(data({ status: 'done', result: result(0.5, true) }))}
          placement="down"
        />
      </div>,
    );
    const button = screen.getByRole('button', { name: 'Win chance 50%' });
    fireEvent.click(button);
    fireEvent.pointerDown(screen.getByText(/Wins/));
    expect(screen.queryByText(/Wins/)).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText(/Wins/)).toBeNull();
    fireEvent.click(button);
    fireEvent.pointerDown(screen.getByText('outside'));
    expect(screen.queryByText(/Wins/)).toBeNull();
  });

  it('Folded: the word, no caption, no button', () => {
    render(<WinBadge view={viewOf(data({ status: 'folded' }))} placement="up" />);
    expect(badgeEl().textContent).toBe('Folded');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('not available: "—", and the popover says so', () => {
    render(<WinBadge view={viewOf(data({ status: 'unavailable' }))} placement="up" />);
    fireEvent.click(screen.getByRole('button', { name: en.badge.labelNone }));
    expect(screen.getByText(en.badge.unavailable)).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.badge.howLink })).toBeNull();
  });
});

describe('the badge through a stream of estimates (hysteresis, §7.6)', () => {
  function Live({ d }: { d: WinBadgeData }) {
    const view = useBadgeView(d);
    return view === null ? null : <WinBadge key={d.key} view={view} placement="up" />;
  }

  it('skeleton, then ~62%, holds within 1.0 point, moves beyond it, and shows the final', () => {
    const { rerender } = render(<Live d={data()} />);
    const texts: string[] = [];
    const read = () => texts.push(badgeEl().querySelector('span')?.textContent ?? '');
    read();
    for (const [e, final] of [
      [0.617, false],
      [0.6245, false],
      [0.6095, false],
      [0.6149, true],
    ] as const) {
      rerender(
        <Live d={data({ result: result(e, final), status: final ? 'done' : 'computing' })} />,
      );
      read();
    }
    expect(texts).toEqual(['--%', '~62%', '~62%', '~61%', '61%']);
  });
});

describe('PriceChip', () => {
  it('"Call 40" over "need 20%"', () => {
    render(
      <PriceChip
        view={{ text: 'Call 40 · need 20%', call: 'Call 40', need: 'need 20%', potYouCanWin: null }}
      />,
    );
    const chip = document.querySelector('[data-price-chip]') as HTMLElement;
    expect(chip.textContent).toBe('Call 40\nneed 20%');
  });

  it('adds "Pot you can win 150" under a short all-in call', () => {
    render(
      <PriceChip
        view={{
          text: 'Call 50 · need 25%',
          call: 'Call 50',
          need: 'need 25%',
          potYouCanWin: 'Pot you can win 150',
        }}
      />,
    );
    expect(screen.getByText('Pot you can win 150')).toBeTruthy();
  });
});

describe('BigMoveLine (§7.6)', () => {
  it('shows the line with the card drawn in it for 4 s, then hides; a new move shows again', () => {
    vi.useFakeTimers();
    const first = bigMoveView({ key: 'a', kind: 'blank', card: card('3♣') });
    const { rerender } = render(<BigMoveLine view={first} placement="up" />);
    const line = screen.getByRole('status');
    expect(line.textContent).toBe('The 3 did not help you.');
    expect(screen.getByRole('img', { name: cardAriaLabel(card('3♣')) })).toBeTruthy();
    act(() => vi.advanceTimersByTime(BIG_MOVE_MS - 1));
    expect(screen.queryByRole('status')).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('status')).toBeNull();
    // The same move again (a re-render) stays hidden; a new one shows.
    rerender(<BigMoveLine view={{ ...(first as NonNullable<typeof first>) }} placement="up" />);
    expect(screen.queryByRole('status')).toBeNull();
    rerender(
      <BigMoveLine view={bigMoveView({ key: 'b', kind: 'fold', name: 'Ben' })} placement="up" />,
    );
    expect(screen.getByRole('status').textContent).toBe('Ben folded. One fewer player to beat.');
  });

  it('nothing without a move', () => {
    render(<BigMoveLine view={null} placement="up" />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
