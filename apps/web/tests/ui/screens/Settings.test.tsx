// @vitest-environment jsdom
// Settings, Game section (PLAN §12.1, §18 Stage 3): speed, auto next hand, amounts.
import '../../../src/ui/styles/tokens.css';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Settings, type GameSettings } from '../../../src/ui/screens/Settings.tsx';
import { controlCount, smallTargets } from './targets.ts';

afterEach(cleanup);

const GAME: GameSettings = { speed: 'normal', autoNext: true, amounts: 'chips' };

function renderSettings(settings: GameSettings = GAME) {
  const props = { settings, onChangeSettings: vi.fn(), onBack: vi.fn() };
  return { ...props, ...render(<Settings {...props} />) };
}

const radios = (group: string) =>
  within(screen.getByRole('group', { name: group })).getAllByRole('radio') as HTMLInputElement[];

describe('Settings', () => {
  it('has the Game section only, with Back', () => {
    const { onBack } = renderSettings();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Settings');
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Game',
    ]);
    expect(screen.getByRole('region', { name: 'Game' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('speed: Normal, Fast or Instant; a change is sent at once', () => {
    const { onChangeSettings } = renderSettings();
    expect(radios('Speed').map((r) => [r.labels?.[0]?.textContent, r.checked])).toEqual([
      ['Normal', true],
      ['Fast', false],
      ['Instant', false],
    ]);
    fireEvent.click(radios('Speed')[2] as HTMLInputElement);
    expect(onChangeSettings).toHaveBeenCalledWith({ speed: 'instant' });
    expect(
      screen.getByRole('group', { name: 'Speed' }).getAttribute('aria-describedby'),
    ).toBeTruthy();
  });

  it('auto next hand is a switch with its hint as the description', () => {
    const { onChangeSettings } = renderSettings();
    const toggle = screen.getByRole('switch', { name: 'Deal the next hand by itself' });
    expect((toggle as HTMLInputElement).checked).toBe(true);
    const hint = document.getElementById(toggle.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toBe('Off: the next hand waits for your tap.');
    fireEvent.click(toggle);
    expect(onChangeSettings).toHaveBeenCalledWith({ autoNext: false });
  });

  it('amounts: chips or big blinds', () => {
    const { onChangeSettings } = renderSettings({ ...GAME, amounts: 'bb' });
    expect(radios('Show amounts as').map((r) => [r.labels?.[0]?.textContent, r.checked])).toEqual([
      ['Chips', false],
      ['Big blinds', true],
    ]);
    fireEvent.click(radios('Show amounts as')[0] as HTMLInputElement);
    expect(onChangeSettings).toHaveBeenCalledWith({ amounts: 'chips' });
  });

  it('shows what the controller passes (a whole Settings object fits)', () => {
    const settings = { ...GAME, speed: 'fast' as const, autoNext: false, showEquity: true };
    renderSettings(settings);
    expect(radios('Speed')[1]?.checked).toBe(true);
    expect((screen.getByRole('switch') as HTMLInputElement).checked).toBe(false);
  });

  it('every control is at least 44×44 px (§12.12)', () => {
    const { container } = renderSettings();
    expect(controlCount(container)).toBe(7);
    expect(smallTargets(container, () => false)).toEqual([]);
  });
});
