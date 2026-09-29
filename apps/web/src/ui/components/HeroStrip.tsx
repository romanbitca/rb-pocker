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
 * The win badge (Stage 4) and the draw chips (Stage 4) join the strip later.
 */
import { memo, useId } from 'react';
import type { HeroView } from '../../app/store.ts';
import { en } from '../../i18n/en.ts';
import { formatChips } from '../format.ts';
import { Card } from './Card.tsx';
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
        className={styles.dealt}
      />
      <Card
        card={hero.hole[1].card}
        size={size}
        highlight={hero.hole[1].highlight}
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
      <span className={styles.stack}>{en.table.heroChips(formatChips(hero.stack))}</span>
      {marker !== null && (
        <span className={cx(styles.marker, hero.dealer && styles.dealer)}>{marker}</span>
      )}
      {hero.allIn && !hero.folded && <span className={styles.tag}>{en.table.allIn}</span>}
    </span>
  );
});

export interface HeroLabelProps {
  hero: HeroView;
  /** Opens the hand rankings (the drawer, or the wide column). */
  onOpenRankings: () => void;
  className?: string | undefined;
}

/** `describe()`'s label and sub-label; "You folded" once the hero has folded. */
export const HeroLabel = memo(function HeroLabel({
  hero,
  onOpenRankings,
  className,
}: HeroLabelProps) {
  const hintId = useId();
  const sub = hero.folded ? en.table.folded : hero.subLabel;
  return (
    <span className={cx(styles.labelBox, className)}>
      <button
        type="button"
        className={cx(styles.label, hero.folded && styles.labelFolded)}
        aria-describedby={hintId}
        aria-haspopup="dialog"
        data-hero-label=""
        onClick={(e) => {
          e.currentTarget.focus();
          onOpenRankings();
        }}
      >
        <span className={styles.name} data-hero-name="">
          {hero.label}
        </span>
        {sub !== null && <span className={styles.sub}>{sub}</span>}
      </button>
      <span id={hintId} hidden>
        {en.table.labelHint}
      </span>
    </span>
  );
});
