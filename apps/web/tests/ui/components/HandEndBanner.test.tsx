// @vitest-environment jsdom
/**
 * The hand-end result (PLAN §12.9; 1.3.99) and its links: the banner is words only (the next hand
 * is Row A's "Next hand ›", ActionBar.test.tsx). "Review this hand" (§12.10) and, when the hand has
 * a summary (1.3.92), "Hand summary" (Exam's "Exam result") are separate buttons, outside the
 * result's announcement; the sheet never opens by itself.
 */
import '../../../src/ui/styles/tokens.css';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HandEndBanner, HandEndLinks } from '../../../src/ui/components/HandEndBanner.tsx';
import type { BannerLine } from '../../../src/ui/handEnd.ts';
import { smallTargets } from '../screens/targets.ts';

afterEach(cleanup);

const LINES: readonly BannerLine[] = [
  { text: 'Ben wins 340 with Two Pair, Kings and Sevens.', kind: 'main' },
  { text: 'You lost 100', kind: 'own' },
  { text: 'The third line.', kind: 'line' },
];

describe('HandEndBanner', () => {
  it('the result only: its lines, in order, and no button', () => {
    render(<HandEndBanner lines={LINES} />);
    const banner = document.querySelector('[data-hand-result]') as HTMLElement;
    expect([...banner.children].map((c) => c.textContent)).toEqual(LINES.map((l) => l.text));
    expect(banner.textContent).not.toContain('Next hand');
    expect(banner.querySelector('button')).toBeNull();
    expect(screen.queryAllByRole('button')).toEqual([]);
  });

  it('is a polite live region that announces the result', () => {
    render(<HandEndBanner lines={LINES} />);
    const status = screen.getByRole('status');
    expect(status.hasAttribute('data-hand-result')).toBe(true);
    expect(status.textContent).toContain(LINES[0]?.text);
  });

  it('draws each kind of line its own way', () => {
    render(<HandEndBanner lines={LINES} />);
    const banner = document.querySelector('[data-hand-result]') as HTMLElement;
    const names = [...banner.children].map((c) => c.className);
    expect(new Set(names).size).toBe(3);
  });

  it('only when it scrolls can the keyboard reach it (§12.12)', () => {
    const height = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(120);
    const client = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(120);
    const { rerender } = render(<HandEndBanner lines={LINES} />);
    const banner = () => document.querySelector('[data-hand-result]') as HTMLElement;
    expect(banner().hasAttribute('tabindex')).toBe(false);
    height.mockReturnValue(160);
    rerender(<HandEndBanner lines={[...LINES]} />);
    expect(banner().getAttribute('tabindex')).toBe('0');
    height.mockRestore();
    client.mockRestore();
  });
});

describe('HandEndLinks: the hand summary on demand (§10.2, §12.9; 1.3.92)', () => {
  const links = (over: Partial<Parameters<typeof HandEndLinks>[0]> = {}) => {
    const onReview = vi.fn();
    const onSummary = vi.fn();
    const utils = render(
      <HandEndLinks onReview={onReview} summary="hand" onSummary={onSummary} {...over} />,
    );
    return { onReview, onSummary, ...utils };
  };

  it('"Hand summary" before "Review this hand": each does its own thing', () => {
    const { onReview, onSummary } = links();
    const open = screen.getByRole('button', { name: 'Hand summary' });
    expect(open.getAttribute('data-hand-summary')).toBe('hand');
    expect(open.getAttribute('aria-keyshortcuts')).toBe('S');
    const review = screen.getByRole('button', { name: 'Review this hand' });
    expect(open.parentElement).toBe(review.parentElement);
    expect(open.nextElementSibling).toBe(review);
    fireEvent.click(open);
    expect(onSummary).toHaveBeenCalledTimes(1);
    expect(onReview).not.toHaveBeenCalled();
    fireEvent.click(review);
    expect(onReview).toHaveBeenCalledTimes(1);
    expect(onSummary).toHaveBeenCalledTimes(1);
  });

  it('Exam: "Exam result"', () => {
    links({ summary: 'exam' });
    const open = screen.getByRole('button', { name: 'Exam result' });
    expect(open.getAttribute('data-hand-summary')).toBe('exam');
    expect(screen.queryByRole('button', { name: 'Hand summary' })).toBeNull();
  });

  it('no summary for the hand (null): no button, "Review this hand" alone', () => {
    links({ summary: null });
    expect(document.querySelector('[data-hand-summary]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Review this hand' })).not.toBeNull();
  });

  it('every button is big enough to touch (§12.12): the phone row, the column, the panel', () => {
    const { container, rerender } = render(
      <HandEndLinks onReview={() => {}} summary="exam" onSummary={() => {}} />,
    );
    expect(container.querySelectorAll('button')).toHaveLength(2);
    expect(smallTargets(container, () => false)).toEqual([]);
    rerender(<HandEndLinks onReview={() => {}} summary="exam" onSummary={() => {}} place="side" />);
    expect(smallTargets(container, () => false)).toEqual([]);
    rerender(
      <HandEndLinks onReview={() => {}} summary="exam" onSummary={() => {}} place="panel" />,
    );
    expect(smallTargets(container, () => false)).toEqual([]);
  });
});
