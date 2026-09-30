/**
 * The win badge and what sits with it (PLAN §7.6, §12.3, §12.14): "62%" large, "win chance"
 * small; `~62%` while provisional; a `--%` skeleton before the first estimate (static under
 * reduced motion); "Folded"; "—" when the number is not available. A tap opens its popover: what
 * the number means, with "How is this calculated?". The badge is neutral in colour: it never says
 * call or fold (§7.1).
 *
 * - `PriceChip`: "Call 40 · need 20%" under the badge when the hero faces a bet, on two lines.
 * - `BigMoveLine`: one line for 4 s when the final number moved by 8 points or more.
 *
 * Presentational: the views come from `ui/equity.ts`; the Table wires them to the store.
 */
import { memo, useCallback, useId, useRef, useState } from 'react';
import { cardAriaLabel, rankLabel, rankOf, suitOf, type Card } from '../../core/cards.ts';
import { en } from '../../i18n/en.ts';
import type { BadgeView, BigMoveView, PriceChipView } from '../equity.ts';
import { useDismiss, useFresh } from '../hooks.ts';
import { SUIT_SYMBOLS } from './SvgSprite.tsx';
import styles from './WinBadge.module.css';

const cx = (...names: (string | false | null | undefined)[]): string =>
  names.filter(Boolean).join(' ');

/** Where popovers and the big-move line open: over the felt, or down the landscape column. */
export type BadgePlacement = 'up' | 'down';

export interface WinBadgeProps {
  view: BadgeView;
  placement: BadgePlacement;
}

/**
 * The badge. Mount it with `key` = the situation's key, so a new street or a fold closes an open
 * popover.
 */
export const WinBadge = memo(function WinBadge({ view, placement }: WinBadgeProps) {
  const [open, setOpen] = useState(false);
  const [how, setHow] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const close = useCallback(() => {
    setOpen(false);
    setHow(false);
  }, []);
  useDismiss(open, rootRef, close);

  const face = (
    <>
      <span
        className={cx(
          styles.value,
          view.state === 'skeleton' && styles.skeleton,
          view.state === 'folded' && styles.word,
        )}
        aria-hidden="true"
      >
        {view.text}
      </span>
      {view.state !== 'folded' && (
        <span className={styles.caption} aria-hidden="true">
          {en.badge.caption}
        </span>
      )}
    </>
  );
  const popover = view.popover;
  if (popover === null) {
    return (
      <div className={styles.badge} role="img" aria-label={view.label} data-win-badge={view.state}>
        {face}
      </div>
    );
  }
  return (
    <div ref={rootRef} className={styles.root}>
      <button
        type="button"
        className={cx(styles.badge, styles.button)}
        aria-label={view.label}
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        data-win-badge={view.state}
        onClick={(e) => {
          e.currentTarget.focus();
          if (open) close();
          else setOpen(true);
        }}
      >
        {face}
      </button>
      {open && (
        <div id={popoverId} className={cx(styles.popover, styles[placement])}>
          {popover.unavailable !== null && <p className={styles.line}>{popover.unavailable}</p>}
          {popover.stats !== null && <p className={styles.line}>{popover.stats}</p>}
          {popover.how !== null && (
            <button
              type="button"
              className={styles.link}
              aria-expanded={how}
              onClick={() => setHow(!how)}
            >
              {en.badge.howLink}
            </button>
          )}
          {how && popover.how !== null && <p className={styles.how}>{popover.how}</p>}
        </div>
      )}
    </div>
  );
});

/** "Call 40" over "need 20%", and "Pot you can win 150" under a short all-in call (§0.3). */
export const PriceChip = memo(function PriceChip({ view }: { view: PriceChipView }) {
  return (
    <p className={styles.price} data-price-chip="">
      {view.need === '' ? view.text : `${view.call}\n${view.need}`}
      {view.potYouCanWin !== null && <span className={styles.canWin}>{view.potYouCanWin}</span>}
    </p>
  );
});

/** A card inside a sentence: its rank and suit shape (never a Unicode suit, pitfall 31). */
export function InlineCard({ card }: { card: Card }) {
  const suit = suitOf(card);
  return (
    <span
      className={cx(styles.inlineCard, styles[`suit${suit}`])}
      role="img"
      aria-label={cardAriaLabel(card)}
    >
      {rankLabel(rankOf(card))}
      <svg className={styles.inlineSuit} aria-hidden="true" focusable="false">
        <use href={`#${SUIT_SYMBOLS[suit]}`} />
      </svg>
    </span>
  );
}

/** How long a big-move line stays (§7.6). */
export const BIG_MOVE_MS = 4000;

export interface BigMoveLineProps {
  view: BigMoveView | null;
  placement: BadgePlacement;
}

/** The §7.6 line: "Ben folded. One fewer player to beat." for 4 s, next to the badge. */
export const BigMoveLine = memo(function BigMoveLine({ view, placement }: BigMoveLineProps) {
  const fresh = useFresh(view?.key ?? null, BIG_MOVE_MS);
  if (view === null || !fresh) return null;
  return (
    <p className={cx(styles.move, styles[placement])} role="status" data-big-move="">
      {view.before}
      {view.card !== null && <InlineCard card={view.card} />}
      {view.after}
    </p>
  );
});
