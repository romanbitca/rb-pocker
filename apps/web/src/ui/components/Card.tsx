/**
 * One playing card (PLAN §13.4, §6.1, §12.12): `<Card size card highlight? dim? used?>` serves the
 * rankings panel, the board, the hero strip and the seats.
 *
 * - Face up: the rank as text ("10", never "T") and the suit from the SVG sprite (`<use href="#s-h">`),
 *   `aria-label` "King of hearts" from `core/cards.ts`.
 * - Face down (`card === null`): a plain back with `aria-label` "Hidden card". ⚠️ It is given no
 *   card, so no rank or suit can reach the DOM or the accessibility tree.
 * - Fixed size per `size` (no layout shift, PLAN §15.3). `board` takes its width from the
 *   `--card-w` custom property (the board sets it from `boardCardSize()`).
 */
import { memo } from 'react';
import {
  cardAriaLabel,
  rankLabel,
  rankOf,
  suitOf,
  type Card as CardValue,
} from '../../core/cards.ts';
import { en } from '../../i18n/en.ts';
import type { CardHighlight } from '../views.ts';
import styles from './Card.module.css';
import { SUIT_SYMBOLS } from './SvgSprite.tsx';

/**
 * Card sizes (width × height, CSS px): xs 16×22 (bot backs, §12.4) · sm 24×34 (drawer, §13.4) ·
 * md 30×42 (wide panel, §13.4) · lg 36×50 (bot faces at showdown, §12.4) · xl 52×74 (hero,
 * compact) · xxl 64×90 (hero, §12.3) · board (`--card-w` × 1.4).
 */
export type CardSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl' | 'board';

/** Index-only faces (rank over suit, centred) for the small sizes; corner indices for the rest. */
const INDEX_ONLY: ReadonlySet<CardSize> = new Set(['xs', 'sm', 'md']);

const SUIT_CLASS = [styles.clubs, styles.diamonds, styles.hearts, styles.spades] as const;
const HIGHLIGHT_CLASS: Record<CardHighlight, string | undefined> = {
  core: styles.core,
  kicker: styles.kicker,
  off: styles.off,
};

export interface CardProps {
  /** The card, or `null` for a face-down card. */
  card: CardValue | null;
  size: CardSize;
  /** §6.1 highlight: core (raised, 3 px outline), kicker (1 px outline), off (60% opacity). */
  highlight?: CardHighlight | undefined;
  /** 45% opacity: a kicker in the rankings examples (§13.2). */
  dim?: boolean | undefined;
  /** Outlined: one of the hero's own cards on the rankings "You" line (§13.3). */
  used?: boolean | undefined;
  className?: string | undefined;
}

const join = (...names: (string | false | undefined)[]): string => names.filter(Boolean).join(' ');

export const Card = memo(function Card({ card, size, highlight, dim, used, className }: CardProps) {
  const sizeClass = styles[size];
  if (card === null) {
    return (
      <span
        role="img"
        aria-label={en.cards.hidden}
        className={join(styles.card, sizeClass, styles.back, className)}
      />
    );
  }
  const rank = rankLabel(rankOf(card));
  const suit = suitOf(card);
  const symbol = `#${SUIT_SYMBOLS[suit]}`;
  return (
    <span
      role="img"
      aria-label={cardAriaLabel(card)}
      className={join(
        styles.card,
        sizeClass,
        styles.face,
        INDEX_ONLY.has(size) ? styles.indexOnly : styles.corner,
        rank.length > 1 && styles.ten,
        SUIT_CLASS[suit],
        highlight !== undefined && HIGHLIGHT_CLASS[highlight],
        dim === true && styles.dim,
        used === true && styles.used,
        className,
      )}
    >
      {/* The rank is a bare text node (no wrapper element): the Table stays under 600 DOM nodes
          (§15.3) with nine players, the rankings column and every hand shown. `role="img"` with
          its label makes the text presentational for screen readers. */}
      {rank}
      <svg className={styles.suit} aria-hidden="true" focusable="false">
        <use href={symbol} />
      </svg>
      {!INDEX_ONLY.has(size) && (
        <svg className={styles.pip} aria-hidden="true" focusable="false">
          <use href={symbol} />
        </svg>
      )}
    </span>
  );
});
