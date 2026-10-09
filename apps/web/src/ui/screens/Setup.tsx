/**
 * Setup, "Set up your table" (PLAN §12.2): four questions, then Start game. Optional: Play never
 * passes through it. It opens with the last-used values (`initial`), so New table… → Start game is
 * at most two taps. The form state is local; `onStartTable` gets a config that `createTable`
 * accepts (§3.2), and Start stays disabled until there is one. "More options" (bot speed, per-seat
 * levels, four-colour cards) arrives with the stages that build those settings.
 *
 * Level cards that are not available yet are shown disabled with "Coming soon" (§18: from chunk
 * 7.1 all four bot levels, Beginner and Intermediate coach; see `AVAILABLE_LEVELS`).
 */
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import type { CoachLevel, TableConfig } from '../../engine/types.ts';
import { en } from '../../i18n/en.ts';
import { LevelCards } from './LevelCards.tsx';
import { formatChips } from './numbers.ts';
import { ScreenBar } from './ScreenBar.tsx';
import styles from './Screen.module.css';
import s from './Setup.module.css';
import {
  BIG_BLIND_PRESETS,
  BOT_LEVEL_ORDER,
  checkSetup,
  COACH_LEVEL_ORDER,
  digitsOnly,
  MAX_DIGITS,
  PLAYERS,
  parseAmount,
  roundUpToEven,
  STACK_PRESETS,
  stepPlayers,
  initialForm,
  type Amount,
  type AvailableLevels,
  type SetupForm,
  type SetupValues,
  type Stakes,
} from './setupForm.ts';

export interface SetupProps {
  /** The last-used values; a `Settings` object fits (Appendix A.7). */
  initial: SetupValues;
  /** The levels that can be picked now (`AVAILABLE_LEVELS`); the others say "Coming soon". */
  available: AvailableLevels;
  /** Start game. The controller asks first when a hand is unfinished (§3.1, the 'newTable' dialog). */
  onStartTable: (config: TableConfig, coachLevel: CoachLevel) => void;
  onBack: () => void;
  /** The footer's Privacy link. Hidden while absent (the About screen comes later). */
  onOpenPrivacy?: (() => void) | undefined;
}

