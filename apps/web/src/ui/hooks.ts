/**
 * Small DOM hooks for the Table screen: a media query and an element's size (both degrade where
 * the API is missing, as in jsdom: `matchMedia` → false, `ResizeObserver` → window `resize`
 * events), a popover's dismissal, and a line that shows for a few seconds.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
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
