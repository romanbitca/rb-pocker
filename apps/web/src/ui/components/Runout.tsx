/**
 * All-in "TV mode" (PLAN §7.6): once the hands of a run-out are face up, every face-up player gets
 * an equity bar that follows the board street by street. A bot's bar sits in its pod's bet slot
 * and the hero's in the hero's bet slot (`tableGeometry().bets`, `heroBetRect`): nobody bets during
 * a run-out, so those places are free and already clear of the pods, the board and the pot.
 *
 * The numbers come from the store's `selectRunoutView` (face-up hands only, §2.2); the layer
 * subscribes on its own, so equity messages never re-render a seat (pitfall 37). The fill moves
 * with `transform` only (§12.8). Neutral colours: the bars show the cards, they give no advice.
 *
 * `useLuckLine` gives the hand-end banner its §7.6 luck line (ui/handEnd.ts words it).
 */
import { memo, type CSSProperties } from 'react';
import {
  selectLuckLine,
  selectRunoutView,
  useAppStore,
  type RunoutBarData,
} from '../../app/store.ts';
import { en } from '../../i18n/en.ts';
import { luckLine } from '../handEnd.ts';
import type { Rect } from '../layout/seats.ts';
import styles from './Runout.module.css';

export interface RunoutBarsProps {
  /** The pods' bet slots: index `i` is seat `i + 1` (`tableGeometry().bets`). */
  bets: readonly Rect[];
  /** The hero's bet slot. */
  hero: Rect;
}

/** The pill's size: it sits centred in the 56×20 bet slot. */
const PILL = { w: 52, h: 20 } as const;

/**
 * One player's bar: "62%" over a thin fill. One element (the track and the fill are its
 * `::before` and `::after`, the fill scaled by `--fill`), so nine bars add nine DOM nodes (§15.3).
 */
export const RunoutBar = memo(function RunoutBar({
  bar,
  place,
}: {
  bar: RunoutBarData;
  place: Rect;
}) {
  const pct = `${bar.pct}%`;
  const label = bar.seat === 0 ? en.runout.heroBar(pct) : en.runout.bar(bar.name, pct);
  const style = {
    left: Math.round(place.x + (place.w - PILL.w) / 2),
    top: Math.round(place.y + (place.h - PILL.h) / 2),
    '--fill': bar.pct / 100,
  } as CSSProperties;
  return (
    <span
      className={styles.bar}
      style={style}
      role="img"
      aria-label={label}
      data-runout-seat={bar.seat}
    >
      {pct}
    </span>
  );
});

/** Every face-up player's bar, while a run-out is on the table. */
export const RunoutBars = memo(function RunoutBars({ bets, hero }: RunoutBarsProps) {
  const view = useAppStore(selectRunoutView);
  if (view === null) return null;
  return (
    <>
      {view.bars.map((bar) => {
        const place = bar.seat === 0 ? hero : bets[bar.seat - 1];
        return place === undefined ? null : <RunoutBar key={bar.seat} bar={bar} place={place} />;
      })}
    </>
  );
});

/** The luck line while the hand-end banner is up (mode `handEnd`), else null. */
export function useLuckLine(): string | null {
  const luck = useAppStore((s) => (s.game.mode === 'handEnd' ? selectLuckLine(s) : null));
  return luck === null ? null : luckLine(luck);
}
