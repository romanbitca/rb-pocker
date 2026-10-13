/**
 * The few line icons the screens use, drawn here (PLAN §16.4: art is drawn in code; never emoji
 * or Unicode symbols, pitfall 31). Decorative: the text next to each one says what it means.
 */

const LINE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.25,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** "Back". */
export function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <polyline points="15 5 8 12 15 19" {...LINE} />
    </svg>
  );
}

/** "Show more": Setup's "More options" (turned over while it is open). */
export function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <polyline points="5 9 12 16 19 9" {...LINE} />
    </svg>
  );
}

/** A tick: Welcome's bullets and the chosen level card. */
export function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <polyline points="5 12.5 10 17.5 19 7" {...LINE} />
    </svg>
  );
}
