/**
 * The two small controls that Settings and Setup's "More options" share (PLAN §12.1, §12.2): a
 * setting with a few options drawn as chips, and a switch row. Both are native inputs (arrow keys,
 * screen readers) with the whole face as the tap target (44 px or more).
 */
import styles from './Screen.module.css';

export interface ChoiceProps<V extends string> {
  /** The radio group's name (unique on the page); `${name}-hint` is the hint's id. */
  name: string;
  label: string;
  hint: string;
  options: readonly { value: V; label: string }[];
  value: V;
  onChange: (value: V) => void;
}

/** One setting with a few options: a radio group drawn as chips. */
export function Choice<V extends string>({
  name,
  label,
  hint,
  options,
  value,
  onChange,
}: ChoiceProps<V>) {
  return (
    <fieldset className={styles.section} aria-describedby={`${name}-hint`}>
      <legend className={styles.legend}>{label}</legend>
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

export interface SwitchRowProps {
  /** Unique on the page; `${id}-label` and `${id}-hint` are the ids of the two texts. */
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** An on/off setting: the whole row is the tap target; the knob's side says on or off. */
export function SwitchRow({ id, label, hint, checked, onChange }: SwitchRowProps) {
  return (
    <label className={styles.switchRow}>
      <span className={styles.switchText}>
        <span id={`${id}-label`} className={styles.switchLabel}>
          {label}
        </span>
        <span id={`${id}-hint`} className={styles.hint}>
          {hint}
        </span>
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-hint`}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={styles.switch} aria-hidden="true" />
    </label>
  );
}
