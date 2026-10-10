/**
 * The coach strip (PLAN §12.3, §12.6, §10.2): the coach's one-line peek, in the main bundle (the
 * full sheet is a lazy chunk, `CoachSheet.tsx`). Presentational: it draws a `StripView`
 * (`ui/coach.ts`) and reports taps.
 *
 * Variants:
 * - `strip` (portrait, 48 px): an empty 44 px Undo slot on the left (Undo arrives in Stage 6;
 *   the slot is CSS padding, no element), then the level's content. Beginner's advice is one big
 *   button (tap the strip or "›" opens the sheet); Intermediate's has a "Why?" button.
 * - `header` (the landscape column's coach row and the wide inline panel's head, §12.5): the same
 *   content without opening a sheet: the details sit right under it.
 * - `pill` (compact portrait, §12.3): a 44 px "Coach" pill in the hero strip; a tap opens the
 *   sheet (at Intermediate it opens the hint first) or tries again after a failure.
 *
 * The narration ("Ben raises to 60.") is plain text: the live announcements of §12.12 (one polite
 * log, throttled) are their own chunk. DOM: 1–5 elements (§15.3); the "›" is CSS.
 *
 * After the hero acts (§10.2, §12.6, chunk 6.4) the strip shows the decision's grade chip for
 * 1.5 s in place of the narration (`chip`, when the level shows that grade); the hero's next turn
 * takes the strip back at once. In compact mode the chip takes the pill's place.
 */
import { memo } from 'react';
import type { Grade } from '../../brain/types.ts';
import { en } from '../../i18n/en.ts';
import { coachWords } from '../../i18n/coachUi.ts';
import type { StripView } from '../coach.ts';
import styles from './CoachStrip.module.css';
import { GradeChip } from './GradeChip.tsx';

export type StripVariant = 'strip' | 'header' | 'pill';

export interface CoachStripProps {
  readonly view: StripView;
  readonly variant: StripVariant;
  /** Opens the coach sheet (strip and pill). */
  readonly onOpen: () => void;
  /** Intermediate's "Hint": shows the advice (and marks the decision as helped, §10.2). */
  readonly onHint: () => void;
  /** "Tap to try again" (§12.11). */
  readonly onRetry: () => void;
  /** The lines may wrap and the strip grow (the landscape column, §12.5). */
  readonly wrap?: boolean;
  /** The grade chip of the decision just graded, while it shows (§12.6); else null. */
  readonly chip?: Grade | null | undefined;
  readonly className?: string | undefined;
}

const cx = (...names: (string | false | null | undefined)[]): string =>
  names.filter(Boolean).join(' ');

function Advice({ headline, line }: { headline: string; line: string }) {
  return (
    <>
      <span className={styles.head}>
        {coachWords.prefix} <strong>{headline}</strong>
      </span>
      {line !== '' && <span className={styles.line}>{line}</span>}
    </>
  );
}

const hintLabel = (view: { countsAsHelp: boolean }): string =>
  view.countsAsHelp ? coachWords.hintExam : coachWords.hint;

function Pill({ view, onOpen, onHint, onRetry, chip }: Omit<CoachStripProps, 'variant'>) {
  switch (view.kind) {
    case 'empty':
    case 'narration':
      return chip == null ? null : (
        <span className={styles.pillChip}>
          <GradeChip grade={chip} />
        </span>
      );
    case 'failed':
      return (
        <button
          type="button"
          className={styles.pill}
          aria-label={coachWords.failed}
          onClick={onRetry}
        >
          {coachWords.pill}
        </button>
      );
    case 'thinking':
      return (
        <button
          type="button"
          className={styles.pill}
          aria-label={coachWords.thinking}
          aria-disabled="true"
        >
          {coachWords.pill}
        </button>
      );
    case 'hint':
      return (
        <button
          type="button"
          className={styles.pill}
          aria-label={hintLabel(view)}
          aria-disabled={view.ready ? undefined : true}
          onClick={() => {
            if (!view.ready) return;
            onHint();
            onOpen();
          }}
        >
          {coachWords.pill}
        </button>
      );
    case 'advice':
      return (
        <button
          type="button"
          className={cx(styles.pill, styles.pillReady)}
          aria-label={`${coachWords.prefix} ${view.headline}. ${coachWords.openSheet}`}
          aria-haspopup="dialog"
          onClick={onOpen}
        >
          {coachWords.pill}
        </button>
      );
  }
}

export const CoachStrip = memo(function CoachStrip({
  view,
  variant,
  onOpen,
  onHint,
  onRetry,
  wrap = false,
  chip = null,
  className,
}: CoachStripProps) {
  if (variant === 'pill') {
    return <Pill view={view} onOpen={onOpen} onHint={onHint} onRetry={onRetry} chip={chip} />;
  }
  const header = variant === 'header';
  let body: React.ReactNode = null;
  switch (view.kind) {
    case 'empty':
      if (chip !== null) body = <GradeChip grade={chip} />;
      break;
    case 'narration':
      body =
        chip === null ? (
          <p className={styles.narration}>{view.text}</p>
        ) : (
          <GradeChip grade={chip} />
        );
      break;
    case 'thinking':
      body = <p className={styles.muted}>{coachWords.thinking}</p>;
      break;
    case 'failed':
      body = (
        <button type="button" className={styles.wide} onClick={onRetry}>
          {coachWords.failed}
        </button>
      );
      break;
    case 'hint':
      body = (
        <button
          type="button"
          className={styles.hint}
          aria-disabled={view.ready ? undefined : true}
          data-coach-hint=""
          onClick={() => {
            if (view.ready) onHint();
          }}
        >
          {hintLabel(view)}
        </button>
      );
      break;
    case 'advice':
      if (header) {
        body = (
          <p className={styles.advice} data-coach-advice="">
            <Advice headline={view.headline} line={view.line} />
          </p>
        );
      } else if (view.why) {
        body = (
          <>
            <p className={styles.advice} data-coach-advice="">
              <Advice headline={view.headline} line={view.line} />
            </p>
            <button type="button" className={styles.why} aria-haspopup="dialog" onClick={onOpen}>
              {coachWords.why}
            </button>
          </>
        );
      } else {
        body = (
          <button
            type="button"
            className={cx(styles.advice, styles.open)}
            aria-haspopup="dialog"
            aria-label={`${coachWords.prefix} ${view.headline}. ${view.line} ${coachWords.openSheet}`}
            data-coach-advice=""
            onClick={onOpen}
          >
            <Advice headline={view.headline} line={view.line} />
          </button>
        );
      }
      break;
  }
  return (
    <section
      className={cx(styles.strip, header && styles.header, wrap && styles.wrap, className)}
      aria-label={en.coachUi.title}
      data-coach-strip={view.kind}
    >
      {body}
    </section>
  );
});
