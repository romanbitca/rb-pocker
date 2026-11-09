/**
 * The hand-end result (PLAN §12.9; 1.3.99): who won what, until the next hand starts. A polite live
 * region announces it. It is words only: the next hand is Row A's "Next hand ›" (§12.7), under the
 * thumb, and `HandEndLinks` are "Review this hand" (§12.10; leaving the table pauses the game) and,
 * when the hand has a summary (§10.2; 1.3.92), "Hand summary" (Exam's "Exam result"), which opens
 * the sheet, never by itself; while it is open the next hand waits.
 *
 * Where it goes: phones in portrait: a card on the felt under the board, which it never covers (a
 * long result scrolls inside it, the shadow at its edge says so); landscape: the right column,
 * above the buttons (`side`); wide screens: the panel under the hero (`panel`).
 */
import { memo, useLayoutEffect, useRef } from 'react';
import type { SummaryOffer } from '../../app/store.ts';
import { en } from '../../i18n/en.ts';
import type { BannerLine } from '../handEnd.ts';
import styles from './HandEndBanner.module.css';

const cx = (...names: (string | false | null | undefined)[]): string =>
  names.filter(Boolean).join(' ');

export interface HandEndBannerProps {
  /** `bannerLines()` (ui/handEnd.ts): the winner first, the hero's own result, the rest. */
  lines: readonly BannerLine[];
  /** Landscape's right column (§12.5): less room, so less padding. */
  side?: boolean | undefined;
  /** Wide screens' panel (§12.5): no card of its own, the words at the left. */
  panel?: boolean | undefined;
  className?: string | undefined;
}

export const HandEndBanner = memo(function HandEndBanner({
  lines,
  side,
  panel,
  className,
}: HandEndBannerProps) {
  const ref = useRef<HTMLDivElement>(null);
  // A result taller than its place scrolls, and a keyboard must be able to scroll it (§12.12).
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null || side === true || panel === true) return;
    if (el.scrollHeight > el.clientHeight) el.tabIndex = 0;
    else el.removeAttribute('tabindex');
  }, [lines, side, panel]);
  return (
    <div
      ref={ref}
      role="status"
      className={cx(
        styles.banner,
        side === true && styles.side,
        panel === true && styles.panel,
        className,
      )}
      data-hand-result=""
    >
      {lines.map((line, i) => (
        <span key={i} className={styles[line.kind]}>
          {line.text}
        </span>
      ))}
    </div>
  );
});

export interface HandEndLinksProps {
  /** "Review this hand": the replay of this hand (Review, §12.10). */
  onReview: () => void;
  /**
   * The hand's summary (`game.summary`, §12.9): 'hand' shows "Hand summary", 'exam' "Exam
   * result"; null: none (the level shows no summary for this hand).
   */
  summary: SummaryOffer;
  /** Opens the summary sheet (the `summary` overlay). */
  onSummary: () => void;
  /** The landscape column, the wide panel and compact mode's hero strip have their own sizes. */
  place?: 'side' | 'panel' | 'hero' | undefined;
  className?: string | undefined;
}

/**
 * "Hand summary" (Exam's "Exam result"; only when the hand has one) and "Review this hand": quiet
 * links, each 44 px to touch (§12.12), side by side. Where a row is short of width each one's words
 * take two lines inside the 44 px, so the row never grows: nothing moves when a late grade brings
 * the summary's button.
 */
export const HandEndLinks = memo(function HandEndLinks({
  onReview,
  summary,
  onSummary,
  place,
  className,
}: HandEndLinksProps) {
  return (
    <div className={cx(styles.links, place !== undefined && styles[place], className)}>
      {summary !== null && (
        <button
          type="button"
          className={styles.link}
          onClick={() => onSummary()}
          aria-keyshortcuts="S"
          data-hand-summary={summary}
        >
          {summary === 'exam' ? en.handEnd.examResult : en.handEnd.summary}
        </button>
      )}
      <button type="button" className={styles.link} onClick={() => onReview()} data-hand-review="">
        {en.handEnd.review}
      </button>
    </div>
  );
});
