// @vitest-environment jsdom
// Welcome (PLAN §12.1): one tap on Play, the short disclaimer, hidden (not disabled) links.
import '../../../src/ui/styles/tokens.css';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { en } from '../../../src/i18n/en.ts';
import styles from '../../../src/ui/screens/Screen.module.css';
import { Welcome } from '../../../src/ui/screens/Welcome.tsx';
import { controlCount, cssClass, smallTargets } from './targets.ts';

const PRIMARY = cssClass(styles, 'primary');

afterEach(cleanup);

function renderWelcome(extra: Partial<Parameters<typeof Welcome>[0]> = {}) {
  const props = { onPlay: vi.fn(), onSetup: vi.fn(), ...extra };
  const view = render(<Welcome {...props} />);
  return { ...props, ...view };
}

describe('Welcome', () => {
  it('shows the wordmark, the tagline, the four bullets and the short disclaimer', () => {
    renderWelcome();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('RB Poker Coach');
    expect(screen.getByText('Learn poker by playing.')).toBeTruthy();
    const bullets = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(bullets.map((li) => li.textContent)).toEqual([
      'Play against friendly bots',
      'A coach tells you what to do, and why',
      'See your hand, your chance to win, and all poker hands',
      'Free, no sign-up, works offline',
    ]);
    // Appendix G.1: the first sentence on Welcome.
    expect(screen.getByText('Play money only.')).toBeTruthy();
  });

  it('one tap: Play calls onPlay at once, with no dialog before or after (§12.1)', () => {
    const { onPlay, onSetup } = renderWelcome();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();

    const play = screen.getByRole('button', { name: 'Play' });
    // Play is the first control on the page: nothing to get past first.
    expect(document.querySelector('button')).toBe(play);
    fireEvent.click(play);

    // Synchronously, inside the tap (the controller unlocks audio there, §12.13), no arguments.
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPlay).toHaveBeenCalledWith();
    expect(onSetup).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('"Choose players, chips and levels" opens Setup', () => {
    const { onPlay, onSetup } = renderWelcome();
    fireEvent.click(screen.getByRole('button', { name: 'Choose players, chips and levels' }));
    expect(onSetup).toHaveBeenCalledTimes(1);
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('hides the links to screens that do not exist yet, instead of disabling them (§18 Stage 3)', () => {
    const { container } = renderWelcome();
    expect(screen.queryByText(en.welcome.guide)).toBeNull();
    expect(screen.queryByText(en.legal.privacy)).toBeNull();
    expect(container.querySelectorAll('[disabled], [aria-disabled="true"]')).toHaveLength(0);
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('shows those links once their screens exist', () => {
    const onOpenGuide = vi.fn();
    const onOpenPrivacy = vi.fn();
    renderWelcome({ onOpenGuide, onOpenPrivacy });
    fireEvent.click(screen.getByRole('button', { name: 'New to poker? 1-minute guide' }));
    fireEvent.click(screen.getByRole('button', { name: 'Privacy' }));
    expect(onOpenGuide).toHaveBeenCalledTimes(1);
    expect(onOpenPrivacy).toHaveBeenCalledTimes(1);
  });

  it('Play is at least 56 px tall and every control at least 44×44 px (§12.12)', () => {
    const { container } = renderWelcome({ onOpenGuide: () => {}, onOpenPrivacy: () => {} });
    expect(controlCount(container)).toBe(4);
    expect(smallTargets(container, (el) => el.classList.contains(PRIMARY))).toEqual([]);
    const play = screen.getByRole('button', { name: 'Play' });
    expect(play.classList.contains(PRIMARY)).toBe(true);
  });

  it('is one main landmark with buttons of type "button" (no form submits)', () => {
    renderWelcome();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    for (const button of screen.getAllByRole('button')) {
      expect(button.getAttribute('type')).toBe('button');
    }
  });
});
