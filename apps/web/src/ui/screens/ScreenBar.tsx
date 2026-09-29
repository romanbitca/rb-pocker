/**
 * The top of a screen that has a way back (Setup, Settings): Back on the left, the title centred.
 * A visible Back matters in an installed app, where there is no browser toolbar (§12.13). It does
 * what Android Back does (`navigate(nav, { type: 'back' })`, app/navigation.ts).
 */
import { en } from '../../i18n/en.ts';
import { ChevronLeftIcon } from './icons.tsx';
import styles from './Screen.module.css';

export interface ScreenBarProps {
  title: string;
  onBack: () => void;
}

export function ScreenBar({ title, onBack }: ScreenBarProps) {
  return (
    <header className={styles.bar}>
      <button type="button" className={styles.back} onClick={() => onBack()}>
        <ChevronLeftIcon />
        <span>{en.back}</span>
      </button>
      <h1 className={styles.title}>{title}</h1>
      <span aria-hidden="true" />
    </header>
  );
}
