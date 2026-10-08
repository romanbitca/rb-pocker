/**
 * Row A of the action bar (PLAN §12.7): Fold · Check/Call · Bet/Raise, most aggressive on the
 * right, under the right thumb. Presentational: it shows an `ActionBarView` (ui/actionBar.ts) and
 * reports taps; the screen passes them to the controller.
 *
 * Wiring (the Table screen):
 * ```tsx
 * const view = useMemo(() => actionBarView(input), [input]);
 * const sizing = useSizing(view.tray);
 * {sizing.open && view.tray && (
 *   <SizingTray id={trayId} tray={view.tray} amount={sizing.amount}
 *               onAmount={sizing.setAmount} onClose={sizing.closeTray} />
 * )}
 * <ActionBar view={view} trayOpen={sizing.open} amount={sizing.amount} trayId={trayId}
 *            onAct={act} onOpenTray={sizing.openTray} onCloseTray={sizing.closeTray} />
 * ```
 * Android Back with the tray open calls the same `closeTray` (PLAN §12.1, Stage 3 acceptance 8).
 *
 * Disabled buttons use `aria-disabled`, not `disabled`: they stay focusable (focus never drops
 * to the page when the turn passes), and a tap on a disabled Fold or Raise can say why.
 */
import { memo, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { PlayerAction } from '../../engine/types.ts';
import { en } from '../../i18n/en.ts';
import { trayAction, trayActionLabel, type ActionBarView, type BarButton } from '../actionBar.ts';
import styles from './ActionBar.module.css';

/** Taps within this long after an action are ignored (PLAN §12.7), so a double tap acts once. */
export const TAP_GUARD_MS = 250;

export interface ActionBarProps {
  readonly view: ActionBarView;
  /** The sizing tray is open: the right button reads "Raise to 120" and confirms `amount`. */
  readonly trayOpen: boolean;
  /** The tray's "to" amount (`useSizing().amount`). */
  readonly amount: number;
  /** A legal action for the hero. Only ever called with actions the view offers. */
  readonly onAct: (action: PlayerAction) => void;
  readonly onOpenTray: () => void;
  readonly onCloseTray: () => void;
  /** `row` (default): three buttons side by side. `column`: stacked, the landscape right column. */
  readonly layout?: 'row' | 'column';
  /** The `SizingTray`'s id, for `aria-controls`. */
  readonly trayId?: string | undefined;
  /**
   * The coach's recommended button while its advice is on show (Beginner, or after "Hint"): a
   * 3 px accent ring and a "Coach" badge (§10.2, §12.7). Never on a disabled button.
   */
  readonly recommended?: Slot | null | undefined;
  readonly className?: string | undefined;
}

type Slot = 'fold' | 'middle' | 'right';

/** Identifies one decision, so a tooltip never survives into the next one. */
const decisionKey = (v: ActionBarView): string =>
  [v.waiting, v.fold.enabled, v.middle.label, v.right?.label ?? '-', v.right?.enabled].join('|');

const cx = (...names: (string | false | undefined)[]): string => names.filter(Boolean).join(' ');

/** The "Bet ▲" / "Raise ▲" mark, drawn (never a text glyph). */
function Caret() {
  return (
    <svg className={styles.caret} viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path d="M6 2.5 11 9.5H1Z" fill="currentColor" />
    </svg>
  );
}

interface SlotButtonProps {
  readonly slot: Slot;
  readonly button: BarButton;
  readonly label: string;
  readonly sub?: string | null;
  readonly wide?: boolean;
  readonly primary?: boolean;
  /** The coach's choice: the accent ring and the "Coach" badge (§12.7). */
  readonly coach?: boolean;
  /** Ids of the elements that describe the button (its note, its second line). */
  readonly describedBy?: string | undefined;
  /** For the right button while it opens the tray (a disclosure). */
  readonly expanded?: boolean | undefined;
  readonly controls?: string | undefined;
  readonly onPress: (slot: Slot) => void;
  readonly children?: ReactNode;
}

function SlotButton(props: SlotButtonProps) {
  const { slot, button, label, sub = null, wide = false, primary = false, onPress } = props;
  const coach = props.coach === true && button.enabled;
  const subId = useId();
  const badgeId = useId();
  const described = cx(sub !== null && subId, coach && badgeId, props.describedBy);
  return (
    <button
      type="button"
      className={cx(
        styles.button,
        wide && styles.wide,
        primary && styles.primary,
        coach && styles.coach,
      )}
      data-slot={slot}
      data-coach={coach ? '' : undefined}
      // Only the tray's own button keeps a tap on it from closing the tray.
      data-sizing-keep={props.expanded === undefined ? undefined : 'true'}
      aria-label={label}
      aria-disabled={button.enabled ? undefined : true}
      aria-describedby={described === '' ? undefined : described}
      aria-expanded={props.expanded}
      aria-controls={props.controls}
      onClick={() => onPress(slot)}
    >
      <span className={styles.label}>
        {label}
        {props.children}
      </span>
      {sub === null ? null : (
        <span id={subId} className={styles.sub}>
          {sub}
        </span>
      )}
      {coach && (
        <span id={badgeId} className={styles.badge}>
          {en.coachUi.badge}
        </span>
      )}
    </button>
  );
}

export const ActionBar = memo(function ActionBar({
  view,
  trayOpen,
  amount,
  onAct,
  onOpenTray,
  onCloseTray,
  layout = 'row',
  trayId,
  recommended = null,
  className,
}: ActionBarProps) {
  const lastAction = useRef(Number.NEGATIVE_INFINITY);
  const barRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ slot: Slot; key: string } | null>(null);
  const foldNoteId = useId();
  const rightNoteId = useId();
  const key = decisionKey(view);
  const tipSlot = tip !== null && tip.key === key ? tip.slot : null;
  const open = trayOpen && view.tray !== null;
  const right = view.right;

  // A tap anywhere else hides the tooltip. No timer: it stays until the player moves on.
  useEffect(() => {
    if (tipSlot === null) return;
    const onDown = (e: Event) => {
      const own = barRef.current?.querySelector(`[data-slot="${tipSlot}"]`);
      if (own && e.target instanceof Node && own.contains(e.target)) return;
      setTip(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [tipSlot]);

  const act = (action: PlayerAction) => {
    lastAction.current = performance.now();
    setTip(null);
    if (trayOpen) onCloseTray();
    onAct(action);
  };

  const onPress = (slot: Slot) => {
    if (performance.now() - lastAction.current < TAP_GUARD_MS) return;
    const button = slot === 'fold' ? view.fold : slot === 'middle' ? view.middle : right;
    if (button === null) return;
    if (!button.enabled) {
      if (button.note !== null) setTip(tipSlot === slot ? null : { slot, key });
      return;
    }
    if (slot === 'right' && right?.opensTray === true) {
      if (open && view.tray !== null) act(trayAction(view.tray, amount));
      else onOpenTray();
      return;
    }
    if (button.action !== null) act(button.action);
  };

  const note = tipSlot === 'fold' ? view.fold.note : tipSlot === 'right' ? right?.note : null;
  const disclosure = right !== null && right.opensTray && !view.waiting;

  return (
    <div
      ref={barRef}
      role="group"
      aria-label={en.actions.group}
      className={cx(styles.bar, layout === 'column' && styles.column, className)}
    >
      <SlotButton
        slot="fold"
        button={view.fold}
        label={view.fold.label}
        coach={!view.waiting && recommended === 'fold'}
        describedBy={view.fold.note === null ? undefined : foldNoteId}
        onPress={onPress}
      />
      <SlotButton
        slot="middle"
        button={view.middle}
        label={view.middle.label}
        sub={view.middle.sub}
        wide={right === null}
        coach={!view.waiting && recommended === 'middle'}
        onPress={onPress}
      />
      {right === null ? null : (
        <SlotButton
          slot="right"
          button={right}
          label={open && view.tray !== null ? trayActionLabel(view.tray, amount) : right.label}
          primary={open}
          coach={!view.waiting && recommended === 'right'}
          describedBy={right.note === null ? undefined : rightNoteId}
          expanded={disclosure ? open : undefined}
          controls={disclosure && open ? trayId : undefined}
          onPress={onPress}
        >
          {right.opensTray && !open ? <Caret /> : null}
        </SlotButton>
      )}
      {/* Why a disabled button is disabled: read with the button, and shown when it is tapped. */}
      {view.fold.note === null ? null : (
        <span id={foldNoteId} className={styles.hidden}>
          {view.fold.note}
        </span>
      )}
      {right?.note == null ? null : (
        <span id={rightNoteId} className={styles.hidden}>
          {right.note}
        </span>
      )}
      {/* Always mounted, so screen readers announce the text when a tap puts it here. */}
      <p
        role="status"
        className={note == null ? styles.hidden : styles.tip}
        data-side={tipSlot ?? undefined}
      >
        {note ?? ''}
      </p>
    </div>
  );
});
