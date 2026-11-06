/**
 * Keyboard shortcuts (PLAN §12.5, §12.12; chunk 9.3): F fold · C check/call · B or R bet/raise ·
 * 1–5 presets · ↑/↓ one step · Enter confirm · Esc close · U undo · H hint · K toggle hands panel ·
 * S hand summary (1.3.92: the hand-end banner's "Hand summary" or "Exam result") · ? list shortcuts.
 *
 * - A key is read as typed (`e.key`), with the physical key (`e.code`) as the fallback when the
 *   keyboard types another alphabet (Cyrillic, Greek…) or needs Shift for digits (AZERTY): F is F
 *   on any layout.
 * - Never with Ctrl, Alt or Meta (the browser's and the system's shortcuts), never while text is
 *   being composed (an IME), never on a held key's repeat except ↑/↓.
 * - Never while a text field has focus (§12.5), and never while a dialog or a sheet is open: an
 *   `aria-modal` layer has the keyboard then (Esc closes it; inside the rankings drawer K closes it
 *   too). A phone's on-screen keyboard types only into a focused field, so it never fires one.
 * - Row A's keys press its buttons exactly as a tap does (`ActionBar`'s `pressRef`: the 250 ms
 *   guard, a disabled button's note), and the tray's keys set amounts the tray offers: a key can
 *   only send what `actionBarView` built from `legalActions` (pitfall 1).
 * - Esc is not handled here: every layer closes itself on it (the tray, the sheets, the dialogs,
 *   the feedback card: Keep my move).
 */
import { useEffect, useRef, type MutableRefObject } from 'react';
import { snapAmount, stepAmount, type ActionBarView } from './actionBar.ts';

export type Shortcut =
  | 'fold'
  | 'call'
  | 'raise'
  | 'preset1'
  | 'preset2'
  | 'preset3'
  | 'preset4'
  | 'preset5'
  | 'up'
  | 'down'
  | 'confirm'
  | 'undo'
  | 'hint'
  | 'hands'
  | 'summary'
  | 'help';

/** The letters (lower case). */
const LETTERS: Readonly<Record<string, Shortcut>> = {
  f: 'fold',
  c: 'call',
  b: 'raise',
  r: 'raise',
  u: 'undo',
  h: 'hint',
  k: 'hands',
  s: 'summary',
};

const PRESETS: readonly Shortcut[] = ['preset1', 'preset2', 'preset3', 'preset4', 'preset5'];

/** What `shortcutOf` reads of a `KeyboardEvent`. */
export interface KeyLike {
  readonly key: string;
  readonly code?: string | undefined;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly repeat: boolean;
  readonly isComposing?: boolean | undefined;
}

/** The shortcut a key press stands for, or null. Pure (see the module note). */
export function shortcutOf(e: KeyLike): Shortcut | null {
  if (e.altKey || e.ctrlKey || e.metaKey || e.isComposing === true) return null;
  const key = shortcutKey(e);
  if (key === null) return null;
  return e.repeat && key !== 'up' && key !== 'down' ? null : key;
}

function shortcutKey(e: KeyLike): Shortcut | null {
  const { key } = e;
  switch (key) {
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'Enter':
      return 'confirm';
    case '?':
      return 'help';
  }
  if (/^[1-5]$/.test(key)) return PRESETS[Number(key) - 1] ?? null;
  if (/^[a-z]$/i.test(key)) return LETTERS[key.toLowerCase()] ?? null;
  // The physical key: digits that need Shift on this layout, letters of another alphabet.
  const code = e.code ?? '';
  const digit = /^(?:Digit|Numpad)([1-5])$/.exec(code);
  if (digit !== null) return PRESETS[Number(digit[1]) - 1] ?? null;
  const letter = /^Key([A-Z])$/.exec(code);
  // Only for a letter outside ASCII: a punctuation key is never moved onto a shortcut.
  if (letter !== null && key.length === 1 && key > '~') {
    return LETTERS[(letter[1] ?? '').toLowerCase()] ?? null;
  }
  return null;
}

/** Inputs that do not type text: a key there is still a shortcut. */
const UNTYPED = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color']);

/** A focused field that types: a key there is a letter, not a shortcut (§12.5). */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !UNTYPED.has(target.type);
}

/** An open modal layer (a sheet, a dialog, the feedback card), not one still sliding out. */
export function modalOpen(doc: Document): boolean {
  for (const el of doc.querySelectorAll('[aria-modal="true"]')) {
    if (el.closest('[inert]') === null) return true;
  }
  return false;
}

/**
 * The table's shortcuts leave this key alone: another handler took it, a field types it, or a
 * dialog or a sheet has the keyboard (§12.5).
 */
export function keysBlocked(e: Pick<Event, 'target' | 'defaultPrevented'>): boolean {
  if (e.defaultPrevented || isTyping(e.target)) return true;
  const el = e.target instanceof Element ? e.target : null;
  if (el?.closest('[role="dialog"], [role="alertdialog"]') != null) return true;
  return modalOpen(el?.ownerDocument ?? document);
}

const OWNS_ENTER =
  'button, a[href], select, textarea, summary, [role="button"], [role="link"], [contenteditable="true"]';

