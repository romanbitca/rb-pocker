// @vitest-environment jsdom
/**
 * The mute button (PLAN §12.3, §12.8; chunk 9.1), with the real store and controller: a 44×44
 * toggle named "Sound" in the top bar (portrait, landscape, wide), pressed while sound is on; a
 * tap flips `settings.sound`. Compact mode puts Undo in its place, and the Menu turns sound off
 * and on instead ("Turn sound off" / "Turn sound on").
 */
import '../../../src/ui/styles/tokens.css';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { en } from '../../../src/i18n/en.ts';
import { App } from '../../../src/ui/App.tsx';
import { Menu } from '../../../src/ui/screens/Menu.tsx';
import { loadScreens } from '../../../src/ui/screensModule.ts';
import { startTableHarness, type TableHarness } from '../tableHarness.ts';
import { smallTargets } from './targets.ts';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [false, () => {}],
    offlineReady: [false, () => {}],
    updateServiceWorker: async () => {},
  }),
}));

beforeAll(async () => {
  await loadScreens(); // the screens lazy chunk, as App asks for it after the first paint
});

let h: TableHarness | null = null;

afterEach(() => {
  cleanup();
  h?.dispose();
  h = null;
  vi.unstubAllGlobals();
});

/** The Table on screen with a hand dealt. */
function table(): TableHarness {
  const harness = startTableHarness({ settings: { players: 3, speed: 'normal' } });
  h = harness;
  render(<App />);
  act(() => harness.state().dispatch({ type: 'play' }));
  return harness;
}

const header = (): HTMLElement => document.querySelector('header') as HTMLElement;
const soundButton = (): HTMLElement | null =>
  within(header()).queryByRole('button', { name: 'Sound' });

/** Compact mode: portrait at most 640 px tall (§12.3). */
function compactScreen(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(max-height: 640px)',
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe('the top bar mute button (§12.3)', () => {
  it('sits between the blinds line and Hands, pressed while sound is on; a tap flips the setting', () => {
    const harness = table();
    const button = soundButton() as HTMLElement;
    expect(button.getAttribute('aria-pressed')).toBe('true');
    const order = [...header().querySelectorAll('button, p')].map(
      (el) => el.getAttribute('aria-label') ?? el.tagName,
    );
    expect(order).toEqual([en.table.menu, 'P', 'Sound', en.rankings.open]);
    const iconOn = button.querySelector('path')?.getAttribute('d');

    act(() => fireEvent.click(button));
    expect(harness.state().settings.sound).toBe(false);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.querySelector('path')?.getAttribute('d')).not.toBe(iconOn);
    expect(document.activeElement).toBe(button);

    act(() => fireEvent.click(button));
    expect(harness.state().settings.sound).toBe(true);
    expect(button.getAttribute('aria-pressed')).toBe('true');
  });

  it('is 44×44 and drawn, not a character; three DOM nodes', () => {
    table();
    const button = soundButton() as HTMLElement;
    expect(smallTargets(header(), () => false)).toEqual([]);
    expect(button.textContent).toBe('');
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(button.querySelectorAll('*')).toHaveLength(2); // the svg and its one path
  });

  it('is in the top bar in landscape and on wide screens too', () => {
    const harness = table();
    act(() => harness.state().dispatch({ type: 'layout', layout: 'landscape' }));
    expect(soundButton()).not.toBeNull();
    act(() => harness.state().dispatch({ type: 'layout', layout: 'wide' }));
    expect(soundButton()).not.toBeNull();
  });

  it('the Menu has no sound item outside compact mode', () => {
    table();
    act(() => fireEvent.click(screen.getByRole('button', { name: en.table.menu })));
    const menu = screen.getByRole('dialog', { name: en.menu.title });
    expect(within(menu).queryByRole('button', { name: /sound/i })).toBeNull();
  });
});

describe('compact mode (§12.3): Undo in the top bar, sound in the Menu', () => {
  it('no mute button in the top bar; the Menu turns sound off, then on', () => {
    compactScreen();
    const harness = table();
    expect(soundButton()).toBeNull();
    expect(header().querySelector('[data-undo]')).not.toBeNull();

    act(() => fireEvent.click(screen.getByRole('button', { name: en.table.menu })));
    const off = within(screen.getByRole('dialog')).getByRole('button', { name: 'Turn sound off' });
    act(() => fireEvent.click(off));
    expect(harness.state().settings.sound).toBe(false);
    expect(harness.state().ui.overlays).toEqual([]); // the Menu closed: the game goes on

    act(() => fireEvent.click(screen.getByRole('button', { name: en.table.menu })));
    const on = within(screen.getByRole('dialog')).getByRole('button', { name: 'Turn sound on' });
    act(() => fireEvent.click(on));
    expect(harness.state().settings.sound).toBe(true);
  });
});

describe('Menu: the sound item (compact mode)', () => {
  const props = {
    onResume: () => {},
    topUpTo: null,
    onTopUp: () => {},
    onOpenSettings: () => {},
    onLeaveTable: () => {},
    onNewTable: () => {},
  };
  const labels = () =>
    within(screen.getByRole('dialog'))
      .getAllByRole('button')
      .map((b) => b.textContent);

  it('says what a tap does, before Settings; a tap toggles', () => {
    const onToggle = vi.fn();
    render(<Menu {...props} sound={{ on: true, onToggle }} />);
    expect(labels()).toEqual(['Resume', 'Turn sound off', 'Settings', 'Leave table', 'New table']);
    fireEvent.click(screen.getByRole('button', { name: 'Turn sound off' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    cleanup();
    render(<Menu {...props} sound={{ on: false, onToggle }} />);
    expect(labels()).toContain('Turn sound on');
  });
});
