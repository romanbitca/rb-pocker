// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { appStore, defaultGameSettings, initialData, initialUi } from '../../src/app/store.ts';
import { en } from '../../src/i18n/en.ts';
import { App } from '../../src/ui/App.tsx';
import { loadScreens } from '../../src/ui/screensModule.ts';

const { useRegisterSW } = vi.hoisted(() => ({
  useRegisterSW: vi.fn(() => ({
    needRefresh: [false, () => {}],
    offlineReady: [false, () => {}],
    updateServiceWorker: async () => {},
  })),
}));
vi.mock('virtual:pwa-register/react', () => ({ useRegisterSW }));

beforeAll(async () => {
  await loadScreens(); // the screens lazy chunk, as App asks for it after the first paint
});

afterEach(cleanup);

describe('App', () => {
  it('shows the product name as the page heading', () => {
    render(<App />);

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe('RB Poker Coach');
    expect(heading.textContent).toBe(en.app.name);
  });

  it('takes its copy from i18n/en.ts', () => {
    render(<App />);

    expect(screen.getByText(en.app.tagline)).toBeTruthy();
  });

  it('registers the service worker through useRegisterSW (PLAN §15.1)', () => {
    useRegisterSW.mockClear();
    render(<App />);

    expect(useRegisterSW).toHaveBeenCalled();
  });

  it('the speed, reduce-motion and deck settings reach the root element (PLAN §12.8)', () => {
    appStore.setState({
      settings: {
        ...defaultGameSettings(),
        speed: 'instant',
        reduceMotion: 'on',
        fourColour: false,
      },
    });
    render(<App />);
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--speed')).toBe('0');
    expect(root.dataset.motion).toBe('reduced');
    expect(root.dataset.deck).toBe('two');

    act(() => appStore.setState({ settings: { ...defaultGameSettings(), reduceMotion: 'off' } }));
    expect(root.style.getPropertyValue('--speed')).toBe('1');
    expect(root.dataset.motion).toBe('full');
    expect(root.dataset.deck).toBeUndefined();

    act(() => appStore.setState({ settings: { ...defaultGameSettings(), speed: 'fast' } }));
    expect(root.style.getPropertyValue('--speed')).toBe('0.5');
    expect(root.dataset.motion).toBeUndefined();
  });
});

describe('a read-only tab (§14.7)', () => {
  it('every game screen shows Home with the banner; "Play here" goes to the controller', () => {
    const sent: string[] = [];
    appStore.setGameHandler((cmd) => sent.push(cmd.type));
    appStore.setState({ ui: initialUi(false), data: { ...initialData(), tab: 'readOnly' } });
    for (const screenName of ['welcome', 'setup', 'table', 'settings'] as const) {
      act(() => appStore.getState().dispatch({ type: 'go', screen: screenName }));
      const { unmount } = render(<App />);
      expect(screen.getByRole('alert').textContent).toBe(en.otherTab.text);
      expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
      act(() => screen.getByRole('button', { name: en.otherTab.playHere }).click());
      unmount();
    }
    expect(sent).toEqual(['playHere', 'playHere', 'playHere', 'playHere']);
    act(() => appStore.setState({ data: initialData(), ui: initialUi(false) }));
    render(<App />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
    appStore.setGameHandler(null);
  });
});
