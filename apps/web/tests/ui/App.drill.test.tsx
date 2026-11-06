// @vitest-environment jsdom
/**
 * The hand drill in the app (PLAN §13.5, §12.1): Home's "Hand drill" opens the page through its
 * frame (the screens chunk) and its two lazy chunks (the page, and the logic that boot's loader
 * brings in); the title takes the focus; Back returns Home. Learn's "Practise the 10 hands" opens
 * it too (chunk 9.2). A read-only tab has no Hand drill button (§14.7), on Home or in Learn.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appStore, initialData, initialUi, setDrillLoader } from '../../src/app/store.ts';
import { en } from '../../src/i18n/en.ts';
import { learnWords } from '../../src/i18n/learn.ts';
import { App } from '../../src/ui/App.tsx';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [false, () => {}],
    offlineReady: [false, () => {}],
    updateServiceWorker: async () => {},
  }),
}));

/** Lets every pending dynamic import (and the renders after them) finish. */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await vi.dynamicImportSettled();
    });
  }
}

beforeEach(() => {
  appStore.setState({ ui: initialUi(false), data: initialData() });
  setDrillLoader(() => import('../../src/app/drill.ts'));
  window.localStorage.clear();
});

afterEach(cleanup);

describe('the hand drill from Home', { timeout: 20_000 }, () => {
  it('opens the page, gives its title the focus, and Back returns Home', async () => {
    render(<App />);
    await settle(); // the screens chunk, asked for after the first paint
    fireEvent.click(screen.getByRole('button', { name: en.drill.title }));
    expect(appStore.getState().ui.nav.screens).toEqual(['home', 'drill']);
    await settle();
    const title = screen.getByRole('heading', { level: 1 });
    expect(title.textContent).toBe(en.drill.title);
    expect(document.activeElement).toBe(title);
    expect(document.querySelector('[data-question]')?.getAttribute('data-question')).toBe('cards');
    expect(document.querySelectorAll('[data-question] ~ * [role="img"]')).toHaveLength(5);

    fireEvent.click(screen.getByRole('button', { name: en.back }));
    expect(appStore.getState().ui.nav.screens).toEqual(['home']);
    expect(screen.getByRole('button', { name: en.drill.title })).toBeTruthy();
  });

  it('has no Hand drill button in a read-only tab (another tab has the game)', async () => {
    appStore.setState({ data: { ...initialData(), tab: 'readOnly' } });
    render(<App />);
    await settle();
    expect(screen.queryByRole('button', { name: en.drill.title })).toBeNull();
  });
});

describe(
  'the hand drill from Learn (chunk 9.2: "Practise the 10 hands")',
  { timeout: 20_000 },
  () => {
    it('opens the page over Learn, and Back returns to Learn', async () => {
      render(<App />);
      await settle(); // the screens chunk, asked for after the first paint
      fireEvent.click(screen.getByRole('button', { name: en.home.learn }));
      await settle();
      fireEvent.click(await screen.findByRole('button', { name: learnWords.drill }));
      expect(appStore.getState().ui.nav.screens).toEqual(['home', 'learn', 'drill']);
      await settle();
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(en.drill.title);
      fireEvent.click(screen.getByRole('button', { name: en.back }));
      expect(appStore.getState().ui.nav.screens).toEqual(['home', 'learn']);
    });

    it('a read-only tab opens Learn, without the drill', async () => {
      appStore.setState({ data: { ...initialData(), tab: 'readOnly' } });
      render(<App />);
      await settle();
      fireEvent.click(screen.getByRole('button', { name: en.home.learn }));
      await settle();
      expect(await screen.findByRole('button', { name: /^Lesson 1: / })).toBeTruthy();
      expect(screen.queryByRole('button', { name: learnWords.drill })).toBeNull();
    });
  },
);
