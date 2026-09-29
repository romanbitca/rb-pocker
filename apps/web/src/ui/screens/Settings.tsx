/**
 * Settings (PLAN §12.1). Stage 3 has the Game section only: speed, auto next hand and amounts;
 * later stages add rows (win chance, levels) and sections (Display, Sound, Data, About). A change
 * applies at once through `onChangeSettings(patch)`; the controller saves it (Appendix A.7).
 */
import { useId } from 'react';
import { en } from '../../i18n/en.ts';
import { ScreenBar } from './ScreenBar.tsx';
import styles from './Screen.module.css';

/** The Game rows, named as in `Settings` (Appendix A.7): a `Settings` object fits. */
export interface GameSettings {
  speed: 'normal' | 'fast' | 'instant';
  autoNext: boolean;
  amounts: 'chips' | 'bb';
}

export interface SettingsProps {
  settings: GameSettings;
  /** Only the changed field. */
  onChangeSettings: (patch: Partial<GameSettings>) => void;
  onBack: () => void;
}

const SPEEDS: readonly GameSettings['speed'][] = ['normal', 'fast', 'instant'];
const AMOUNTS: readonly GameSettings['amounts'][] = ['chips', 'bb'];

export function Settings({ settings, onChangeSettings, onBack }: SettingsProps) {
  const id = useId();
  return (
    <main className={styles.page}>
      <ScreenBar title={en.settings.title} onBack={onBack} />
      <div className={styles.content}>
        <section className={styles.section} aria-labelledby={`${id}-game`}>
          <h2 id={`${id}-game`} className={styles.sectionTitle}>
            {en.settings.game}
          </h2>

          <Choice
            name={`${id}-speed`}
            label={en.settings.speed.label}
            hint={en.settings.speed.hint}
            options={SPEEDS.map((v) => ({ value: v, label: en.settings.speed[v] }))}
            value={settings.speed}
            onChange={(speed) => onChangeSettings({ speed })}
          />

          <label className={styles.switchRow}>
            <span className={styles.switchText}>
              <span id={`${id}-auto`} className={styles.switchLabel}>
                {en.settings.autoNext.label}
              </span>
              <span id={`${id}-auto-hint`} className={styles.hint}>
                {en.settings.autoNext.hint}
              </span>
            </span>
            <input
              type="checkbox"
              role="switch"
              aria-labelledby={`${id}-auto`}
              aria-describedby={`${id}-auto-hint`}
              checked={settings.autoNext}
              onChange={(e) => onChangeSettings({ autoNext: e.target.checked })}
            />
            <span className={styles.switch} aria-hidden="true" />
          </label>

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

interface ChoiceProps<V extends string> {
  name: string;
  label: string;
  hint: string;
  options: readonly { value: V; label: string }[];
  value: V;
  onChange: (value: V) => void;
}

/** One setting with a few options: a radio group drawn as chips. */
function Choice<V extends string>({ name, label, hint, options, value, onChange }: ChoiceProps<V>) {
  return (
    <fieldset className={styles.section} aria-describedby={`${name}-hint`}>
      <legend className={styles.switchLabel}>{label}</legend>
      <div className={`${styles.choices} ${options.length === 2 ? styles.choices2 : ''}`}>
        {options.map((option) => (
          <label key={option.value} className={styles.choice}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span className={styles.face}>{option.label}</span>
          </label>
        ))}
      </div>
      <p id={`${name}-hint`} className={styles.hint}>
        {hint}
      </p>
    </fieldset>
  );
}
