// @vitest-environment jsdom
/**
 * The hand drill's chunks cannot load (PLAN §13.5, §15.3: offline before they were cached): the
 * frame keeps Back and the title, says so (F.10 `en.screens`), and offers Try again (a reload).
 * Its own file: a chunk that loaded once stays loaded for the rest of the module graph.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appStore, initialUi, setDrillLoader } from '../../src/app/store.ts';
import { en } from '../../src/i18n/en.ts';
import { App } from '../../src/ui/App.tsx';

afterEach(cleanup);

describe('the hand drill when its chunks cannot load', { timeout: 20_000 }, () => {
  it('shows the title, the failure line, Try again and Back', async () => {
    appStore.setState({ ui: initialUi(false) });
    setDrillLoader(() => Promise.reject(new Error('offline')));
    render(<App />);
    act(() => appStore.getState().dispatch({ type: 'go', screen: 'drill' }));
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await vi.dynamicImportSettled();
      });
    }
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(en.drill.title);
    expect(screen.getByRole('alert').textContent).toBe(en.screens.loadFailed);
    expect(screen.getByRole('button', { name: en.screens.tryAgain })).toBeTruthy();
    expect(screen.getByRole('button', { name: en.back })).toBeTruthy();
    expect(document.querySelector('[data-question]')).toBeNull();
  });
});
