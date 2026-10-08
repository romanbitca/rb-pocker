/**
 * Level cards (PLAN §10, §12.2): one radio card per bot level or coach level, 2×2 on phones. Setup
 * asks them as two of its questions and Settings shows them as two rows, so both use this.
 *
 * A level that is not available yet is shown disabled with "Coming soon" (§18): Hard and Expert
 * bots, Advanced and Exam coach, until their stages. The cards are native radios (arrow keys,
 * screen readers); the whole card is the tap target (44 px or more).
 */
import type { BotLevel, CoachLevel } from '../../engine/types.ts';
import { en } from '../../i18n/en.ts';
import { CheckIcon } from './icons.tsx';
import s from './LevelCards.module.css';
import styles from './Screen.module.css';

export interface LevelCardsProps<L extends BotLevel | CoachLevel> {
  /** The radio group's name (unique on the page). */
  name: string;
  /** The fieldset's legend: a question in Setup, a setting's name in Settings. */
  legend: string;
  /** The legend's look (`styles.question` in Setup, `styles.legend` in Settings). */
  legendClass: string | undefined;
  /** A line under the cards that describes the group, for example when a change starts. */
  hint?: string | undefined;
  order: readonly L[];
  available: readonly L[];
  value: L;
  names: Readonly<Record<L, string>>;
  texts: Readonly<Record<L, string>>;
  onChange: (level: L) => void;
}

export function LevelCards<L extends BotLevel | CoachLevel>({
  name,
  legend,
  legendClass,
  hint,
  order,
  available,
  value,
  names,
  texts,
  onChange,
}: LevelCardsProps<L>) {
  const hintId = `${name}-hint`;
  return (
    <fieldset className={styles.section} aria-describedby={hint === undefined ? undefined : hintId}>
      <legend className={legendClass}>{legend}</legend>
      <div className={s.levels}>
        {order.map((level) => {
          const open = available.includes(level);
          return (
            <label key={level} className={s.level}>
              <input
                type="radio"
                name={name}
                value={level}
                checked={value === level}
                disabled={!open}
                onChange={() => {
                  if (open) onChange(level);
                }}
              />
              <span className={s.levelFace}>
                <span className={s.levelName}>{names[level]}</span>
                <span className={s.levelText}>{texts[level]}</span>
                {!open && <span className={s.soon}>{en.levels.comingSoon}</span>}
                <span className={s.tick}>
                  <CheckIcon />
                </span>
              </span>
            </label>
          );
        })}
      </div>
      {hint !== undefined && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
    </fieldset>
  );
}
