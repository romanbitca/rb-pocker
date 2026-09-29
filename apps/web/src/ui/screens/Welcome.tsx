/**
 * Welcome: the first launch (PLAN §12.1). ⚠️ One tap on Play reaches a dealt hand: Play calls
 * `onPlay` straight from the tap, and nothing (no dialog, tip or Setup) stands in between. The
 * controller starts the default table (you + 5 bots, 2,000 chips, blinds 10/20, Easy bots, Beginner
 * coach) and unlocks audio inside that same tap (§12.13).
 *
 * Links to screens that do not exist yet are hidden, not disabled (§18 Stage 3): the guide
 * (Learn) and Privacy show only when their callback is given.
 */
import { en } from '../../i18n/en.ts';
import { CheckIcon } from './icons.tsx';
import styles from './Screen.module.css';

export interface WelcomeProps {
  /** Play: start a table at once with the defaults. Called synchronously from the tap. */
  onPlay: () => void;
  /** "Choose players, chips and levels" → Setup. */
  onSetup: () => void;
  /** "New to poker? 1-minute guide" → Learn lesson 1. Hidden while absent (Learn comes later). */
  onOpenGuide?: (() => void) | undefined;
  /** The footer's Privacy link. Hidden while absent (the About screen comes later). */
  onOpenPrivacy?: (() => void) | undefined;
}

export function Welcome({ onPlay, onSetup, onOpenGuide, onOpenPrivacy }: WelcomeProps) {
  return (
    <main className={`${styles.page} ${styles.felt}`}>
      <div className={styles.column}>
        <header className={styles.brand}>
          <h1 className={styles.wordmark}>{en.app.name}</h1>
          <p className={styles.tagline}>{en.app.tagline}</p>
        </header>

        <ul className={styles.bullets}>
          {en.welcome.bullets.map((text) => (
            <li key={text}>
              <CheckIcon />
              <span>{text}</span>
            </li>
          ))}
        </ul>

        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={() => onPlay()}>
            {en.welcome.play}
          </button>
          <button type="button" className={styles.link} onClick={() => onSetup()}>
            {en.welcome.setup}
          </button>
          {onOpenGuide && (
            <button type="button" className={styles.link} onClick={() => onOpenGuide()}>
              {en.welcome.guide}
            </button>
          )}
        </div>
      </div>

      <footer className={styles.footer}>
        <p>{en.legal.playMoneyOnly}</p>
        {onOpenPrivacy && (
          <button type="button" className={styles.link} onClick={() => onOpenPrivacy()}>
            {en.legal.privacy}
          </button>
        )}
      </footer>
    </main>
  );
}
