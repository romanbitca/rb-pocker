/**
 * The mistake feedback card (PLAN §11.1, §12.6, Appendix F.4, F.5): grade icon and title, the one
 * reason, "Coach's move: Call 40.", [Undo: try again] (primary, 56 px) and [Keep my move], and the
 * §11.4 small print. Presentational: the Table hosts it above the action bar over a 25% scrim; the
 * game stays paused until one of the buttons (§11.1), so it never closes by itself.
 *
 * `role="alertdialog"` with focus on Undo (on Keep my move when this decision was undone once
 * already and Undo shows disabled); Tab stays inside. Keys (§12.6): U = Undo, Enter = the focused
 * button, Esc = Keep my move (as Android Back).
 */
import { memo, useEffect, useId, useMemo, useRef, type KeyboardEvent } from 'react';
import type { FeedbackView } from '../../app/store.ts';
import { en } from '../../i18n/en.ts';
import { feedbackTexts } from '../feedback.ts';
import styles from './FeedbackCard.module.css';
import { GradeMark } from './GradeChip.tsx';
import { isUndoKey } from './UndoButton.tsx';

export interface FeedbackCardProps {
  readonly view: FeedbackView;
  /** The player's amount unit (Settings "Show amounts as"). */
  readonly unit: 'chips' | 'bb';
  readonly onUndo: () => void;
  readonly onKeep: () => void;
}

export const FeedbackCard = memo(function FeedbackCard({
  view,
  unit,
  onUndo,
  onKeep,
}: FeedbackCardProps) {
  const titleId = useId();
  const reasonId = useId();
  const undoRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const texts = useMemo(() => feedbackTexts(view, unit), [view, unit]);
  const canUndo = view.canUndo;

  useEffect(() => {
    (canUndo ? undoRef : keepRef).current?.focus();
  }, [canUndo]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.defaultPrevented) return;
      if (isUndoKey(e)) {
        e.preventDefault();
        if (canUndo) onUndo();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onKeep();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [canUndo, onUndo, onKeep]);

  // Tab and Shift+Tab go between the two buttons.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const next = document.activeElement === undoRef.current ? keepRef : undoRef;
    next.current?.focus();
  };

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={reasonId}
      className={styles.card}
      data-feedback={view.grade}
      onKeyDown={onKeyDown}
    >
      <h2 id={titleId} className={styles.title}>
        <GradeMark grade={view.grade} className={styles.mark} />
        {texts.title}
      </h2>
      <p id={reasonId} className={styles.reason}>
        {texts.reason}
      </p>
      <p className={styles.coach}>{texts.coachMove}</p>
      <div className={styles.buttons}>
        <button
          ref={undoRef}
          type="button"
          className={styles.undo}
          aria-disabled={canUndo ? undefined : true}
          aria-keyshortcuts="U"
          data-feedback-undo=""
          onClick={() => {
            if (canUndo) onUndo();
          }}
        >
          {en.feedback.undo}
        </button>
        <button
          ref={keepRef}
          type="button"
          className={styles.keep}
          data-feedback-keep=""
          onClick={() => onKeep()}
        >
          {en.feedback.keep}
        </button>
      </div>
      <p className={styles.small}>{en.feedback.smallPrint}</p>
    </div>
  );
});
