/**
 * Messages over every screen (PLAN §12.11, §12.14):
 * - `Toasts`: short messages from the controller ("Nora sits down."). The controller removes each
 *   after 4 s; a tap removes it at once. A polite live region reads them.
 * - `StorageBanner`: "Stats can't be saved in this browser mode…", once per launch when the
 *   browser storage fails (§14.6); [OK] hides it. The game stays playable in memory.
 */
import type { SessionSummary, Toast } from '../../app/store.ts';
import { en } from '../../i18n/en.ts';
import { formatChips } from '../format.ts';
import { joinNames } from '../names.ts';
import styles from './Notices.module.css';

/**
 * A toast's text (§12.11): each kind is a key of `en.toast` (Leave table's line, chunk 8.2, is
 * built; the collection moment, §12.9, names the category as the hand-end banner does).
 */
export function toastText(toast: Toast): string {
  if (toast.kind === 'botsJoined') {
    return en.toast.botsJoined(joinNames(toast.names), toast.names.length === 1);
  }
  if (toast.kind === 'collection') {
    return en.toast.collection(en.handEnd.category[toast.category]);
  }
  return toast.kind === 'session' ? sessionText(toast.session) : en.toast[toast.kind];
}

/** Leave table (§14.4): "This session: 45 hands · +640 chips · Decision score 82 · 4 mistakes." */
function sessionText(s: SessionSummary): string {
  const t = en.toast;
  const net = s.netChips;
  const chips = net > 0 ? `+${formatChips(net)}` : net < 0 ? `−${formatChips(-net)}` : '0';
  const parts = [t.sessionHands(s.hands, formatChips(s.hands)), t.sessionChips(chips)];
  if (s.decisionScore !== null) parts.push(t.sessionScore(Math.round(s.decisionScore)));
  if (s.decisions > 0) parts.push(t.sessionMistakes(s.mistakes + s.blunders));
  return t.session(parts.join(t.separator));
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
