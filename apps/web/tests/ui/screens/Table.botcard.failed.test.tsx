// @vitest-environment jsdom
/**
 * The bot card's chunk cannot be loaded (chunk 5.10: for example a browser that dropped the cached
 * file during an app update). A tap on a seat must not take the app down or leave the `sheet`
 * gate shut over an empty screen: the overlay closes again and the bots play on. A separate file,
 * because `vi.mock` replaces the module for the whole file.
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../src/ui/App.tsx';
import { elapse, playUntil, startTableHarness, type TableHarness } from '../tableHarness.ts';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [false, () => {}],
    offlineReady: [false, () => {}],
    updateServiceWorker: async () => {},
  }),
}));

// importing the module throws, so `import('./components/BotCard.tsx')` rejects
vi.mock('../../../src/ui/components/BotCard.tsx', () => {
  throw new Error('chunk failed to load');
});

let h: TableHarness;

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  h = startTableHarness();
});
afterEach(() => {
  cleanup();
  h.dispose();
  vi.restoreAllMocks();
});

describe('the bot card when its chunk fails to load', () => {
  it('closes again at once, keeps the table, and play goes on', async () => {
    render(<App />);
    act(() => h.state().dispatch({ type: 'play' }));
    await playUntil(() => h.state().game.mode === 'botTurn');
    const before = h.controller.snapshot().inputs.length;

    fireEvent.click(document.querySelector('[data-seat="2"] > button') as Element);
    await act(async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });

    expect(h.state().ui.overlays).toEqual([]);
    expect(h.state().ui.botCardSeat).toBeNull();
    expect(h.state().ui.gates).toEqual([]);
    expect(h.state().ui.screen).toBe('table');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelectorAll('[data-seat]').length).toBeGreaterThan(0);

    await elapse(4000);
    expect(h.controller.snapshot().inputs.length).toBeGreaterThan(before);
  }, 20_000);
});
