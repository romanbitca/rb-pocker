/**
 * The coach strip (PLAN §12.3, §12.6, §10.2): the coach's peek, in the coach's lazy chunk with
 * the sheet (`ui/coachEntry.ts`, §15.3). Presentational: it draws a `StripView` (`ui/coach.ts`)
 * and reports taps.
 *
 * Variants:
 * - `strip` (portrait, 56 px): a 44 px slot on the left (CSS padding; the toolbar Undo sits over
 *   it), then the level's content. The advice is "Coach: Call 40" over its line, which wraps to
 *   two lines at most (the labelled pair needs two on a 360–390 px phone); a head or a sentence
 *   too long for its room gives way to a shorter form (`useFit`), never to "…", and the strip's
 *   height never follows the words. Beginner's advice is one big button, tap it or its "Why?";
 *   Intermediate's has a "Why?" button.
 * - `header` (the wide inline panel's head, §12.5): the same content without opening a sheet: the
 *   details sit right under it.
 * - `strip` with `wrap` (the landscape column's coach row, §12.5): the lines take the lines they
 *   need. "Why?" sits at the top right and the words flow around it: the head and the first line
 *   beside it, the rest under it on the row's whole width (the labelled pair, one number a line,
 *   in two lines, not three).
 * - `pill` (compact portrait, §12.3): a 44 px "Coach" pill in the hero strip; a tap opens the
 *   sheet (at Intermediate it opens the hint first) or tries again after a failure.
 *
 * The narration ("Ben raises to 60.") is plain text: the live announcements of §12.12 (one polite
 * log, throttled) are their own chunk. DOM: 1–6 elements (§15.3).
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
import { sentences } from '../coachText.ts';
import { useFit } from '../hooks.ts';
import styles from './CoachStrip.module.css';
import { GradeChip } from './GradeChip.tsx';

type AdviceView = Extract<StripView, { kind: 'advice' }>;

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

/**
 * "Coach: Call 40" over the line. A line of two sentences (the two numbers, §12.6: "All 5 players:
 * 26%. Raiser alone: about 44%.", "You win about 45%. You need 25%.") shows one a line: the CSS
 * keeps the "\n" (`white-space: pre-line`), so a pair reads one number and its label a line.
 *
 * Each picks what fits its room, never a cut word (1.3.100): the head its big blinds out, then
 * "Coach:" (the section's name still says it); the line a shorter sentence, then none (the sheet
 * has it whole; "Why?" is beside it).
 */
function Advice({ view }: { view: AdviceView }) {
  const heads = [
    { prefix: true, text: view.headline },
    { prefix: true, text: view.headlineShort },
    { prefix: false, text: view.headlineShort },
  ].filter((f, i, all) => all.findIndex((x) => x.prefix === f.prefix && x.text === f.text) === i);
  const head = useFit<HTMLSpanElement>(
    heads.map((f) => `${f.prefix}${f.text}`),
    'width',
  );
  const face = heads[head.index] as (typeof heads)[number];
  const lines = [view.line, view.lineShort, ''].filter((t, i, all) => all.indexOf(t) === i);
  const line = useFit<HTMLSpanElement>(lines, 'height');
  const words = lines[line.index] ?? '';
  return (
    <>
      <span ref={head.ref} className={styles.head} data-tight={head.tight ? '' : undefined}>
        {face.prefix && <>{coachWords.prefix} </>}
        <strong>{face.text}</strong>
      </span>
      {words !== '' && (
        <span ref={line.ref} className={styles.line}>
          {sentences(words).join('\n')}
        </span>
      )}
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
            <Advice view={view} />
          </p>
        );
      } else if (view.why) {
        body = (
          <>
            <p className={cx(styles.advice, styles.besideWhy)} data-coach-advice="">
              <Advice view={view} />
            </p>
            <button type="button" className={styles.why} aria-haspopup="dialog" onClick={onOpen}>
              {coachWords.why}
            </button>
          </>
        );
      } else {
        // Beginner: the whole strip opens the sheet, with "Why?" on its face where it ends.
        body = (
          <button
            type="button"
            className={cx(styles.advice, styles.open, styles.besideWhy)}
            aria-haspopup="dialog"
            aria-label={`${coachWords.prefix} ${view.headline}. ${view.line} ${coachWords.openSheet}`}
            data-coach-advice=""
            onClick={onOpen}
          >
            <Advice view={view} />
            <span className={styles.whyFace} data-coach-why="">
              {coachWords.why}
            </span>
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
