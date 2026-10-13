/**
 * Setup's "More options" (PLAN §12.2 item 5, chunk 7.2): the bot speed, "Set each bot's level" (the
 * per-seat override list of §9.3) and the four-colour deck. Setup mounts it only once the player
 * opens the section, and its code is a lazy chunk (still precached, §15.1), so the first screen
 * does not pay for it (§15.3).
 *
 * The form's state lives in Setup; this only draws it and reports changes. The list has one row per
 * bot (`seatLevels` has one entry per seat, the hero's first); a row's first choice, "Same as
 * table", leaves that bot at the level chosen above.
 */
import { useId } from 'react';
import type { BotLevel } from '../../engine/types.ts';
import { en } from '../../i18n/en.ts';
import { Choice, SwitchRow } from './Controls.tsx';
import s from './MoreOptions.module.css';
import styles from './Screen.module.css';
import { BOT_LEVEL_ORDER, type Speed } from './setupForm.ts';

export interface MoreOptionsProps {
  speed: Speed;
  onSpeed: (speed: Speed) => void;
  /** The table's bot level (Setup's question 3): what "Same as table" means. */
  botLevel: BotLevel;
  /** One entry per seat, the hero's (index 0) first; null = the table's level. */
  seatLevels: readonly (BotLevel | null)[];
  /** The levels that can be picked now (`AVAILABLE_LEVELS`). */
  available: readonly BotLevel[];
  onSeatLevel: (seat: number, level: BotLevel | null) => void;
  fourColour: boolean;
  onFourColour: (on: boolean) => void;
}

const SPEEDS: readonly Speed[] = ['normal', 'fast', 'instant'];

export function MoreOptions({
  speed,
  onSpeed,
  botLevel,
  seatLevels,
  available,
  onSeatLevel,
  fourColour,
  onFourColour,
}: MoreOptionsProps) {
  // The prefix of every id and radio group name here. (Importing from `react` also keeps this lazy
  // chunk from splitting the runtime helpers off the entry: PLAN pitfall 47.)
  const id = useId();
  const hintId = `${id}-bots-hint`;
  return (
    <div className={styles.rows}>
      <Choice
        name={`${id}-speed`}
        label={en.settings.speed.label}
        hint={en.settings.speed.hint}
        options={SPEEDS.map((value) => ({ value, label: en.settings.speed[value] }))}
        value={speed}
        onChange={onSpeed}
      />

      {seatLevels.length > 1 && (
        <fieldset className={styles.section} aria-describedby={hintId}>
          <legend className={styles.legend}>{en.setup.more.bots.legend}</legend>
          <p id={hintId} className={styles.hint}>
            {en.setup.more.bots.hint}
          </p>
          <div className={s.rows}>
            {seatLevels.map((level, seat) =>
              seat === 0 ? null : (
                <div key={seat} className={s.row}>
                  <label htmlFor={`${id}-bot-${seat}`} className={s.rowLabel}>
                    {en.setup.more.bots.bot(seat)}
                  </label>
                  <select
                    id={`${id}-bot-${seat}`}
                    className={s.select}
                    value={level ?? ''}
                    onChange={(e) => {
                      const value = e.target.value;
                      onSeatLevel(seat, value === '' ? null : (value as BotLevel));
                    }}
                  >
                    <option value="">
                      {en.setup.more.bots.sameAsTable(en.levels.bot[botLevel])}
                    </option>
                    {BOT_LEVEL_ORDER.filter((l) => available.includes(l)).map((l) => (
                      <option key={l} value={l}>
                        {en.levels.bot[l]}
                      </option>
                    ))}
                  </select>
                </div>
              ),
            )}
          </div>
        </fieldset>
      )}

      <SwitchRow
        id={`${id}-colour`}
        label={en.setup.more.fourColour.label}
        hint={en.setup.more.fourColour.hint}
        checked={fourColour}
        onChange={onFourColour}
      />
    </div>
  );
}
