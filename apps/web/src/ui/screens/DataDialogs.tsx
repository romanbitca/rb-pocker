/**
 * The Data dialogs (PLAN §14.8, §12.11; chunk 8.4): Import's preview with Replace, and Reset's
 * "Delete my stats". Both are `Modal` dialogs (focus moved in and trapped, Esc and the scrim
 * cancel, Back closes them through the navigation reducer, focus returns to the opener) and keep
 * the controller's `dialog` gate closed while open (the `dataImport` and `dataReset` overlays).
 *
 * Import: the controller opens the dialog when a picked file is being read (`data.importCheck`),
 * shows its preview ("3 hands, exported 6 Nov 2026") with [Replace] [Cancel], or why it cannot be
 * imported with [OK]. Replace only (no merge in v1); an unfinished hand is cancelled, and the
 * dialog says so.
 */
import { useId } from 'react';
import type { ImportCheck } from '../../app/store.ts';
import { dataWords as D } from '../../i18n/data.ts';
import { Modal } from '../components/Modal.tsx';
import { formatChips } from './numbers.ts';
import o from './Overlays.module.css';
import styles from './Screen.module.css';

/** "12 Sep 2026": the local date of an ISO time, the same in every browser locale (§0.3). */
export function exportDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getDate()} ${D.months[d.getMonth()] ?? ''} ${d.getFullYear()}`;
}

/** The dialog's text for a check: the preview, or why the file cannot be imported. */
export function checkText(check: ImportCheck): string {
  switch (check.status) {
    case 'reading':
      return D.reading;
    case 'ready':
      return D.preview(formatChips(check.hands), check.hands === 1, exportDate(check.exportedAt));
    case 'failed':
      return D.failed[check.why];
  }
}

export interface ImportDialogProps {
  check: ImportCheck;
  /** A hand is dealt and not over: Replace cancels it (§14.8 notes). */
  handInProgress: boolean;
  onReplace: () => void;
  /** Cancel, OK, Esc, the scrim (Back closes the overlay; the controller then forgets the file). */
  onCancel: () => void;
}

export function ImportDialog({ check, handInProgress, onReplace, onCancel }: ImportDialogProps) {
  const titleId = useId();
  const textId = useId();
  const ready = check.status === 'ready';
  return (
    <Modal
      kind="dialog"
      alert={ready}
      labelledBy={titleId}
      describedBy={textId}
      onDismiss={onCancel}
    >
      <h2 id={titleId} className={o.title}>
        {D.importTitle}
      </h2>
      <div id={textId} role="status" data-import-check={check.status}>
        <p className={o.text}>{checkText(check)}</p>
        {ready && <p className={o.text}>{D.replaceText}</p>}
        {ready && handInProgress && <p className={o.text}>{D.handCancelled}</p>}
      </div>
      <div className={o.buttons}>
        {ready && (
          <button key="replace" type="button" className={styles.primary} onClick={onReplace}>
            {D.replace}
          </button>
        )}
        <button key="cancel" type="button" className={styles.secondary} onClick={onCancel}>
          {check.status === 'failed' ? D.ok : D.cancel}
        </button>
      </div>
    </Modal>
  );
}

export interface ResetDialogProps {
  /** "Delete my stats": Reset (§14.8). */
  onConfirm: () => void;
  /** Cancel, Esc, the scrim. */
  onCancel: () => void;
}

/** §14.8: "confirmation with a red 'Delete my stats' button". */
export function ResetDialog({ onConfirm, onCancel }: ResetDialogProps) {
  const titleId = useId();
  const textId = useId();
  return (
    <Modal kind="dialog" alert labelledBy={titleId} describedBy={textId} onDismiss={onCancel}>
      <h2 id={titleId} className={o.title}>
        {D.resetTitle}
      </h2>
      <p id={textId} className={o.text}>
        {D.resetText}
      </p>
      <div className={o.buttons}>
        <button type="button" className={`${styles.primary} ${styles.danger}`} onClick={onConfirm}>
          {D.deleteMyStats}
        </button>
        <button type="button" className={styles.secondary} onClick={onCancel}>
          {D.cancel}
        </button>
      </div>
    </Modal>
  );
}
