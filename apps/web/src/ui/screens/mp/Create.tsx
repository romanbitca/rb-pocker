/**
 * "New table" (PLAN §19.10), the Create screen of Play with friends: how many players, which game
 * and how long a turn lasts, then "Create table". The driver opens the socket when this screen
 * comes on show and asks the server when the button is tapped (§19.6); a second tap does nothing.
 *
 * Look: the existing form's classes (`Screen.module.css`). What is new is inline, so this chunk
 * adds nothing to the one stylesheet (§15.3: its budget is nearly used).
 */
import { useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { useDispatch } from '../../../app/store.ts';
import { mpWords } from '../../../i18n/mp.ts';
import {
  MAX_SEATS,
  MIN_SEATS,
  TURN_SECONDS,
  type StakesId,
  type TurnSeconds,
} from '../../../net/protocol.ts';
import { ScreenBar } from '../ScreenBar.tsx';
import styles from '../Screen.module.css';
import { ConnectionLine } from './TableParts.tsx';

const t = mpWords.create;

/** A table of six, a Normal game, 30 seconds: what most friends want (§19.14's public tables too). */
const DEFAULT_SEATS = 6;
const GAMES: readonly StakesId[] = ['quick', 'normal', 'long'];
const SEAT_COUNTS = Array.from({ length: MAX_SEATS - MIN_SEATS + 1 }, (_, i) => MIN_SEATS + i);

/** Above the bottom of the screen, as Setup's Start button (§12.2). */
const BUTTON_BAR: CSSProperties = {
  position: 'sticky',
  bottom: 0,
  marginTop: 'auto',
  padding: 'var(--space-3) 0',
  background: 'var(--bg)',
};

/** A radio drawn as a chip (the Settings look): the whole chip is the tap target. */
function Option({
  name,
  value,
  checked,
  onPick,
  children,
  faceStyle,
}: {
  name: string;
  value: string | number;
  checked: boolean;
  onPick: () => void;
  children: ReactNode;
  faceStyle?: CSSProperties | undefined;
}) {
  return (
    <label className={styles.choice}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onPick} />
      <span className={styles.face} style={faceStyle}>
        {children}
      </span>
    </label>
  );
}

export function Create() {
  const dispatch = useDispatch();
  const [seats, setSeats] = useState(DEFAULT_SEATS);
  const [stakes, setStakes] = useState<StakesId>('normal');
  const [turnSeconds, setTurnSeconds] = useState<TurnSeconds>(30);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    dispatch({ type: 'mpCreateTable', settings: { seats, stakes, turnSeconds } });
  };

  return (
    <main className={styles.page}>
      <ScreenBar title={t.title} onBack={() => dispatch({ type: 'back' })} />
      <form className={styles.content} onSubmit={submit} noValidate>
        <fieldset className={styles.section} aria-describedby="mp-players-hint">
          <legend className={styles.question}>{t.players}</legend>
          <div className={styles.choices} style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            {SEAT_COUNTS.map((count) => (
              <Option
                key={count}
                name="mp-players"
                value={count}
                checked={seats === count}
                onPick={() => setSeats(count)}
              >
                {count}
              </Option>
            ))}
          </div>
          <p id="mp-players-hint" className={styles.hint}>
            {t.playersHint}
          </p>
        </fieldset>

        <fieldset className={styles.section}>
          <legend className={styles.question}>{t.game}</legend>
          <div className={styles.choices} style={{ gridTemplateColumns: '1fr' }}>
            {GAMES.map((game) => (
              <Option
                key={game}
                name="mp-game"
                value={game}
                checked={stakes === game}
                onPick={() => setStakes(game)}
                faceStyle={{ flexDirection: 'column', padding: 6 }}
              >
                <span>{t.games[game].name}</span>{' '}
                <span style={{ fontSize: '0.875rem', fontWeight: 400 }}>
                  {t.games[game].detail}
                </span>
              </Option>
            ))}
          </div>
        </fieldset>

        <fieldset className={styles.section}>
          <legend className={styles.question}>{t.time}</legend>
          <div className={styles.choices}>
            {TURN_SECONDS.map((seconds) => (
              <Option
                key={seconds}
                name="mp-time"
                value={seconds}
                checked={turnSeconds === seconds}
                onPick={() => setTurnSeconds(seconds)}
              >
                {t.seconds[seconds]}
              </Option>
            ))}
          </div>
        </fieldset>

        <ConnectionLine />

        <footer className={styles.footer} style={{ marginTop: 0 }}>
          <p>
            {t.playMoney} {t.noValue}
          </p>
          <p>{t.notInStats}</p>
        </footer>

        <div style={BUTTON_BAR}>
          <button type="submit" className={styles.primary}>
            {t.button}
          </button>
        </div>
      </form>
    </main>
  );
}
