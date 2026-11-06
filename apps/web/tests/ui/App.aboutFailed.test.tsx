// @vitest-environment jsdom
/**
 * About's page is a lazy chunk of its own (PLAN §15.3, chunk 9.2c). If it cannot be loaded (no
 * connection and not cached yet), the screen says so, offers Try again (a reload) and Back, and the
 * app never crashes.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialReview } from '../../src/app/review.ts';
import { appStore, initialGame, initialUi } from '../../src/app/store.ts';
import { App } from '../../src/ui/App.tsx';
import { loadScreens } from '../../src/ui/screensModule.ts';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [false, () => {}],
    offlineReady: [false, () => {}],
    updateServiceWorker: async () => {},
  }),
}));
// The page's module fails to load, as a chunk does when the network is down.
vi.mock('../../src/ui/screens/About.tsx', () => {
  throw new Error('the chunk did not load');
});

beforeAll(async () => {
  await loadScreens();
});

beforeEach(() => {
  appStore.setState({ game: initialGame(), ui: initialUi(false), review: initialReview() });
});
afterEach(cleanup);

describe('when the About chunk does not load', () => {
  it('says so under the title, offers Try again, and Back leaves', async () => {
    render(<App />);
    act(() => appStore.getState().dispatch({ type: 'go', screen: 'about' }));
    expect(screen.getByText('Loading…')).toBeTruthy();
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('About');
    expect(screen.getByRole('alert').textContent).toBe(
      'This screen could not be loaded. Check your connection and try again.',
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Back' })));
    expect(appStore.getState().ui.screen).toBe('home');
  });
});
