/**
 * The pot (PLAN §12.3): "Pot 340", and "Main 300 · Side 400" under it once side pots exist.
 * Sits right above the board, `tableGeometry().pot` (layout/seats.ts). Nothing when empty.
 */
import { memo } from 'react';
import { en } from '../../i18n/en.ts';
import { formatChips } from '../format.ts';
import type { Rect } from '../layout/seats.ts';
import type { PotView } from '../views.ts';
import styles from './Pot.module.css';

export interface PotProps {
  pot: PotView;
  /** Absolute position in the table box; omit to lay it out inline. */
  place?: Rect | undefined;
}

/** "Main 300 · Side 400 · Side 120", or null without side pots. */
export function sidePotLine(pots: readonly number[]): string | null {
  if (pots.length < 2) return null;
  return pots
    .map((amount, i) => (i === 0 ? en.pot.main : en.pot.side)(formatChips(amount)))
    .join(en.pot.separator);
}

export const Pot = memo(function Pot({ pot, place }: PotProps) {
  if (pot.total <= 0) return null;
  const side = sidePotLine(pot.pots);
  const style = place && {
    position: 'absolute' as const,
    left: place.x,
    top: place.y,
    width: place.w,
    height: place.h,
  };
  return (
    <div className={styles.pot} style={style}>
      <span className={styles.total}>{en.pot.total(formatChips(pot.total))}</span>
      {side !== null && <span className={styles.side}>{side}</span>}
    </div>
  );
});
