// @vitest-environment jsdom
// Setup (PLAN §12.2): the four questions, the "= N big blinds" line, custom fields, level cards.
import '../../../src/ui/styles/tokens.css';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import styles from '../../../src/ui/screens/Screen.module.css';
import { Setup, type SetupProps } from '../../../src/ui/screens/Setup.tsx';
import {
  AVAILABLE_LEVELS,
  type AvailableLevels,
  type SetupValues,
} from '../../../src/ui/screens/setupForm.ts';
import { controlCount, cssClass, declaredSize, smallTargets } from './targets.ts';

const PRIMARY = cssClass(styles, 'primary');

afterEach(cleanup);

const DEFAULTS: SetupValues = {
  players: 6,
  startingStack: 2000,
  bb: 20,
  botLevel: 'easy',
  coachLevel: 'beginner',
};

function renderSetup(extra: Partial<SetupProps> = {}) {
  const onStartTable = vi.fn<SetupProps['onStartTable']>();
  const onBack = vi.fn();
  const props: SetupProps = {
    initial: DEFAULTS,
    available: AVAILABLE_LEVELS,
    onStartTable,
    onBack,
    ...extra,
  };
  return { onStartTable, onBack, ...render(<Setup {...props} />) };
}

const group = (name: string) => screen.getByRole('group', { name });
const radio = (groupName: string, name: string | RegExp) =>
  within(group(groupName)).getByRole('radio', { name }) as HTMLInputElement;
const start = () => screen.getByRole('button', { name: 'Start game' }) as HTMLButtonElement;
const depth = () => start().getAttribute('aria-describedby') ?? '';
const depthText = () => document.getElementById(depth())?.textContent ?? '';

describe('Setup: opening', () => {
  it('is "Set up your table" with Back', () => {
    const { onBack } = renderSetup();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Set up your table');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('opens with the last-used values, so New table… → Start game is one more tap (§12.2)', () => {
    const { onStartTable } = renderSetup({
      initial: {
        players: 4,
        startingStack: 5000,
        bb: 50,
        botLevel: 'easy',
        coachLevel: 'beginner',
      },
    });
    expect(screen.getByText('You and 3 bots')).toBeTruthy();
    expect(radio('Starting chips', '5,000').checked).toBe(true);
    expect(radio('Blinds', '25/50').checked).toBe(true);
    expect(radio('How good are the bots?', /^Easy/).checked).toBe(true);
    expect(radio('How much help do you want?', /^Beginner/).checked).toBe(true);
    fireEvent.click(start());
    expect(onStartTable).toHaveBeenCalledTimes(1);
    expect(onStartTable).toHaveBeenCalledWith(
      {
        seatCount: 4,
        sb: 25,
        bb: 50,
        startingStack: 5000,
        botLevel: 'easy',
        seatLevels: [null, null, null, null],
      },
      'beginner',
    );
  });

  it('shows "= 100 big blinds" and the depth label for the defaults', () => {
    renderSetup();
    expect(depthText()).toBe('Each player starts with 2,000 chips = 100 big blinds.Normal');
    expect(document.getElementById(depth())?.getAttribute('aria-live')).toBe('polite');
  });

  it('offers the §12.2 presets and Custom', () => {
    renderSetup();
    const names = (g: string) =>
      within(group(g))
        .getAllByRole('radio')
        .map((r) => (r as HTMLInputElement).labels?.[0]?.textContent);
    expect(names('Starting chips')).toEqual(['500', '1,000', '2,000', '5,000', '10,000', 'Custom']);
    expect(names('Blinds')).toEqual(['5/10', '10/20', '25/50', '50/100', '100/200', 'Custom']);
  });
});

