/**
 * The hand-rankings drawer for phones and tablets in portrait (PLAN §13.1): a modal right-side
 * sheet `min(86vw, 340px)` wide over a 40% scrim.
 *
 * - Controlled: `open` + `onOpenChange`. It opens only from taps outside it (`HandsTab`, the top-bar
 *   Hands button, the hero's hand label), never from an edge swipe (§12.13).
 * - Closes by the scrim, ✕, Esc, or dragging it to the right; each calls
 *   `onOpenChange(false, reason)`. Android Back belongs to the controller: its `popstate` handler
 *   sets `open` to false (and a UI close should pop the history entry it pushed; see `reason`).
 * - While `open` is true the controller keeps its `sheet` gate closed, so no bot acts behind the
 *   scrim (Appendix A.8).
 * - Focus moves into the sheet, is trapped there, and returns to the opener on close. The
 *   highlighted row scrolls into view on open.
 * - Render it inside the element the sheet may cover: in portrait everything above the action bar,
 *   in landscape the table column (it fills its nearest positioned ancestor).
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import { en } from '../../i18n/en.ts';
import type { HeroHandView } from '../views.ts';
import styles from './RankingsDrawer.module.css';
import { RankingsList } from './RankingsList.tsx';
import { ICONS, SpriteIcon } from './SvgSprite.tsx';

/** What closed the drawer (the controller pops its history entry for all of these). */
export type RankingsCloseReason = 'scrim' | 'close' | 'escape' | 'drag';

export interface RankingsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean, reason: RankingsCloseReason) => void;
  hero: HeroHandView | null;
  showTips?: boolean | undefined;
}

/** The sheet stays mounted this long after closing, for the 200 ms slide-out (§12.8). */
const EXIT_MS = 220;
/** A drag counts once it moves this far; it closes past `DRAG_CLOSE` px or 25% of the width. */
const DRAG_START = 10;
const DRAG_CLOSE = 64;

// `a[href]`, not `[href]`: the SVG `<use href="#s-h">` suits are not focusable.
const FOCUSABLE =
  'button:not([disabled]), a[href], area[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
}

interface Drag {
  id: number;
  x: number;
  y: number;
  dx: number;
  active: boolean;
}

function Sheet({ open, onOpenChange, hero, showTips }: RankingsDrawerProps) {
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const currentRowRef = useRef<HTMLLIElement>(null);
  const drag = useRef<Drag | null>(null);
  const swallowClick = useRef(false);
  // The latest callback, so a parent's inline function never re-runs the open/close effect below
  // (that would move focus and scroll on every parent render).
  const onChange = useRef(onOpenChange);
  useEffect(() => {
    onChange.current = onOpenChange;
  });
  const close = useCallback((reason: RankingsCloseReason) => onChange.current(false, reason), []);

  // While open: focus moves in (and the highlighted row into view), Esc closes, and focus that
  // lands outside the sheet is brought back (the trap). On close: the listeners go first, then
  // focus returns to the opener.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    sheetRef.current?.focus();
    currentRowRef.current?.scrollIntoView?.({ block: 'center' });
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close('escape');
      }
    };
    const onFocusIn = (e: FocusEvent) => {
      const sheet = sheetRef.current;
      if (sheet !== null && e.target instanceof Node && !sheet.contains(e.target)) sheet.focus();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocusIn);
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [open, close]);

  // Tab and Shift+Tab wrap around inside the sheet.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const sheet = sheetRef.current;
    if (e.key !== 'Tab' || sheet === null) return;
    const items = focusables(sheet);
    const first = items[0];
    const last = items[items.length - 1];
    if (first === undefined || last === undefined) {
      e.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === sheet)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // Drag right to close. Vertical moves stay native scrolling (`touch-action: pan-y`).
  const moveSheet = (dx: number) => {
    const sheet = sheetRef.current;
    if (sheet !== null) sheet.style.transform = dx > 0 ? `translateX(${dx}px)` : '';
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, active: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d === null || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.active) {
      if (Math.abs(dx) < DRAG_START && Math.abs(dy) < DRAG_START) return;
      if (dx <= 0 || Math.abs(dx) <= Math.abs(dy)) {
        drag.current = null; // a scroll, or a drag to the left
        return;
      }
      d.active = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      e.currentTarget.classList.add(styles.dragging ?? '');
    }
    d.dx = Math.max(0, dx);
    moveSheet(d.dx);
  };
  const endDrag = (e: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (d === null || !d.active) return;
    e.currentTarget.classList.remove(styles.dragging ?? '');
    swallowClick.current = true; // the drag's pointerup must not also tap a row
    const width = e.currentTarget.offsetWidth;
    if (!cancelled && d.dx >= Math.max(DRAG_CLOSE, width * 0.25)) {
      close('drag');
      // Once the closing class is on, the slide-out continues from where the finger let go.
      requestAnimationFrame(() => moveSheet(0));
    } else {
      moveSheet(0); // snap back
    }
  };
  const onClickCapture = (e: MouseEvent<HTMLDivElement>) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    e.stopPropagation();
    e.preventDefault();
  };

  const join = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ');
  return (
    <div
      className={join(styles.root, !open && styles.closing)}
      inert={!open}
      aria-hidden={open ? undefined : true}
      data-state={open ? 'open' : 'closing'}
    >
      <div className={styles.scrim} aria-hidden="true" onClick={() => close('scrim')} />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={styles.sheet}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endDrag(e, false)}
        onPointerCancel={(e) => endDrag(e, true)}
        onClickCapture={onClickCapture}
      >
        <header className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {en.rankings.title}
          </h2>
          <button
            type="button"
            className={styles.close}
            aria-label={en.rankings.close}
            onClick={() => close('close')}
          >
            <SpriteIcon id={ICONS.close} className={styles.closeIcon} />
          </button>
        </header>
        <div className={styles.scroll}>
          <RankingsList
            hero={hero}
            cardSize="sm"
            showTips={showTips}
            currentRowRef={currentRowRef}
          />
        </div>
      </div>
    </div>
  );
}

export function RankingsDrawer(props: RankingsDrawerProps) {
  // Mounted while open and for the slide-out after; unmounted when closed (keeps the Table's DOM
  // small, §15.3).
  const [present, setPresent] = useState(props.open);
  if (props.open && !present) setPresent(true);
  useEffect(() => {
    if (props.open || !present) return;
    const timer = window.setTimeout(() => setPresent(false), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [props.open, present]);
  return present ? <Sheet {...props} /> : null;
}
