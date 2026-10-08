/**
 * The step controls' icons (PLAN §12.10: first, back, forward, last and play), drawn here (§16.4:
 * art is drawn in code; never emoji or Unicode symbols, pitfall 31). Decorative: each button has
 * a text name.
 */
import type { ReactNode } from 'react';

const SHAPE = {
  fill: 'currentColor',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinejoin: 'round',
} as const;

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export const FirstIcon = () => (
  <Icon>
    <rect x="5" y="5.5" width="2.5" height="13" rx="1" {...SHAPE} />
    <polygon points="19 5.5 9.5 12 19 18.5" {...SHAPE} />
  </Icon>
);

export const PrevIcon = () => (
  <Icon>
    <polygon points="17 5.5 7 12 17 18.5" {...SHAPE} />
  </Icon>
);

export const NextIcon = () => (
  <Icon>
    <polygon points="7 5.5 17 12 7 18.5" {...SHAPE} />
  </Icon>
);

export const LastIcon = () => (
  <Icon>
    <polygon points="5 5.5 14.5 12 5 18.5" {...SHAPE} />
    <rect x="16.5" y="5.5" width="2.5" height="13" rx="1" {...SHAPE} />
  </Icon>
);

export const PlayIcon = () => (
  <Icon>
    <polygon points="8 5 19 12 8 19" {...SHAPE} />
  </Icon>
);

export const PauseIcon = () => (
  <Icon>
    <rect x="6.5" y="5" width="3.5" height="14" rx="1" {...SHAPE} />
    <rect x="14" y="5" width="3.5" height="14" rx="1" {...SHAPE} />
  </Icon>
);
