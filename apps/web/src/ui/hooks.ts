/**
 * Small DOM hooks for the Table screen: a media query and an element's size. Both degrade where
 * the API is missing (jsdom, old engines): `matchMedia` → false, `ResizeObserver` → window
 * `resize` events.
 */
import {
  useCallback,
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
