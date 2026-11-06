// @vitest-environment jsdom
// Home (PLAN §12.1, Appendix F.10): one-tap Play, the session line, hidden (not disabled) tiles,
// the read-only banner (§14.7, §12.11).
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

  it('"Hand drill" (§13.5) is a secondary button under New table, when given', () => {
    const onOpenDrill = vi.fn();
    renderHome({ session: SESSION, onOpenDrill });
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Play',
      'New table…',
      'Hand drill',
      'Settings',
    ]);
    const drill = screen.getByRole('button', { name: 'Hand drill' });
    expect(drill.className).toBe(cssClass(styles, 'secondary'));
    fireEvent.click(drill);
    expect(onOpenDrill).toHaveBeenCalledTimes(1);
    // Read-only (§14.7): the app shows only Home, so the drill is not offered.
    cleanup();
    renderHome({ onOpenDrill, onPlayHere: vi.fn() });
    expect(screen.queryByRole('button', { name: 'Hand drill' })).toBeNull();
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

  it('read-only (§14.7): the §12.11 banner and "Play here" replace Play, New table and Settings', () => {
    const onPlayHere = vi.fn();
    const onOpenStats = vi.fn();
    const { onPlay, container } = renderHome({ session: SESSION, onPlayHere, onOpenStats });
    expect(screen.getByRole('alert').textContent).toBe(
      'The game is open in another tab. Close it, or tap here to play here instead.',
    );
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Play here', 'Stats']);
    expect(screen.queryByText(/You have/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Play here' }));
    expect(onPlayHere).toHaveBeenCalledTimes(1);
    expect(onPlay).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Play here' }).classList.contains(PRIMARY)).toBe(
      true,
    );
    expect(smallTargets(container, (el) => el.classList.contains(PRIMARY))).toEqual([]);
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

describe('Home: the one-time install cards (§12.11, §12.13; chunk 8.4)', () => {
  const card = () => document.querySelector('[data-nudge]');

  it('no card without one; the iOS tip with [Got it] under the tiles, never before Play', () => {
    renderHome();
    expect(card()).toBeNull();
    cleanup();
    const onDismiss = vi.fn();
    renderHome({ nudge: { nudge: 'iosTip', onDismiss } });
    const tip = screen.getByRole('region', {
      name: "Tip: add RB Poker Coach to your Home Screen. Tap Share, then 'Add to Home Screen'. It works offline and keeps your stats safer.",
    });
    expect(document.querySelector('button')?.textContent).toBe('Play'); // Play stays first
    expect(tip.querySelectorAll('button')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('the install card: [Install] opens the browser`s dialog, [Not now] answers it', () => {
    const onDismiss = vi.fn();
    const onInstall = vi.fn();
    renderHome({ nudge: { nudge: 'installCard', onDismiss, onInstall } });
    expect(card()?.textContent).toContain(
      'Install RB Poker Coach? It opens like an app, works offline and keeps your stats safer.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    expect(onInstall).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('"Played in Safari before?": [Import] is the file picker, [Skip] answers it', () => {
    const onDismiss = vi.fn();
    const onImportFile = vi.fn();
    const { container } = renderHome({
      nudge: { nudge: 'safariImport', onDismiss, onImportFile },
    });
    expect(card()?.textContent).toContain(
      'Played in Safari before? Export your stats there, then Import them here.',
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toBe('application/json,.json');
    expect(input.labels?.[0]?.textContent).toBe('Import');
    const file = new File(['{}'], 'stats.json', { type: 'application/json' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onImportFile).toHaveBeenCalledWith(file);
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('every control of a card is at least 44×44 px (§12.12)', () => {
    const { container } = renderHome({
      nudge: { nudge: 'safariImport', onDismiss: () => {}, onImportFile: () => {} },
    });
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
