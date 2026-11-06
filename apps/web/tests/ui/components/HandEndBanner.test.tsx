// @vitest-environment jsdom
/**
 * The hand-end banner (PLAN §12.9) and its "Review this hand" link (§12.10): the banner is still
 * one button that starts the next hand; the link is a separate button under it, and only there
 * when Review can open. Beside it, when the hand has a summary (1.3.92), "Hand summary" (Exam's
 * "Exam result") opens the sheet, which never opens by itself.
 */
import '../../../src/ui/styles/tokens.css';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HandEndBanner } from '../../../src/ui/components/HandEndBanner.tsx';
import { smallTargets } from '../screens/targets.ts';

afterEach(cleanup);

const LINES = ['Ben wins 340 with Two Pair, Kings and Sevens.', 'You lost 100 chips.'];

describe('HandEndBanner', () => {
  it('without Review: the lines and "Next hand", as before', () => {
    const onNext = vi.fn();
    render(<HandEndBanner lines={LINES} onNext={onNext} />);
    const banner = document.querySelector('[data-hand-end]') as HTMLElement;
    expect(banner.textContent).toBe(`${LINES.join('')}Next hand`);
    expect(screen.queryByRole('button', { name: 'Review this hand' })).toBeNull();
    fireEvent.click(banner);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('with Review: a second button under the banner; each button does its own thing', () => {
    const onNext = vi.fn();
    const onReview = vi.fn();
    render(<HandEndBanner lines={LINES} onNext={onNext} onReview={onReview} />);
    const link = screen.getByRole('button', { name: 'Review this hand' });
    fireEvent.click(link);
    expect(onReview).toHaveBeenCalledTimes(1);
    expect(onNext).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector('[data-hand-end]') as HTMLElement);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onReview).toHaveBeenCalledTimes(1);
  });

  it('the link is outside the banner button and outside the result announcement', () => {
    render(<HandEndBanner lines={LINES} onNext={() => {}} onReview={() => {}} />);
    const banner = document.querySelector('[data-hand-end]') as HTMLElement;
    const link = screen.getByRole('button', { name: 'Review this hand' });
    expect(banner.contains(link)).toBe(false);
    expect(within(banner).queryByRole('button')).toBeNull();
    const status = screen.getByRole('status');
    expect(status.contains(banner)).toBe(true);
    expect(status.contains(link)).toBe(false);
    expect(status.textContent).toContain(LINES[0]);
  });

  it('both buttons are big enough to touch (§12.12), also in the landscape column', () => {
    const { container, rerender } = render(
      <HandEndBanner lines={LINES} onNext={() => {}} onReview={() => {}} />,
    );
    expect(smallTargets(container, () => false)).toEqual([]);
    rerender(<HandEndBanner lines={LINES} onNext={() => {}} onReview={() => {}} side />);
    expect(smallTargets(container, () => false)).toEqual([]);
  });
});

describe('HandEndBanner: the hand summary on demand (§10.2, §12.9; 1.3.92)', () => {
  it('"Hand summary" beside "Review this hand": its tap opens the summary, not the next hand', () => {
    const onNext = vi.fn();
    const onReview = vi.fn();
    const onSummary = vi.fn();
    render(
      <HandEndBanner
        lines={LINES}
        onNext={onNext}
        onReview={onReview}
        summary="hand"
        onSummary={onSummary}
      />,
    );
    const open = screen.getByRole('button', { name: 'Hand summary' });
    expect(open.getAttribute('data-hand-summary')).toBe('hand');
    expect(open.getAttribute('aria-keyshortcuts')).toBe('S');
    // In the links row, before "Review this hand".
    const review = screen.getByRole('button', { name: 'Review this hand' });
    expect(open.parentElement).toBe(review.parentElement);
    expect(open.nextElementSibling).toBe(review);
    fireEvent.click(open);
    expect(onSummary).toHaveBeenCalledTimes(1);
    expect(onNext).not.toHaveBeenCalled();
    expect(onReview).not.toHaveBeenCalled();
  });

  it('Exam: "Exam result"', () => {
    render(
      <HandEndBanner
        lines={LINES}
        onNext={() => {}}
        onReview={() => {}}
        summary="exam"
        onSummary={() => {}}
      />,
    );
    const open = screen.getByRole('button', { name: 'Exam result' });
    expect(open.getAttribute('data-hand-summary')).toBe('exam');
    expect(screen.queryByRole('button', { name: 'Hand summary' })).toBeNull();
  });

  it('no summary for the hand (null): no button, "Review this hand" alone as before', () => {
    render(
      <HandEndBanner
        lines={LINES}
        onNext={() => {}}
        onReview={() => {}}
        summary={null}
        onSummary={() => {}}
      />,
    );
    expect(document.querySelector('[data-hand-summary]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Review this hand' })).not.toBeNull();
  });

  it('outside the banner button and the result announcement', () => {
    render(
      <HandEndBanner
        lines={LINES}
        onNext={() => {}}
        onReview={() => {}}
        summary="hand"
        onSummary={() => {}}
      />,
    );
    const banner = document.querySelector('[data-hand-end]') as HTMLElement;
    const open = screen.getByRole('button', { name: 'Hand summary' });
    expect(banner.contains(open)).toBe(false);
    expect(screen.getByRole('status').contains(open)).toBe(false);
  });

  it('every button is big enough to touch (§12.12): phones, the landscape column, wide screens', () => {
    const props = {
      lines: LINES,
      onNext: () => {},
      onReview: () => {},
      summary: 'exam' as const,
      onSummary: () => {},
    };
    const { container, rerender } = render(<HandEndBanner {...props} />);
    expect(container.querySelectorAll('button')).toHaveLength(3);
    expect(smallTargets(container, () => false)).toEqual([]);
    rerender(<HandEndBanner {...props} side />);
    expect(smallTargets(container, () => false)).toEqual([]);
    rerender(<HandEndBanner {...props} wide />);
    expect(smallTargets(container, () => false)).toEqual([]);
  });
});
