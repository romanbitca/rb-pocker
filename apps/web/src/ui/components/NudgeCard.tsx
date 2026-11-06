/**
 * The one-time card on Home and Welcome (PLAN §12.11, §12.13; chunk 8.4), under the buttons: it
 * never sits between Play and the first hand (§12.1), and it is there from the first paint (the
 * controller works it out at boot), so nothing moves when it shows.
 * - `iosTip`: "Tip: add RB Poker Coach to your Home Screen…" [Got it];
 * - `installCard`: "Install RB Poker Coach?…" [Install] [Not now];
 * - `safariImport`: "Played in Safari before?…" [Import] (the file picker) [Skip].
 */
import { useId } from 'react';
import type { Nudge } from '../../app/store.ts';
import { enStart as en } from '../../i18n/start.ts';
import styles from '../screens/Screen.module.css';
import { FileButton } from './FileButton.tsx';

export interface NudgeCardProps {
  nudge: Nudge;
  /** [Got it], [Not now], [Skip]: the card does not come back. */
  onDismiss: () => void;
  /** The install card's [Install]: the browser's dialog, from the tap itself (it answers the card). */
  onInstall?: (() => void) | undefined;
  /** The Safari card's [Import]: the picked file. */
  onImportFile?: ((file: File) => void) | undefined;
}

/** The answer that closes each card (its text is `en.nudge[nudge]`). */
const DISMISS: Readonly<Record<Nudge, string>> = {
  iosTip: en.nudge.gotIt,
  installCard: en.nudge.notNow,
  safariImport: en.nudge.skip,
};

export function NudgeCard({ nudge, onDismiss, onInstall, onImportFile }: NudgeCardProps) {
  const textId = useId();
  return (
    <section className={styles.card} aria-labelledby={textId} data-nudge={nudge}>
      <p id={textId}>{en.nudge[nudge]}</p>
      <div className={styles.cardButtons}>
        {nudge === 'installCard' && onInstall && (
          <button type="button" className={styles.secondary} onClick={() => onInstall()}>
            {en.nudge.installNow}
          </button>
        )}
        {nudge === 'safariImport' && onImportFile && (
          <FileButton
            label={en.nudge.import}
            className={`${styles.secondary} ${styles.fileButton}`}
            onFile={onImportFile}
          />
        )}
        <button type="button" className={styles.secondary} onClick={() => onDismiss()}>
          {DISMISS[nudge]}
        </button>
      </div>
    </section>
  );
}
