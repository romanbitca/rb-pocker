// @vitest-environment jsdom
/**
 * The toasts (PLAN §12.11 and its notes of 1.3.86): off the Table they stack under the top edge; on
 * the Table (`place`) they sit over the top bar, one at a time, the newest, so a toast never covers
 * a seat, the board, the hero's hand, the coach or Row A while the hero decides. The live region is
 * always there. Where the bar is (portrait, landscape, wide, the rail) is CSS read from
 * `data-place`; Playwright measures it (`tests/e2e/phoneLayout.spec.ts`).
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
  it('off the Table: every toast, stacked, in a live region', () => {
    const { container } = render(<Toasts toasts={[OLDER, NEWER]} onDismiss={vi.fn()} />);
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      enStart.toast.dataRecovered,
      enStart.toast.offlineReady,
    ]);
    expect(container.querySelector('[data-place]')).toBeNull();
  });

  it('on the Table: over its top bar, one at a time (the newest); a tap closes it', () => {
    const onDismiss = vi.fn();
    render(<Toasts toasts={[OLDER, NEWER]} onDismiss={onDismiss} place="portrait" />);
    expect(screen.getByRole('status').getAttribute('data-place')).toBe('portrait');
    const shown = screen.getAllByRole('button');
    expect(shown.map((b) => b.textContent)).toEqual([enStart.toast.offlineReady]);
    fireEvent.click(shown[0] as HTMLElement);
    expect(onDismiss).toHaveBeenCalledWith(NEWER.id);
  });

  it('the bar of the table column: landscape, wide, and wide with the rankings on their rail', () => {
    for (const place of ['landscape', 'wide', 'rail'] satisfies ToastPlace[]) {
      render(<Toasts toasts={[OLDER, NEWER]} onDismiss={vi.fn()} place={place} />);
      expect(screen.getByRole('status').getAttribute('data-place')).toBe(place);
      expect(screen.getAllByRole('button')).toHaveLength(1);
      cleanup();
    }
  });

  it('no toast: the live region is still there (it must exist before its text changes)', () => {
    render(<Toasts toasts={[]} onDismiss={vi.fn()} place="portrait" />);
    expect(screen.getByRole('status').childElementCount).toBe(0);
  });
});