export function Setup({ initial, available, onStartTable, onBack, onOpenPrivacy }: SetupProps) {
  const [form, setForm] = useState<SetupForm>(() => initialForm(initial, available));
  const check = checkSetup(form, available);
  const id = useId();
  const depthId = `${id}-depth`;

  const update = (patch: Partial<SetupForm>) => setForm((f) => ({ ...f, ...patch }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (check.config !== null) onStartTable(check.config, form.coachLevel);
  };

  return (
    <main className={styles.page}>
      <ScreenBar title={en.setup.title} onBack={onBack} />
      <form className={styles.content} onSubmit={submit} noValidate>
        <Players players={form.players} onChange={(players) => update({ players })} />

        <AmountField
          id={`${id}-stack`}
          question={en.setup.chips.question}
          inputLabel={en.setup.chips.customLabel}
          range={en.setup.chips.range}
          presets={STACK_PRESETS}
          presetLabel={formatChips}
          amount={form.stack}
          valid={check.stack !== null}
          onChange={(stack) => update({ stack })}
        />

        <AmountField
          id={`${id}-bb`}
          question={en.setup.blinds.question}
          inputLabel={en.setup.blinds.bigBlind}
          range={en.setup.blinds.range}
          presets={BIG_BLIND_PRESETS}
          presetLabel={(bb) => `${formatChips(bb / 2)}/${formatChips(bb)}`}
          amount={form.bigBlind}
          valid={check.bb !== null}
          onChange={(bigBlind) => update({ bigBlind })}
          onBlur={(text) => {
            // §12.2: rounded up to even on blur (the value is already used rounded before that).
            const n = parseAmount(text);
            if (n !== null) update({ bigBlind: { custom: true, text: String(roundUpToEven(n)) } });
          }}
          extra={
            check.bb !== null && (
              <p className={s.smallBlind}>
                {en.setup.blinds.smallBlind(formatChips(check.bb / 2))}
              </p>
            )
          }
        />

        <Depth id={depthId} stakes={check.stakes} stack={check.stack} />

        <LevelCards
          name={`${id}-bots`}
          legend={en.setup.bots.question}
          legendClass={styles.question}
          order={BOT_LEVEL_ORDER}
          available={available.bot}
          value={form.botLevel}
          names={en.levels.bot}
          texts={en.levels.botText}
          onChange={(botLevel) => update({ botLevel })}
        />

        <LevelCards
          name={`${id}-coach`}
          legend={en.setup.coach.question}
          legendClass={styles.question}
          order={COACH_LEVEL_ORDER}
          available={available.coach}
          value={form.coachLevel}
          names={en.levels.coach}
          texts={en.levels.coachText}
          onChange={(coachLevel) => update({ coachLevel })}
        />

        <footer className={s.footer}>
          <p>
            {en.legal.playMoneyOnly} {en.legal.chipsHaveNoValue}
          </p>
          {onOpenPrivacy && (
            <button type="button" className={styles.link} onClick={() => onOpenPrivacy()}>
              {en.legal.privacy}
            </button>
          )}
        </footer>

        <div className={s.startBar}>
          <button
            type="submit"
            className={styles.primary}
            disabled={check.config === null}
            aria-describedby={depthId}
          >
            {en.setup.start}
          </button>
        </div>
      </form>
    </main>
  );
}

/** Question 1: the stepper [−] 6 [+], its caption and the mini table. */
function Players({ players, onChange }: { players: number; onChange: (n: number) => void }) {
  const atMin = players <= PLAYERS.min;
  const atMax = players >= PLAYERS.max;
  // aria-disabled, not disabled: a button that leaves the tab order under the finger or the
  // keyboard would drop the focus.
  return (
    <fieldset className={styles.section}>
      <legend className={styles.question}>{en.setup.players.question}</legend>
      <div className={s.players}>
        <div className={s.stepper}>
          <button
            type="button"
            className={s.step}
            aria-label={en.setup.players.fewer}
            aria-disabled={atMin}
            onClick={() => {
              if (!atMin) onChange(stepPlayers(players, -1));
            }}
          >
            <StepIcon minus />
          </button>
          <span className={s.count} aria-hidden="true">
            {players}
          </span>
          <button
            type="button"
            className={s.step}
            aria-label={en.setup.players.more}
            aria-disabled={atMax}
            onClick={() => {
              if (!atMax) onChange(stepPlayers(players, 1));
            }}
          >
            <StepIcon />
          </button>
        </div>
        <MiniTable players={players} />
      </div>
      <p className={s.caption} aria-live="polite">
        {en.setup.players.caption(players - 1)}
      </p>
    </fieldset>
  );
}

function StepIcon({ minus = false }: { minus?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d={minus ? 'M5 12h14' : 'M5 12h14M12 5v14'}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The 120 px table preview (§12.2): the seats around an oval, clockwise from "you" at the bottom
 * centre (§0.3). Decoration: the caption says the same in words.
 */
export function MiniTable({ players }: { players: number }) {
  const cx = 60;
  const cy = 40;
  const seats = Array.from({ length: players }, (_, seat) => {
    const angle = Math.PI / 2 + (seat * 2 * Math.PI) / players;
    return { seat, x: cx + 50 * Math.cos(angle), y: cy + 30 * Math.sin(angle) };
  });
  return (
    <svg className={s.miniTable} viewBox="0 0 120 80" aria-hidden="true" focusable="false">
      <ellipse cx={cx} cy={cy} rx="44" ry="24" className={s.felt} />
      {seats.map(({ seat, x, y }) => (
        <circle
          key={seat}
          data-seat={seat}
          cx={x.toFixed(2)}
          cy={y.toFixed(2)}
          r={seat === 0 ? 7.5 : 6}
          className={seat === 0 ? s.hero : s.bot}
        />
      ))}
    </svg>
  );
}

interface AmountFieldProps {
  id: string;
  question: string;
  inputLabel: string;
  range: string;
  presets: readonly number[];
  presetLabel: (value: number) => string;
  amount: Amount;
  valid: boolean;
  onChange: (amount: Amount) => void;
  onBlur?: (text: string) => void;
  extra?: ReactNode;
}

/** Question 2, twice: preset chips plus Custom, which shows a numeric field (§12.2). */
function AmountField({
  id,
  question,
  inputLabel,
  range,
  presets,
  presetLabel,
  amount,
  valid,
  onChange,
  onBlur,
  extra,
}: AmountFieldProps) {
  const inputId = `${id}-input`;
  const rangeId = `${id}-range`;
  const picked = amount.custom ? null : parseAmount(amount.text);
  return (
    <fieldset className={styles.section}>
      <legend className={styles.question}>{question}</legend>
      <div className={styles.choices}>
        {presets.map((value) => (
          <label key={value} className={styles.choice}>
            <input
              type="radio"
              name={id}
              value={value}
              checked={picked === value}
              onChange={() => onChange({ custom: false, text: String(value) })}
            />
            <span className={styles.face}>{presetLabel(value)}</span>
          </label>
        ))}
        <label className={styles.choice}>
          <input
            type="radio"
            name={id}
            value="custom"
            checked={amount.custom}
            onChange={() => onChange({ custom: true, text: amount.text })}
          />
          <span className={styles.face}>{en.setup.custom}</span>
        </label>
      </div>
      {amount.custom && (
        <div className={s.custom}>
          <div className={s.customRow}>
            <label htmlFor={inputId} className={s.customLabel}>
              {inputLabel}
            </label>
            <input
              id={inputId}
              className={s.input}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              enterKeyHint="done"
              maxLength={MAX_DIGITS + 2}
              value={amount.text}
              aria-invalid={!valid}
              aria-describedby={valid ? undefined : rangeId}
              onChange={(e) => onChange({ custom: true, text: digitsOnly(e.target.value) })}
              onBlur={(e) => onBlur?.(e.target.value)}
            />
            {extra}
          </div>
          {!valid && (
            <p id={rangeId} className={s.error}>
              {range}
            </p>
          )}
        </div>
      )}
    </fieldset>
  );
}

/** "Each player starts with 2,000 chips = 100 big blinds." and the depth label, or what to fix. */
function Depth({ id, stakes, stack }: { id: string; stakes: Stakes | null; stack: number | null }) {
  return (
    <div
      id={id}
      className={`${s.depth} ${stakes !== null && stakes.kind !== 'ok' ? s.depthProblem : ''}`}
      aria-live="polite"
    >
      {stakes?.kind === 'ok' && stack !== null && (
        <>
          <p>{en.setup.depth.caption(formatChips(stack), formatChips(stakes.bigBlinds))}</p>
          <p className={s.band}>{en.setup.depth[stakes.band]}</p>
        </>
      )}
      {stakes?.kind === 'tooShallow' && <p className={s.error}>{en.setup.depth.tooShallow}</p>}
      {stakes?.kind === 'tooDeep' && <p className={s.error}>{en.setup.depth.tooDeep}</p>}
    </div>
  );
}
