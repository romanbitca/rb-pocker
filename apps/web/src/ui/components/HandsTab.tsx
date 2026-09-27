/**
 * The "Hands" edge tab (PLAN §13.1): always visible on the right edge of the table, inside the
 * 28 px gutter that no pod uses (§12.3). 28×88 px drawn, 44 px wide to touch (the extra 16 px reach
 * over the felt, transparent). An 8 px accent dot shows when the hero's hand improved since the
 * drawer was last open (`useHandsTabDot`).
 *
 * ⚠️ It opens on a tap only, never on a swipe (§12.13): a click that ends more than a few pixels
 * from where its pointer went down is ignored, so an edge swipe (the browser's Back) that happens
 * to end on the tab does nothing.
 */
import { useRef } from 'react';
import { en } from '../../i18n/en.ts';
import styles from './HandsTab.module.css';

export interface HandsTabProps {
  onOpen: () => void;
  /** Whether the drawer is open (for `aria-expanded`). */
  expanded: boolean;
  dot?: boolean | undefined;
  className?: string | undefined;
}

/** How far a tap may move and still be a tap. */
const TAP_SLOP = 10;
/** A pointer-down older than this is not the start of the click. */
const TAP_MS = 1500;

export function HandsTab({ onOpen, expanded, dot = false, className }: HandsTabProps) {
  const down = useRef<{ x: number; y: number; t: number } | null>(null);
  return (
    <button
      type="button"
      className={[styles.tab, className].filter(Boolean).join(' ')}
      aria-label={en.rankings.open}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      onPointerDown={(e) => {
        down.current = { x: e.clientX, y: e.clientY, t: e.timeStamp };
      }}
      onPointerCancel={() => {
        down.current = null;
      }}
      onClick={(e) => {
        const d = down.current;
        down.current = null;
        const recent = d !== null && e.timeStamp - d.t < TAP_MS;
        if (recent && Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_SLOP) return;
        // Safari does not focus a tapped button; the drawer returns focus to what had it.
        e.currentTarget.focus();
        onOpen();
      }}
    >
      <span className={styles.face}>
        <span className={styles.label}>{en.rankings.tab}</span>
        {dot && <span className={styles.dot} />}
      </span>
    </button>
  );
}
