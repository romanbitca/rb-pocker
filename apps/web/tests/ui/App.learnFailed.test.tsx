// @vitest-environment jsdom
/**
 * Learn is a lazy chunk (PLAN §12.1, §15.3, chunk 9.2). While it loads, its page shows the heading
 * "Learn" (the "Loading…" line comes after half a second, by CSS); if its files cannot be loaded
 * (no connection and not cached yet), the app says so and leaves by Back; it never crashes.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { appStore, initialGame, initialUi } from '../../src/app/store.ts';
import { en } from '../../src/i18n/en.ts';
import { App } from '../../src/ui/App.tsx';
import { loadScreens } from '../../src/ui/screensModule.ts';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [false, () => {}],
    offlineReady: [false, () => {}],
    updateServiceWorker: async () => {},
  }),
}));
// The screen's module fails to load, as a chunk does when the network is down.
vi.mock('../../src/ui/screens/Learn.tsx', () => {
  throw new Error('the chunk did not load');
});

beforeAll(async () => {
  await loadScreens(); // the screens lazy chunk, as App asks for it after the first paint
});

beforeEach(() => {
  appStore.setState({ game: initialGame(), ui: initialUi(false) });
});
afterEach(cleanup);

describe('when the Learn chunk does not load', () => {
  it('shows its heading while it loads, then says it could not load, and Back leaves', async () => {
    render(<App />);
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Learn' })));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Learn');
    expect(screen.getByText(en.screens.loading)).toBeTruthy();
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    expect(screen.getByRole('alert').textContent).toBe(en.screens.loadFailed);
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Back' })));
    expect(appStore.getState().ui.screen).toBe('home');
  }, 15_000);

  it('a lesson from Welcome fails the same way, back to Welcome', async () => {
    appStore.setState({ ui: initialUi(true) });
    render(<App />);
    act(() => void fireEvent.click(screen.getByRole('button', { name: en.welcome.guide })));
    expect(appStore.getState().ui.screen).toBe('lesson');
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    expect(screen.getByRole('alert').textContent).toBe(en.screens.loadFailed);
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Back' })));
    expect(appStore.getState().ui.screen).toBe('welcome');
  }, 15_000);
});
