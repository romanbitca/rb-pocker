/**
 * Welcome: the first launch (PLAN §12.1). ⚠️ One tap on Play reaches a dealt hand: Play calls
 * `onPlay` straight from the tap, and nothing (no dialog, tip or Setup) stands in between. The
 * controller starts the default table (you + 5 bots, 2,000 chips, blinds 10/20, Easy bots, Beginner
 * coach) and unlocks audio inside that same tap (§12.13).
 *
 * Links to screens that do not exist yet are hidden, not disabled (§18 Stage 3): the guide
 * (Learn) and Privacy show only when their callback is given.
 *
 * The first launch of a home-screen app on iOS has storage of its own (§12.13): the card "Played
 * in Safari before?…" [Import] [Skip] sits under the buttons (chunk 8.4).
 */
import { enStart as en } from '../../i18n/start.ts';
import { NudgeCard, type NudgeCardProps } from '../components/NudgeCard.tsx';
import { CheckIcon } from './icons.tsx';
import styles from './Screen.module.css';

export interface WelcomeProps {
  /** Play: start a table at once with the defaults. Called synchronously from the tap. */
  onPlay: () => void;
  /** "Play with friends" (§19.10): given only inside Telegram. */
  onPlayWithFriends?: (() => void) | undefined;
  /** "Choose players, chips and levels" → Setup. */
  onSetup: () => void;
  /** "New to poker? 1-minute guide" → Learn lesson 1. Hidden while absent (Learn comes later). */
  onOpenGuide?: (() => void) | undefined;
  /** The footer's Privacy link: About at its Privacy section (chunk 9.2c). Hidden while absent. */
  onOpenPrivacy?: (() => void) | undefined;
  /** The one-time card (§12.11), or absent. */
  nudge?: NudgeCardProps | undefined;
}

export function Welcome({
  onPlay,
  onPlayWithFriends,
  onSetup,
  onOpenGuide,
  onOpenPrivacy,
  nudge,
}: WelcomeProps) {
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
          {onPlayWithFriends && (
            <button type="button" className={styles.secondary} onClick={() => onPlayWithFriends()}>
              {en.playWithFriends}
            </button>
          )}
          <button type="button" className={styles.link} onClick={() => onSetup()}>
            {en.welcome.setup}
          </button>
          {onOpenGuide && (
            <button type="button" className={styles.link} onClick={() => onOpenGuide()}>
              {en.welcome.guide}
            </button>
          )}
        </div>

        {nudge && <NudgeCard {...nudge} />}
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
