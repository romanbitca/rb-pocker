/**
 * The hero's hand (PLAN §12.3 "Hero strip", §12.5): the hole cards with the §6.1 highlights, "You ·
 * 2,340" with the dealer disc or blind tag, and `describe()`'s label and sub-label (computed on the
 * main thread in the same state as the cards, so they appear in the same frame, §15.3).
 *
 * The pieces are separate because the layouts place them apart: in portrait and on wide screens
 * the strip holds all of them (the cards reach up into the felt); in landscape the cards sit inset
 * at the bottom of the felt and the label heads the right-hand column.
 *
 * The label is a button: it opens the hand rankings at the highlighted row (§12.3). Safari does not
 * focus a tapped button, so it focuses itself first and the drawer can return focus to it (§13.1).
 * The win badge and the draw chips (`WinBadge.tsx`, `DrawChips.tsx`) sit beside and under it.
 */
import { memo, useId, useRef } from 'react';
import type { HeroView } from '../../app/store.ts';
import { en } from '../../i18n/en.ts';
import { formatChips } from '../format.ts';
import { useFit } from '../hooks.ts';
import { Card, cardViewLabel } from './Card.tsx';
import styles from './HeroStrip.module.css';

const cx = (...names: (string | false | null | undefined)[]): string =>
  names.filter(Boolean).join(' ');

export interface HeroCardsProps {
  hero: HeroView;
  /** `xxl` 64×90 (the design size); `xl` 52×74 in compact mode (§12.3). */
  size: 'xl' | 'xxl';
  className?: string | undefined;
}

/**
 * The two hole cards, the second overlapping the first by 30%. Mount it with `key={handSeq}`: a
 * new hand remounts it and the deal animation plays once.
 */
export const HeroCards = memo(function HeroCards({ hero, size, className }: HeroCardsProps) {
  return (
    <span
      className={cx(
        styles.cards,
        styles[size],
        hero.folded && styles.folded,
        hero.toAct && styles.toAct,
        className,
      )}
      data-hero-cards=""
    >
      <Card
        card={hero.hole[0].card}
        size={size}
        highlight={hero.hole[0].highlight}
        label={cardViewLabel(hero.hole[0])}
        className={styles.dealt}
      />
      <Card
        card={hero.hole[1].card}
        size={size}
        highlight={hero.hole[1].highlight}
        label={cardViewLabel(hero.hole[1])}
        className={cx(styles.dealt, styles.second)}
      />
    </span>
  );
});

/** "You · 2,340", the dealer disc or blind tag, and "All-in". */
export const HeroChips = memo(function HeroChips({ hero }: { hero: HeroView }) {
  const marker = hero.dealer
    ? en.seat.dealer
    : hero.blind === 'sb'
      ? en.seat.smallBlind
      : hero.blind === 'bb'
        ? en.seat.bigBlind
        : null;
  return (
    <span className={styles.chips}>
      <span data-hero-stack="">{en.table.heroChips(formatChips(hero.stack))}</span>
      {marker !== null && (
        <span className={cx(styles.marker, hero.dealer && styles.dealer)}>{marker}</span>
      )}
      {hero.allIn && !hero.folded && <span className={styles.tag}>{en.table.allIn}</span>}
    </span>
  );
});

/** "You · 975" with no cards: a seat at a table of the server's that sits this hand out (§19.10). */
export const HeroStackOnly = memo(function HeroStackOnly({ stack }: { stack: number }) {
  return (
    <span className={styles.chips}>
      <span data-hero-stack="">{en.table.heroChips(formatChips(stack))}</span>
    </span>
  );
});

export interface HeroLabelProps {
  hero: HeroView;
  /** No hand can beat the hero's (§6.5): " · Best possible hand" after the sub-label. */
  nuts?: boolean | undefined;
  /** Opens the hand rankings (the drawer, or the wide column). */
  onOpenRankings: () => void;
  /**
   * Compact mode's 96 px strip (§12.3): a smaller name and a one-line sub-label. 'column': the same
   * sizes in the landscape column below 390 px of height, where the name keeps three lines and,
   * below 340 px, the sub-label is for screen readers only (§12.5 notes of 1.3.91).
   */
  compact?: boolean | 'column' | undefined;
  className?: string | undefined;
}

/** Hand names longer than this many characters are drawn smaller (`data-long`). */
export const LONG_LABEL = 16;

/** A name's forms, longest first: "Full House, Queens full of Sevens", "Full House". */
function nameForms(label: string): readonly string[] {
  const comma = label.indexOf(',');
  return comma === -1 ? [label] : [label, label.slice(0, comma)];
}

/**
 * A sub-label's forms, longest first; '' (no line) is the last. Nothing is ever cut with "…": the
 * label picks the first that fits its room (`useFit`, 1.3.100). Screen readers read the hand
 * name; the rows of the rankings and the coach sheet have the whole words.
 */
function subForms(hero: HeroView, nuts: boolean): readonly string[] {
  if (hero.folded) return [en.table.folded];
  const sub = hero.subLabel;
  if (sub === null) return [];
  const forms = nuts ? [sub + en.table.nuts, en.table.nutsAlone] : [sub, en.table.subShort[sub]];
  return [...forms, ''].filter((f, i, all): f is string => f !== undefined && all.indexOf(f) === i);
}

/** `describe()`'s label and sub-label; "You folded" once the hero has folded. */
export const HeroLabel = memo(function HeroLabel({
  hero,
  nuts = false,
  onOpenRankings,
  compact = false,
  className,
}: HeroLabelProps) {
  const hintId = useId();
  const box = useRef<HTMLSpanElement>(null);
  const names = nameForms(hero.label);
  const name = useFit<HTMLSpanElement>(names, 'height');
  const subs = subForms(hero, nuts);
  // The sub-label gives way when its own lines fit but the label would leave its row of the
  // strip (a long name and a long sub-label at Large text ran into the coach strip below).
  const sub = useFit<HTMLSpanElement>(subs, 'height', {
    box: () => box.current,
    extraKey: names[name.index] ?? '',
  });
  const subWords = subs[sub.index] ?? '';
  return (
    <span ref={box} className={cx(styles.labelBox, className)}>
      <button
        type="button"
        className={cx(styles.label, hero.folded && styles.labelFolded)}
        aria-describedby={hintId}
        aria-haspopup="dialog"
        data-hero-label=""
        // A long name ("Two Pair, Queens and Twos") takes a smaller size, so the label stays in
        // the hero strip on a phone and never runs into the coach strip under it.
        data-long={hero.label.length > LONG_LABEL ? '' : undefined}
        data-compact={compact === 'column' ? 'column' : compact ? '' : undefined}
        onClick={(e) => {
          e.currentTarget.focus();
          onOpenRankings();
        }}
      >
        <span
          ref={name.ref}
          className={styles.name}
          data-hero-name=""
          data-tight={name.tight ? '' : undefined}
        >
          {names[name.index]}
        </span>
        {subWords !== '' && (
          <span ref={sub.ref} className={styles.sub} data-hero-sub="">
            {subWords}
          </span>
        )}
      </button>
      <span id={hintId} hidden>
        {en.table.labelHint}
      </span>
    </span>
  );
});
