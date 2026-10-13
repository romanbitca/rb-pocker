/**
 * Settings (PLAN §12.1). The Game section so far: coach level, bot level, speed, auto next hand and
 * amounts; later stages add rows (win chance) and sections (Display, Sound, Data, About). A change
 * applies at once through `onChangeSettings(patch)`; the controller saves it (Appendix A.7). The
 * controller starts a new bot level with the next hand and a new coach level with the next
 * decision (§10); the hints under the level cards say so.
 *
 * The level rows are the Setup cards. Levels that are not available yet are disabled with
 * "Coming soon" (`available`, §18).
 */
import { useId } from 'react';
import type { BotLevel, CoachLevel } from '../../engine/types.ts';
import { en } from '../../i18n/en.ts';
import { Choice, SwitchRow } from './Controls.tsx';
import { LevelCards } from './LevelCards.tsx';
import { ScreenBar } from './ScreenBar.tsx';
import styles from './Screen.module.css';
import { BOT_LEVEL_ORDER, COACH_LEVEL_ORDER, type AvailableLevels } from './setupForm.ts';

/** The Game rows, named as in `Settings` (Appendix A.7): a `Settings` object fits. */
export interface GameSettings {
  coachLevel: CoachLevel;
  botLevel: BotLevel;
  speed: 'normal' | 'fast' | 'instant';
  autoNext: boolean;
  amounts: 'chips' | 'bb';
}

export interface SettingsProps {
  settings: GameSettings;
  /**
   * How many bots have a level of their own (§9.3, chunk 7.2); the Bot level row says so, because
   * the cards above it do not change those bots. Absent or 0: nothing is said.
   */
  ownLevels?: number | undefined;
  /** The levels that can be picked now (`AVAILABLE_LEVELS`). */
  available: AvailableLevels;
  /** Only the changed field. */
  onChangeSettings: (patch: Partial<GameSettings>) => void;
  onBack: () => void;
}

const SPEEDS: readonly GameSettings['speed'][] = ['normal', 'fast', 'instant'];
const AMOUNTS: readonly GameSettings['amounts'][] = ['chips', 'bb'];

export function Settings({
  settings,
  ownLevels = 0,
  available,
  onChangeSettings,
  onBack,
}: SettingsProps) {
  const id = useId();
  return (
    <main className={styles.page}>
      <ScreenBar title={en.settings.title} onBack={onBack} />
      <div className={styles.content}>
        <section className={styles.rows} aria-labelledby={`${id}-game`}>
          <h2 id={`${id}-game`} className={styles.sectionTitle}>
            {en.settings.game}
          </h2>

          <LevelCards
            name={`${id}-coach`}
            legend={en.settings.coachLevel.label}
            legendClass={styles.legend}
            hint={en.settings.coachLevel.hint}
            order={COACH_LEVEL_ORDER}
            available={available.coach}
            value={settings.coachLevel}
            names={en.levels.coach}
            texts={en.levels.coachText}
            onChange={(coachLevel) => onChangeSettings({ coachLevel })}
          />

          <LevelCards
            name={`${id}-bots`}
            legend={en.settings.botLevel.label}
            legendClass={styles.legend}
            hint={
              ownLevels > 0
                ? `${en.settings.botLevel.hint} ${en.settings.botLevel.own(ownLevels)}`
                : en.settings.botLevel.hint
            }
            order={BOT_LEVEL_ORDER}
            available={available.bot}
            value={settings.botLevel}
            names={en.levels.bot}
            texts={en.levels.botText}
            onChange={(botLevel) => onChangeSettings({ botLevel })}
          />

          <Choice
            name={`${id}-speed`}
            label={en.settings.speed.label}
            hint={en.settings.speed.hint}
            options={SPEEDS.map((v) => ({ value: v, label: en.settings.speed[v] }))}
            value={settings.speed}
            onChange={(speed) => onChangeSettings({ speed })}
          />

          <SwitchRow
            id={`${id}-auto`}
            label={en.settings.autoNext.label}
            hint={en.settings.autoNext.hint}
            checked={settings.autoNext}
            onChange={(autoNext) => onChangeSettings({ autoNext })}
          />

          <Choice
            name={`${id}-amounts`}
            label={en.settings.amounts.label}
            hint={en.settings.amounts.hint}
            options={AMOUNTS.map((v) => ({ value: v, label: en.settings.amounts[v] }))}
            value={settings.amounts}
            onChange={(amounts) => onChangeSettings({ amounts })}
          />
        </section>
      </div>
    </main>
  );
}
