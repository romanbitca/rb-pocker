/**
 * Settings (PLAN §12.1). The Game section: coach level, bot level, speed, auto next hand, amounts
 * and "Show win chance" (§7.6, chunk 9.1b); then Display and Sound (`DisplayAndSound.tsx`:
 * four-colour cards, text size, reduce motion, keep screen on; sound, vibration). The way to
 * About comes last (chunk 9.2c). A change applies at once through `onChangeSettings(patch)`; the
 * controller saves it (Appendix A.7). The controller starts a new bot level with the next hand and
 * a new coach level with the next decision (§10); the hints under the level cards say so.
 *
 * The level rows are the Setup cards. Levels that are not available yet are disabled with
 * "Coming soon" (`available`, §18).
 *
 * Data (§14.8, chunk 8.4): Export (from the tap itself: the share sheet opens only inside it),
 * Import (the browser's file picker; the preview and Replace are the `dataImport` dialog), Reset
 * stats (its "Delete my stats" dialog) and "Protected from automatic clean-up: Yes/No".
 * Diagnostics (§4.5, §12.14): this launch's counters, the features this page lacks, and "Export
 * debug report". Both sections show when their props are given.
 */
import { useId, type ReactNode } from 'react';
import type { Diagnostics, SecureFeatures } from '../../app/store.ts';
import type { BotLevel, CoachLevel } from '../../engine/types.ts';
import { dataWords as D } from '../../i18n/data.ts';
import { deviceWords } from '../../i18n/device.ts';
import { en } from '../../i18n/en.ts';
import { FileButton } from '../components/FileButton.tsx';
import { Choice, SwitchRow } from './Controls.tsx';
import { DisplayAndSound, type DisplayAndSoundProps } from './DisplayAndSound.tsx';
import { LevelCards } from './LevelCards.tsx';
import { formatChips } from './numbers.ts';
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
  /** "Show win chance" (§7.6): the win chance badge; off, the player practises estimating. */
  showEquity: boolean;
}

/** The Data section (§14.8). */
export interface DataSection {
  /** `persistGranted`: "Protected from automatic clean-up: Yes", else No (null: never asked). */
  persisted: boolean | null;
  /** Export: call it in the tap itself. */
  onExport: () => void;
  /** The file the player picked for Import. */
  onImport: (file: File) => void;
  /** Reset stats: opens its "Delete my stats" dialog. */
  onReset: () => void;
}

/** The Diagnostics section (§4.5, §12.14). */
export interface DiagnosticsSection {
  /** This launch's counters (`game.diag`). */
  counters: Diagnostics;
  /** The features this page lacks (`missingFeatures`). */
  featuresOff: readonly (keyof SecureFeatures)[];
  /** "Export debug report": call it in the tap itself. */
  onExportDebug: () => void;
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
  /**
   * The Display and Sound sections after Game (chunks 9.1 and 9.1b, `DisplayAndSound.tsx`):
   * four-colour cards, text size, reduce motion, keep screen on; sound, vibration. The app always
   * passes them; absent, they are not drawn.
   */
  device?: DisplayAndSoundProps | undefined;
  data?: DataSection | undefined;
  diagnostics?: DiagnosticsSection | undefined;
  /** "About" (§12.1: Settings → About & Privacy), the last row. Hidden while absent. */
  onOpenAbout?: (() => void) | undefined;
}

const SPEEDS: readonly GameSettings['speed'][] = ['normal', 'fast', 'instant'];
const AMOUNTS: readonly GameSettings['amounts'][] = ['chips', 'bb'];

export function Settings({
  settings,
  ownLevels = 0,
  available,
  onChangeSettings,
  onBack,
  device,
  data,
  diagnostics,
  onOpenAbout,
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

          <SwitchRow
            id={`${id}-equity`}
            label={deviceWords.winChance.label}
            hint={deviceWords.winChance.hint}
            checked={settings.showEquity}
            onChange={(showEquity) => onChangeSettings({ showEquity })}
          />
        </section>
        {device !== undefined && <DisplayAndSound {...device} />}

        {data && <DataRows id={`${id}-data`} data={data} />}
        {diagnostics && <DiagnosticsRows id={`${id}-diag`} diagnostics={diagnostics} />}

        {onOpenAbout && (
          <button type="button" className={styles.secondary} onClick={() => onOpenAbout()}>
            {en.about}
          </button>
        )}
      </div>
    </main>
  );
}

/** One Data action: its button, then a line that says what it does (the button's description). */
function Action({ id, hint, children }: { id: string; hint: string; children: ReactNode }) {
  return (
    <div className={styles.action}>
      {children}
      <p id={id} className={styles.hint}>
        {hint}
      </p>
    </div>
  );
}

function DataRows({ id, data }: { id: string; data: DataSection }) {
  return (
    <section className={styles.rows} aria-labelledby={id}>
      <h2 id={id} className={styles.sectionTitle}>
        {D.title}
      </h2>
      <p>{D.saved}</p>
      <Action id={`${id}-export`} hint={D.export.hint}>
        <button
          type="button"
          className={styles.secondary}
          aria-describedby={`${id}-export`}
          onClick={() => data.onExport()}
        >
          {D.export.label}
        </button>
      </Action>
      <Action id={`${id}-import`} hint={D.import.hint}>
        <FileButton
          label={D.import.label}
          className={`${styles.secondary} ${styles.fileButton}`}
          describedBy={`${id}-import`}
          onFile={data.onImport}
        />
      </Action>
      <Action id={`${id}-reset`} hint={D.reset.hint}>
        <button
          type="button"
          className={styles.secondary}
          aria-describedby={`${id}-reset`}
          onClick={() => data.onReset()}
        >
          {D.reset.label}
        </button>
      </Action>
      <div className={styles.action}>
        <p>{data.persisted === true ? D.protectedYes : D.protectedNo}</p>
        {data.persisted !== true && <p className={styles.hint}>{D.protectedHint}</p>}
      </div>
    </section>
  );
}

function DiagnosticsRows({ id, diagnostics }: { id: string; diagnostics: DiagnosticsSection }) {
  const W = D.diagnostics;
  const { counters, featuresOff } = diagnostics;
  const rows: [string, number][] = [
    [W.errors, counters.engineErrors],
    [W.voided, counters.voidedHands],
    [W.fallbacks, counters.botFallbacks],
  ];
  return (
    <section className={styles.rows} aria-labelledby={id}>
      <h2 id={id} className={styles.sectionTitle}>
        {W.title}
      </h2>
      <div className={styles.action}>
        <p className={styles.hint}>{W.since}</p>
        <dl className={styles.facts}>
          {rows.map(([name, n]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>{formatChips(n)}</dd>
            </div>
          ))}
        </dl>
      </div>
      <p>
        {featuresOff.length === 0
          ? W.allOn
          : `${W.off} ${featuresOff.map((f) => W.features[f]).join(', ')}.`}
      </p>
      <Action id={`${id}-export`} hint={W.exportHint}>
        <button
          type="button"
          className={styles.secondary}
          aria-describedby={`${id}-export`}
          onClick={() => diagnostics.onExportDebug()}
        >
          {W.export}
        </button>
      </Action>
    </section>
  );
}
