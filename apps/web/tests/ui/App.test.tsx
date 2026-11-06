// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { appStore, defaultGameSettings, initialData, initialUi } from '../../src/app/store.ts';
import { en } from '../../src/i18n/en.ts';
import { App } from '../../src/ui/App.tsx';
import { loadScreens } from '../../src/ui/screensModule.ts';

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

  it('leaves the service worker to the app side (PLAN §15.1, chunk 9.5: app/swUpdate.ts)', () => {
    const register = vi.fn(() => new Promise<never>(() => {}));
    Object.defineProperty(navigator, 'serviceWorker', { value: { register }, configurable: true });
    try {
      render(<App />);
      expect(register).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(navigator, 'serviceWorker');
    }
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

  it('Large text size puts data-text on the root before the first paint (§12.12, chunk 9.1b)', () => {
    const root = document.documentElement;
    appStore.setState({ settings: { ...defaultGameSettings(), textSize: 'large' } });
    // A layout effect: set in the same commit as the first render, before the browser paints.
    let atCommit: string | undefined;
    function Probe() {
      useLayoutEffect(() => {
        atCommit = root.dataset.text;
      });
      return null;
    }
    render(
      <>
        <App />
        <Probe />
      </>,
    );
    expect(atCommit).toBe('large');
    expect(root.dataset.text).toBe('large');
    act(() => appStore.setState({ settings: defaultGameSettings() }));
    expect(root.dataset.text).toBeUndefined();
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

describe('chunk 8.4: install hints and the Data dialogs over every screen', () => {
  afterEach(() => {
    appStore.setGameHandler(null);
    act(() => appStore.setState({ data: initialData(), ui: initialUi(false) }));
  });

  it('Home: the Install tile while the browser offers it, and the one-time card; their taps go to the controller', () => {
    const sent: string[] = [];
    appStore.setGameHandler((cmd) => sent.push(cmd.type));
    appStore.setState({
      ui: initialUi(false),
      data: { ...initialData(), install: true, nudge: 'installCard' },
    });
    render(<App />);
    act(() => screen.getByRole('button', { name: en.home.install }).click());
    act(() => screen.getByRole('button', { name: en.nudge.installNow }).click());
    act(() => screen.getByRole('button', { name: en.nudge.notNow }).click());
    expect(sent).toEqual(['install', 'install', 'dismissNudge']);
  });

  it('Welcome: "Played in Safari before?" picks a file for Import', () => {
    const sent: { type: string; file?: unknown }[] = [];
    appStore.setGameHandler((cmd) => sent.push(cmd));
    appStore.setState({ ui: initialUi(true), data: { ...initialData(), nudge: 'safariImport' } });
    const { container } = render(<App />);
    const file = new File(['{}'], 'stats.json');
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(sent).toEqual([]); // no file picked yet
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(sent).toEqual([{ type: 'importFile', file }]);
  });

  it('Import`s preview and "Delete my stats" open over the screen in force (the screens chunk)', () => {
    const sent: string[] = [];
    appStore.setGameHandler((cmd) => sent.push(cmd.type));
    appStore.setState({
      ui: initialUi(false),
      data: {
        ...initialData(),
        importCheck: { status: 'ready', hands: 3, exportedAt: '2026-11-06T10:00:00.000Z' },
      },
    });
    act(() => appStore.getState().dispatch({ type: 'open', overlay: 'dataImport' }));
    const { unmount } = render(<App />);
    expect(screen.getByRole('alertdialog', { name: 'Import stats' }).textContent).toContain(
      '3 hands, exported 6 Nov 2026',
    );
    act(() => screen.getByRole('button', { name: 'Replace' }).click());
    expect(sent).toEqual(['importConfirm']);
    unmount();

    act(() => appStore.getState().dispatch({ type: 'open', overlay: 'dataReset' }));
    render(<App />);
    act(() => screen.getByRole('button', { name: 'Delete my stats' }).click());
    expect(sent).toEqual(['importConfirm', 'resetStats']);
    expect(appStore.getState().ui.overlays).not.toContain('dataReset');
  });
});
