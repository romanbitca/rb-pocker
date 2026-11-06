/**
 * A first-table tip (PLAN §12.11, chunk 9.3): one line in a bubble beside what it explains, with
 * an arrow pointing at it. The element it explains carries `data-tip-anchor="<tip>"` (and
 * `data-tip-side` when the bubble belongs on its left); `ui/tips.ts` places the bubble in the
 * window, never over the tray and Row A (`data-action-area`).
 *
 * Any tap or key closes it (`onDismiss`), and the tap or key still does what it does (a tap on
 * Call calls), so the bubble never takes the focus and is not a dialog: `role="status"`, read out
 * politely. One element: the arrow is CSS (§15.3 DOM budget).
 *
 * A lazy chunk with its words and its placement (the Table loads it while a tip is due): a player
 * who has seen the four tips never downloads it.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { TipId } from '../../app/store.ts';
import { tipWords } from '../../i18n/tips.ts';
import { placeTip, type Box, type TipPlace, type TipSide } from '../tipPlace.ts';
import styles from './TipBubble.module.css';

export interface TipBubbleProps {
  readonly tip: TipId;
  /** A tap anywhere or a key: the tip is seen. */
  readonly onDismiss: () => void;
}

/** Keys that only change another key: pressing them alone closes nothing. */
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'AltGraph', 'Fn']);

const boxOf = (el: Element | null): Box | null => {
  if (el === null) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};

const sideOf = (el: Element | null): TipSide => {
  const side = el?.getAttribute('data-tip-side');
  return side === 'left' || side === 'below' ? side : 'above';
};

export function TipBubble({ tip, onDismiss }: TipBubbleProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<TipPlace | null>(null);

  // Placed before the first paint, and again when the window or what it points at changes size.
  useLayoutEffect(() => {
    const bubble = ref.current;
    if (bubble === null) return;
    const anchorOf = (): Element | null => document.querySelector(`[data-tip-anchor~="${tip}"]`);
    const measure = (): void => {
      const anchor = anchorOf();
      const next = placeTip({
        anchor: boxOf(anchor),
        bubble: { width: bubble.offsetWidth, height: bubble.offsetHeight },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        avoid: boxOf(document.querySelector('[data-action-area]')),
        prefer: sideOf(anchor),
      });
      setPlace((last) =>
        last !== null &&
        last.left === next.left &&
        last.top === next.top &&
        last.side === next.side &&
        last.arrow === next.arrow
          ? last
          : next,
      );
    };
    measure();
    window.addEventListener('resize', measure);
    const anchor = anchorOf();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (anchor !== null) observer?.observe(anchor);
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [tip]);

  // Tap anywhere (§12.11), or any key: captured first, never stopped.
  useEffect(() => {
    const onPointer = (): void => onDismiss();
    const onKey = (e: KeyboardEvent): void => {
      if (!MODIFIERS.has(e.key)) onDismiss();
    };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [onDismiss]);

  const style: CSSProperties =
    place === null
      ? { visibility: 'hidden' }
      : ({ left: place.left, top: place.top, '--arrow': `${place.arrow}px` } as CSSProperties);
  return (
    <div
      ref={ref}
      role="status"
      className={styles.tip}
      data-tip={tip}
      data-side={place?.side ?? undefined}
      style={style}
    >
      {tipWords[tip]}
    </div>
  );
}