describe('Setup: players (question 1)', () => {
  it('steps from 2 to 9 with 44 px buttons and says "You and N bots"', () => {
    renderSetup();
    const more = screen.getByRole('button', { name: 'More players' });
    const fewer = screen.getByRole('button', { name: 'Fewer players' });
    const caption = () => screen.getByText(/^You and \d+ bots?$/);
    expect(caption().getAttribute('aria-live')).toBe('polite');

    for (let i = 0; i < 5; i++) fireEvent.click(more);
    expect(caption().textContent).toBe('You and 8 bots');
    expect(more.getAttribute('aria-disabled')).toBe('true');
    expect(fewer.getAttribute('aria-disabled')).toBe('false');

    for (let i = 0; i < 10; i++) fireEvent.click(fewer);
    expect(caption().textContent).toBe('You and 1 bot');
    expect(fewer.getAttribute('aria-disabled')).toBe('true');
    // Still focusable at the limit: aria-disabled, not disabled.
    expect(fewer.hasAttribute('disabled')).toBe(false);
    for (const b of [more, fewer]) expect(declaredSize(b)).toEqual({ w: 44, h: 44 });
  });

  it('starts the table with the chosen number of seats', () => {
    const { onStartTable } = renderSetup();
    fireEvent.click(screen.getByRole('button', { name: 'Fewer players' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fewer players' }));
    fireEvent.click(start());
    const config = onStartTable.mock.calls[0]?.[0];
    expect(config?.seatCount).toBe(4);
    expect(config?.seatLevels).toEqual([null, null, null, null]);
  });

  it('draws the mini table with one seat per player, you at the bottom (§12.2)', () => {
    const { container } = renderSetup();
    const seats = () => container.querySelectorAll('svg circle[data-seat]');
    expect(seats()).toHaveLength(6);
    fireEvent.click(screen.getByRole('button', { name: 'More players' }));
    expect(seats()).toHaveLength(7);
    const hero = container.querySelector('circle[data-seat="0"]');
    expect([hero?.getAttribute('cx'), hero?.getAttribute('cy')]).toEqual(['60.00', '70.00']);
    expect(container.querySelector('svg[viewBox="0 0 120 80"]')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
  });
});

describe('Setup: chips and blinds (question 2)', () => {
  it('too few chips for the blinds: says so and keeps Start disabled', () => {
    const { onStartTable } = renderSetup();
    fireEvent.click(radio('Starting chips', '500'));
    fireEvent.click(radio('Blinds', '100/200'));
    expect(depthText()).toBe('Too few chips for these blinds. Choose smaller blinds.');
    expect(start().disabled).toBe(true);
    fireEvent.click(start());
    expect(onStartTable).not.toHaveBeenCalled();
  });

  it('too deep: says so and keeps Start disabled', () => {
    renderSetup();
    fireEvent.click(radio('Starting chips', '10,000'));
    fireEvent.click(radio('Blinds', '5/10'));
    expect(depthText()).toBe('Very deep. Choose bigger blinds.');
    expect(start().disabled).toBe(true);
    fireEvent.click(radio('Blinds', '25/50'));
    expect(depthText()).toBe(
      'Each player starts with 10,000 chips = 200 big blinds.Deep: long hands, bigger decisions',
    );
    expect(start().disabled).toBe(false);
  });

  it('labels short and medium depths', () => {
    renderSetup();
    fireEvent.click(radio('Starting chips', '1,000'));
    fireEvent.click(radio('Blinds', '50/100'));
    expect(depthText()).toBe(
      'Each player starts with 1,000 chips = 10 big blinds.Short: many all-ins, fast games',
    );
    fireEvent.click(radio('Blinds', '25/50'));
    expect(depthText()).toBe(
      'Each player starts with 1,000 chips = 20 big blinds.Short: many all-ins, fast games',
    );
    fireEvent.click(radio('Starting chips', '2,000'));
    expect(depthText()).toBe('Each player starts with 2,000 chips = 40 big blinds.Medium');
  });

  it('Custom chips: a numeric field that keeps digits and shows its range when needed', () => {
    const { onStartTable } = renderSetup();
    fireEvent.click(radio('Starting chips', 'Custom'));
    const field = screen.getByRole('textbox', { name: 'Starting chips' }) as HTMLInputElement;
    expect(field.value).toBe('2000');
    expect(field.getAttribute('inputmode')).toBe('numeric');
    // Pitfall 30: iOS zooms into inputs under 16 px.
    expect(getComputedStyle(field).fontSize).toBe('16px');

    fireEvent.change(field, { target: { value: '3,5a00' } });
    expect(field.value).toBe('3500');
    expect(field.getAttribute('aria-invalid')).toBe('false');
    expect(depthText()).toBe(
      'Each player starts with 3,500 chips = 175 big blinds.Deep: long hands, bigger decisions',
    );

    fireEvent.change(field, { target: { value: '150' } });
    expect(field.getAttribute('aria-invalid')).toBe('true');
    const range = document.getElementById(field.getAttribute('aria-describedby') ?? '');
    expect(range?.textContent).toBe('200 to 1,000,000');
    expect(start().disabled).toBe(true);

    fireEvent.change(field, { target: { value: '' } });
    expect(screen.getByText('200 to 1,000,000')).toBeTruthy();
    expect(start().disabled).toBe(true);

    fireEvent.change(field, { target: { value: '4000' } });
    fireEvent.click(start());
    expect(onStartTable.mock.calls[0]?.[0].startingStack).toBe(4000);
  });

  it('Custom big blind: rounded up to even (at once for the maths, on blur on screen), SB = BB / 2', () => {
    const { onStartTable } = renderSetup();
    fireEvent.click(radio('Blinds', 'Custom'));
    const field = screen.getByRole('textbox', { name: 'Big blind' }) as HTMLInputElement;
    expect(field.value).toBe('20');
    expect(screen.getByText('Small blind 10')).toBeTruthy();

    fireEvent.change(field, { target: { value: '25' } });
    expect(field.value).toBe('25');
    expect(screen.getByText('Small blind 13')).toBeTruthy();
    expect(depthText()).toBe('Each player starts with 2,000 chips = 76 big blinds.Normal');
    fireEvent.blur(field);
    expect(field.value).toBe('26');

    fireEvent.change(field, { target: { value: '200001' } });
    expect(screen.getByText('2 to 100,000')).toBeTruthy();
    expect(screen.queryByText(/^Small blind/)).toBeNull();
    expect(start().disabled).toBe(true);

    fireEvent.change(field, { target: { value: '39' } });
    // Start without leaving the field first (a tap on iOS may not blur it): 40 is used.
    fireEvent.click(start());
    expect(onStartTable.mock.calls[0]?.[0]).toMatchObject({ bb: 40, sb: 20 });
  });

  it('Enter in a custom field starts the game when the form is valid', () => {
    const { onStartTable } = renderSetup();
    fireEvent.click(radio('Starting chips', 'Custom'));
    const field = screen.getByRole('textbox', { name: 'Starting chips' });
    fireEvent.change(field, { target: { value: '100' } });
    fireEvent.submit(field);
    expect(onStartTable).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: '1000' } });
    fireEvent.submit(field);
    expect(onStartTable).toHaveBeenCalledTimes(1);
  });

  it('going back to a preset hides the custom field', () => {
    renderSetup();
    fireEvent.click(radio('Starting chips', 'Custom'));
    expect(screen.queryByRole('textbox', { name: 'Starting chips' })).not.toBeNull();
    fireEvent.click(radio('Starting chips', '1,000'));
    expect(screen.queryByRole('textbox', { name: 'Starting chips' })).toBeNull();
    expect(radio('Starting chips', '1,000').checked).toBe(true);
  });
});

describe('Setup: level cards (questions 3 and 4)', () => {
  const ALL: AvailableLevels = {
    bot: ['easy', 'medium', 'hard', 'expert'],
    coach: ['beginner', 'intermediate', 'advanced', 'exam'],
  };

  it('Stage 5: Easy and Medium bots, Beginner and Intermediate coach; the rest say "Coming soon"', () => {
    renderSetup();
    const bots = within(group('How good are the bots?')).getAllByRole(
      'radio',
    ) as HTMLInputElement[];
    expect(bots.map((r) => [r.value, r.checked, r.disabled])).toEqual([
      ['easy', true, false],
      ['medium', false, false],
      ['hard', false, true],
      ['expert', false, true],
    ]);
    const coach = within(group('How much help do you want?')).getAllByRole(
      'radio',
    ) as HTMLInputElement[];
    expect(coach.map((r) => [r.value, r.checked, r.disabled])).toEqual([
      ['beginner', true, false],
      ['intermediate', false, false],
      ['advanced', false, true],
      ['exam', false, true],
    ]);
    // The card text is the §10.1 / §12.2 text; the caption says why it cannot be picked.
    expect(bots.map((r) => r.labels?.[0]?.textContent)).toEqual([
      'EasyBots make many mistakes. They call too much and rarely bluff.',
      'MediumBots play okay but are easy to read.',
      'HardBots play solid poker and read the board. Their style is hidden.Coming soon',
      'ExpertBots study how you play and adapt.Coming soon',
    ]);
    expect(coach.map((r) => r.labels?.[0]?.textContent)).toEqual([
      'BeginnerFull help',
      'IntermediateHelp on tap',
      'AdvancedMistakes onlyComing soon',
      'ExamTest yourselfComing soon',
    ]);
  });

  it('Medium bots and the Intermediate coach can be picked and are sent with Start', () => {
    const { onStartTable } = renderSetup();
    fireEvent.click(radio('How good are the bots?', /^Medium/));
    fireEvent.click(radio('How much help do you want?', /^Intermediate/));
    expect(radio('How good are the bots?', /^Medium/).checked).toBe(true);
    expect(radio('How good are the bots?', /^Easy/).checked).toBe(false);
    expect(radio('How much help do you want?', /^Intermediate/).checked).toBe(true);
    fireEvent.click(start());
    expect(onStartTable).toHaveBeenCalledWith(
      expect.objectContaining({
        botLevel: 'medium',
        seatLevels: [null, null, null, null, null, null],
      }),
      'intermediate',
    );
  });

  it('a disabled card cannot be picked', () => {
    const { onStartTable } = renderSetup();
    fireEvent.click(radio('How good are the bots?', /^Hard/));
    fireEvent.click(radio('How much help do you want?', /^Exam/));
    fireEvent.click(start());
    expect(onStartTable).toHaveBeenCalledWith(
      expect.objectContaining({ botLevel: 'easy' }),
      'beginner',
    );
  });

  it('later stages open more levels through `available`', () => {
    const { onStartTable } = renderSetup({ available: ALL });
    expect(screen.queryByText('Coming soon')).toBeNull();
    fireEvent.click(radio('How good are the bots?', /^Hard/));
    fireEvent.click(radio('How much help do you want?', /^Exam/));
    fireEvent.click(start());
    expect(onStartTable).toHaveBeenCalledWith(
      expect.objectContaining({ botLevel: 'hard' }),
      'exam',
    );
  });

  it('opens with the last-used Medium and Intermediate', () => {
    const { onStartTable } = renderSetup({
      initial: { ...DEFAULTS, botLevel: 'medium', coachLevel: 'intermediate' },
    });
    expect(radio('How good are the bots?', /^Medium/).checked).toBe(true);
    expect(radio('How much help do you want?', /^Intermediate/).checked).toBe(true);
    fireEvent.click(start());
    expect(onStartTable).toHaveBeenCalledWith(
      expect.objectContaining({ botLevel: 'medium' }),
      'intermediate',
    );
  });

  it('a saved level that is not available yet opens as the first available one', () => {
    renderSetup({ initial: { ...DEFAULTS, botLevel: 'expert', coachLevel: 'exam' } });
    expect(radio('How good are the bots?', /^Easy/).checked).toBe(true);
    expect(radio('How much help do you want?', /^Beginner/).checked).toBe(true);
    expect(start().disabled).toBe(false);
  });
});

describe('Setup: disclaimer, labels and tap targets', () => {
  it('carries "Play money only. Chips have no value." (§12.2, §16.2)', () => {
    renderSetup();
    expect(screen.getByText('Play money only. Chips have no value.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Privacy' })).toBeNull();
  });

  it('every question is a named group and every field has a label', () => {
    renderSetup();
    fireEvent.click(radio('Starting chips', 'Custom'));
    fireEvent.click(radio('Blinds', 'Custom'));
    expect(
      screen.getAllByRole('group').map((g) => g.getElementsByTagName('legend')[0]?.textContent),
    ).toEqual([
      'How many players? (you + bots)',
      'Starting chips',
      'Blinds',
      'How good are the bots?',
      'How much help do you want?',
    ]);
    for (const input of document.querySelectorAll('input')) {
      expect(input.labels?.length ?? 0).toBeGreaterThan(0);
    }
    for (const button of screen.getAllByRole('button')) {
      expect(button.textContent?.trim() || button.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('Start game is at least 56 px tall and every control at least 44×44 px (§12.12)', () => {
    const { container } = renderSetup({ onOpenPrivacy: () => {} });
    fireEvent.click(radio('Starting chips', 'Custom'));
    fireEvent.click(radio('Blinds', 'Custom'));
    expect(controlCount(container)).toBeGreaterThan(20);
    expect(smallTargets(container, (el) => el.classList.contains(PRIMARY))).toEqual([]);
    expect(start().classList.contains(PRIMARY)).toBe(true);
  });
});
