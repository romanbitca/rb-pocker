// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appStore, defaultGameSettings } from '../../src/app/store.ts';
import { en } from '../../src/i18n/en.ts';
import { App } from '../../src/ui/App.tsx';

const { useRegisterSW } = vi.hoisted(() => ({
  useRegisterSW: vi.fn(() => ({
    needRefresh: [false, () => {}],
    offlineReady: [false, () => {}],
    updateServiceWorker: async () => {},
  })),
}));
vi.mock('virtual:pwa-register/react', () => ({ useRegisterSW }));

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
