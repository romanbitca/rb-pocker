/**
 * One hero decision in words (PLAN §12.9, §12.10): the street and what you did, the grade chip
 * ("Taken back with Undo" for an undone decision, "No grade" when grading failed), and the line
 * with the coach's move when it was another and the numbers at the decision (`rowDid`, `rowNotes`
 * in `ui/summary.ts`). The hand summary lists these, one per `<li>`; Review shows one on the
 * hero's step. It renders its three pieces as siblings, for the parent's own layout.
 */
import { summaryWords as W } from '../../i18n/summary.ts';
import { rowDid, rowNotes, type SummaryRow } from '../summary.ts';
import { GradeChip } from './GradeChip.tsx';
import s from './Levels.module.css';

export interface DecisionRowProps {
  readonly row: SummaryRow;
  /** An amount as the player chose to see them (chips or big blinds). */
  readonly money: (x: number) => string;
}

export function DecisionRow({ row, money }: DecisionRowProps) {
  const notes = rowNotes(row, money);
  return (
    <>
      <p className={s.bold}>
        {W.streets[row.street]} · {rowDid(row, money)}
      </p>
      {row.undone ? (
        <span className={s.muted}>{W.undone}</span>
      ) : row.grade === null ? (
        <span className={s.muted}>{W.noGrade}</span>
      ) : (
        <GradeChip grade={row.grade} />
      )}
      {notes !== '' && <p className={s.muted}>{notes}</p>}
    </>
  );
}
