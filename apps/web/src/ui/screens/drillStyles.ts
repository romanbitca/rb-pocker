/**
 * The hand drill's layout as inline styles (PLAN §13.5, §15.3): they travel in the drill's lazy
 * chunk, while the app's one stylesheet loads at first paint for everyone. `Drill.module.css` keeps
 * only what needs CSS (the animations, reduced motion, a media query, `:focus`), and the buttons
 * and sheets reuse the shared classes (`Levels.module.css` `.button`, `Screen.module.css`,
 * `Overlays.module.css`). RB's tokens throughout. Every control is a 44 px tap target (§12.12).
 */
import type { CSSProperties } from 'react';

/** One card's width: five cards and four gaps fill the felt (page and felt padding), up to 72 px. */
const CARD_W = 'min(72px, calc((100vw - 84px) / 5))';
/** Inside Which wins' hand buttons (their padding and border): a little smaller. */
const CARD_W_BUTTON = 'min(64px, calc((100vw - 104px) / 5))';

const caps: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

export const tally: CSSProperties = { display: 'flex', justifyContent: 'center', gap: 24 };
export const count: CSSProperties = {
  ...caps,
  display: 'grid',
  justifyItems: 'center',
  color: 'var(--muted)',
};
export const countValue: CSSProperties = {
  color: 'var(--text)',
  fontSize: '1.5rem',
  letterSpacing: 0,
  fontVariantNumeric: 'tabular-nums',
};

export const controls: CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 2,
  display: 'flex',
  gap: 8,
  padding: '8px 0',
  background: 'var(--bg)',
};
/** The game button grows; its name shortens with an ellipsis (it may shrink to 44 px, §12.12). */
export const gameButton: CSSProperties = {
  display: 'flex',
  flex: 1,
  alignItems: 'center',
  gap: 8,
  minWidth: 44,
  textAlign: 'left',
};
export const gameText: CSSProperties = { display: 'grid', flex: 1, minWidth: 0 };
export const ellipsis: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
export const accentCaps: CSSProperties = { ...caps, color: 'var(--accent)' };
export const icon18: CSSProperties = { display: 'block', flex: 'none', width: 18, height: 18 };

export const play: CSSProperties = { display: 'grid', gap: 12, scrollMarginTop: 64 };
/** The cards lie on the felt (the `felt` class gives its colour). */
export const stage: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  gap: 8,
  minHeight: 140,
  padding: '12px 8px',
  borderRadius: 'var(--radius-3)',
};
export const seat: CSSProperties = { ...caps, margin: 0, textAlign: 'center' };

const handBase: CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  gap: 8,
  paddingTop: 6,
  perspective: 900,
};
/** A row of cards (RB's `Card` at its `board` size, sized by these two properties). */
export const hand = {
  ...handBase,
  '--board-card-w': CARD_W,
  '--board-card-h': `calc(${CARD_W} * 1.4)`,
} as CSSProperties;
export const handInButton = {
  ...handBase,
  '--board-card-w': CARD_W_BUTTON,
  '--board-card-h': `calc(${CARD_W_BUTTON} * 1.4)`,
} as CSSProperties;

export const seats: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 };

