// @vitest-environment jsdom
// The Data dialogs (PLAN §14.8, §12.11, §12.12; chunk 8.4): Import's preview with Replace, and
// Reset's red "Delete my stats". Dialog semantics, focus, Esc and the scrim, tap targets.
import '../../../src/ui/styles/tokens.css';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImportCheck } from '../../../src/app/store.ts';
import {
  checkText,
  exportDate,
  ImportDialog,
  ResetDialog,
} from '../../../src/ui/screens/DataDialogs.tsx';
import styles from '../../../src/ui/screens/Screen.module.css';
import { cssClass, smallTargets } from './targets.ts';

afterEach(cleanup);

const PRIMARY = cssClass(styles, 'primary');

function renderImport(check: ImportCheck, handInProgress = false) {
  const props = { check, handInProgress, onReplace: vi.fn(), onCancel: vi.fn() };
  return { ...props, ...render(<ImportDialog {...props} />) };
}

const ready: ImportCheck = { status: 'ready', hands: 1234, exportedAt: '2026-09-12T10:00:00.000Z' };

describe('Import (§14.8): the preview, then Replace only', () => {
  it('the preview: "1,234 hands, exported 12 Sep 2026", what Replace does, [Replace] [Cancel]', () => {
    const { onReplace, onCancel } = renderImport(ready);
    const dialog = screen.getByRole('alertdialog', { name: 'Import stats' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.textContent).toContain('1,234 hands, exported 12 Sep 2026');
    expect(dialog.textContent).toContain(
      'The stats on this device will be replaced by the stats in this file.',
    );
    expect(dialog.textContent).not.toContain('unfinished hand');
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
    expect(onReplace).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('says an unfinished hand will be cancelled (chunk 8.3: its number may be in the file)', () => {
    renderImport(ready, true);
    expect(screen.getByRole('alertdialog').textContent).toContain(
      'Your unfinished hand will be cancelled, and its chips go back.',
    );
  });

  it('one hand: "1 hand"', () => {
    expect(
      checkText({ status: 'ready', hands: 1, exportedAt: '2026-01-05T08:00:00.000Z' }),
    ).toMatch(/^1 hand, exported \d+ Jan 2026$/);
  });

  it('reading, then a file that cannot be imported: why, and [OK]', () => {
    renderImport({ status: 'reading' });
    expect(screen.getByRole('dialog', { name: 'Import stats' }).textContent).toContain(
      'Reading the file…',
    );
    expect(screen.queryByRole('button', { name: 'Replace' })).toBeNull();
    cleanup();
    const words = {
      notStats: 'This is not a stats file of RB Poker Coach.',
      newer: 'This file is from a newer version of the game. Update the game, then try again.',
      damaged: 'This stats file is damaged, so it cannot be imported.',
      unreadable: 'This file could not be read. Please try again.',
    } as const;
    for (const [why, text] of Object.entries(words)) {
      const { onCancel } = renderImport({ status: 'failed', why: why as keyof typeof words });
      expect(screen.getByRole('dialog').textContent).toContain(text);
      fireEvent.click(screen.getByRole('button', { name: 'OK' }));
      expect(onCancel).toHaveBeenCalledTimes(1);
      cleanup();
    }
  });

  it('the text is a live region, so a screen reader hears the preview when it arrives', () => {
    renderImport({ status: 'reading' });
    const status = screen.getByRole('status');
    expect(screen.getByRole('dialog').getAttribute('aria-describedby')).toBe(status.id);
  });

  it('Esc and the scrim cancel; focus moves in, and back to the opener after', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { onCancel, unmount } = renderImport(ready);
    expect(document.activeElement?.textContent).toBe('Replace');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    (document.querySelector('[aria-hidden="true"]') as HTMLElement).click();
    expect(onCancel).toHaveBeenCalledTimes(2);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('the date is the player`s calendar day, in the same words on every device', () => {
    expect(exportDate('2026-09-12T10:00:00.000Z')).toBe('12 Sep 2026');
    expect(exportDate('not a date')).toBe('not a date');
  });
});

describe('Reset stats (§14.8): a red "Delete my stats"', () => {
  it('asks first; "Delete my stats" is red and confirms, Cancel and Esc do not', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { container } = render(<ResetDialog onConfirm={onConfirm} onCancel={onCancel} />);
    const dialog = screen.getByRole('alertdialog', { name: 'Delete your stats?' });
    expect(dialog.textContent).toContain(
      'Your stats and saved hands will be deleted. Your settings stay. You cannot undo this.',
    );
    const del = screen.getByRole('button', { name: 'Delete my stats' });
    expect(del.classList.contains(cssClass(styles, 'danger'))).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(del);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(
      smallTargets(container.ownerDocument.body, (el) => el.classList.contains(PRIMARY)),
    ).toEqual([]);
  });
});
