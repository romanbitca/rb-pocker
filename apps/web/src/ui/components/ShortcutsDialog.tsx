/**
 * "Keyboard shortcuts" (PLAN §12.5 "? list shortcuts", chunk 9.3): the Table's keys in a dialog
 * (`Modal`: focus trapped, Esc and the scrim close it, focus goes back where it was). ? or the
 * Menu's "Keyboard shortcuts" opens it (the `shortcuts` overlay, which closes the `sheet` gate:
 * nothing moves while it is read). A lazy chunk with its words (`i18n/shortcuts.ts`): it costs the
 * Table nothing until it opens.
 */
import { useId } from 'react';
import { shortcutWords } from '../../i18n/shortcuts.ts';
import o from '../screens/Overlays.module.css';
import screen from '../screens/Screen.module.css';
import { Modal } from './Modal.tsx';
import styles from './ShortcutsDialog.module.css';

export interface ShortcutsDialogProps {
  /** Close (also Esc, the scrim and Back). */
  readonly onClose: () => void;
}

export function ShortcutsDialog({ onClose }: ShortcutsDialogProps) {
  const titleId = useId();
  return (
    <Modal kind="dialog" labelledBy={titleId} onDismiss={onClose}>
      <h2 id={titleId} className={o.title}>
        {shortcutWords.title}
      </h2>
      <dl className={styles.list} data-shortcuts="">
        {shortcutWords.rows.map(([keys, what]) => (
          <div key={keys} className={styles.row}>
            <dt>
              <kbd className={styles.key}>{keys}</kbd>
            </dt>
            <dd className={styles.what}>{what}</dd>
          </div>
        ))}
      </dl>
      <p className={styles.note}>{shortcutWords.note}</p>
      <button type="button" className={screen.secondary} onClick={() => onClose()}>
        {shortcutWords.close}
      </button>
    </Modal>
  );
}
