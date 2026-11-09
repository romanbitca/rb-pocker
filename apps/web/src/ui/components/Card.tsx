/**
 * One playing card (PLAN §13.4, §6.1, §12.12): `<Card size card highlight? used?>` serves the
 * rankings panel, the lessons, the drill, the board, the hero strip and the seats.
 *
 * - Face up: ONE element. The rank is its text ("10", never "T"); the suit is drawn by CSS
 *   (`Card.module.css`: the sprite's suit paths as a mask on `::after`, and on `::before` for the
 *   big corner pip of the larger sizes), so a card costs one DOM node, not three or five: the
 *   Table stays within its 600 nodes with nine players, the rankings column and the coach (§15.3).
 *   `data-suit` ("c", "d", "h", "s") names the suit for tests; `aria-label` "King of hearts" comes
 *   from `core/cards.ts`.
 * - Face down (`card === null`): a plain back with `aria-label` "Hidden card". ⚠️ It is given no
 *   card, so no rank or suit can reach the DOM or the accessibility tree.
 * - Fixed size per `size` (no layout shift, PLAN §15.3). `board` takes its width from the
 *   `--card-w` custom property (the board sets it from `boardCardSize()`).
 * - One rule everywhere (1.3.100): the five that count carry `highlight`, the gold edge, `core`
 *   raised too (on the Table `cardViewLabel` names them for screen readers). No card is ever faded
 *   for being out of the five (1.3.97 on the Table; the rankings, the lessons and the drill since
 *   1.3.100).
 */
import { memo } from 'react';
import {
  cardAriaLabel,
  rankLabel,
  rankOf,
  SUIT_CHARS,
  suitOf,
  type Card as CardValue,
} from '../../core/cards.ts';
import { en } from '../../i18n/en.ts';
import type { CardHighlight, CardView } from '../views.ts';
import styles from './Card.module.css';

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
};

/**
 * A Table card's screen-reader name (§12.12): undefined (the plain "King of hearts") unless it has
 * the gold edge (§6.1), which reads "King of hearts, part of your hand", or after a showdown
 * "King of hearts, part of the winning hand" (§12.9).
 */
export function cardViewLabel(view: CardView): string | undefined {
  if (view.card === null || view.highlight === undefined) return undefined;
  const name = cardAriaLabel(view.card);
  return view.winning === true ? en.cards.winningHand(name) : en.cards.yourHand(name);
}

export interface CardProps {
  /** The card, or `null` for a face-down card. */
  card: CardValue | null;
  size: CardSize;
  /** §6.1 highlight, one of the best five: the gold edge (a 3 px outline); core is raised too. */
  highlight?: CardHighlight | undefined;
  /** Underlined: one of the hero's own cards on the rankings "You" line (§13.3), the drill's. */
  used?: boolean | undefined;
  /** A screen-reader name instead of "King of hearts" (e.g. a risky out, §6.4). */
  label?: string | undefined;
  className?: string | undefined;
}

const join = (...names: (string | false | undefined)[]): string => names.filter(Boolean).join(' ');

export const Card = memo(function Card({
  card,
  size,
  highlight,
  used,
  label,
  className,
}: CardProps) {
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
  return (
    <span
      role="img"
      aria-label={label ?? cardAriaLabel(card)}
      data-suit={SUIT_CHARS[suit]}
      className={join(
        styles.card,
        sizeClass,
        styles.face,
        INDEX_ONLY.has(size) ? styles.indexOnly : styles.corner,
        rank.length > 1 && styles.ten,
        SUIT_CLASS[suit],
        highlight !== undefined && HIGHLIGHT_CLASS[highlight],
        used === true && styles.used,
        className,
      )}
    >
      {/* The rank is a bare text node and the suit a CSS mask (no child elements): the Table
          stays under 600 DOM nodes (§15.3). `role="img"` with its label makes the text
          presentational for screen readers. */}
      {rank}
    </span>
  );
});
