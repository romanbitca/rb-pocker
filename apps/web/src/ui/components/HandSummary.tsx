/**
 * The end-of-hand summary (PLAN §10.2, §12.9; chunk 6.4): a bottom sheet over the table when the
 * level shows one (Beginner every hand; Intermediate after an Inaccuracy or worse; Advanced after
 * a Mistake or worse; Exam every hand, as the "Exam result"). Title "Hand 12: +160"; one row per
 * hero decision: street, what you did, the grade chip, the coach's move when it was another, and
 * the numbers at the decision ("You had 45%, needed 25%."). Exam adds the score of the hand
 * (§14.4). Buttons [Review hand] and [Next hand ›]; ✕, Esc, the scrim and Back close it (the
 * banner stays, and the next hand waits its 3 s again).
 *
 * The Table hosts it while the `summary` overlay is open (its `sheet` gate keeps the next hand
 * waiting, §12.8); it reads the hand and its records from the store (`ui/summary.ts` builds the
 * rows), and closes the overlay when there is nothing to show. Part of the summary's lazy chunk
 * (`ui/summaryEntry.ts`, §15.3).
 */
import { memo, useEffect, useId, useMemo } from 'react';
import { selectCoachLevel, useAppStore, type AppState } from '../../app/store.ts';
import type { PlayerAction } from '../../engine/types.ts';
import { summaryOf, type SummaryData, type SummaryRow } from '../summary.ts';
import { summaryWords as W } from '../../i18n/summary.ts';
import { formatAmount } from '../actionBar.ts';
import { percentText } from '../equity.ts';
import { formatChips } from '../format.ts';
import { GradeChip } from './GradeChip.tsx';
import { Modal } from './Modal.tsx';
import screen from '../screens/Screen.module.css';
import s from './Levels.module.css';

const cx = (...names: (string | false | undefined)[]): string => names.filter(Boolean).join(' ');

type AmountUnit = 'chips' | 'bb';

export interface HandSummaryProps {
  readonly unit: AmountUnit;
  readonly onNext: () => void;
  readonly onReview: (handSeq: number) => void;
  readonly onClose: () => void;
}

const selectGame = (s: AppState): AppState['game'] => s.game;

/** The summary of the hand that just ended (the store's), or null; closes the sheet when null. */
export const HandSummary = memo(function HandSummary(props: HandSummaryProps) {
  const game = useAppStore(selectGame);
  const level = useAppStore(selectCoachLevel);
  const summary = useMemo(() => summaryOf(game, level), [game, level]);
  const { onClose } = props;
  useEffect(() => {
    if (summary === null) onClose();
  }, [summary, onClose]);
  return summary === null ? null : <SummarySheet summary={summary} {...props} />;
});

/** "+160", "−40" (a real minus sign), "0". */
export function netText(net: number): string {
  if (net === 0) return '0';
  return `${net > 0 ? '+' : '−'}${formatChips(Math.abs(net))}`;
}

const sameMove = (a: PlayerAction, b: PlayerAction): boolean =>
  a.type === b.type &&
  (a.type === 'bet' || a.type === 'raise' ? a.to === (b as { to: number }).to : true);

function didText(a: PlayerAction, money: (x: number) => string): string {
  switch (a.type) {
    case 'fold':
    case 'check':
    case 'call':
      return W.did[a.type];
    case 'bet':
      return W.did.bet(money(a.to));
    case 'raise':
      return W.did.raise(money(a.to));
  }
}

function coachText(a: PlayerAction, money: (x: number) => string): string {
  switch (a.type) {
    case 'fold':
    case 'check':
    case 'call':
      return W.coach[a.type];
    case 'bet':
      return W.coach.bet(money(a.to));
    case 'raise':
      return W.coach.raise(money(a.to));
  }
}

/** The second line of a row: the coach's move when it was another, then the numbers. */
export function rowNotes(row: SummaryRow, money: (x: number) => string): string {
  const notes: string[] = [];
  if (!sameMove(row.taken, row.rec)) notes.push(coachText(row.rec, money));
  if (row.eRandom !== null) {
    const pct = (x: number): string => percentText(100 * x);
    notes.push(
      row.need === null ? W.win(pct(row.eRandom)) : W.numbers(pct(row.eRandom), pct(row.need)),
    );
  }
  return notes.join(' · ');
}

/** The sheet itself (presentational). */
export const SummarySheet = memo(function SummarySheet({
  summary,
  unit,
  onNext,
  onReview,
  onClose,
}: HandSummaryProps & { summary: SummaryData }) {
  const titleId = useId();
  const money = (x: number): string => formatAmount(x, summary.bb, unit);
  const title = W.title(formatChips(summary.handNumber), netText(summary.net));
  return (
    <Modal kind="sheet" labelledBy={titleId} onDismiss={onClose}>
      <div className={s.summary} data-summary={summary.exam ? 'exam' : 'hand'}>
        <div className={s.row}>
          <h2 id={titleId} className={s.grow}>
            {summary.exam && <span className={s.exam}>{W.exam}</span>}
            {title}
          </h2>
          <button
            type="button"
            className={s.button}
            aria-label={W.close}
            onClick={onClose}
            data-summary-close=""
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {summary.exam && summary.score !== null && (
          <p className={s.bold}>{W.score(summary.score)}</p>
        )}
        <ol className={s.rows}>
          {summary.rows.map((row, i) => {
            const notes = rowNotes(row, money);
            return (
              <li key={`${row.decisionId}-${i}`} data-summary-row={row.grade ?? 'none'}>
                <p className={s.bold}>
                  {W.streets[row.street]} · {didText(row.taken, money)}
                </p>
                {row.undone ? (
                  <span className={s.muted}>{W.undone}</span>
                ) : row.grade === null ? (
                  <span className={s.muted}>{W.noGrade}</span>
                ) : (
                  <GradeChip grade={row.grade} />
                )}
                {notes !== '' && <p className={s.muted}>{notes}</p>}
              </li>
            );
          })}
        </ol>
        <div className={cx(s.row, s.stick)}>
          <button
            type="button"
            className={cx(screen.secondary, s.grow)}
            onClick={() => onReview(summary.handSeq)}
            data-summary-review=""
          >
            {W.review}
          </button>
          <button
            type="button"
            className={cx(screen.primary, s.grow)}
            onClick={onNext}
            data-summary-next=""
          >
            {W.next}
          </button>
        </div>
      </div>
    </Modal>
  );
});
