/**
 * The sizing tray (PLAN §12.7): preset chips first, then the slider row [−] slider [+] amount ✕.
 * Presentational and controlled: the amount lives with the screen (`useSizing` in
 * ui/actionBar.ts), because Row A's right button shows and confirms it. Every amount it reports
 * is a legal "to" amount: presets are legal or disabled, the slider walks legal steps, and a typed
 * amount is snapped and clamped when the field loses focus.
 *
 * Closing: ✕, Esc, or a tap outside the tray (Row A's right button excepted: it confirms) call
 * `onClose`. The controller's Android Back handling closes the tray through the same path. The
 * tray is not a gate (Appendix A.8) and not modal: no scrim, no focus trap.
 */
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from 'react';
import { en } from '../../i18n/en.ts';
import {
  formatAmount,
  amountAt,
  amountFieldText,
  indexOfAmount,
  parseAmount,
  sliderValueText,
  snapAmount,
  snapToPreset,
  stepAmount,
  stepCount,
  type TrayView,
} from '../actionBar.ts';
import styles from './SizingTray.module.css';

/** Hold ± this long before it repeats, then repeat at 8 steps a second (PLAN §12.7). */
export const HOLD_MS = 400;
export const REPEAT_MS = 125;

/**
 * - `inline`: a 104 px row in the layout, above Row A (portrait; it pushes the coach strip up).
 * - `overlay`: over the bottom 104 px of its positioned parent, the table area, with no scrim
 *   (portrait compact mode, e.g. 375×667: the table never shrinks below its content).
 * - `panel`: fills a narrow column (landscape: it replaces the coach text).
 */
export type TrayPlacement = 'inline' | 'overlay' | 'panel';

export interface SizingTrayProps {
  readonly tray: TrayView;
  /** The current "to" amount. */
  readonly amount: number;
  /** A new amount; always legal (the screen's `setAmount` snaps it again anyway). */
  readonly onAmount: (amount: number) => void;
  /** ✕, Esc and a tap outside. */
  readonly onClose: () => void;
  readonly placement?: TrayPlacement;
  /**
   * The coach's amount while its advice is on show (§12.7): the preset with that amount gets the
   * accent ring, or a sixth "Coach" chip shows it when no preset has it. Null: no coach chip.
   */
  readonly coachAmount?: number | null | undefined;
  readonly id?: string | undefined;
  readonly className?: string | undefined;
}

const cx = (...names: (string | false | undefined)[]): string => names.filter(Boolean).join(' ');

/** An amount as the chips show it: "120" or "6 BB". */
const amountText = (t: TrayView, chips: number): string => formatAmount(chips, t.bb, t.amounts);

/** Is an `aria-modal` dialog open? Then Esc and outside taps belong to it, not to the tray. */
const modalOpen = (): boolean => document.querySelector('[aria-modal="true"]') !== null;

