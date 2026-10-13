// @vitest-environment jsdom
// Settings, Game section (PLAN §12.1, §18 Stages 3 and 5): coach level, bot level, speed, auto next
// hand, amounts.
import '../../../src/ui/styles/tokens.css';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Settings, type GameSettings } from '../../../src/ui/screens/Settings.tsx';
import { AVAILABLE_LEVELS, type AvailableLevels } from '../../../src/ui/screens/setupForm.ts';
import { controlCount, smallTargets } from './targets.ts';

afterEach(cleanup);

const GAME: GameSettings = {
  coachLevel: 'beginner',
  botLevel: 'easy',
  speed: 'normal',
  autoNext: true,
  amounts: 'chips',
};

function renderSettings(
  settings: GameSettings = GAME,
  available: AvailableLevels = AVAILABLE_LEVELS,
) {
  const props = { settings, available, onChangeSettings: vi.fn(), onBack: vi.fn() };
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
    // Back, 4 + 4 level cards, 3 speeds, the switch, 2 amounts.
    expect(controlCount(container)).toBe(15);
    expect(smallTargets(container, () => false)).toEqual([]);
  });
});

describe('Settings: coach level and bot level (PLAN §10, §12.1)', () => {
  const state = (group: string) =>
    radios(group).map((r) => [r.value, r.checked, r.disabled] as const);

  it('lists the coach level and the bot level first, before the speed', () => {
    renderSettings();
    expect(
      screen.getAllByRole('group').map((g) => g.getElementsByTagName('legend')[0]?.textContent),
    ).toEqual(['Coach level', 'Bot level', 'Speed', 'Show amounts as']);
  });

  it('coach level: all four can be picked (Advanced and Exam since chunk 6.4)', () => {
    const { onChangeSettings } = renderSettings();
    expect(state('Coach level')).toEqual([
      ['beginner', true, false],
      ['intermediate', false, false],
      ['advanced', false, false],
      ['exam', false, false],
    ]);
    expect(radios('Coach level').map((r) => r.labels?.[0]?.textContent)).toEqual([
      'BeginnerFull help',
      'IntermediateHelp on tap',
      'AdvancedMistakes only',
      'ExamTest yourself',
    ]);
    fireEvent.click(radios('Coach level')[1] as HTMLInputElement);
    fireEvent.click(radios('Coach level')[2] as HTMLInputElement);
    fireEvent.click(radios('Coach level')[3] as HTMLInputElement);
    expect(onChangeSettings.mock.calls).toEqual([
      [{ coachLevel: 'intermediate' }],
      [{ coachLevel: 'advanced' }],
      [{ coachLevel: 'exam' }],
    ]);
  });

  it('bot level: all four can be picked (Hard and Expert from chunk 7.1)', () => {
    const { onChangeSettings } = renderSettings();
    expect(state('Bot level')).toEqual([
      ['easy', true, false],
      ['medium', false, false],
      ['hard', false, false],
      ['expert', false, false],
    ]);
    expect(radios('Bot level').map((r) => r.labels?.[0]?.textContent)).toEqual([
      'EasyBots make many mistakes. They call too much and rarely bluff.',
      'MediumBots play okay but are easy to read.',
      'HardBots play solid poker and read the board. Their style is hidden.',
      'ExpertBots study how you play and adapt.',
    ]);
    fireEvent.click(radios('Bot level')[1] as HTMLInputElement);
    fireEvent.click(radios('Bot level')[2] as HTMLInputElement);
    fireEvent.click(radios('Bot level')[3] as HTMLInputElement);
    expect(onChangeSettings.mock.calls).toEqual([
      [{ botLevel: 'medium' }],
      [{ botLevel: 'hard' }],
      [{ botLevel: 'expert' }],
    ]);
  });

  it('a card that is not available yet sends nothing', () => {
    const { onChangeSettings } = renderSettings(GAME, {
      ...AVAILABLE_LEVELS,
      bot: ['easy', 'medium'],
    });
    fireEvent.click(radios('Bot level')[2] as HTMLInputElement);
    fireEvent.click(radios('Bot level')[3] as HTMLInputElement);
    expect(onChangeSettings).not.toHaveBeenCalled();
  });

  it('a coach level missing from `available` sends nothing either', () => {
    const { onChangeSettings } = renderSettings(GAME, { bot: ['easy'], coach: ['beginner'] });
    fireEvent.click(radios('Coach level')[3] as HTMLInputElement);
    expect(onChangeSettings).not.toHaveBeenCalled();
  });

  it('shows the levels that are set, and the hints say when a change starts', () => {
    renderSettings({ ...GAME, coachLevel: 'intermediate', botLevel: 'medium' });
    expect(radios('Coach level').find((r) => r.checked)?.value).toBe('intermediate');
    expect(radios('Bot level').find((r) => r.checked)?.value).toBe('medium');
    const hint = (group: string) =>
      document.getElementById(
        screen.getByRole('group', { name: group }).getAttribute('aria-describedby') ?? '',
      )?.textContent;
    expect(hint('Coach level')).toBe('Changes start with your next decision.');
    expect(hint('Bot level')).toBe('Changes start with the next hand.');
  });

  describe('bots with a level of their own (§9.3, chunk 7.2)', () => {
    const hintOf = () =>
      document.getElementById(
        screen.getByRole('group', { name: 'Bot level' }).getAttribute('aria-describedby') ?? '',
      )?.textContent;
    const withOwn = (ownLevels?: number) => {
      const props = {
        settings: GAME,
        available: AVAILABLE_LEVELS,
        onChangeSettings: vi.fn(),
        onBack: vi.fn(),
        ownLevels,
      };
      return render(<Settings {...props} />);
    };

    it('says nothing while no bot has one', () => {
      withOwn(0);
      expect(hintOf()).toBe('Changes start with the next hand.');
      cleanup();
      withOwn(undefined);
      expect(hintOf()).toBe('Changes start with the next hand.');
    });

    it('says how many do, and where to change them', () => {
      withOwn(1);
      expect(hintOf()).toBe(
        'Changes start with the next hand. 1 bot has its own level. Tap that bot at the table to change it.',
      );
      cleanup();
      withOwn(3);
      expect(hintOf()).toBe(
        'Changes start with the next hand. 3 bots have their own level. Tap a bot at the table to change it.',
      );
    });

    it('the Coach level row is not touched', () => {
      withOwn(2);
      expect(
        document.getElementById(
          screen.getByRole('group', { name: 'Coach level' }).getAttribute('aria-describedby') ?? '',
        )?.textContent,
      ).toBe('Changes start with your next decision.');
    });
  });

  it('later stages open more cards through `available`', () => {
    const { onChangeSettings } = renderSettings(GAME, {
      bot: ['easy', 'medium', 'hard', 'expert'],
      coach: ['beginner', 'intermediate', 'advanced', 'exam'],
    });
    expect(screen.queryByText('Coming soon')).toBeNull();
    fireEvent.click(radios('Bot level')[3] as HTMLInputElement);
    fireEvent.click(radios('Coach level')[3] as HTMLInputElement);
    expect(onChangeSettings.mock.calls).toEqual([
      [{ botLevel: 'expert' }],
      [{ coachLevel: 'exam' }],
    ]);
  });
});