/** A seat of a showdown or a hand of Which wins, before and after the answer. */
export type Outcome = 'win' | 'lose' | 'tie' | null;
const OUTCOME: Readonly<Record<Exclude<Outcome, null>, CSSProperties>> = {
  win: { border: '2px solid var(--grade-best)', background: 'rgb(47 191 113 / 18%)' },
  lose: { border: '2px solid var(--grade-big-mistake)', background: 'rgb(229 72 77 / 16%)' },
  tie: { border: '2px solid var(--accent)', background: 'rgb(245 197 66 / 16%)' },
};
export function box(outcome: Outcome, button = false): CSSProperties {
  return {
    display: 'grid',
    gap: 4,
    width: button ? '100%' : undefined,
    minWidth: button ? 44 : undefined,
    minHeight: button ? 44 : undefined,
    padding: 8,
    border: '2px dashed rgb(242 245 243 / 35%)',
    borderRadius: 'var(--radius-3)',
    background: 'none',
    color: 'var(--text)',
    font: 'inherit',
    cursor: button ? 'pointer' : undefined,
    ...(outcome === null ? {} : OUTCOME[outcome]),
  };
}
/** The outcome's tag colours in the showdown result ("Wins", "Loses", "Split"). */
export const tag = (outcome: Exclude<Outcome, null>): CSSProperties => ({
  ...OUTCOME[outcome],
  ...caps,
  padding: '0 6px',
  borderRadius: 'var(--radius-1)',
});

export const options: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))',
  gap: 8,
};

/** A choice button (on Levels' `.button`): plain, picked before the answer, right, or wrong. */
export type Pick = 'plain' | 'picked' | 'good' | 'bad';
const PICK: Readonly<Record<Pick, CSSProperties>> = {
  plain: { borderColor: 'var(--control-border)' },
  picked: { borderColor: 'var(--accent)', background: 'var(--accent)', color: 'var(--bg)' },
  good: { border: '2px solid var(--grade-best)' },
  bad: { border: '2px solid var(--grade-big-mistake)' },
};
/** `name`: a hand name to pick (text left, mark right); `option`: an answer; `big`: a big answer. */
export function choice(state: Pick, kind: 'name' | 'option' | 'big' = 'name'): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: kind === 'name' ? 'space-between' : 'center',
    gap: 4,
    minHeight: kind === 'big' ? 88 : 48,
    padding: '4px 12px',
    fontSize: kind === 'big' ? '1.25rem' : '1rem',
    fontWeight: kind === 'big' ? 700 : 600,
    textAlign: kind === 'name' ? 'left' : 'center',
    ...PICK[state],
  };
}
export const markGood: CSSProperties = { ...icon18, color: 'var(--grade-best)' };
export const markBad: CSSProperties = { ...icon18, color: 'var(--grade-big-mistake)' };

export const bigName: CSSProperties = {
  margin: 0,
  padding: '12px 0',
  fontSize: 'clamp(1.5rem, 8vw, 2.25rem)',
  fontWeight: 700,
  lineHeight: 1.15,
  textAlign: 'center',
};
export const direction: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  margin: 0,
};
export const center: CSSProperties = { display: 'flex', justifyContent: 'center' };

/** The showdown's result: each best five, the player's own two cards outlined. */
export const result: CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: '8px 12px',
  borderRadius: 'var(--radius-2)',
  background: 'rgb(15 21 18 / 55%)',
};
export const resultHead: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  gap: 8,
  margin: '0 0 4px',
};
export const who: CSSProperties = { ...caps, minWidth: 72 };
export const minis: CSSProperties = { display: 'flex', gap: 3 };
export const small: CSSProperties = { margin: 0, fontSize: 13 };

/** The feedback box: the left edge says right or wrong (with the words, never alone). */
export function feedback(result: boolean | null): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    minHeight: 70,
    padding: '8px 12px',
    borderLeft: `6px solid ${
      result === null
        ? 'var(--control-border)'
        : result
          ? 'var(--grade-best)'
          : 'var(--grade-big-mistake)'
    }`,
    borderRadius: 'var(--radius-3)',
    background: 'var(--surface)',
  };
}
export const lines: CSSProperties = { display: 'grid', flex: 1, gap: 2, minWidth: 0 };
export const first: CSSProperties = { margin: 0, fontWeight: 700 };
export const second: CSSProperties = { margin: 0, color: 'var(--muted)', fontSize: '0.9375rem' };
export const trapTag: CSSProperties = {
  ...caps,
  marginLeft: 8,
  padding: '1px 6px',
  borderRadius: 'var(--radius-1)',
  background: 'var(--accent)',
  color: 'var(--bg)',
  fontSize: 11,
  verticalAlign: 2,
};
/** Next (on Screen's `.primary`): not full width, a little lower. */
export const next: CSSProperties = {
  flex: 'none',
  width: 'auto',
  minHeight: 48,
  padding: '0 18px',
  borderRadius: 'var(--radius-2)',
  fontSize: '1rem',
};

