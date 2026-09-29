// @vitest-environment jsdom
// The §3.1 dialogs: out of chips (top-up) and a new table while a hand is unfinished.
import '../../../src/ui/styles/tokens.css';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NewTableDialog, OutOfChipsDialog } from '../../../src/ui/screens/Dialogs.tsx';
import styles from '../../../src/ui/screens/Screen.module.css';
import { controlCount, cssClass, smallTargets } from './targets.ts';

const PRIMARY = cssClass(styles, 'primary');

afterEach(cleanup);

const isPrimary = (el: Element) => el.classList.contains(PRIMARY);

describe('OutOfChipsDialog', () => {
  function renderIt() {
    const props = { startingStack: 2000, onTopUp: vi.fn(), onChangeTable: vi.fn() };
    return { ...props, ...render(<OutOfChipsDialog {...props} />) };
  }

  it('asks in the §12.11 words, as a modal alert dialog', () => {
    renderIt();
    const dialog = screen.getByRole('alertdialog', {
      name: "You're out of chips. That's okay: chips are free here.",
    });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reload 2,000 chips' }));
  });

  it('Reload tops up and Change table goes to Setup', () => {
    const { onTopUp, onChangeTable } = renderIt();
    fireEvent.click(screen.getByRole('button', { name: 'Reload 2,000 chips' }));
    expect(onTopUp).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Change table' }));
    expect(onChangeTable).toHaveBeenCalledTimes(1);
  });

  it('cannot be dismissed any other way: Esc and a tap outside do nothing (§3.1)', () => {
    const { onTopUp, onChangeTable, container } = renderIt();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(container.querySelector('[aria-hidden="true"]') as HTMLElement);
    expect(onTopUp).not.toHaveBeenCalled();
    expect(onChangeTable).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('Reload is a 56 px primary button; Change table at least 44 px', () => {
    const { container } = renderIt();
    expect(isPrimary(screen.getByRole('button', { name: 'Reload 2,000 chips' }))).toBe(true);
    expect(controlCount(container)).toBe(2);
    expect(smallTargets(container, isPrimary)).toEqual([]);
  });
});

describe('NewTableDialog', () => {
  function renderIt() {
    const props = { onConfirm: vi.fn(), onCancel: vi.fn() };
    return { ...props, ...render(<NewTableDialog {...props} />) };
  }

  it('asks in the Appendix F.10 words and answers', () => {
    const { onConfirm, onCancel } = renderIt();
    const dialog = screen.getByRole('alertdialog', {
      name: 'Your unfinished hand will be folded. Start a new table?',
    });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Start new table' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Esc and a tap outside cancel', () => {
    const { onConfirm, onCancel, container } = renderIt();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(container.querySelector('[aria-hidden="true"]') as HTMLElement);
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('only the top dialog answers Esc when two are open', () => {
    const outer = { onConfirm: vi.fn(), onCancel: vi.fn() };
    const inner = { onConfirm: vi.fn(), onCancel: vi.fn() };
    render(
      <>
        <NewTableDialog {...outer} />
        <NewTableDialog {...inner} />
      </>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(inner.onCancel).toHaveBeenCalledTimes(1);
    expect(outer.onCancel).not.toHaveBeenCalled();
  });

  it('tap targets (§12.12)', () => {
    const { container } = renderIt();
    expect(controlCount(container)).toBe(2);
    expect(smallTargets(container, isPrimary)).toEqual([]);
  });
});
