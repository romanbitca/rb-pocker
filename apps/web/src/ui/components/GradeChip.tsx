/**
 * A grade chip (PLAN §12.6, Appendix F.4): the grade's colour, its drawn mark and its words, so
 * colour is never the only cue (§12.12): ✓✓ Best move · ✓ Good · ~ Slightly off · ✗ Mistake ·
 * ✗✗ Big mistake. The marks are SVG paths, never text glyphs. Used by the coach strip after the
 * hero acts, by the hand summary, and (the marks) by the feedback card; it is never in the initial
 * bundle (those three are lazy chunks).
 */
import { memo } from 'react';
import type { Grade } from '../../brain/types.ts';
import styles from './Levels.module.css';

/** The F.4 marks as SVG paths (24×24): ✓✓ ✓ ~ ✗ ✗✗. */
export const GRADE_MARK: Readonly<Record<Grade, string>> = {
  best: 'M1.5 12.5l3.5 3.5 7-8M9.5 13.5l2.5 2.5 9.5-10.5',
  good: 'M5 12.5l4.5 4.5 10-11',
  inaccuracy: 'M3.5 14c2.5-4 5-4 8.5-1s6 3 8.5-1',
  mistake: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
  blunder: 'M2.5 7l7 10M9.5 7l-7 10M14.5 7l7 10M21.5 7l-7 10',
};

/** F.4's chip words. */
export const GRADE_CHIP_TEXT: Readonly<Record<Grade, string>> = {
  best: 'Best move',
  good: 'Good',
  inaccuracy: 'Slightly off',
  mistake: 'Mistake',
  blunder: 'Big mistake',
};

export function GradeMark({ grade, className }: { grade: Grade; className?: string | undefined }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={GRADE_MARK[grade]} />
    </svg>
  );
}

export const GradeChip = memo(function GradeChip({
  grade,
  className,
}: {
  grade: Grade;
  className?: string | undefined;
}) {
  return (
    <span
      className={[styles.chip, styles[grade], className].filter(Boolean).join(' ')}
      data-grade-chip={grade}
    >
      <GradeMark grade={grade} className={styles.mark} />
      {GRADE_CHIP_TEXT[grade]}
    </span>
  );
});
