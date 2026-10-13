/**
 * Messages over every screen (PLAN §12.11, §12.14):
 * - `Toasts`: short messages from the controller ("Nora sits down."). The controller removes each
 *   after 4 s; a tap removes it at once. A polite live region reads them.
 * - `StorageBanner`: "Stats can't be saved in this browser mode…", once per launch when the
 *   browser storage fails (§14.6); [OK] hides it. The game stays playable in memory.
 */
import type { Toast } from '../../app/store.ts';
import { en } from '../../i18n/en.ts';
import { joinNames } from '../handEnd.ts';
import styles from './Notices.module.css';

/** A toast's text (§12.11). */
export function toastText(toast: Toast): string {
  switch (toast.kind) {
    case 'botsJoined':
      return en.toast.botsJoined(joinNames(toast.names), toast.names.length === 1);
    case 'handVoided':
      return en.toast.handVoided;
    case 'handNotRestored':
      return en.toast.handNotRestored;
    case 'dataRecovered':
      return en.toast.dataRecovered;
    case 'dataRestored':
      return en.toast.dataRestored;
    case 'undone':
      return en.toast.undone;
  }
}

export interface ToastsProps {
  toasts: readonly Toast[];
  onDismiss: (id: number) => void;
}

export function Toasts({ toasts, onDismiss }: ToastsProps) {
  // Always mounted: a live region must exist before its text changes.
  return (
    <div className={styles.toasts} role="status" aria-live="polite">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          className={styles.toast}
          onClick={() => onDismiss(toast.id)}
        >
          {toastText(toast)}
        </button>
      ))}
    </div>
  );
}

export interface StorageBannerProps {
  onDismiss: () => void;
}

export function StorageBanner({ onDismiss }: StorageBannerProps) {
  return (
    <div className={styles.storage} role="alert">
      <p className={styles.storageText}>{en.storage.banner}</p>
      <button type="button" className={styles.ok} onClick={() => onDismiss()}>
        {en.storage.ok}
      </button>
    </div>
  );
}
