// @vitest-environment jsdom
/**
 * The ways into Learn in the real app (PLAN §12.1, chunk 9.2): Home's tile opens the lazy Learn
 * chunk; a lesson, its Next, lesson 4's "See all poker hands" and "Which hand wins?"; Back (the
 * button and Android Back) returns page by page. Welcome's "1-minute guide" opens lesson 1; the
 * Table's Menu opens Learn and the game waits behind it; a read-only tab (§14.7) still opens Learn.
 * The real store and controller (fixed seeds, fake timers) and `App`.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { appStore, initialData, initialUi } from '../../src/app/store.ts';
import { App } from '../../src/ui/App.tsx';
import { loadScreens } from '../../src/ui/screensModule.ts';
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
afterEach(() => {
  cleanup();
  h?.dispose();
  h = null;
  appStore.setState({ data: initialData() });
});

/** Lets the lazy Learn chunk load (a dynamic `import()`), and React reveal it. */
const loaded = () =>
  act(async () => {
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(400); // React 19 shows a Suspense boundary's content ≥ 300 ms in
  });

const tap = (name: string | RegExp) =>
  act(() => void fireEvent.click(screen.getByRole('button', { name })));
const heading = (): string => screen.getByRole('heading', { level: 1 }).textContent ?? '';
/** Android Back (and the browser's back button): `popstate`. */
const androidBack = () =>
  act(() => void window.dispatchEvent(new PopStateEvent('popstate', { state: null })));

describe('Learn in the app', () => {
  it('Home → Learn → lesson 4 → Next → Back → See all poker hands → Which hand wins? → Back to Home', async () => {
    h = startTableHarness();
    render(<App />);
    tap('Learn');
    expect(h.state().ui.screen).toBe('learn');
    await loaded();
    expect(heading()).toBe('Learn');
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
    expect(screen.getAllByRole('button', { name: /^Lesson \d: / })).toHaveLength(7);

    tap('Lesson 4: Which hand wins');
    expect(h.state().ui).toMatchObject({ screen: 'lesson', lesson: 4 });
    expect(heading()).toBe('Which hand wins');
    expect(screen.getByText('Lesson 4 of 7')).toBeTruthy();
    // Next pages in place: the stack keeps one lesson, so Back returns to the list.
    tap('Next: Position');
    expect(heading()).toBe('Position');
    expect(h.state().ui.nav.screens).toEqual(['home', 'learn', 'lesson']);
    androidBack();
    expect(heading()).toBe('Learn');

    tap('Lesson 4: Which hand wins');
    tap('See all poker hands');
    expect(h.state().ui.screen).toBe('handRankings');
    expect(heading()).toBe('Poker hands');
    expect(document.querySelectorAll('li[data-category]')).toHaveLength(10);
    tap('Which hand wins?');
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    const quiz = screen.getByRole('region', { name: 'Which hand wins?' });
    act(
      () =>
        void fireEvent.click(
          within(quiz).getAllByRole('button', { name: /hand:/ })[1] as HTMLElement,
        ),
    );
    expect(within(quiz).getByRole('status').textContent).not.toBe('');

    tap('Back');
    expect(heading()).toBe('Which hand wins');
    androidBack();
    expect(heading()).toBe('Learn');
    tap('Back');
    expect(h.state().ui.screen).toBe('home');
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
  }, 30_000);

  it('Learn → Glossary: the search narrows the words; Back returns to Learn', async () => {
    h = startTableHarness();
    render(<App />);
    tap('Learn');
    await loaded();
    tap(/^Glossary/);
    expect(heading()).toBe('Glossary');
    const search = screen.getByRole('searchbox', { name: 'Find a word' });
    act(() => void fireEvent.change(search, { target: { value: 'outs' } }));
    expect(within(screen.getByRole('main')).getByRole('status').textContent).toMatch(
      /^\d+ words?$/,
    );
    expect(screen.getByText('Cards still in the deck that improve your hand.')).toBeTruthy();
    tap('Back');
    expect(heading()).toBe('Learn');
  }, 30_000);

  it("Welcome's 1-minute guide opens lesson 1, and Back returns to Welcome", async () => {
    h = startTableHarness();
    appStore.setState({ ui: initialUi(true) });
    render(<App />);
    tap('New to poker? 1-minute guide');
    expect(h.state().ui).toMatchObject({ screen: 'lesson', lesson: 1 });
    await loaded();
    expect(heading()).toBe('The goal');
    expect(screen.getByText('Lesson 1 of 7')).toBeTruthy();
    tap('Back');
    expect(h.state().ui.screen).toBe('welcome');
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
  }, 30_000);

  it('Menu → Learn over the Table: the game waits; Back returns to the hand', async () => {
    const harness = startTableHarness({ settings: { players: 3, speed: 'instant' } });
    h = harness;
    render(<App />);
    act(() => harness.state().dispatch({ type: 'play' }));
    await playUntil(() => harness.state().game.mode === 'heroTurn');
    act(() => harness.state().dispatch({ type: 'open', overlay: 'menu' }));
    tap('Learn');
    expect(harness.state().ui.nav.screens).toEqual(['home', 'table', 'learn']);
    expect(harness.state().ui.gates).toContain('offTable');
    await loaded();
    expect(heading()).toBe('Learn');
    const mode = harness.state().game.mode;
    await elapse(20_000);
    expect(harness.state().game.mode).toBe(mode);
    tap('Back');
    expect(harness.state().ui.screen).toBe('table');
  }, 30_000);

  it('a read-only tab (§14.7) still opens Learn from Home, and nothing of the game', async () => {
    h = startTableHarness();
    appStore.setState({ data: { ...initialData(), tab: 'readOnly' } });
    render(<App />);
    expect(screen.getByRole('button', { name: 'Play here' })).toBeTruthy();
    tap('Learn');
    await loaded();
    expect(heading()).toBe('Learn');
    tap('Lesson 2: A hand, step by step');
    expect(heading()).toBe('A hand, step by step');
    tap('Back');
    tap('Back');
    expect(screen.getByRole('button', { name: 'Play here' })).toBeTruthy();
    // A game screen in the stack still shows Home only.
    act(() =>
      appStore.setState({
        ui: {
          ...appStore.getState().ui,
          nav: { screens: ['home', 'table', 'learn'], overlays: [] },
        },
      }),
    );
    expect(screen.getByRole('button', { name: 'Play here' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Learn', level: 1 })).toBeNull();
  }, 30_000);
});
