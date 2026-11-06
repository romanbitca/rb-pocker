/**
 * Home: every launch after the first (PLAN §12.1). ⚠️ Play is one tap: `onPlay` continues the
 * saved hand when a session exists, otherwise starts a table with the last-used settings; the
 * controller decides which (and re-opens the out-of-chips dialog for a busted hero, §3.1).
 *
 * Tiles for screens that do not exist yet are hidden, not disabled (§18 Stage 3): Learn, Stats and
 * Install app show only when their callback is given.
 *
 * Read-only (§14.7, chunk 8.3: another tab has the game): the §12.11 banner and its "Play here"
 * take the place of Play and New table, and Settings is hidden (nothing could be saved); Learn and
 * Stats stay.
 *
 * The one-time card about installing (§12.11, §12.13, chunk 8.4) sits under the tiles.
 */
import { Fragment, useId } from 'react';
import type { BotLevel, CoachLevel } from '../../engine/types.ts';
import { en } from '../../i18n/en.ts';
import { NudgeCard, type NudgeCardProps } from '../components/NudgeCard.tsx';
import { formatChips } from './numbers.ts';
import styles from './Screen.module.css';

/** The saved session, for the line under Play (Appendix F.10). */
export interface SessionLine {
  /** The hand on the table now: `handsDealt + 1` (Appendix A.3). */
  hand: number;
  players: number;
  /** The hero's chips. */
  chips: number;
  botLevel: BotLevel;
  coachLevel: CoachLevel;
}

export interface HomeProps {
  /** The saved session, or null when there is none. */
  session: SessionLine | null;
  /** Play: continue the session, else start a table with the last-used settings. */
  onPlay: () => void;
  /** "New table…" → Setup. */
  onNewTable: () => void;
  onOpenSettings: () => void;
  /** Hidden while absent (later stages). */
  onOpenLearn?: (() => void) | undefined;
  onOpenStats?: (() => void) | undefined;
  /** "Install app": only while the browser offers it (§12.13). */
  onInstall?: (() => void) | undefined;
  /** Read-only (§14.7): "Play here" (the banner replaces Play and New table). */
  onPlayHere?: (() => void) | undefined;
  /** The one-time card (§12.11), or absent. */
  nudge?: NudgeCardProps | undefined;
}

/** The parts of "Hand 23 · 6 players · You have 2,340 chips · Easy bots · Beginner coach". */
export function sessionParts(s: SessionLine): string[] {
  const t = en.home.session;
  return [
    t.hand(s.hand),
    t.players(s.players),
    t.chips(formatChips(s.chips)),
    t.bots(en.levels.bot[s.botLevel]),
    t.coach(en.levels.coach[s.coachLevel]),
  ];
}

export function Home({
  session,
  onPlay,
  onNewTable,
  onOpenSettings,
  onOpenLearn,
  onOpenStats,
  onInstall,
  onPlayHere,
  nudge,
}: HomeProps) {
  const sessionId = useId();
  const tiles: { key: string; label: string; onClick: () => void }[] = [];
  if (onOpenLearn) tiles.push({ key: 'learn', label: en.home.learn, onClick: onOpenLearn });
  if (onOpenStats) tiles.push({ key: 'stats', label: en.home.stats, onClick: onOpenStats });
  if (!onPlayHere)
    tiles.push({ key: 'settings', label: en.home.settings, onClick: onOpenSettings });
  if (onInstall) tiles.push({ key: 'install', label: en.home.install, onClick: onInstall });

  return (
    <main className={`${styles.page} ${styles.felt}`}>
      <div className={styles.column}>
        <header className={styles.brand}>
          <h1 className={styles.wordmark}>{en.app.name}</h1>
          <p className={styles.tagline}>{en.app.tagline}</p>
        </header>

        {onPlayHere ? (
          <div className={styles.actions}>
            <p className={styles.session} role="alert">
              {en.otherTab.text}
            </p>
            <button type="button" className={styles.primary} onClick={() => onPlayHere()}>
              {en.otherTab.playHere}
            </button>
          </div>
        ) : (
          <>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.primary}
                onClick={() => onPlay()}
                aria-describedby={session ? sessionId : undefined}
              >
                {en.home.play}
              </button>
              {session && (
                <p id={sessionId} className={styles.session}>
                  {sessionParts(session).map((part, i) => (
                    <Fragment key={i}>
                      {i > 0 && en.home.session.separator}
                      <span className={styles.nowrap}>{part}</span>
                    </Fragment>
                  ))}
                </p>
              )}
            </div>

            <button type="button" className={styles.secondary} onClick={() => onNewTable()}>
              {en.home.newTable}
            </button>
          </>
        )}

        <div className={styles.tiles}>
          {tiles.map((tile) => (
            <button
              key={tile.key}
              type="button"
              className={styles.tile}
              onClick={() => tile.onClick()}
            >
              {tile.label}
            </button>
          ))}
        </div>

        {nudge && <NudgeCard {...nudge} />}
      </div>

      <footer className={styles.footer}>
        <p>{en.legal.playMoneyOnly}</p>
      </footer>
    </main>
  );
}
