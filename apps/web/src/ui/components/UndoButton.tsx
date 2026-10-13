/**
 * The toolbar Undo (PLAN §11.1, §12.3, §12.5): a 44×44 button left of the coach strip (in the top
 * bar in compact mode). Shown at Beginner and Intermediate, disabled (not hidden) while there is
 * nothing to take back; hidden at Advanced (Undo is offered only inside the feedback card) and
 * at Exam. Disabled is `aria-disabled`: the button stays focusable, like Row A (§12.7).
 *
 * The word, not an arrow: one DOM node (the Table's §15.3 budget) and plain for a beginner.
 * `useUndoKey` is the desktop shortcut U (§12.5): never while a text field has focus, never with
 * a modifier, never on a key repeat.
 */
import { memo, useEffect } from 'react';
import { en } from '../../i18n/en.ts';
import styles from './UndoButton.module.css';

export interface UndoButtonProps {
  readonly state: 'disabled' | 'enabled';
  readonly onUndo: () => void;
  readonly className?: string | undefined;
}

export const UndoButton = memo(function UndoButton({ state, onUndo, className }: UndoButtonProps) {
  const enabled = state === 'enabled';
  return (
    <button
      type="button"
      className={className === undefined ? styles.undo : `${styles.undo} ${className}`}
      aria-disabled={enabled ? undefined : true}
      aria-keyshortcuts="U"
      data-undo={state}
      onClick={() => {
        if (enabled) onUndo();
      }}
    >
      {en.undo.button}
    </button>
  );
});

/** A key press that types into a field (U there is a letter, not Undo). */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/** True for a plain press of U (either case), outside text fields, not repeated. */
export function isUndoKey(e: KeyboardEvent): boolean {
  return (
    (e.key === 'u' || e.key === 'U') &&
    !e.repeat &&
    !e.altKey &&
    !e.ctrlKey &&
    !e.metaKey &&
    !typing(e.target)
  );
}

/** U calls `onUndo` while `active` (the toolbar Undo can be used and nothing covers the table). */
export function useUndoKey(active: boolean, onUndo: () => void): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || !isUndoKey(e)) return;
      e.preventDefault();
      onUndo();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active, onUndo]);
}
