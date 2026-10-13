// @vitest-environment jsdom
// Setup (PLAN §12.2): the four questions, the "= N big blinds" line, custom fields, level cards.
import '../../../src/ui/styles/tokens.css';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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
  seatLevels: [null, null, null, null, null, null],
  speed: 'normal',
  fourColour: true,
};

/** What "More options" sends besides the config when nothing there was touched (chunk 7.2). */
const MORE = { speed: 'normal', fourColour: true } as const;

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
        ...DEFAULTS,
        players: 4,
        startingStack: 5000,
        bb: 50,
        seatLevels: [null, null, null, null],
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
      MORE,
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

  it('all four bot levels (7.1) and all four coach levels (6.4); nothing says "Coming soon"', () => {
    renderSetup();
    const bots = within(group('How good are the bots?')).getAllByRole(
      'radio',
    ) as HTMLInputElement[];
    expect(bots.map((r) => [r.value, r.checked, r.disabled])).toEqual([
      ['easy', true, false],
      ['medium', false, false],
      ['hard', false, false],
      ['expert', false, false],
    ]);
    const coach = within(group('How much help do you want?')).getAllByRole(
      'radio',
    ) as HTMLInputElement[];
    expect(coach.map((r) => [r.value, r.checked, r.disabled])).toEqual([
      ['beginner', true, false],
      ['intermediate', false, false],
      ['advanced', false, false],
      ['exam', false, false],
    ]);
    // The card text is the §10.1 / §12.2 text, with no "Coming soon" caption on any card.
    expect(bots.map((r) => r.labels?.[0]?.textContent)).toEqual([
      'EasyBots make many mistakes. They call too much and rarely bluff.',
      'MediumBots play okay but are easy to read.',
      'HardBots play solid poker and read the board. Their style is hidden.',
      'ExpertBots study how you play and adapt.',
    ]);
    expect(coach.map((r) => r.labels?.[0]?.textContent)).toEqual([
      'BeginnerFull help',
      'IntermediateHelp on tap',
      'AdvancedMistakes only',
      'ExamTest yourself',
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
      MORE,
    );
  });

  it('Hard and Expert bots can be picked and are sent with Start (chunk 7.1)', () => {
    for (const [name, level] of [
      [/^Hard/, 'hard'],
      [/^Expert/, 'expert'],
    ] as const) {
      const { onStartTable, unmount } = renderSetup();
      fireEvent.click(radio('How good are the bots?', name));
      fireEvent.click(start());
      expect(onStartTable).toHaveBeenCalledWith(
        expect.objectContaining({ botLevel: level }),
        'beginner',
        MORE,
      );
      unmount();
    }
  });

  it('a disabled card cannot be picked; Advanced and Exam can (6.4)', () => {
    const { onStartTable } = renderSetup({
      available: { ...AVAILABLE_LEVELS, bot: ['easy', 'medium'] },
    });
    fireEvent.click(radio('How good are the bots?', /^Hard/));
    fireEvent.click(radio('How much help do you want?', /^Exam/));
    fireEvent.click(start());
    expect(onStartTable).toHaveBeenCalledWith(
      expect.objectContaining({ botLevel: 'easy' }),
      'exam',
      MORE,
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
      MORE,
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
      MORE,
    );
  });

  it('a saved level that is not available yet opens as the first available one', () => {
    renderSetup({
      initial: { ...DEFAULTS, botLevel: 'expert', coachLevel: 'exam' },
      available: { bot: ['easy', 'medium'], coach: ['beginner', 'intermediate'] },
    });
    expect(radio('How good are the bots?', /^Easy/).checked).toBe(true);
    expect(radio('How much help do you want?', /^Beginner/).checked).toBe(true);
    expect(start().disabled).toBe(false);
  });

  it('a saved Exam coach opens as Exam (6.4)', () => {
    renderSetup({ initial: { ...DEFAULTS, coachLevel: 'exam' } });
    expect(radio('How much help do you want?', /^Exam/).checked).toBe(true);
  });

  it('a saved Expert level opens as Expert (chunk 7.1)', () => {
    renderSetup({ initial: { ...DEFAULTS, botLevel: 'expert' } });
    expect(radio('How good are the bots?', /^Expert/).checked).toBe(true);
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

describe('Setup: More options (chunk 7.2, §12.2 item 5, §9.3)', () => {
  // The section's code is a lazy chunk, loaded before the tests (in the app it is precached).
  beforeAll(async () => {
    await import('../../../src/ui/screens/MoreOptions.tsx');
  });

  const toggle = () => screen.getByRole('button', { name: /^More options/ });
  /** Opens the section and lets the lazy chunk render (React suspends once, then shows it). */
  async function open(): Promise<void> {
    fireEvent.click(toggle());
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
  }
  const botSelect = (n: number) => screen.getByLabelText(`Bot ${n}`) as HTMLSelectElement;
  const optionsOf = (select: HTMLSelectElement) =>
    [...select.options].map((o) => [o.value, o.textContent]);

  it('is closed: a button that says so, and none of its content is in the page', () => {
    renderSetup();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('group', { name: "Set each bot's level" })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Speed' })).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(document.getElementById(toggle().getAttribute('aria-controls') ?? '')?.hidden).toBe(
      true,
    );
    // The four questions are the only groups, as before.
    expect(
      screen.getAllByRole('group').map((g) => g.getElementsByTagName('legend')[0]?.textContent),
    ).toHaveLength(5);
  });

  it('opens on a tap and closes on a second one', async () => {
    renderSetup();
    await open();
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('group', { name: "Set each bot's level" })).toBeTruthy();
    fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('group', { name: "Set each bot's level" })).toBeNull();
  });

  it('holds the bot speed, a level for each bot and the four-colour cards', async () => {
    renderSetup();
    await open();
    const speed = within(group('Speed')).getAllByRole('radio') as HTMLInputElement[];
    expect(speed.map((r) => [r.value, r.checked])).toEqual([
      ['normal', true],
      ['fast', false],
      ['instant', false],
    ]);
    expect(screen.getByText('How fast the bots play and the cards move.')).toBeTruthy();
    expect(group("Set each bot's level").getAttribute('aria-describedby')).not.toBeNull();
    expect(screen.getByText('Bots are numbered clockwise, from your left.')).toBeTruthy();
    const colour = screen.getByRole('switch', { name: 'Four-colour cards' }) as HTMLInputElement;
    expect(colour.checked).toBe(true);
    expect(screen.getByText('Each suit has its own colour.')).toBeTruthy();
  });

  it('has one row per bot, each starting at "Same as table (Easy)"', async () => {
    renderSetup();
    await open();
    const rows = screen.getAllByLabelText(/^Bot \d$/) as HTMLSelectElement[];
    expect(rows.map((r) => r.labels?.[0]?.textContent)).toEqual([
      'Bot 1',
      'Bot 2',
      'Bot 3',
      'Bot 4',
      'Bot 5',
    ]);
    for (const row of rows) {
      expect(row.value).toBe('');
      expect(optionsOf(row)).toEqual([
        ['', 'Same as table (Easy)'],
        ['easy', 'Easy'],
        ['medium', 'Medium'],
        ['hard', 'Hard'],
        ['expert', 'Expert'],
      ]);
    }
  });

  it('"Same as table" names the table level chosen above', async () => {
    renderSetup();
    await open();
    fireEvent.click(radio('How good are the bots?', /^Hard/));
    expect(optionsOf(botSelect(1))[0]).toEqual(['', 'Same as table (Hard)']);
  });

  it('follows the players stepper, keeping the levels of the bots that stay', async () => {
    renderSetup();
    await open();
    fireEvent.change(botSelect(2), { target: { value: 'expert' } });
    fireEvent.change(botSelect(4), { target: { value: 'hard' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fewer players' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fewer players' }));
    expect(screen.getAllByLabelText(/^Bot \d$/)).toHaveLength(3);
    expect(botSelect(2).value).toBe('expert');
    fireEvent.click(screen.getByRole('button', { name: 'More players' }));
    fireEvent.click(screen.getByRole('button', { name: 'More players' }));
    fireEvent.click(screen.getByRole('button', { name: 'More players' }));
    // Bot 4 was dropped with its seat; the seats that came back start at the table's level.
    expect(botSelect(4).value).toBe('');
    expect(botSelect(2).value).toBe('expert');
    expect(screen.getAllByLabelText(/^Bot \d$/)).toHaveLength(6);
  });

  it('Start sends the levels of the bots, the speed and the four-colour setting', async () => {
    const { onStartTable } = renderSetup();
    await open();
    fireEvent.change(botSelect(2), { target: { value: 'expert' } });
    fireEvent.change(botSelect(5), { target: { value: 'medium' } });
    fireEvent.click(within(group('Speed')).getByRole('radio', { name: 'Fast' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Four-colour cards' }));
    fireEvent.click(start());
    expect(onStartTable).toHaveBeenCalledTimes(1);
    expect(onStartTable).toHaveBeenCalledWith(
      expect.objectContaining({
        seatCount: 6,
        botLevel: 'easy',
        seatLevels: [null, null, 'expert', null, null, 'medium'],
      }),
      'beginner',
      { speed: 'fast', fourColour: false },
    );
    // A bot put back to "Same as table" is a null again.
    fireEvent.change(botSelect(2), { target: { value: '' } });
    fireEvent.click(start());
    expect(onStartTable.mock.calls[1]?.[0].seatLevels).toEqual([
      null,
      null,
      null,
      null,
      null,
      'medium',
    ]);
  });

  it('opens with the last-used levels, speed and four-colour setting', async () => {
    const { onStartTable } = renderSetup({
      initial: {
        ...DEFAULTS,
        seatLevels: [null, 'hard', null, null, 'easy', null],
        speed: 'instant',
        fourColour: false,
      },
    });
    await open();
    expect(botSelect(1).value).toBe('hard');
    expect(botSelect(2).value).toBe('');
    expect(botSelect(4).value).toBe('easy');
    expect(
      (within(group('Speed')).getByRole('radio', { name: 'Instant' }) as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (screen.getByRole('switch', { name: 'Four-colour cards' }) as HTMLInputElement).checked,
    ).toBe(false);
    fireEvent.click(start());
    expect(onStartTable).toHaveBeenCalledWith(
      expect.objectContaining({ seatLevels: [null, 'hard', null, null, 'easy', null] }),
      'beginner',
      { speed: 'instant', fourColour: false },
    );
  });

  it('starts as it was left even if the section is never opened', () => {
    const { onStartTable } = renderSetup({
      initial: { ...DEFAULTS, seatLevels: [null, null, null, 'expert', null, null], speed: 'fast' },
    });
    fireEvent.click(start());
    expect(onStartTable).toHaveBeenCalledWith(
      expect.objectContaining({ seatLevels: [null, null, null, 'expert', null, null] }),
      'beginner',
      { speed: 'fast', fourColour: true },
    );
  });

  it('closed, it says how many bots have a level of their own', async () => {
    renderSetup({
      initial: { ...DEFAULTS, seatLevels: [null, 'hard', null, 'expert', null, null] },
    });
    expect(screen.getByText('2 bots have their own level.')).toBeTruthy();
    expect(toggle().getAttribute('aria-describedby')).not.toBeNull();
    await open();
    expect(screen.queryByText('2 bots have their own level.')).toBeNull();
    fireEvent.change(botSelect(1), { target: { value: '' } });
    fireEvent.click(toggle());
    expect(screen.getByText('1 bot has its own level.')).toBeTruthy();
    await open();
    fireEvent.change(botSelect(3), { target: { value: '' } });
    fireEvent.click(toggle());
    expect(screen.queryByText(/has its own level|have their own level/)).toBeNull();
    expect(toggle().hasAttribute('aria-describedby')).toBe(false);
  });

  it('offers only the levels that can be picked', async () => {
    renderSetup({ available: { ...AVAILABLE_LEVELS, bot: ['easy', 'medium'] } });
    await open();
    expect(optionsOf(botSelect(1)).map(([value]) => value)).toEqual(['', 'easy', 'medium']);
  });

  it('every control in it is at least 44×44 px (§12.12)', async () => {
    const { container } = renderSetup();
    await open();
    expect(container.querySelectorAll('select')).toHaveLength(5);
    expect(smallTargets(container, (el) => el.classList.contains(PRIMARY))).toEqual([]);
  });

  it('every row has a label, and the section is named', async () => {
    renderSetup();
    await open();
    for (const select of document.querySelectorAll('select')) {
      expect(select.labels?.length ?? 0).toBe(1);
    }
    expect(group('Speed')).toBeTruthy();
    expect(toggle().getAttribute('aria-controls')).toBeTruthy();
  });
});