export const label: CSSProperties = {
  ...caps,
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  margin: '0 0 8px',
  color: 'var(--muted)',
};
export const labelNote: CSSProperties = {
  fontWeight: 500,
  letterSpacing: 0,
  textTransform: 'none',
};
export const names: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 };
export const chips: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(5, 1fr)',
  gap: '12px 4px',
  justifyItems: 'center',
};

/** A poker chip: a white face, its edge spots the dashed border over the colour. */
export function chip(state: Pick, size = 52): CSSProperties {
  const ring =
    state === 'picked'
      ? 'var(--accent)'
      : state === 'good'
        ? 'var(--grade-best)'
        : state === 'bad'
          ? 'var(--grade-big-mistake)'
          : null;
  return {
    display: 'inline-grid',
    placeItems: 'center',
    width: size,
    height: size,
    padding: 0,
    border: `${Math.round(size / 11)}px dashed rgb(255 255 255 / 85%)`,
    borderRadius: '50%',
    background: 'radial-gradient(circle, var(--card-face) 0 56%, var(--avatar-0) 57%)',
    boxShadow: '0 3px 0 rgb(0 0 0 / 35%)',
    color: '#111',
    font: `700 ${Math.round(size * 0.36)}px/1 var(--font-family)`,
    fontVariantNumeric: 'tabular-nums',
    cursor: size === 52 ? 'pointer' : 'default',
    outline: ring === null ? undefined : `3px solid ${ring}`,
    outlineOffset: ring === null ? undefined : 2,
    opacity: state === 'bad' ? 0.8 : undefined,
    touchAction: 'manipulation',
  };
}

// ---- Sheets ----

export const sheetText: CSSProperties = {
  margin: 0,
  color: 'var(--muted)',
  fontSize: '0.875rem',
  fontWeight: 400,
};
export const gameOption: CSSProperties = {
  display: 'grid',
  gap: 2,
  padding: '8px 16px',
  border: '1px solid transparent',
};
export const gameOptionOn: CSSProperties = {
  ...gameOption,
  borderColor: 'var(--accent)',
  background: 'rgb(245 197 66 / 16%)',
};
export const spread: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 8,
};
export const statRow: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '36px 1fr',
  gap: 12,
  alignItems: 'center',
  padding: '8px 0',
  borderTop: '1px solid rgb(242 245 243 / 10%)',
};
export const statList: CSSProperties = { margin: 0, padding: 0, listStyle: 'none' };
export const statText: CSSProperties = { display: 'grid', gap: 6 };
export const numbers: CSSProperties = { fontWeight: 600, fontVariantNumeric: 'tabular-nums' };
export const numbersSmall: CSSProperties = {
  marginLeft: 4,
  color: 'var(--muted)',
  fontSize: 13,
  fontWeight: 400,
};
export const bar: CSSProperties = {
  display: 'block',
  height: 6,
  overflow: 'hidden',
  borderRadius: 3,
  background: 'var(--bg)',
};
/** The accuracy bar: red below 60%, gold below 85%, else green (the number says it too). */
export function barFill(pct: number): CSSProperties {
  return {
    display: 'block',
    width: `${pct}%`,
    height: '100%',
    background:
      pct < 60 ? 'var(--grade-big-mistake)' : pct < 85 ? 'var(--accent)' : 'var(--grade-best)',
  };
}
export const sheetButtons: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8 };
export const resetButton: CSSProperties = { borderColor: 'var(--grade-big-mistake)' };
