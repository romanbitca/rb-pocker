/**
 * The end-of-hand summary (PLAN §10.2, §12.9; chunk 6.4): a bottom sheet over the table when the
 * level shows one (Beginner every hand; Intermediate after an Inaccuracy or worse; Advanced after
 * a Mistake or worse; Exam every hand, as the "Exam result"). Title "Hand 12: +160"; one row per
 * hero decision: street, what you did, the grade chip, the coach's move when it was another (with
 * a Best grade: "Calling was as good as folding here."; a check or a call Slightly off or worse
 * where the coach bet or raised: "Raising to 2,100 wins more here."), and the numbers at the
 * decision ("You had 45%, needed 25%."; the hint's and the grade's own, labelled when they differ:
 * "Any cards: 45%. Their likely hands: about 20%, needed 30%.", "All 3 players: 34%. Raiser
 * alone: about 56%, …", `rowNumbers` in `ui/summary.ts`, QA-1 and QA-2). An all-in says so ("You
 * went all-in for 710", "Coach: All-in 200"). Exam adds the score of the hand (§14.4). Buttons [Review hand] and [Next hand ›]; ✕, Esc, the scrim and Back close it
 * (the banner stays, and the next hand waits its 3 s again). Above the buttons, the level
 * suggestion card when there is one (§10.4, chunk 8.4).
 *
 * The Table hosts it while the `summary` overlay is open (its `sheet` gate keeps the next hand
 * waiting, §12.8); only the player opens it, with the hand-end banner's "Hand summary" or "Exam
 * result" (or S), never the controller (1.3.92). It reads the hand and its records from the store
 * (`ui/summary.ts` builds the rows), and closes the overlay when there is nothing to show. Part of the summary's lazy chunk
 * (`ui/summaryEntry.ts`, §15.3).
 */
import { memo, useEffect, useId, useMemo } from 'react';
import { selectCoachLevel, useAppStore, type AppState } from '../../app/store.ts';
import type { PlayerAction } from '../../engine/types.ts';
import {
  isAllInMove,
  rowNumbers,
  summaryOf,
  type SummaryData,
  type SummaryRow,
} from '../summary.ts';
import { summaryWords as W } from '../../i18n/summary.ts';
import { formatAmount } from '../actionBar.ts';
import { percentText } from '../equity.ts';
import { formatChips } from '../format.ts';
import { GradeChip } from './GradeChip.tsx';
import { Modal } from './Modal.tsx';
import { LevelSuggestion } from './SuggestionCard.tsx';
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

/** The words for each move: "You called" (`did`), "Coach: Call" (`coach`), "Calling" (`doing`)… */
type MoveWords = typeof W.did | typeof W.coach | typeof W.doing | typeof W.coachDoing;

/**
 * A move of the row in one of the word sets; an all-in says so, as the action bar does ("All-in
 * 200", "Call all-in"; QA-2 of 6 Nov 2026, item 6).
 */
function moveText(
  row: SummaryRow,
  a: PlayerAction,
  words: MoveWords,
  money: (x: number) => string,
): string {
  const allIn = isAllInMove(row, a);
  switch (a.type) {
    case 'fold':
    case 'check':
      return words[a.type];
    case 'call':
      return allIn ? words.callAllIn : words.call;
    case 'bet':
      return allIn ? words.allIn(money(a.to)) : words.bet(money(a.to));
    case 'raise':
      return allIn ? words.allIn(money(a.to)) : words.raise(money(a.to));
  }
}

/** The row's first line after the street: "You called", "You went all-in for 200". */
export function rowDid(row: SummaryRow, money: (x: number) => string): string {
  return moveText(row, row.taken, W.did, money);
}

/** The numbers of a row in words (`rowNumbers`: the ones that tell the grade's story). */
function numbersText(row: SummaryRow): string | null {
  const pct = (x: number): string => percentText(100 * x);
  const n = rowNumbers(row);
  const later = (x: number | null): string => (x === null ? '' : ` ${W.later(pct(x))}`);
  switch (n.kind) {
    case 'none':
      return null;
    case 'win':
      return W.win(pct(n.win));
    case 'price':
      return W.numbers(pct(n.win), pct(n.need)) + later(n.later);
    case 'likelyOnly':
      return n.whom === null
        ? W.likelyOnly(pct(n.win), pct(n.likely))
        : W.whomOnly(W.whom(n.whom.players, pct(n.win), n.whom.callers, pct(n.likely)));
    case 'likely':
      return (
        (n.whom === null
          ? W.likely(pct(n.win), pct(n.likely), pct(n.need))
          : W.whomPrice(
              W.whom(n.whom.players, pct(n.win), n.whom.callers, pct(n.likely)),
              pct(n.need),
            )) + later(n.later)
      );
  }
}

const isPassive = (a: PlayerAction): boolean => a.type === 'check' || a.type === 'call';
const isAggressive = (a: PlayerAction): boolean => a.type === 'bet' || a.type === 'raise';

/**
 * The second line of a row: the coach's move when it was another, then the numbers. A Best grade
 * for another move says it was as good ("Calling was as good as folding here."), never "Best move"
 * next to a bare "Coach: Fold" (§8.9: the close alternative, or a loss of at most 1% of the pot).
 * A check or a call graded Slightly off or worse where the coach bet or raised says the coach's
 * move wins more ("Raising to 2,100 wins more here."; §8.9 "value missed", QA-2 item 1).
 */
export function rowNotes(row: SummaryRow, money: (x: number) => string): string {
  const notes: string[] = [];
  if (!sameMove(row.taken, row.rec)) {
    if (row.grade === 'best') {
      notes.push(
        W.asGood(
          moveText(row, row.taken, W.doing, money),
          moveText(row, row.rec, W.coachDoing, money),
        ),
      );
    } else if (
      row.grade !== null &&
      row.grade !== 'good' &&
      isPassive(row.taken) &&
      isAggressive(row.rec)
    ) {
      notes.push(W.winsMore(moveText(row, row.rec, W.doing, money)));
    } else {
      notes.push(moveText(row, row.rec, W.coach, money));
    }
  }
  const numbers = numbersText(row);
  if (numbers !== null) notes.push(numbers);
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
              </li>
            );
          })}
        </ol>
        <LevelSuggestion />
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
