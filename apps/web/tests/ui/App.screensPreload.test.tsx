// @vitest-environment jsdom
/**
 * The screens after the first tap are a lazy chunk (PLAN §15.3) that App asks for as soon as the
 * first screen is painted, without any tap: so the first tap renders its screen at once, with no
 * "Loading…" in between. (This file must not load the chunk any other way first.)
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialReview } from '../../src/app/review.ts';
import { appStore, initialGame, initialUi } from '../../src/app/store.ts';
import { en } from '../../src/i18n/en.ts';
import { App } from '../../src/ui/App.tsx';

beforeEach(() => {
  appStore.setState({ game: initialGame(), ui: initialUi(false), review: initialReview() });
});
afterEach(cleanup);

describe('the screens chunk', () => {
  it('is asked for after the first paint, so the first tap shows its screen at once', async () => {
    render(<App />);
    expect(appStore.getState().ui.screen).toBe('home');
    // The first animation frame after App mounts asks for the chunk; nothing is tapped.
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await vi.dynamicImportSettled();
    });
    act(() => appStore.getState().dispatch({ type: 'go', screen: 'settings' }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(en.settings.title);
    expect(screen.queryByText(en.screens.loading)).toBeNull();
  });
});
