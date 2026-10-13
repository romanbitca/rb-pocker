/**
 * The table of one replay frame (PLAN §12.10: "Same table layout" as the game): the felt, the
 * opponents' pods, the board, the pot and the hero's bet, placed by `tableGeometry()` in the
 * measured box, with the same `Seat`, `Board` and `Pot` components as the Table. The cards come
 * from the frame's view models, which keep every unrevealed card out (app/reviewViews.ts), and
 * `Seat` draws a hidden hand as two backs; so a replay shows what the live game showed.
 *
 * Landscape phones inset the hero's cards at the bottom of the felt (§12.5); every other layout
 * puts them in a strip under the table (`ReviewHero`).
 */
import { memo, useMemo, useRef, type CSSProperties } from 'react';
import type { HeroView, ReviewFrame } from '../../app/store.ts';
import { en } from '../../i18n/en.ts';
import { Board } from '../components/Board.tsx';
import { HeroCards, HeroChips } from '../components/HeroStrip.tsx';
import { Pot } from '../components/Pot.tsx';
import { Seat } from '../components/Seat.tsx';
import { ICONS, SpriteIcon } from '../components/SvgSprite.tsx';
import { betChips, formatChips } from '../format.ts';
import { useElementSize } from '../hooks.ts';
import { tableGeometry, type Rect, type TableLayout } from '../layout/seats.ts';
import styles from './ReviewTable.module.css';
import { heroBetRect } from './Table.tsx';

const at = (r: Rect): CSSProperties => ({ left: r.x, top: r.y, width: r.w, height: r.h });

/** Until the box can be measured (and in jsdom): a typical phone table. */
const FALLBACK = { w: 340, h: 360 } as const;

export interface ReviewTableProps {
  frame: ReviewFrame;
  /** Bots at the table (1..8). */
  opponents: number;
  layout: TableLayout;
  handSeq: number;
  /** The table's accessible name, e.g. "Hand 12". */
  label: string;
}

export const ReviewTable = memo(function ReviewTable({
  frame,
  opponents,
  layout,
  handSeq,
  label,
}: ReviewTableProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const { w, h } = useElementSize(boxRef, FALLBACK);
  const geometry = useMemo(
    () => tableGeometry(layout, { w, h }, opponents),
    [layout, w, h, opponents],
  );
  const bet = frame.hero?.bet ?? 0;
  return (
    <div ref={boxRef} className={styles.box} role="group" aria-label={label} data-table-box="">
      <div className={styles.felt} aria-hidden="true" />
      <Pot pot={frame.pot} place={geometry.pot} />
      <Board cards={frame.board} card={geometry.boardCard} place={geometry.board} />
      {frame.seats.map((view, i) => {
        const pod = geometry.pods[i];
        const betSlot = geometry.bets[i];
        if (pod === undefined || betSlot === undefined) return null;
        return (
          <Seat
            key={view.seat}
            view={view}
            place={{ pod, bet: betSlot, inner: geometry.inner[i] ?? 'right' }}
          />
        );
      })}
      {bet > 0 && (
        <span
          className={styles.bet}
          style={at(heroBetRect(geometry))}
          role="img"
          aria-label={en.table.yourBet(formatChips(bet))}
        >
          <span className={styles.betPill}>
            <SpriteIcon id={ICONS.chip} className={styles.chip} />
            {betChips(bet)}
          </span>
        </span>
      )}
      {layout === 'landscape' && frame.hero !== null && (
        <div
          className={styles.heroInset}
          style={at(geometry.hero)}
          role="group"
          aria-label={en.table.yourHand}
        >
          <HeroCards key={handSeq} hero={frame.hero} size="xxl" />
        </div>
      )}
    </div>
  );
});

/** The hero under the table (every layout but landscape): cards, chips and the hand's name. */
export const ReviewHero = memo(function ReviewHero({
  hero,
  handSeq,
  compact,
}: {
  hero: HeroView;
  handSeq: number;
  compact: boolean;
}) {
  const sub = hero.folded ? en.table.folded : hero.subLabel;
  return (
    <section className={styles.hero} aria-label={en.table.yourHand}>
      <div className={styles.heroLeft}>
        <HeroCards key={handSeq} hero={hero} size={compact ? 'xl' : 'xxl'} />
        <HeroChips hero={hero} />
      </div>
      <p className={styles.heroText}>
        <span className={styles.heroName}>{hero.label}</span>
        {sub !== null && <span className={styles.heroSub}>{sub}</span>}
      </p>
    </section>
  );
});
