// @vitest-environment jsdom
/**
 * The toasts (PLAN §12.11 and its notes of 1.3.86 and 1.3.91): off the Table they stack under the
 * top edge; on the Table (`place`) they sit over the top bar, one at a time, the newest, so a toast
 * never covers a seat, the board, the hero's hand, the coach or Row A while the hero decides, and
 * the older ones close. The live region is always there. Where the bar is (portrait, landscape,
 * wide, the rail) and the toast's full width are CSS read from `data-place`; Playwright measures
 * them (`tests/e2e/phoneLayout.spec.ts`).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Toast } from '../../../src/app/store.ts';
import { enStart } from '../../../src/i18n/start.ts';
import { Toasts, type ToastPlace } from '../../../src/ui/components/Notices.tsx';

afterEach(cleanup);

// Words that are on the first screen already (`enStart`), so nothing waits for a lazy chunk.
const OLDER: Toast = { id: 1, kind: 'dataRecovered' };
const NEWER: Toast = { id: 2, kind: 'offlineReady' };

describe('Toasts', () => {
  it('off the Table: every toast, stacked, in a live region; none closes before its time', () => {
    const onDismiss = vi.fn();
    const { container } = render(<Toasts toasts={[OLDER, NEWER]} onDismiss={onDismiss} />);
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      enStart.toast.dataRecovered,
      enStart.toast.offlineReady,
    ]);
    expect(container.querySelector('[data-place]')).toBeNull();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('on the Table: over its top bar, one at a time (the newest); a tap closes it', () => {
    const onDismiss = vi.fn();
    render(<Toasts toasts={[NEWER]} onDismiss={onDismiss} place="portrait" />);
    expect(screen.getByRole('status').getAttribute('data-place')).toBe('portrait');
    const shown = screen.getAllByRole('button');
    expect(shown.map((b) => b.textContent)).toEqual([enStart.toast.offlineReady]);
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.click(shown[0] as HTMLElement);
    expect(onDismiss).toHaveBeenCalledWith(NEWER.id);
  });

  it('on the Table a newer toast closes the older ones at once, so a tap never uncovers one (1.3.91)', () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<Toasts toasts={[OLDER]} onDismiss={onDismiss} place="portrait" />);
    expect(onDismiss).not.toHaveBeenCalled();
    // The newer one comes: it shows, and the older one closes (it used to run on unseen and show
    // again when the newer one was tapped away).
    rerender(<Toasts toasts={[OLDER, NEWER]} onDismiss={onDismiss} place="portrait" />);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      enStart.toast.offlineReady,
    ]);
    expect(onDismiss.mock.calls).toEqual([[OLDER.id]]);
    // Two toasts from another screen, then the Table: the same.
    cleanup();
    onDismiss.mockClear();
    const { rerender: again } = render(<Toasts toasts={[OLDER, NEWER]} onDismiss={onDismiss} />);
    expect(onDismiss).not.toHaveBeenCalled();
    again(<Toasts toasts={[OLDER, NEWER]} onDismiss={onDismiss} place="landscape" />);
    expect(onDismiss.mock.calls).toEqual([[OLDER.id]]);
  });

  it('the bar of the table column: landscape, wide, and wide with the rankings on their rail', () => {
    for (const place of ['landscape', 'wide', 'rail'] satisfies ToastPlace[]) {
      render(<Toasts toasts={[OLDER, NEWER]} onDismiss={vi.fn()} place={place} />);
      expect(screen.getByRole('status').getAttribute('data-place')).toBe(place);
      expect(screen.getAllByRole('button')).toHaveLength(1);
      cleanup();
    }
  });

  it("on the Table the toast takes the box of the bar's title, between its buttons (1.3.91)", () => {
    // The Table's top bar marks its title; jsdom has no layout, so its box is given here.
    const title = document.createElement('p');
    title.setAttribute('data-bar-title', '');
    title.getBoundingClientRect = () => new DOMRect(52, 0, 180, 44);
    document.body.appendChild(title);
    try {
      const { rerender } = render(<Toasts toasts={[NEWER]} onDismiss={vi.fn()} place="portrait" />);
      const region = screen.getByRole('status');
      expect([region.style.left, region.style.width]).toEqual(['52px', '180px']);
      // Off the Table the toasts stack again (the CSS places them).
      rerender(<Toasts toasts={[NEWER]} onDismiss={vi.fn()} />);
      expect([region.style.left, region.style.width]).toEqual(['', '']);
    } finally {
      title.remove();
    }
  });

  it('no toast: the live region is still there (it must exist before its text changes)', () => {
    render(<Toasts toasts={[]} onDismiss={vi.fn()} place="portrait" />);
    expect(screen.getByRole('status').childElementCount).toBe(0);
  });
});
