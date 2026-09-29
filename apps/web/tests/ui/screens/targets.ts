/**
 * Tap-target checks for the screens (PLAN §12.12: primary buttons ≥ 56 px tall, every other
 * control ≥ 44×44 px). jsdom has no layout, so a control must declare its size in CSS; the CSS
 * modules are injected (vitest.config.ts) and a test imports tokens.css for the `--tap-*` values,
 * which are resolved here because jsdom does not substitute `var()`.
 */

/** Elements a finger or a keyboard can use. */
const INTERACTIVE =
  'button, a[href], input, select, textarea, summary, [role="button"], [tabindex]:not([tabindex="-1"])';

/** px of a computed value: "44px", or `var(--name[, fallback])` looked up on `el`. */
function px(el: Element, value: string): number {
  const v = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(value.trim());
  if (v) {
    const custom = getComputedStyle(el)
      .getPropertyValue(v[1] ?? '')
      .trim();
    return px(el, custom !== '' ? custom : (v[2] ?? ''));
  }
  return value.trim().endsWith('px') ? parseFloat(value) : 0;
}

/** The larger of `width` / `min-width` and of `height` / `min-height`, in px. */
export function declaredSize(el: Element): { w: number; h: number } {
  const cs = getComputedStyle(el);
  return {
    w: Math.max(px(el, cs.width), px(el, cs.minWidth)),
    h: Math.max(px(el, cs.height), px(el, cs.minHeight)),
  };
}

/** What a finger hits: a radio or checkbox laid over its label is as big as the label. */
export function tapTarget(el: Element): Element {
  if (el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox')) {
    return el.labels?.[0] ?? el;
  }
  return el;
}

const nameOf = (el: Element): string =>
  (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName).trim().slice(0, 40);

/**
 * Controls under `root` below the §12.12 sizes, as readable lines ([] when all pass).
 * `isPrimary` marks the controls that need 56 px of height.
 */
export function smallTargets(root: ParentNode, isPrimary: (el: Element) => boolean): string[] {
  return [...root.querySelectorAll(INTERACTIVE)].flatMap((el) => {
    const target = tapTarget(el);
    const { w, h } = declaredSize(target);
    const minH = isPrimary(el) ? 56 : 44;
    return w >= 44 && h >= minH ? [] : [`"${nameOf(target)}" is ${w}×${h}, needs 44×${minH}`];
  });
}

/** A CSS module's class name; throws when it is missing (so a check cannot pass by accident). */
export function cssClass(styles: Readonly<Record<string, string>>, name: string): string {
  const value = styles[name];
  if (value === undefined || value === '') throw new Error(`no .${name} in this CSS module`);
  return value;
}

/** How many controls `smallTargets` looked at (so a test can see it checked something). */
export function controlCount(root: ParentNode): number {
  return root.querySelectorAll(INTERACTIVE).length;
}
