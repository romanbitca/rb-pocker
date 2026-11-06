/**
 * The board (PLAN §12.3): five fixed slots, dealt cards face up, empty slots as dashed outlines.
 * Card size comes from `boardCardSize()` (layout/seats.ts); highlights (§6.1: the gold edge on the
 * cards of the best five, the ones that make the category raised too; the others look like any
 * card) come with each `CardView`, and so does their screen-reader name ("part of your hand").
 */
import { memo, type CSSProperties } from 'react';
import { en } from '../../i18n/en.ts';
import type { Rect, Size } from '../layout/seats.ts';
import type { CardView } from '../views.ts';
import styles from './Board.module.css';
import { Card, cardViewLabel } from './Card.tsx';

export interface BoardProps {
  /** The dealt board cards, 0 to 5. */
  cards: readonly CardView[];
  /** Card size, `tableGeometry().boardCard`. */
  card: Size;
  /** Absolute position in the table box, `tableGeometry().board`; omit to lay it out inline. */
  place?: Rect | undefined;
  /**
   * The Table's board: the gold edge's first-table tip points at it, its bubble on this side
   * (§12.11, `boardTipSide()`). Undefined elsewhere (Review): no tip anchor.
   */
  tipSide?: 'above' | 'below' | undefined;
}

export const Board = memo(function Board({ cards, card, place, tipSide }: BoardProps) {
  const style = {
    '--board-card-w': `${card.w}px`,
    '--board-card-h': `${card.h}px`,
    ...(place && { position: 'absolute', left: place.x, top: place.y, width: place.w }),
  } as CSSProperties;
  return (
    <div
      role="group"
      aria-label={en.board.label}
      className={styles.board}
      style={style}
      data-tip-anchor={tipSide === undefined ? undefined : 'bestFive'}
      data-tip-side={tipSide}
    >
      {[0, 1, 2, 3, 4].map((i) => {
        const c = cards[i];
        return c === undefined ? (
          <span key={i} className={styles.empty} aria-hidden="true" />
        ) : (
          <Card
            key={i}
            card={c.card}
            size="board"
            highlight={c.highlight}
            label={cardViewLabel(c)}
          />
        );
      })}
    </div>
  );
});
