// @vitest-environment jsdom
// Home (PLAN §12.1, Appendix F.10): one-tap Play, the session line, hidden (not disabled) tiles.
import '../../../src/ui/styles/tokens.css';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Home, sessionParts, type SessionLine } from '../../../src/ui/screens/Home.tsx';
import styles from '../../../src/ui/screens/Screen.module.css';
import { controlCount, cssClass, smallTargets } from './targets.ts';

const PRIMARY = cssClass(styles, 'primary');

afterEach(cleanup);

const SESSION: SessionLine = {
  hand: 23,
  players: 6,
  chips: 2340,
  botLevel: 'easy',
  coachLevel: 'beginner',
};

function renderHome(extra: Partial<Parameters<typeof Home>[0]> = {}) {
  const props = {
    session: null,
    onPlay: vi.fn(),
    onNewTable: vi.fn(),
    onOpenSettings: vi.fn(),
    ...extra,
  };
  return { ...props, ...render(<Home {...props} />) };
}

describe('Home', () => {
  it('Play calls onPlay once, with no dialog in between (§12.1)', () => {
    const { onPlay, onNewTable, onOpenSettings } = renderHome({ session: SESSION });
    const play = screen.getByRole('button', { name: 'Play' });
    expect(document.querySelector('button')).toBe(play);
    fireEvent.click(play);
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPlay).toHaveBeenCalledWith();
    expect(onNewTable).not.toHaveBeenCalled();
    expect(onOpenSettings).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the saved session under Play, in the Appendix F.10 words', () => {
    renderHome({ session: SESSION });
    const line = 'Hand 23 · 6 players · You have 2,340 chips · Easy bots · Beginner coach';
    expect(sessionParts(SESSION).join(' · ')).toBe(line);
    const play = screen.getByRole('button', { name: 'Play' });
    const described = document.getElementById(play.getAttribute('aria-describedby') ?? '');
    expect(described?.textContent).toBe(line);
    expect(
      sessionParts({
        hand: 1,
        players: 9,
        chips: 1_000_000,
        botLevel: 'expert',
        coachLevel: 'exam',
      }),
    ).toEqual(['Hand 1', '9 players', 'You have 1,000,000 chips', 'Expert bots', 'Exam coach']);
  });

  it('has no session line without a session', () => {
    renderHome();
    expect(screen.queryByText(/You have/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Play' }).hasAttribute('aria-describedby')).toBe(
      false,
    );
  });

  it('"New table…" opens Setup and the Settings tile opens Settings', () => {
    const { onNewTable, onOpenSettings, onPlay } = renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'New table…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onNewTable).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('hides Learn, Stats and Install app until they exist, instead of disabling them', () => {
    const { container } = renderHome({ session: SESSION });
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Play',
      'New table…',
      'Settings',
    ]);
    expect(container.querySelectorAll('[disabled], [aria-disabled="true"]')).toHaveLength(0);
  });

  it('shows the later tiles when their callbacks are given', () => {
    const onOpenLearn = vi.fn();
    const onOpenStats = vi.fn();
    const onInstall = vi.fn();
    renderHome({ onOpenLearn, onOpenStats, onInstall });
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Play',
      'New table…',
      'Learn',
      'Stats',
      'Settings',
      'Install app',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stats' }));
    fireEvent.click(screen.getByRole('button', { name: 'Install app' }));
    expect([onOpenLearn, onOpenStats, onInstall].map((f) => f.mock.calls.length)).toEqual([
      1, 1, 1,
    ]);
  });

  it('carries the short disclaimer (§16.2, Appendix G.1)', () => {
    renderHome();
    expect(screen.getByText('Play money only.')).toBeTruthy();
  });

  it('Play is at least 56 px tall and every control at least 44×44 px (§12.12)', () => {
    const { container } = renderHome({
      session: SESSION,
      onOpenLearn: () => {},
      onOpenStats: () => {},
      onInstall: () => {},
    });
    expect(controlCount(container)).toBe(6);
    expect(smallTargets(container, (el) => el.classList.contains(PRIMARY))).toEqual([]);
  });
});

describe('the tap-target check itself', () => {
  it('flags controls without a declared size, and a primary button under 56 px', () => {
    const { container } = render(
      <div>
        <button type="button">bare</button>
        <button type="button" className={styles.link}>
          link
        </button>
      </div>,
    );
    expect(smallTargets(container, () => false)).toEqual(['"bare" is 0×0, needs 44×44']);
    expect(smallTargets(container, () => true)).toEqual([
      '"bare" is 0×0, needs 44×56',
      '"link" is 44×44, needs 44×56',
    ]);
  });
});
