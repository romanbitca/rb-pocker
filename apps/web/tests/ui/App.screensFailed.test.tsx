// @vitest-environment jsdom
/**
 * The screens after the first tap are a lazy chunk (PLAN §15.3). If it cannot be loaded (no
 * connection and not cached yet), the screen says so, offers Try again (a reload: a browser may
 * keep a module that failed to load as failed until then) and Back; the app never crashes, and an
 * overlay from the chunk draws nothing.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialReview } from '../../src/app/review.ts';
import { appStore, initialGame, initialUi } from '../../src/app/store.ts';
import { en } from '../../src/i18n/en.ts';
import { App } from '../../src/ui/App.tsx';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [false, () => {}],
    offlineReady: [false, () => {}],
    updateServiceWorker: async () => {},
  }),
}));
// The chunk fails to load, as it does when the network is down.
vi.mock('../../src/ui/screensEntry.tsx', () => {
  throw new Error('the chunk did not load');
});

beforeEach(() => {
  appStore.setState({ game: initialGame(), ui: initialUi(false), review: initialReview() });
});
afterEach(cleanup);

describe('when the screens chunk does not load', () => {
  it('says so, offers Try again and Back, and Back leaves', async () => {
    render(<App />);
    act(() => appStore.getState().dispatch({ type: 'go', screen: 'settings' }));
    expect(screen.getByText(en.screens.loading)).toBeTruthy();
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    expect(screen.getByRole('alert').textContent).toBe(en.screens.loadFailed);
    expect(screen.getByRole('button', { name: en.screens.tryAgain })).toBeTruthy();
    // An overlay from the chunk draws nothing (and never throws).
    act(() => appStore.getState().dispatch({ type: 'open', overlay: 'newTable' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => appStore.getState().dispatch({ type: 'close', overlay: 'newTable' }));
    act(() => void fireEvent.click(screen.getByRole('button', { name: en.back })));
    expect(appStore.getState().ui.screen).toBe('home');
  });
});
