/**
 * Where a first-table tip's bubble goes (PLAN §12.11, chunk 9.3): beside what it explains, inside
 * the window, never over the tray and Row A. Pure. It loads with the bubble's lazy chunk
 * (`components/TipBubble.tsx`), only while a tip is due: a player who has seen the four tips never
 * downloads it.
 */

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Where the bubble sits, seen from what it points at. */
export type TipSide = 'above' | 'below' | 'left';

export interface TipPlace {
  readonly left: number;
  readonly top: number;
  /** Null: nothing to point at (the anchor is not on the page): no arrow. */
  readonly side: TipSide | null;
  /** The arrow's centre along the bubble's edge (px from its left, or its top for `left`). */
  readonly arrow: number;
}

export interface PlaceInput {
  /** What the tip is about; null when it is not on the page. */
  readonly anchor: Box | null;
  readonly bubble: { readonly width: number; readonly height: number };
  readonly viewport: { readonly width: number; readonly height: number };
  /** The tray and Row A: the bubble never covers them (§12.11). */
  readonly avoid: Box | null;
  /** The anchor's own side (`data-tip-side`), tried first. */
  readonly prefer: TipSide;
}

/** Room kept from the window's edges. */
const EDGE = 8;
/** Between the bubble and what it points at (the arrow sits in it). */
const GAP = 10;
/** The arrow stays this far from the bubble's ends (its rounded corners). */
const ARROW_END = 14;

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

const overlaps = (a: Box, b: Box): boolean =>
  a.left < b.left + b.width &&
  b.left < a.left + a.width &&
  a.top < b.top + b.height &&
  b.top < a.top + a.height;

/**
 * The bubble's place (pure): beside its anchor on the preferred side, else above, below or to the
 * left, the first that fits in the window without covering `avoid`; the arrow points at the
 * anchor's middle. When nothing fits, above it as far as the window allows, and always clear of
 * `avoid` (lifted above it).
 */
export function placeTip(p: PlaceInput): TipPlace {
  const { anchor, bubble, viewport, avoid } = p;
  const { width: w, height: h } = bubble;
  const maxLeft = Math.max(EDGE, viewport.width - EDGE - w);
  const maxTop = Math.max(EDGE, viewport.height - EDGE - h);
  if (anchor === null) {
    const floor = avoid === null ? viewport.height - EDGE : avoid.top - GAP;
    return {
      left: clamp((viewport.width - w) / 2, EDGE, maxLeft),
      top: clamp(floor - h, EDGE, maxTop),
      side: null,
      arrow: 0,
    };
  }
  const cx = anchor.left + anchor.width / 2;
  const cy = anchor.top + anchor.height / 2;
  const at = (side: TipSide): TipPlace => {
    if (side === 'left') {
      const top = clamp(cy - h / 2, EDGE, maxTop);
      const arrow = clamp(cy - top, ARROW_END, Math.max(ARROW_END, h - ARROW_END));
      return { left: anchor.left - GAP - w, top, side, arrow };
    }
    const left = clamp(cx - w / 2, EDGE, maxLeft);
    const arrow = clamp(cx - left, ARROW_END, Math.max(ARROW_END, w - ARROW_END));
    const top = side === 'above' ? anchor.top - GAP - h : anchor.top + anchor.height + GAP;
    return { left, top, side, arrow };
  };
  const fits = (place: TipPlace): boolean => {
    const box = { left: place.left, top: place.top, width: w, height: h };
    return (
      place.left >= EDGE &&
      place.top >= EDGE &&
      place.left + w <= viewport.width - EDGE &&
      place.top + h <= viewport.height - EDGE &&
      (avoid === null || !overlaps(box, avoid))
    );
  };
  const order: TipSide[] = [p.prefer, 'above', 'below', 'left'];
  for (const side of order) {
    const place = at(side);
    if (fits(place)) return place;
  }
  // Nothing fits: above, inside the window, and never over the action bar.
  const above = at('above');
  let top = clamp(above.top, EDGE, maxTop);
  if (avoid !== null && overlaps({ left: above.left, top, width: w, height: h }, avoid)) {
    top = Math.max(EDGE, avoid.top - GAP - h);
  }
  return { ...above, top };
}
