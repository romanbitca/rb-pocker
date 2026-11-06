// @vitest-environment jsdom
/**
 * Review is a lazy screen (PLAN §15.3). If its files cannot be loaded (no connection and not
 * cached yet), the app says so and leaves by Back; it never crashes.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialReview } from '../../src/app/review.ts';
import { appStore, initialGame, initialUi } from '../../src/app/store.ts';
import { App } from '../../src/ui/App.tsx';
import { loadScreens } from '../../src/ui/screensModule.ts';

// The screen's module fails to load, as a chunk does when the network is down.
vi.mock('../../src/ui/screens/Review.tsx', () => {
  throw new Error('the chunk did not load');
});

beforeAll(async () => {
  await loadScreens(); // the screens lazy chunk, as App asks for it after the first paint
});

beforeEach(() => {
  appStore.setState({ game: initialGame(), ui: initialUi(false), review: initialReview() });
});
afterEach(cleanup);

describe('when the Review chunk does not load', () => {
  it('shows a loading line, then says it could not load, and Back leaves', async () => {
    render(<App />);
    act(() => appStore.getState().dispatch({ type: 'review', handSeq: null }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Review');
    expect(screen.getByText('Loading…')).toBeTruthy();
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    expect(screen.getByText(/Review could not be loaded/)).toBeTruthy();
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Back' })));
    expect(appStore.getState().ui.screen).toBe('home');
  });
});
