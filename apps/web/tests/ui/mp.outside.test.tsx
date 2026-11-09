// @vitest-environment jsdom
/**
 * Outside Telegram none of Play with friends is asked for (PLAN §19.1, Stage 10 acceptance 14): the
 * app's whole run in single-player, from the first screen through a hand, Menu and Back, never
 * reaches the loader of that chunk (`review.bundle.test.ts` checks the files, this the run).
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/ui/App.tsx';
import { loadMp, useMpModule } from '../../src/ui/mpModule.ts';
import { loadScreens } from '../../src/ui/screensModule.ts';
import { startTableHarness, type TableHarness } from './tableHarness.ts';

vi.mock('../../src/ui/mpModule.ts', async (actual) => {
  const real = await actual<typeof import('../../src/ui/mpModule.ts')>();
  return { ...real, loadMp: vi.fn(real.loadMp), useMpModule: vi.fn(real.useMpModule) };
});

beforeAll(async () => {
  await loadScreens(); // the screens chunk evaluates: it must not ask for this one by itself
});

let h: TableHarness | null = null;

afterEach(() => {
  cleanup();
  h?.dispose();
  h = null;
});

describe('a game outside Telegram', () => {
  it('never asks for the chunk of Play with friends', () => {
    h = startTableHarness();
    render(<App />);
    expect(screen.queryByRole('button', { name: 'Play with friends' })).toBeNull();
    act(() => h?.state().dispatch({ type: 'play' }));
    expect(h.state().ui.screen).toBe('table');
    act(() => h?.state().dispatch({ type: 'open', overlay: 'menu' }));
    act(() => h?.state().dispatch({ type: 'close', overlay: 'menu' }));
    act(() => h?.state().dispatch({ type: 'open', overlay: 'outOfChips' }));
    act(() => h?.state().dispatch({ type: 'close', overlay: 'outOfChips' }));
    act(() => h?.state().dispatch({ type: 'back' }));
    expect(loadMp).not.toHaveBeenCalled();
    expect(useMpModule).not.toHaveBeenCalled();
  });
});