function Icon({ d }: { d: string }) {
  return (
    <svg className={styles.icon} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d={d} stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}
const MINUS = 'M3 8h10';
const PLUS = 'M3 8h10M8 3v10';
const CROSS = 'M4 4l8 8M12 4l-8 8';

export const SizingTray = memo(function SizingTray({
  tray,
  amount,
  onAmount,
  onClose,
  placement = 'inline',
  coachAmount = null,
  id,
  className,
}: SizingTrayProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const current = snapAmount(amount, tray);
  const coach = coachAmount === null ? null : snapAmount(coachAmount, tray);
  const coachPreset = coach !== null && tray.presets.some((p) => p.enabled && p.amount === coach);
  const count = stepCount(tray);
  const index = indexOfAmount(tray, current);

  // The latest amount for the ± repeat (its timer outlives a render).
  const latest = useRef(current);
  useEffect(() => {
    latest.current = current;
  }, [current]);

  // Outside taps and Esc close the tray.
  useEffect(() => {
    const onDown = (e: Event) => {
      const target = e.target;
      if (!(target instanceof Node) || rootRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-sizing-keep]') !== null) return;
      if (!modalOpen()) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !modalOpen()) onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // [−] / [+]: one step per tap; held down, it repeats (a local input timer, never game flow).
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stop = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  useEffect(() => stop, [stop]);
  const nudge = useCallback(
    (delta: number): boolean => {
      const next = stepAmount(tray, latest.current, delta);
      if (next === latest.current) return false;
      latest.current = next;
      onAmount(next);
      return true;
    },
    [tray, onAmount],
  );
  const press = (delta: number) => (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    stop();
    if (!nudge(delta)) return;
    const repeat = (delay: number) => {
      timer.current = setTimeout(() => {
        if (nudge(delta)) repeat(REPEAT_MS);
        else stop();
      }, delay);
    };
    repeat(HOLD_MS);
  };
  const stepButton = (delta: number, label: string, d: string, atEnd: boolean) => (
    <button
      type="button"
      className={styles.square}
      aria-label={label}
      aria-disabled={atEnd ? true : undefined}
      onPointerDown={press(delta)}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      // Keyboard (Enter, Space) clicks have detail 0; pointer taps already stepped on pointerdown.
      onClick={(e) => {
        if (e.detail === 0) nudge(delta);
      }}
    >
      <Icon d={d} />
    </button>
  );

  // The slider snaps to a preset within ±2% while dragged, never on arrow keys (§12.7).
  const dragging = useRef(false);

  // The typed amount: free text while focused, snapped and clamped when committed.
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const typed = parseAmount(draft, tray);
    setDraft(null);
    if (typed !== null) onAmount(typed);
  };

  const bb = tray.amounts === 'bb';
  const fill = count > 1 ? index / (count - 1) : 1;

  return (
    <div
      ref={rootRef}
      id={id}
      role="group"
      aria-label={en.sizing.label[tray.kind]}
      className={cx(styles.tray, styles[placement], className)}
    >
      <div className={styles.presets}>
        {tray.presets.map((p) => (
          <button
            key={p.id}
            type="button"
            className={cx(styles.chip, coachPreset && p.amount === coach && styles.coach)}
            disabled={!p.enabled}
            aria-pressed={p.enabled && p.amount === current}
            aria-label={en.sizing.presetName(p.spoken, p.amountText)}
            data-coach={coachPreset && p.amount === coach ? '' : undefined}
            onClick={() => onAmount(p.amount)}
          >
            <span className={styles.chipLabel}>{p.label}</span>
            {p.amountText === p.label ? null : (
              <span className={styles.chipAmount}>{p.amountText}</span>
            )}
          </button>
        ))}
        {coach !== null && !coachPreset && (
          <button
            type="button"
            className={cx(styles.chip, styles.coach)}
            aria-pressed={coach === current}
            aria-label={en.coachUi.chipName(amountText(tray, coach))}
            data-coach=""
            onClick={() => onAmount(coach)}
          >
            <span className={styles.chipLabel}>{en.coachUi.chip}</span>
            <span className={styles.chipAmount}>{amountText(tray, coach)}</span>
          </button>
        )}
      </div>
      <div className={styles.row}>
        {stepButton(-1, en.sizing.smaller, MINUS, current <= tray.min)}
        <input
          type="range"
          className={styles.range}
          style={{ '--fill': fill.toFixed(4) } as CSSProperties}
          min={0}
          max={count - 1}
          step={1}
          value={index}
          aria-label={en.sizing.slider}
          aria-valuetext={sliderValueText(tray, current)}
          onPointerDown={() => {
            dragging.current = true;
          }}
          onPointerUp={() => {
            dragging.current = false;
          }}
          onPointerCancel={() => {
            dragging.current = false;
          }}
          onKeyDown={() => {
            dragging.current = false;
          }}
          onChange={(e) => {
            const next = amountAt(tray, Number(e.currentTarget.value));
            onAmount(dragging.current ? snapToPreset(tray, next) : next);
          }}
        />
        {stepButton(1, en.sizing.bigger, PLUS, current >= tray.max)}
        <label className={styles.field}>
          <input
            type="text"
            className={styles.input}
            inputMode={bb ? 'decimal' : 'numeric'}
            enterKeyHint="done"
            autoComplete="off"
            spellCheck={false}
            aria-label={bb ? en.sizing.field.bb : en.sizing.field.chips}
            value={draft ?? amountFieldText(tray, current)}
            onFocus={(e) => {
              setDraft(e.currentTarget.value);
              e.currentTarget.select();
            }}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
            }}
          />
          {bb ? (
            <span className={styles.unit} aria-hidden="true">
              {en.amounts.bbUnit}
            </span>
          ) : null}
        </label>
        <button
          type="button"
          className={styles.square}
          aria-label={en.sizing.close}
          onClick={onClose}
        >
          <Icon d={CROSS} />
        </button>
      </div>
    </div>
  );
});
