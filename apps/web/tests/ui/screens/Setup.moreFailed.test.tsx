// @vitest-environment jsdom
/**
 * Setup's "More options" chunk cannot be loaded (chunk 7.2: for example a browser that dropped the
 * cached file during an app update). Opening the section must not take Setup down or leave an
 * empty open section: it closes again, and the four questions and Start game still work. A
 * separate file, because `vi.mock` replaces the module for the whole file.
 */
import '../../../src/ui/styles/tokens.css';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Setup } from '../../../src/ui/screens/Setup.tsx';
import { AVAILABLE_LEVELS, type SetupValues } from '../../../src/ui/screens/setupForm.ts';

// importing the module throws, so `import('./MoreOptions.tsx')` rejects
vi.mock('../../../src/ui/screens/MoreOptions.tsx', () => {
  throw new Error('chunk failed to load');
});

const VALUES: SetupValues = {
  players: 6,
  startingStack: 2000,
  bb: 20,
  botLevel: 'easy',
  coachLevel: 'beginner',
  seatLevels: [null, null, 'hard', null, null, null],
  speed: 'normal',
  fourColour: true,
};

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Setup when the More options chunk fails to load', () => {
  it('closes the section again, keeps the form, and Start still sends what it opened with', async () => {
    const onStartTable = vi.fn();
    render(
      <Setup
        initial={VALUES}
        available={AVAILABLE_LEVELS}
        onStartTable={onStartTable}
        onBack={() => {}}
      />,
    );
    const toggle = screen.getByRole('button', { name: /^More options/ });
    fireEvent.click(toggle);
    await act(async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });

    // Closed again, nothing half-drawn, and the line under it still counts the levels.
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('group', { name: "Set each bot's level" })).toBeNull();
    expect(screen.getByText('1 bot has its own level.')).toBeTruthy();

    // The form is as it was: the rest of Setup works, and Start sends the saved levels.
    fireEvent.click(screen.getByRole('radio', { name: /^Medium/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start game' }));
    expect(onStartTable).toHaveBeenCalledTimes(1);
    expect(onStartTable).toHaveBeenCalledWith(
      expect.objectContaining({
        botLevel: 'medium',
        seatLevels: [null, null, 'hard', null, null, null],
      }),
      'beginner',
      { speed: 'normal', fourColour: true },
    );
  });
});
