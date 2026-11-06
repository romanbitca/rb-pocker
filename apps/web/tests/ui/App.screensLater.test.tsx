// @vitest-environment jsdom
/**
 * A tap on Play before the screens chunk has arrived (PLAN §15.3; only on a first visit over a
 * slow network, since App asks for the chunk right after the first paint): the hand is dealt at
 * once (§12.1), the page shows its background (the "Loading…" line is in the DOM, and CSS shows it
 * only after half a second), and when the chunk lands the Table is drawn and its heading takes the
 * focus, as ScreenSwitcher gives it to every new screen (§12.12). (This file must not load the
 * chunk before the tap.)
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { en } from '../../src/i18n/en.ts';
import { App } from '../../src/ui/App.tsx';
import { startTableHarness, type TableHarness } from './tableHarness.ts';

let h: TableHarness | null = null;
afterEach(() => {
  cleanup();
  h?.dispose();
  h = null;
});

describe('a tap before the screens chunk has arrived', () => {
  it('deals at once; the Table follows when the chunk lands, and takes the focus', async () => {
    h = startTableHarness();
    render(<App />);
    act(() => h?.state().dispatch({ type: 'play' }));
    const state = h.state();
    expect(state.ui.screen).toBe('table');
    expect(state.game.hand?.seats[0]?.hole).toHaveLength(2);
    // The page's background, with the delayed line; no screen heading yet.
    expect(screen.getByText(en.screens.loading)).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();

    await act(async () => {
      await vi.dynamicImportSettled();
    });
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe(en.table.heading);
    expect(document.activeElement).toBe(heading);
    expect(screen.queryByText(en.screens.loading)).toBeNull();
    expect(document.querySelectorAll('[data-hero-cards] [role="img"]')).toHaveLength(2);
  });
});
