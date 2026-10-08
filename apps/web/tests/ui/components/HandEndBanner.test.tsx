// @vitest-environment jsdom
/**
 * The hand-end banner (PLAN §12.9) and its "Review this hand" link (§12.10): the banner is still
 * one button that starts the next hand; the link is a separate button under it, and only there
 * when Review can open.
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
