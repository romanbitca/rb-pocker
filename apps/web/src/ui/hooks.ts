/**
 * Small DOM hooks for the Table screen: a media query and an element's size (both degrade where
 * the API is missing, as in jsdom: `matchMedia` → false, `ResizeObserver` → window `resize`
 * events), a popover's dismissal, a line that shows for a few seconds, and a text that picks the
 * form that fits.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react';
import type { Size } from './layout/seats.ts';

/** Whether a CSS media query matches, following changes (false without `matchMedia`). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== 'function') return () => {};
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  const read = () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  return useSyncExternalStore(subscribe, read, () => false);
}

const sameSize = (a: Size, b: Size): boolean => a.w === b.w && a.h === b.h;

/**
 * The element's content-box size in CSS pixels, measured before the first paint and after every
 * resize. Until it can be measured (or when it measures 0, as in jsdom), `fallback` stands in.
 */
export function useElementSize(ref: RefObject<HTMLElement | null>, fallback: Size): Size {
  const [measured, setMeasured] = useState<Size | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const measure = () => {
      const w = Math.round(el.clientWidth);
      const h = Math.round(el.clientHeight);
      const next = w > 0 && h > 0 ? { w, h } : null;
      setMeasured((old) => (old !== null && next !== null && sameSize(old, next) ? old : next));
    };
    measure();
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [ref]);
  return measured ?? fallback;
}

/**
 * A text's element overflows its box along `axis`: 'width' for one line, 'height' for clamped
 * lines (the hidden ones count; a chip's hit area sticks out of its height, so one line reads
 * only its width). A 1×1 box is text for screen readers only: it has nowhere to fit.
 */
const overflows = (el: HTMLElement, axis: 'width' | 'height'): boolean => {
  if (el.clientWidth <= 1) return false;
  return axis === 'width'
    ? el.scrollWidth > el.clientWidth + 1
    : el.scrollHeight > el.clientHeight + 1;
};

export interface Fit<E extends HTMLElement> {
  /** For the element that shows the text. Its parent's width must not follow the text. */
  readonly ref: RefObject<E | null>;
  /** The face on show: the longest that fits (the last one when none does). */
  readonly index: number;
  /** The last face does not fit either: the element gets its last resort (`data-tight`). */
  readonly tight: boolean;
}

/**
 * Which of `faces` (the forms of one text, longest first) fits its element, so a text is shortened
 * and never cut with "…" (PLAN §12.3, §12.6; 1.3.100). Measured after layout and before the paint:
 * a face that overflows steps down to the next, within one frame. `box` measures an ancestor too
 * (the element's lines fit, but the box they sit in does not); `extraKey` starts over when
 * something else in that box changes. A new width starts over from the longest. Without layout
 * (jsdom: every size is 0) the first face fits.
 */
export function useFit<E extends HTMLElement>(
  faces: readonly string[],
  axis: 'width' | 'height',
  options: { readonly box?: () => HTMLElement | null; readonly extraKey?: string } = {},
): Fit<E> {
  const ref = useRef<E>(null);
  const key =
    faces.join('\u0001') + (options.extraKey === undefined ? '' : `\u0001${options.extraKey}`);
  const [fit, setFit] = useState({ key, index: 0, tight: false });
  const now = fit.key === key ? fit : { key, index: 0, tight: false };

  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null || now.tight) return;
    const box = options.box?.() ?? null;
    if (!overflows(el, axis) && (box === null || !overflows(box, axis))) return;
    setFit({
      key,
      index: Math.min(now.index + 1, faces.length - 1),
      tight: now.index >= faces.length - 1,
    });
  }, [key, axis, now.index, now.tight, faces.length]);

  useLayoutEffect(() => {
    const box = ref.current?.parentElement ?? null;
    if (box === null) return;
    let width = box.clientWidth;
    const widen = (): void => {
      if (Math.abs(box.clientWidth - width) < 1) return;
      width = box.clientWidth;
      setFit((f) => (f.index === 0 && !f.tight ? f : { ...f, index: 0, tight: false }));
    };
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(widen);
      observer.observe(box);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', widen);
    return () => window.removeEventListener('resize', widen);
  }, [key]);

  return { ref, index: now.index, tight: now.tight };
}

/**
 * Closes a popover on Escape or on a press outside `root`. The listeners exist only while it is
 * open. (A popover is not a sheet: it closes no gate and never pauses the game.)
 */
export function useDismiss(
  open: boolean,
  root: RefObject<HTMLElement | null>,
  close: () => void,
): void {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      const el = root.current;
      if (el !== null && e.target instanceof Node && el.contains(e.target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, root, close]);
}

/**
 * True for `ms` after `key` first shows, then false until a new key comes (the big-move line's
 * 4 s, §7.6). A local display timer: it never touches the game (§0.3).
 */
export function useFresh(key: string | null, ms: number): boolean {
  const [expired, setExpired] = useState<string | null>(null);
  useEffect(() => {
    if (key === null) return;
    const id = setTimeout(() => setExpired(key), ms);
    return () => clearTimeout(id);
  }, [key, ms]);
  return key !== null && expired !== key;
}