/**
 * Enter on a focused control is the control's own (a button clicks itself); only elsewhere (the
 * page, the tray's slider) is Enter "confirm".
 */
export function ownsEnter(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLInputElement) return target.type !== 'range';
  return target.closest(OWNS_ENTER) !== null;
}

/** What a Row A key does: press a button (as a tap), or set the tray's amount. */
export type RowMove =
  | { readonly kind: 'press'; readonly slot: 'fold' | 'middle' | 'right' }
  /** `open`: the tray opens first (a preset key while it is closed). */
  | { readonly kind: 'amount'; readonly amount: number; readonly open: boolean };

/**
 * What `key` does to Row A and the sizing tray (pure). F, C, B/R press Fold, the middle button and
 * the right one, as a tap would: the button decides (a disabled one shows its note, Bet/Raise
 * opens the tray, then confirms it). 1–5 choose that enabled preset (opening the tray), ↑/↓ move
 * the open tray one step, Enter confirms the open tray unless the focused control owns it. Every
 * amount is a preset's or a step inside the `legalActions` bounds, so it is legal. Null: nothing.
 */
export function rowMove(
  key: Shortcut,
  view: ActionBarView,
  trayOpen: boolean,
  amount: number,
  enterOwned: boolean,
): RowMove | null {
  const tray = view.waiting ? null : view.tray;
  const open = trayOpen && tray !== null;
  switch (key) {
    case 'fold':
      return { kind: 'press', slot: 'fold' };
    case 'call':
      return { kind: 'press', slot: 'middle' };
    case 'raise':
      return view.right === null ? null : { kind: 'press', slot: 'right' };
    case 'confirm':
      return open && !enterOwned ? { kind: 'press', slot: 'right' } : null;
    case 'up':
    case 'down': {
      if (!open) return null;
      const from = snapAmount(amount, tray);
      const to = stepAmount(tray, from, key === 'up' ? 1 : -1);
      return to === from ? null : { kind: 'amount', amount: to, open: false };
    }
    case 'preset1':
    case 'preset2':
    case 'preset3':
    case 'preset4':
    case 'preset5': {
      if (tray === null || view.right?.enabled !== true) return null;
      const preset = tray.presets[PRESETS.indexOf(key)];
      if (preset === undefined || !preset.enabled) return null;
      return { kind: 'amount', amount: preset.amount, open: !open };
    }
    default:
      return null;
  }
}

/** A `press` the ActionBar hands out: its own tap handler for one slot. */
export type PressRef = MutableRefObject<((slot: 'fold' | 'middle' | 'right') => void) | null>;

export interface RowKeysInput {
  readonly view: ActionBarView;
  readonly trayOpen: boolean;
  readonly amount: number;
  readonly press: PressRef;
  readonly openTray: () => void;
  readonly setAmount: (amount: number) => void;
  /** The tray's element id: a key that opens the tray puts the focus on its slider. */
  readonly trayId: string;
}

const isRange = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement && target.type === 'range';

/** A tray that opens this soon after a key asked for it was opened by that key. */
const KEY_OPEN_MS = 1000;

/**
 * Row A's and the tray's keys (F, C, B/R, 1–5, ↑/↓, Enter), for the screen that places them. A key
 * that opens the tray moves the focus to its slider: Enter then confirms, the arrows step it (the
 * slider's own keys), and Enter can never land on another focused button (Call).
 */
export function useRowKeys(input: RowKeysInput): void {
  const latest = useRef(input);
  useEffect(() => {
    latest.current = input;
  });
  // When a key asked for the tray (a press the 250 ms guard ignores opens nothing: it expires).
  const keyOpened = useRef(Number.NEGATIVE_INFINITY);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const key = shortcutOf(e);
      if (key === null || keysBlocked(e)) return;
      // The focused slider steps itself (its arrows, Page Up/Down, Home, End).
      if ((key === 'up' || key === 'down') && isRange(e.target)) return;
      const s = latest.current;
      const move = rowMove(key, s.view, s.trayOpen, s.amount, ownsEnter(e.target));
      if (move === null) return;
      e.preventDefault();
      if (move.kind === 'press') {
        const right = s.view.right;
        if (move.slot === 'right' && !s.trayOpen && right?.enabled && right.opensTray) {
          keyOpened.current = performance.now();
        }
        s.press.current?.(move.slot);
        return;
      }
      if (move.open) {
        keyOpened.current = performance.now();
        s.openTray();
      }
      s.setAmount(move.amount);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const { trayOpen, trayId } = input;
  useEffect(() => {
    const byKey = performance.now() - keyOpened.current < KEY_OPEN_MS;
    keyOpened.current = Number.NEGATIVE_INFINITY;
    if (!trayOpen || !byKey) return;
    document.getElementById(trayId)?.querySelector<HTMLElement>('input[type="range"]')?.focus();
  }, [trayOpen, trayId]);
}

/**
 * One table shortcut (H, K, S, ?): `run` on `key`, outside text fields, dialogs and sheets. Null:
 * off (its listener is gone).
 */
export function useShortcut(key: Shortcut, run: (() => void) | null): void {
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  });
  const on = run !== null;
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent): void => {
      if (shortcutOf(e) !== key || keysBlocked(e)) return;
      e.preventDefault();
      latest.current?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [key, on]);
}
