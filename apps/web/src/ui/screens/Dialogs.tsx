/**
 * The §3.1 dialogs (copy: §12.11, Appendix F.10). Each keeps the controller's `dialog` gate closed
 * while it is open (Appendix A.8).
 */
import { useId } from 'react';
import { en } from '../../i18n/en.ts';
import { Modal } from '../components/Modal.tsx';
import { formatChips } from './numbers.ts';
import o from './Overlays.module.css';
import styles from './Screen.module.css';

export interface OutOfChipsDialogProps {
  /** The table's starting stack: "Reload 2,000 chips". */
  startingStack: number;
  /** Reload = a top-up to the starting stack, counted in `reloads` (§3.1). */
  onTopUp: () => void;
  /** → Setup; the old table's session ends (`{ type: 'replace', screen: 'setup' }`). */
  onChangeTable: () => void;
}

/**
 * "You're out of chips. That's okay: chips are free here." It cannot be dismissed: no Esc, no
 * scrim. Back leaves the Table for Home (the navigation reducer), and Home's Play opens it again.
 */
export function OutOfChipsDialog({ startingStack, onTopUp, onChangeTable }: OutOfChipsDialogProps) {
  const textId = useId();
  return (
    <Modal kind="dialog" alert labelledBy={textId}>
      <p id={textId} className={o.text}>
        {en.dialog.outOfChips.text}
      </p>
      <div className={o.buttons}>
        <button type="button" className={styles.primary} onClick={() => onTopUp()}>
          {en.dialog.outOfChips.reload(formatChips(startingStack))}
        </button>
        <button type="button" className={styles.secondary} onClick={() => onChangeTable()}>
          {en.dialog.outOfChips.changeTable}
        </button>
      </div>
    </Modal>
  );
}

export interface NewTableDialogProps {
  /** Fold the unfinished hand, finish it headlessly and start the new table (§3.1). */
  onConfirm: () => void;
  /** Keep the unfinished hand (also Esc, the scrim and Back). */
  onCancel: () => void;
}

/** "Your unfinished hand will be folded. Start a new table?" (§3.1, Appendix F.10). */
export function NewTableDialog({ onConfirm, onCancel }: NewTableDialogProps) {
  const textId = useId();
  return (
    <Modal kind="dialog" alert labelledBy={textId} onDismiss={onCancel}>
      <p id={textId} className={o.text}>
        {en.dialog.newTable.text}
      </p>
      <div className={o.buttons}>
        <button type="button" className={styles.primary} onClick={() => onConfirm()}>
          {en.dialog.newTable.confirm}
        </button>
        <button type="button" className={styles.secondary} onClick={() => onCancel()}>
          {en.dialog.newTable.cancel}
        </button>
      </div>
    </Modal>
  );
}
