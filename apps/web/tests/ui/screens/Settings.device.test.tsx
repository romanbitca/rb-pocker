// @vitest-environment jsdom
/**
 * Settings' Display and Sound sections (PLAN §12.1, §12.8, §12.13; chunks 9.1 and 9.1b): Display
 * holds "Four-colour cards", "Text size" (Normal / Large), "Reduce motion" (Follow system / On /
 * Off) and "Keep screen on"; Sound holds "Sound" and "Vibration"; a change is sent at once; where
 * the page cannot keep the screen on, the row says why; every control is 44×44 px or more. Also
 * the wake lock support the Settings wrapper reads, and the store wiring (a row changes the
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
  showEquity: true,
};

const ON: DisplayAndSoundSettings = {
  fourColour: true,
  textSize: 'normal',
  reduceMotion: 'system',
  keepAwake: true,
  sound: true,
  haptics: true,
};

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

const radios = (group: string) =>
  within(screen.getByRole('group', { name: group })).getAllByRole('radio') as HTMLInputElement[];
const choices = (group: string) =>
  radios(group).map((r) => [r.labels?.[0]?.textContent, r.checked]);

describe('Settings: Display and Sound (§12.1)', () => {
  it('come after Game: Display in the §12.1 order, then "Sound" and "Vibration" under Sound', () => {
    renderSettings();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Game',
      'Display',
      'Sound',
    ]);
    const display = screen.getByRole('region', { name: 'Display' });
    // Four-colour cards (on), text size, reduce motion, keep screen on (§12.1).
    const rows = [...display.querySelectorAll('label, fieldset')].filter(
      (el) => el.tagName === 'FIELDSET' || el.querySelector('[role="switch"]') !== null,
    );
    expect(
      rows.map((el) =>
        el.tagName === 'FIELDSET'
          ? el.querySelector('legend')?.textContent
          : el.querySelector('[id$="-label"]')?.textContent,
      ),
    ).toEqual(['Four-colour cards', 'Text size', 'Reduce motion', 'Keep screen on']);
    expect(within(display).getAllByRole('switch')).toHaveLength(2);
    within(display).getByRole('switch', { name: 'Keep screen on' });
    const sound = screen.getByRole('region', { name: 'Sound' });
    expect(within(sound).getAllByRole('switch')).toHaveLength(2);
    within(sound).getByRole('switch', { name: 'Sound' });
    within(sound).getByRole('switch', { name: 'Vibration' });
  });

  it('four-colour cards: a switch with Setup`s words; a change is sent at once', () => {
    const { onChange } = renderSettings();
    const four = screen.getByRole('switch', { name: 'Four-colour cards' }) as HTMLInputElement;
    expect(four.checked).toBe(true);
    expect(hintOf(four)).toBe('Each suit has its own colour.');
    fireEvent.click(four);
    expect(onChange.mock.calls).toEqual([[{ fourColour: false }]]);
    cleanup();
    renderSettings({ settings: { ...ON, fourColour: false } });
    expect(
      (screen.getByRole('switch', { name: 'Four-colour cards' }) as HTMLInputElement).checked,
    ).toBe(false);
  });

  it('text size: Normal or Large (§12.12), as chips; a change is sent at once', () => {
    const { onChange } = renderSettings();
    expect(choices('Text size')).toEqual([
      ['Normal', true],
      ['Large', false],
    ]);
    expect(screen.getByRole('group', { name: 'Text size' }).getAttribute('aria-describedby')).toBe(
      screen.getByText('Large makes the words bigger.').id,
    );
    fireEvent.click(radios('Text size')[1] as HTMLInputElement);
    expect(onChange.mock.calls).toEqual([[{ textSize: 'large' }]]);
    cleanup();
    renderSettings({ settings: { ...ON, textSize: 'large' } });
    expect(choices('Text size')).toEqual([
      ['Normal', false],
      ['Large', true],
    ]);
  });

  it('reduce motion: Follow system, On or Off (§12.8); a change is sent at once', () => {
    const { onChange } = renderSettings({ settings: { ...ON, reduceMotion: 'on' } });
    expect(choices('Reduce motion')).toEqual([
      ['Follow system', false],
      ['On', true],
      ['Off', false],
    ]);
    expect(hintOf(screen.getByRole('group', { name: 'Reduce motion' }))).toBe(
      'On: less movement. Follow system: as your phone or computer is set.',
    );
    fireEvent.click(radios('Reduce motion')[2] as HTMLInputElement);
    fireEvent.click(radios('Reduce motion')[0] as HTMLInputElement);
    expect(onChange.mock.calls).toEqual([[{ reduceMotion: 'off' }], [{ reduceMotion: 'system' }]]);
  });

  it('each switch shows its setting and sends only its own change', () => {
    const { onChange } = renderSettings({
      settings: { ...ON, keepAwake: true, sound: false, haptics: true },
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
    // Back, 4 + 4 level cards, 3 speeds, 2 amounts, 2 text sizes, 3 motion choices, 6 switches.
    expect(controlCount(container)).toBe(25);
    expect(smallTargets(container, () => false)).toEqual([]);
  });

  it('the sections alone render with no Settings around them', () => {
    const onChange = vi.fn();
    render(<DisplayAndSound settings={ON} wakeLock="yes" onChange={onChange} />);
    expect(screen.getAllByRole('switch')).toHaveLength(4);
    expect(screen.getAllByRole('radio')).toHaveLength(5);
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
  it('a row changes the settings the controller saves; the words are chunk 9.1`s and 9.1b`s', async () => {
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
        // Chunk 9.1b: the rows §12.1 lists that had none.
        fireEvent.click(screen.getByRole('switch', { name: deviceWords.winChance.label }));
        fireEvent.click(screen.getByRole('switch', { name: 'Four-colour cards' }));
        fireEvent.click(radios(deviceWords.textSize.label)[1] as HTMLInputElement);
        fireEvent.click(radios(deviceWords.reduceMotion.label)[1] as HTMLInputElement);
      });
      expect(patches).toEqual([
        { keepAwake: false },
        { sound: false },
        { haptics: false },
        { showEquity: false },
        { fourColour: false },
        { textSize: 'large' },
        { reduceMotion: 'on' },
      ]);
    } finally {
      appStore.setGameHandler(null);
    }
  });
});
