// @vitest-environment jsdom
/**
 * The ways into Stats in the real app (PLAN §12.1, §14.4, chunk 8.2): Home's Stats tile and the
 * Table's Menu open the lazy Stats screen; the game waits while it is open and Back returns. Its
 * History lists the stored hands and a tap opens one in Review; Back from Review comes back to
 * History. The real store, controller (fixed seeds, fake timers, a fake storage) and `App`.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialReview } from '../../src/app/review.ts';
import { appStore } from '../../src/app/store.ts';
import { defaultProfile } from '../../src/persist/schema.ts';
import { createSafeStorage, STORAGE_KEYS } from '../../src/persist/storage.ts';
import { App } from '../../src/ui/App.tsx';
import { loadScreens } from '../../src/ui/screensModule.ts';
import { FakeStorage } from '../persist/fakeStorage.ts';
import { elapse, playUntil, startTableHarness, type TableHarness } from './tableHarness.ts';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [false, () => {}],
    offlineReady: [false, () => {}],
    updateServiceWorker: async () => {},
  }),
}));

beforeAll(async () => {
  await loadScreens(); // the screens lazy chunk (the Table, the Menu), as App asks for it after first paint
});

let h: TableHarness | null = null;
beforeEach(() => {
  // The app's one store outlives a test: nothing of the one before may show.
  appStore.setState({ review: initialReview(), stats: null, history: null });
});
afterEach(() => {
  cleanup();
  h?.dispose();
  h = null;
});

/** Lets the lazy Stats chunk load (a dynamic `import()`). */
const loaded = () =>
  act(async () => {
    await vi.dynamicImportSettled();
  });

const tap = (name: string | RegExp) =>
  act(() => void fireEvent.click(screen.getByRole('button', { name })));
const page = (name: string) => act(() => void fireEvent.click(screen.getByRole('radio', { name })));

describe('Stats in the app', () => {
  it('Home → Stats: the lazy screen, its empty state, and Back', async () => {
    // A later launch (a profile is stored): Home.
    const fake = new FakeStorage();
    fake.setItem(STORAGE_KEYS.profile, JSON.stringify(defaultProfile(new Date())));
    h = startTableHarness({ storage: createSafeStorage(() => fake) });
    render(<App />);
    tap('Stats');
    expect(h.state().ui.screen).toBe('stats');
    await loaded();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Stats');
    expect(screen.getByText('Play 5 hands to see your first stats.')).toBeTruthy();
    tap('Back');
    expect(h.state().ui.screen).toBe('home');
  }, 30_000);

  it('Menu → Stats over the Table: 5 hands counted; History opens a hand in Review; Back, Back', async () => {
    const fake = new FakeStorage();
    const harness = startTableHarness({
      settings: { players: 3, speed: 'instant' },
      storage: createSafeStorage(() => fake),
    });
    h = harness;
    render(<App />);
    act(() => harness.state().dispatch({ type: 'play' }));
    const first = harness.state().game.hand?.handSeq ?? 0;
    await playUntil(() => {
      const s = harness.state();
      return s.stats !== null && s.stats.results.clean.hands + s.stats.results.practice.hands >= 5;
    });
    await playUntil(() => harness.state().game.mode === 'heroTurn');

    act(() => harness.state().dispatch({ type: 'open', overlay: 'menu' }));
    tap('Stats');
    expect(harness.state().ui.screen).toBe('stats');
    expect(harness.state().ui.gates).toContain('offTable');
    await loaded();
    page('Results');
    expect(document.querySelector('[data-stat="hands"] dd')?.textContent).toBe('5');
    // The game waits while Stats is open.
    const mode = harness.state().game.mode;
    await elapse(30_000);
    expect(harness.state().game.mode).toBe(mode);

    page('History');
    const rows = screen.getAllByRole('button', { name: /^Hand / });
    expect(rows).toHaveLength(5);
    act(() => void fireEvent.click(rows.at(-1) as HTMLElement));
    expect(harness.state().ui.screen).toBe('review');
    expect(harness.state().review.selected).toBe(first);
    await loaded();
    tap('Back');
    expect(harness.state().ui.screen).toBe('stats');
    await loaded();
    // Back on the page the player left.
    expect((screen.getByRole('radio', { name: 'History' }) as HTMLInputElement).checked).toBe(true);
    tap('Back');
    expect(harness.state().ui.screen).toBe('table');
  }, 30_000);
});
