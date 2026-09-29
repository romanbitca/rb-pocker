/**
 * The app's one SVG sprite (PLAN §2.5 "Art", §13.4, §15.3 "one SVG sprite"). Render it once, at the
 * top of the app; everything else draws with `<use href="#id">`.
 *
 * ⚠️ Suits are SVG paths, never the Unicode suit characters U+2660–U+2667: those can render as
 * emoji (PLAN pitfall 31). Hearts and clubs differ by shape as well as colour (§12.12).
 */
import { memo } from 'react';

/** Sprite ids for the suits, indexed by `Suit` (0 clubs, 1 diamonds, 2 hearts, 3 spades). */
export const SUIT_SYMBOLS = ['s-c', 's-d', 's-h', 's-s'] as const;

/** Other sprite ids. */
export const ICONS = {
  chip: 'i-chip',
  close: 'i-close',
  rock: 'p-rock',
  tag: 'p-tag',
  lag: 'p-lag',
  station: 'p-station',
  maniac: 'p-maniac',
} as const;

/** `<use>` for a sprite symbol, filled with the current text colour. */
export function SpriteIcon({ id, className }: { id: string; className?: string | undefined }) {
  return (
    <svg className={className} aria-hidden="true" focusable="false">
      <use href={`#${id}`} />
    </svg>
  );
}

export const SvgSprite = memo(function SvgSprite() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="0"
      height="0"
      style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
    >
      {/* Clubs: three leaves and a stem. */}
      <symbol id="s-c" viewBox="0 0 24 24">
        <path
          fill="currentColor"
          d="M12 1.9a4.6 4.6 0 0 1 3.9 7 4.6 4.6 0 1 1-2.2 7.5l1.1 5.7H9.2l1.1-5.7a4.6 4.6 0 1 1-2.2-7.5A4.6 4.6 0 0 1 12 1.9Z"
        />
      </symbol>
      {/* Diamonds: a rhombus with gently curved sides. */}
      <symbol id="s-d" viewBox="0 0 24 24">
        <path
          fill="currentColor"
          d="M12 1.5c2.2 3.6 4.8 6.9 8 10.5-3.2 3.6-5.8 6.9-8 10.5-2.2-3.6-4.8-6.9-8-10.5 3.2-3.6 5.8-6.9 8-10.5Z"
        />
      </symbol>
      {/* Hearts. */}
      <symbol id="s-h" viewBox="0 0 24 24">
        <path
          fill="currentColor"
          d="M12 21.6C8.4 18.6 2.2 14 2.2 8.4 2.2 5.3 4.6 3 7.5 3c2 0 3.6 1 4.5 2.7C12.9 4 14.5 3 16.5 3c2.9 0 5.3 2.3 5.3 5.4 0 5.6-6.2 10.2-9.8 13.2Z"
        />
      </symbol>
      {/* Spades: an upside-down heart with a stem. */}
      <symbol id="s-s" viewBox="0 0 24 24">
        <path
          fill="currentColor"
          d="M12 1.6c3.4 3.4 9.6 7.6 9.6 12.4 0 2.8-2.1 4.9-4.8 4.9-1.5 0-2.8-.6-3.6-1.7l1.1 4.7H9.7l1.1-4.7c-.8 1.1-2.1 1.7-3.6 1.7-2.7 0-4.8-2.1-4.8-4.9 0-4.8 6.2-9 9.6-12.4Z"
        />
      </symbol>

      {/* A poker chip: a disc with notches and a centre ring. */}
      <symbol id="i-chip" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="11" fill="#f2f5f3" />
        <circle
          cx="12"
          cy="12"
          r="11"
          fill="none"
          stroke="#c8102e"
          strokeWidth="4"
          strokeDasharray="4.32 4.32"
        />
        <circle cx="12" cy="12" r="6" fill="#c8102e" />
        <circle cx="12" cy="12" r="4" fill="#f2f5f3" />
      </symbol>
      {/* Close (✕), drawn: never a text glyph. */}
      <symbol id="i-close" viewBox="0 0 24 24">
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          d="M6 6l12 12M18 6 6 18"
        />
      </symbol>

      {/* Personality badges (PLAN §12.4, F.6): shape, not colour, tells them apart (§12.12). */}
      {/* Careful: a shield. */}
      <symbol id="p-rock" viewBox="0 0 24 24">
        <path
          fill="currentColor"
          d="M12 2.5 20 5.6v5.6c0 5-3.4 9-8 10.8-4.6-1.8-8-5.8-8-10.8V5.6Z"
        />
      </symbol>
      {/* Solid: a check mark. */}
      <symbol id="p-tag" viewBox="0 0 24 24">
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="m4.5 12.5 5 5 10-11"
        />
      </symbol>
      {/* Aggressive: an arrow up. */}
      <symbol id="p-lag" viewBox="0 0 24 24">
        <path fill="currentColor" d="M12 2.5 21 12h-5.5v9.5h-7V12H3Z" />
      </symbol>
      {/* Calls a lot: an equals sign (matching the bet). */}
      <symbol id="p-station" viewBox="0 0 24 24">
        <path fill="currentColor" d="M3.5 6.5h17v4h-17Zm0 7h17v4h-17Z" />
      </symbol>
      {/* Wild: a lightning bolt. */}
      <symbol id="p-maniac" viewBox="0 0 24 24">
        <path fill="currentColor" d="M13.5 1.5 4 13.5h6.5l-2 9 11-13h-6.8Z" />
      </symbol>
    </svg>
  );
});
