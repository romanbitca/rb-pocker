// @vitest-environment jsdom
/**
 * The way into Review, in the real app (PLAN §12.9, §12.10): a finished hand ends with "Review this
 * hand" under the banner; it opens the lazy Review screen on that hand, the game waits while it is
 * open, and Back returns to the hand-end banner. The Menu lists "Recent hands" once a hand is done.
 * The real store, controller (fixed seeds, fake timers) and `App`.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialReview } from '../../src/app/review.ts';
import { appStore } from '../../src/app/store.ts';
import { App } from '../../src/ui/App.tsx';
import { elapse, playUntil, startTableHarness, type TableHarness } from './tableHarness.ts';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [false, () => {}],
    offlineReady: [false, () => {}],
    updateServiceWorker: async () => {},
  }),
}));

let h: TableHarness | null = null;
beforeEach(() => {
  // The app's one store outlives a test: the hands of the one before must not show.
  appStore.setState({ review: initialReview() });
});
afterEach(() => {
  cleanup();
  h?.dispose();
  h = null;
});

/** Plays the first hand to its end (hero checks and calls) with `autoNext` off: the banner waits. */
async function toHandEnd(): Promise<TableHarness> {
  const harness = startTableHarness({ settings: { players: 4, autoNext: false } });
  h = harness;
  render(<App />);
  act(() => harness.state().dispatch({ type: 'play' }));
  await playUntil(() => harness.state().game.mode === 'handEnd');
  return harness;
}

/** Lets the lazy Review chunk load (a dynamic `import()`). */
const loaded = () =>
  act(async () => {
    await vi.dynamicImportSettled();
  });

describe('from the hand-end banner', () => {
  it('"Review this hand" opens Review on the hand that just ended; the game waits; Back returns', async () => {
    const harness = await toHandEnd();
    const handSeq = harness.state().game.hand?.handSeq;
    const banner = document.querySelector('[data-hand-end]') as HTMLElement;
    const lines = [...banner.querySelectorAll('span')].map((s) => s.textContent);

    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Review this hand' })));
    expect(harness.state().ui.screen).toBe('review');
    expect(harness.state().review.selected).toBe(handSeq);
    await loaded();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Hand 1');

    // The last step says what the banner said.
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Last step' })));
    // (The toasts are a live region too: the replay's is the atomic one.)
    const story = screen
      .getAllByRole('status')
      .find((el) => el.getAttribute('aria-atomic') === 'true');
    const result = story?.textContent ?? '';
    expect(result).toContain(lines[0] ?? '');

    // The game waits while Review is open.
    expect(harness.state().ui.gates).toContain('offTable');
    await elapse(30_000);
    expect(harness.state().game.hand?.handSeq).toBe(handSeq);
    expect(harness.state().game.mode).toBe('handEnd');

    // Back: the Table, with the banner still waiting for its tap.
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Back' })));
    expect(harness.state().ui.screen).toBe('table');
    expect(document.querySelector('[data-hand-end]')).not.toBeNull();
    act(() => void fireEvent.click(document.querySelector('[data-hand-end]') as HTMLElement));
    expect(harness.state().game.hand?.handSeq).toBe((handSeq ?? 0) + 1);
  }, 60_000);

  it('the banner link is a separate button: the banner itself still just starts the next hand', async () => {
    const harness = await toHandEnd();
    const banner = document.querySelector('[data-hand-end]') as HTMLElement;
    expect(banner.tagName).toBe('BUTTON');
    expect(within(banner).queryByRole('button')).toBeNull();
    expect(banner.textContent).toContain('Next hand');
    expect(banner.textContent).not.toContain('Review this hand');
    const before = harness.state().game.hand?.handSeq;
    act(() => void fireEvent.click(banner));
    expect(harness.state().game.hand?.handSeq).toBe((before ?? 0) + 1);
    expect(harness.state().ui.screen).toBe('table');
  }, 60_000);
});

describe('from the Menu', () => {
  it('"Recent hands" is not there before a hand is finished, and opens the list after', async () => {
    const harness = startTableHarness({ settings: { players: 4, autoNext: false } });
    h = harness;
    render(<App />);
    act(() => harness.state().dispatch({ type: 'play' }));
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Menu' })));
    expect(screen.queryByRole('button', { name: 'Recent hands' })).toBeNull();
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Resume' })));

    await playUntil(() => harness.state().game.mode === 'handEnd');
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Menu' })));
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Recent hands' })));
    expect(harness.state().ui.screen).toBe('review');
    expect(harness.state().ui.overlays).toEqual([]);
    await loaded();
    // A phone shows the list first; its one row opens the hand.
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Recent hands');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    act(() => void fireEvent.click(screen.getByRole('button', { name: /Hand 1/ })));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Hand 1');
  }, 60_000);

  it('shows hands from this launch only, newest first', async () => {
    const harness = startTableHarness({ settings: { players: 4, autoNext: true } });
    h = harness;
    render(<App />);
    act(() => harness.state().dispatch({ type: 'play' }));
    await playUntil(() => (harness.state().game.hand?.handSeq ?? 0) >= 4);
    act(() => harness.state().dispatch({ type: 'review', handSeq: null }));
    await loaded();
    const rows = screen.getAllByRole('listitem');
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows[0]?.textContent).toContain(`Hand ${rows.length}`);
    expect(rows[rows.length - 1]?.textContent).toContain('Hand 1');
  }, 60_000);
});
