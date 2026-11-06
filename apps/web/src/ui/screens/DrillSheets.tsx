/**
 * The hand drill's two sheets (PLAN §13.5), both `Modal` sheets (§12.12: a dialog named by its
 * title, focus moved in and trapped, back to the opener on close; Esc, the scrim, Close and
 * Android Back close it). They reuse the shared classes (the Menu's list, Settings' choice chips,
 * the quiz's buttons), so they add nothing to the stylesheet.
 * - Choose a game: the difficulty (radio chips with the difficulty's line under them: the sheet
 *   stays open and a new question is dealt) and the eight games (a tap closes the sheet and deals
 *   one).
 * - Your stats: per hand, how often it was answered right, with a bar; hands you miss come up more
 *   often. "Reset stats" asks for a second tap within 3 seconds; Close comes first, so the sheet
 *   does not open with the focus on it.
 */
import { useEffect, useId, useState } from 'react';
import { RANKINGS } from '../../data/rankings.ts';
import type { DrillData } from '../../drill/data.ts';
import type { Difficulty, GameId } from '../../drill/questions.ts';
import { drillWords as W } from '../../i18n/drill.ts';
import levels from '../components/Levels.module.css';
import { Modal } from '../components/Modal.tsx';
import { Choice } from './Controls.tsx';
import * as css from './drillStyles.ts';
import o from './Overlays.module.css';
import screen from './Screen.module.css';

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <div style={css.sheetButtons}>
      <button type="button" className={levels.button} onClick={() => onClose()}>
        {W.close}
      </button>
    </div>
  );
}

export interface GamesSheetProps {
  data: DrillData;
  games: readonly GameId[];
  difficulties: readonly Difficulty[];
  onDifficulty: (difficulty: Difficulty) => void;
  onGame: (game: GameId) => void;
  onClose: () => void;
}

export function GamesSheet({
  data,
  games,
  difficulties,
  onDifficulty,
  onGame,
  onClose,
}: GamesSheetProps) {
  const id = useId();
  return (
    <Modal kind="sheet" labelledBy={`${id}-title`} onDismiss={onClose}>
      <h2 id={`${id}-title`} className={o.title}>
        {W.gamesTitle}
      </h2>
      <Choice
        name={`${id}-difficulty`}
        label={W.difficulty}
        hint={W.difficulties[data.difficulty].desc}
        options={difficulties.map((d) => ({ value: d, label: W.difficulties[d].name }))}
        value={data.difficulty}
        onChange={onDifficulty}
      />
      <h3 id={`${id}-games`} className={screen.legend}>
        {W.game}
      </h3>
      <ul className={o.items} aria-labelledby={`${id}-games`}>
        {games.map((g) => {
          const on = g === data.game;
          return (
            <li key={g}>
              <button
                type="button"
                className={o.item}
                style={on ? css.gameOptionOn : css.gameOption}
                aria-pressed={on}
                onClick={() => onGame(g)}
                data-game={g}
              >
                <span style={css.spread}>
                  <span>{W.games[g].name}</span>
                  {on && <span style={css.accentCaps}>{W.playing}</span>}
                </span>
                <span style={css.sheetText}>{W.games[g].desc}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <CloseButton onClose={onClose} />
    </Modal>
  );
}

/** How long "Tap again to reset" waits for the second tap. */
const RESET_ARM_MS = 3000;

export interface StatsSheetProps {
  data: DrillData;
  onReset: () => void;
  onClose: () => void;
}

export function StatsSheet({ data, onReset, onClose }: StatsSheetProps) {
  const id = useId();
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), RESET_ARM_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);
  const reset = () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    onReset();
  };
  return (
    <Modal kind="sheet" labelledBy={`${id}-title`} onDismiss={onClose}>
      <h2 id={`${id}-title`} className={o.title}>
        {W.statsTitle}
      </h2>
      <p style={css.sheetText}>{W.statsSummary(data.answered, data.best)}</p>
      <ol style={css.statList}>
        {RANKINGS.map((row, i) => {
          const { seen, missed } = data.hands[row.key];
          const right = seen - missed;
          const pct = seen > 0 ? Math.round((100 * right) / seen) : null;
          return (
            <li key={row.key} style={css.statRow} data-category={row.key}>
              <span className={screen.srOnly}>
                {pct === null ? W.statsRowNone(row.name) : W.statsRow(row.name, pct, right, seen)}
              </span>
              <span style={css.chip('plain', 36)} aria-hidden="true">
                {i + 1}
              </span>
              <span style={css.statText} aria-hidden="true">
                <span style={css.spread}>
                  <b>{row.name}</b>
                  <span style={css.numbers}>
                    {pct === null ? W.noAccuracy : W.accuracy(pct)}
                    <small style={css.numbersSmall}>
                      {seen > 0 ? W.rightOf(right, seen) : W.notSeen}
                    </small>
                  </span>
                </span>
                <span style={css.bar}>{pct !== null && <i style={css.barFill(pct)} />}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <div style={css.sheetButtons}>
        <button type="button" className={levels.button} onClick={() => onClose()}>
          {W.close}
        </button>
        <button
          type="button"
          className={levels.button}
          style={css.resetButton}
          onClick={reset}
          data-drill-reset=""
        >
          {armed ? W.resetConfirm : W.reset}
        </button>
      </div>
    </Modal>
  );
}
