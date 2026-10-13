// @vitest-environment jsdom
// The Table's Menu sheet (PLAN §12.3, §3.1): items, hidden-not-disabled, modal behaviour.
import '../../../src/ui/styles/tokens.css';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Menu, type MenuProps } from '../../../src/ui/screens/Menu.tsx';
import { controlCount, smallTargets } from './targets.ts';

afterEach(cleanup);

function menuProps(extra: Partial<MenuProps> = {}) {
  return {
    onResume: vi.fn(),
    topUpTo: null,
    onTopUp: vi.fn(),
    onOpenSettings: vi.fn(),
    onLeaveTable: vi.fn(),
    onNewTable: vi.fn(),
    ...extra,
  };
}

const labels = () =>
  within(screen.getByRole('dialog'))
    .getAllByRole('button')
    .map((b) => b.textContent);

describe('Menu', () => {
  it('is a modal sheet named "Menu" and focus moves into it', () => {
    render(<Menu {...menuProps()} />);
    const sheet = screen.getByRole('dialog', { name: 'Menu' });
    expect(sheet.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Resume' }));
  });

  it('Stage 3 items, in the §12.3 order; the unbuilt ones are hidden, not disabled', () => {
    render(<Menu {...menuProps()} />);
    expect(labels()).toEqual(['Resume', 'Settings', 'Leave table', 'New table']);
    expect(document.querySelectorAll('[disabled], [aria-disabled="true"]')).toHaveLength(0);
  });

  it('shows every item once it exists, and top-up only when there is a top-up', () => {
    render(
      <Menu
        {...menuProps({
          topUpTo: 2000,
          onOpenRankings: () => {},
          onOpenStats: () => {},
          onOpenLearn: () => {},
          onInstall: () => {},
        })}
      />,
    );
    expect(labels()).toEqual([
      'Resume',
      'Top up to 2,000 chips',
      'Hand rankings',
      'Settings',
      'Stats',
      'Learn',
      'Install app',
      'Leave table',
      'New table',
    ]);
  });

  it('each item calls its callback', () => {
    const props = menuProps({ topUpTo: 5000, onOpenRankings: vi.fn() });
    render(<Menu {...props} />);
    const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
    click('Resume');
    click('Top up to 5,000 chips');
    click('Hand rankings');
    click('Settings');
    click('Leave table');
    click('New table');
    for (const fn of [
      props.onResume,
      props.onTopUp,
      props.onOpenRankings,
      props.onOpenSettings,
      props.onLeaveTable,
      props.onNewTable,
    ]) {
      expect(fn).toHaveBeenCalledTimes(1);
    }
  });

  it('Esc and a tap outside resume', () => {
    const props = menuProps();
    const { container } = render(<Menu {...props} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onResume).toHaveBeenCalledTimes(1);
    const scrim = container.querySelector('[aria-hidden="true"]') as HTMLElement;
    fireEvent.click(scrim);
    expect(props.onResume).toHaveBeenCalledTimes(2);
  });

  it('traps Tab inside and gives focus back to the opener when it closes (§12.12)', () => {
    function Table() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open menu
          </button>
          {open && <Menu {...menuProps({ onResume: () => setOpen(false) })} />}
        </>
      );
    }
    render(<Table />);
    const opener = screen.getByRole('button', { name: 'Open menu' });
    opener.focus();
    fireEvent.click(opener);
    const sheet = screen.getByRole('dialog');
    const first = screen.getByRole('button', { name: 'Resume' });
    const last = screen.getByRole('button', { name: 'New table' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(sheet, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(sheet, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    // Focus that lands outside is brought back.
    opener.focus();
    expect(sheet.contains(document.activeElement)).toBe(true);

    fireEvent.click(first);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('every item is at least 44×44 px (§12.12)', () => {
    const { container } = render(
      <Menu {...menuProps({ topUpTo: 2000, onOpenRankings: () => {} })} />,
    );
    expect(controlCount(container)).toBe(6);
    expect(smallTargets(container, () => false)).toEqual([]);
  });
});

describe('Menu: Recent hands (Review, PLAN §12.10)', () => {
  it('is hidden until there is a finished hand, then sits after Hand rankings', () => {
    const { unmount } = render(<Menu {...menuProps({ onOpenRankings: () => {} })} />);
    expect(labels()).not.toContain('Recent hands');
    unmount();

    const onOpenHands = vi.fn();
    render(<Menu {...menuProps({ onOpenRankings: () => {}, onOpenHands })} />);
    expect(labels()).toEqual([
      'Resume',
      'Hand rankings',
      'Recent hands',
      'Settings',
      'Leave table',
      'New table',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Recent hands' }));
    expect(onOpenHands).toHaveBeenCalledTimes(1);
  });
});
