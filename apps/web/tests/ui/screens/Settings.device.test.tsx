// @vitest-environment jsdom
/**
 * Settings' Display and Sound sections (PLAN §12.1, §12.8, §12.13; chunk 9.1): "Keep screen on",
 * "Sound" and "Vibration" are switches after the Game section; a change is sent at once; where the
 * page cannot keep the screen on, the row says why; every control is 44×44 px or more. Also the
 * wake lock support the Settings wrapper reads, and the store wiring (a switch changes the
 * settings the controller saves).
 */
import '../../../src/ui/styles/tokens.css';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deviceWords } from '../../../src/i18n/device.ts';
import {
  DisplayAndSound,
  wakeLockSupport,
  type DisplayAndSoundProps,
  type DisplayAndSoundSettings,
} from '../../../src/ui/screens/DisplayAndSound.tsx';
import { Settings, type GameSettings } from '../../../src/ui/screens/Settings.tsx';
import { AVAILABLE_LEVELS } from '../../../src/ui/screens/setupForm.ts';
import { controlCount, smallTargets } from './targets.ts';

afterEach(cleanup);

const GAME: GameSettings = {
  coachLevel: 'beginner',
  botLevel: 'easy',
  speed: 'normal',
  autoNext: true,
  amounts: 'chips',
};

const ON: DisplayAndSoundSettings = { keepAwake: true, sound: true, haptics: true };

function renderSettings(device: Partial<DisplayAndSoundProps> = {}) {
  const onChange = vi.fn();
  const props = {
    settings: GAME,
    available: AVAILABLE_LEVELS,
    onChangeSettings: vi.fn(),
    onBack: vi.fn(),
    device: { settings: ON, wakeLock: 'yes' as const, onChange, ...device },
  };
  return { onChange, ...render(<Settings {...props} />) };
}

const hintOf = (el: HTMLElement): string | null =>
  document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent ?? null;

describe('Settings: Display and Sound (§12.1)', () => {
  it('come after Game: "Keep screen on" under Display; "Sound" and "Vibration" under Sound', () => {
    renderSettings();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Game',
      'Display',
      'Sound',
    ]);
    const display = screen.getByRole('region', { name: 'Display' });
    expect(within(display).getAllByRole('switch')).toHaveLength(1);
    within(display).getByRole('switch', { name: 'Keep screen on' });
    const sound = screen.getByRole('region', { name: 'Sound' });
    expect(within(sound).getAllByRole('switch')).toHaveLength(2);
    within(sound).getByRole('switch', { name: 'Sound' });
    within(sound).getByRole('switch', { name: 'Vibration' });
  });

  it('each switch shows its setting and sends only its own change', () => {
    const { onChange } = renderSettings({
      settings: { keepAwake: true, sound: false, haptics: true },
    });
    const keep = screen.getByRole('switch', { name: 'Keep screen on' }) as HTMLInputElement;
    const sound = screen.getByRole('switch', { name: 'Sound' }) as HTMLInputElement;
    const vibration = screen.getByRole('switch', { name: 'Vibration' }) as HTMLInputElement;
    expect([keep.checked, sound.checked, vibration.checked]).toEqual([true, false, true]);
    fireEvent.click(keep);
    fireEvent.click(sound);
    fireEvent.click(vibration);
    expect(onChange.mock.calls).toEqual([
      [{ keepAwake: false }],
      [{ sound: true }],
      [{ haptics: false }],
    ]);
  });

  it('the hints say what each one does, in plain words', () => {
    renderSettings();
    expect(hintOf(screen.getByRole('switch', { name: 'Keep screen on' }))).toBe(
      'The screen stays on while you play a hand.',
    );
    expect(hintOf(screen.getByRole('switch', { name: 'Sound' }))).toBe(
      'Short sounds for cards, chips and your turn.',
    );
    expect(hintOf(screen.getByRole('switch', { name: 'Vibration' }))).toBe(
      'Android only: a short buzz on your turn and when you win.',
    );
  });

  it('where the screen cannot be kept on, the row says why and the switch stays', () => {
    renderSettings({ wakeLock: 'insecure' });
    const keep = screen.getByRole('switch', { name: 'Keep screen on' }) as HTMLInputElement;
    expect(hintOf(keep)).toBe(
      'The screen stays on while you play a hand. Needs a secure connection (https).',
    );
    expect(keep.disabled).toBe(false);
    cleanup();
    renderSettings({ wakeLock: 'missing' });
    expect(hintOf(screen.getByRole('switch', { name: 'Keep screen on' }))).toBe(
      'The screen stays on while you play a hand. This browser cannot do this.',
    );
  });

  it('every control is at least 44×44 px (§12.12)', () => {
    const { container } = renderSettings();
    // Back, 4 + 4 level cards, 3 speeds, 2 amounts, 4 switches.
    expect(controlCount(container)).toBe(18);
    expect(smallTargets(container, () => false)).toEqual([]);
  });

  it('the sections alone render with no Settings around them', () => {
    const onChange = vi.fn();
    render(<DisplayAndSound settings={ON} wakeLock="yes" onChange={onChange} />);
    expect(screen.getAllByRole('switch')).toHaveLength(3);
  });
});

describe('wakeLockSupport (§12.14)', () => {
  const win = (isSecureContext: boolean, navigator: object) =>
    ({ isSecureContext, navigator }) as unknown as Window;

  it('yes on a secure page with navigator.wakeLock', () => {
    expect(wakeLockSupport(win(true, { wakeLock: {} }))).toBe('yes');
  });

  it('insecure on plain http (the LAN address), whatever the browser has', () => {
    expect(wakeLockSupport(win(false, {}))).toBe('insecure');
    expect(wakeLockSupport(win(false, { wakeLock: {} }))).toBe('insecure');
    expect(wakeLockSupport(undefined)).toBe('insecure');
  });

  it('missing in a browser without it; a throwing getter counts as missing', () => {
    expect(wakeLockSupport(win(true, {}))).toBe('missing');
    const throwing = Object.defineProperty({}, 'wakeLock', {
      get() {
        throw new Error('no');
      },
    });
    expect(wakeLockSupport(win(true, throwing))).toBe('missing');
  });
});

describe('the Settings screen in the app (store wiring)', () => {
  it('a switch changes the settings the controller saves; the words are the chunk 9.1 words', async () => {
    const [{ appStore, defaultGameSettings }, { loadScreens }] = await Promise.all([
      import('../../../src/app/store.ts'),
      import('../../../src/ui/screensModule.ts'),
    ]);
    const { SettingsScreen } = await loadScreens();
    const patches: unknown[] = [];
    appStore.setState({ settings: defaultGameSettings() });
    appStore.setGameHandler((cmd) => {
      if (cmd.type === 'settings') patches.push(cmd.patch);
    });
    try {
      render(<SettingsScreen />);
      act(() => {
        fireEvent.click(screen.getByRole('switch', { name: deviceWords.keepAwake.label }));
        fireEvent.click(screen.getByRole('switch', { name: deviceWords.sound.label }));
        fireEvent.click(screen.getByRole('switch', { name: deviceWords.vibration.label }));
      });
      expect(patches).toEqual([{ keepAwake: false }, { sound: false }, { haptics: false }]);
    } finally {
      appStore.setGameHandler(null);
    }
  });
});
