// @vitest-environment jsdom
/**
 * A bug in Review must not take the game down with it (PLAN §12.14 spirit): if the screen throws
 * while rendering, the app goes Back to the Table instead of unmounting.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialReview, type ReviewHand } from '../../src/app/review.ts';
import { appStore, initialGame, initialUi } from '../../src/app/store.ts';
import { App } from '../../src/ui/App.tsx';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [false, () => {}],
    offlineReady: [false, () => {}],
    updateServiceWorker: async () => {},
  }),
}));

beforeEach(() => {
  appStore.setState({ game: initialGame(), ui: initialUi(false), review: initialReview() });
  appStore.getState().dispatch({ type: 'go', screen: 'table' });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('when Review throws while rendering', () => {
  it('the app takes Back: the Table is still there', async () => {
    // A hand with no record: building its frames throws a TypeError in the screen.
    const broken = { handSeq: 1, at: '', record: null, heroHole: null, end: null } as unknown;
    appStore.setState({ review: { hands: [broken as ReviewHand], selected: null } });
    // React logs the error it hands to the boundary.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<App />);
    expect(appStore.getState().ui.screen).toBe('table');
    act(() => appStore.getState().dispatch({ type: 'review', handSeq: 1 }));
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    expect(appStore.getState().ui.screen).toBe('table');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Poker table');
  });
});
