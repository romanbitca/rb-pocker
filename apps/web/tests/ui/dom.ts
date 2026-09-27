/** DOM checks shared by the UI tests (jsdom; CSS modules are injected, see vitest.config.ts). */

/** The Unicode suit characters U+2660–U+2667, which can render as emoji (PLAN pitfall 31). */
export const SUIT_CODE_POINTS = /[♠-♧]/u;

/** Elements a finger or a keyboard can use. */
const INTERACTIVE =
  'button, a[href], input, select, textarea, summary, [role="button"], [tabindex]:not([tabindex="-1"])';

const px = (value: string): number => (value.endsWith('px') ? parseFloat(value) : 0);

/**
 * The size an element's own CSS gives it: the larger of `width` / `min-width` and of `height` /
 * `min-height` (jsdom has no layout, so interactive elements must declare their size in px).
 */
export function declaredSize(el: Element): { w: number; h: number } {
  const cs = getComputedStyle(el);
  return {
    w: Math.max(px(cs.width), px(cs.minWidth)),
    h: Math.max(px(cs.height), px(cs.minHeight)),
  };
}

/** Interactive elements under `root` smaller than `min`×`min` px (PLAN §12.12), as descriptions. */
export function smallTapTargets(root: ParentNode, min = 44): string[] {
  return [...root.querySelectorAll(INTERACTIVE)].flatMap((el) => {
    const { w, h } = declaredSize(el);
    if (w >= min && h >= min) return [];
    const name = el.getAttribute('aria-label') ?? el.textContent ?? el.tagName;
    return [`${el.tagName.toLowerCase()} "${name.trim()}" is ${w}×${h}`];
  });
}

/** How many interactive elements are under `root`. */
export function interactiveCount(root: ParentNode): number {
  return root.querySelectorAll(INTERACTIVE).length;
}
