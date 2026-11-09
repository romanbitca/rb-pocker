/**
 * The draw chips (PLAN §6.2–§6.4, §12.3, Appendix F.3): "Flush draw · 9 outs · 35% by river",
 * "(1 risky)" when some outs may help the others too. On a phone (`compact`) the full text does
 * not fit: the chip reads "Flush draw · 35% by river" with a "!" mark for risky outs, and the full
 * text is its accessible name and its popover's title. At most `max` chips; more collapse into
 * "+1". A tap on any chip opens a popover with every draw and its out cards as mini cards; risky
 * outs carry a "!" mark and the caption "may help them too" (shape and text, never colour alone,
 * pitfall 36). At Exam the chips show the names only and do not open (§10.2).
 *
 * Presentational: the chips come from `drawChipViews()` (ui/equity.ts); the Table wires them.
 */
import { memo, useCallback, useId, useRef, useState, type MouseEvent, type Ref } from 'react';
import { cardAriaLabel } from '../../core/cards.ts';
import { en } from '../../i18n/en.ts';
import type { DrawChipView } from '../equity.ts';
import { useDismiss, useFit } from '../hooks.ts';
import { Card } from './Card.tsx';
import styles from './DrawChips.module.css';

const cx = (...names: (string | false | null | undefined)[]): string =>
  names.filter(Boolean).join(' ');

export interface DrawChipsProps {
  chips: readonly DrawChipView[];
  /** Chips shown before "+N": two on wide screens, one on phones (the rest fit no row). */
  max: number;
  /** The popover opens over the felt (`up`) or down the landscape column (`down`). */
  placement: 'up' | 'down';
  /** Phones: the short chip text and a "!" mark (the full text does not fit). */
  compact?: boolean | undefined;
  /**
   * The chip may take two lines where one is too short (the landscape column, where it sits
   * beside the win badge in 180 px, §12.5).
   */
  wrap?: boolean | undefined;
  className?: string | undefined;
}

interface ChipProps {
  readonly chip: DrawChipView;
  readonly compact: boolean;
  readonly interactive: boolean;
  readonly expanded: boolean;
  readonly popoverId: string;
  readonly onToggle: (e: MouseEvent<HTMLButtonElement>) => void;
}

/** One chip: the longest of its forms that fits the row, never cut with "…" (`useFit`, 1.3.100). */
function Chip({ chip, compact, interactive, expanded, popoverId, onToggle }: ChipProps) {
  const faces = [...(compact ? [] : [chip.text]), chip.short, ...chip.shorter].filter(
    (face, i, all) => all.indexOf(face) === i,
  );
  const fit = useFit<HTMLElement>(faces, 'width');
  const face = faces[fit.index] as string;
  const content = (
    <>
      {face}
      {compact && chip.risky > 0 && (
        <span className={styles.chipMark} aria-hidden="true">
          {en.draws.riskyMark}
        </span>
      )}
    </>
  );
  return interactive ? (
    <button
      ref={fit.ref as Ref<HTMLButtonElement>}
      type="button"
      className={styles.chip}
      aria-label={face === chip.text ? undefined : chip.text}
      aria-expanded={expanded}
      aria-controls={expanded ? popoverId : undefined}
      onClick={onToggle}
    >
      {content}
    </button>
  ) : (
    <span ref={fit.ref as Ref<HTMLSpanElement>} className={styles.chip}>
      {content}
    </span>
  );
}

export const DrawChips = memo(function DrawChips({
  chips,
  max,
  placement,
  compact = false,
  wrap = false,
  className,
}: DrawChipsProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, rootRef, close);
  if (chips.length === 0) return null;

  const shown = chips.slice(0, Math.max(1, max));
  const hidden = chips.length - shown.length;
  const interactive = chips.some((c) => c.cards.length > 0);
  const anyRisky = chips.some((c) => c.risky > 0);
  const toggle = (e: MouseEvent<HTMLButtonElement>): void => {
    e.currentTarget.focus();
    setOpen(!open);
  };

  return (
    <div
      ref={rootRef}
      className={cx(styles.row, wrap && styles.wrap, className)}
      data-draw-chips=""
    >
      {shown.map((chip) => (
        <Chip
          key={chip.key}
          chip={chip}
          compact={compact}
          interactive={interactive}
          expanded={open}
          popoverId={popoverId}
          onToggle={toggle}
        />
      ))}
      {hidden > 0 &&
        (interactive ? (
          <button
            type="button"
            className={cx(styles.chip, styles.more)}
            aria-label={en.draws.moreLabel}
            aria-expanded={open}
            aria-controls={open ? popoverId : undefined}
            onClick={toggle}
          >
            {en.draws.more(hidden)}
          </button>
        ) : (
          <span className={cx(styles.chip, styles.more)}>{en.draws.more(hidden)}</span>
        ))}
      {open && interactive && (
        <div id={popoverId} className={cx(styles.popover, styles[placement])}>
          {chips.map((chip) => (
            <section key={chip.key} className={styles.draw} aria-label={chip.text}>
              <p className={styles.title}>{chip.text}</p>
              {/* Out cards are every unseen card that helps, whoever holds it: no hidden
                  information (the E2E leak watch skips `data-examples`, as for the rankings). */}
              <div className={styles.outs} data-examples="">
                {chip.cards.map(({ card, risky }) =>
                  risky ? (
                    <span key={card} className={styles.risky}>
                      <Card card={card} size="sm" label={en.draws.riskyCard(cardAriaLabel(card))} />
                      <span className={styles.mark} aria-hidden="true">
                        {en.draws.riskyMark}
                      </span>
                    </span>
                  ) : (
                    <Card key={card} card={card} size="sm" />
                  ),
                )}
              </div>
            </section>
          ))}
          {anyRisky && (
            <p className={styles.legend}>
              <span className={styles.legendMark} aria-hidden="true">
                {en.draws.riskyMark}
              </span>
              {en.draws.riskyCaption}
            </p>
          )}
        </div>
      )}
    </div>
  );
});
