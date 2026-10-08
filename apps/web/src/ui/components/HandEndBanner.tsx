/**
 * The hand-end banner (PLAN §12.9): who won what, at the table centre, until the next hand starts
 * (3 s, or at once on a tap; with "Deal the next hand by itself" off it waits for the tap). The
 * whole banner is one button, so it is easy to hit on a phone; "Next hand ›" says what it does.
 * A polite live region announces the result. Under it, "Review this hand" (§12.10) opens the
 * replay of the hand that just ended; leaving the table pauses the game, so the 3 s wait stops.
 */
import { memo, type CSSProperties } from 'react';
import { en } from '../../i18n/en.ts';
import styles from './HandEndBanner.module.css';
import { ICONS, SpriteIcon } from './SvgSprite.tsx';

export interface HandEndBannerProps {
  /** `handEndLines()` (ui/handEnd.ts): the winner line first. */
  lines: readonly string[];
  onNext: () => void;
  /** "Review this hand": the replay of this hand (Review, §12.10). Without it no link shows. */
  onReview?: (() => void) | undefined;
  /** Landscape's right column (§12.5): less room, so less padding. */
  side?: boolean | undefined;
  style?: CSSProperties | undefined;
  className?: string | undefined;
}

export const HandEndBanner = memo(function HandEndBanner({
  lines,
  onNext,
  onReview,
  side,
  style,
  className,
}: HandEndBannerProps) {
  return (
    <div
      className={[styles.holder, side === true && styles.side, className].filter(Boolean).join(' ')}
      style={style}
    >
      <div role="status">
        <button type="button" className={styles.banner} onClick={() => onNext()} data-hand-end="">
          {lines.map((line, i) => (
            <span key={i} className={i === 0 ? styles.main : styles.line}>
              {line}
            </span>
          ))}
          <span className={styles.next}>
            {en.handEnd.nextHand}
            <SpriteIcon id={ICONS.chevron} className={styles.chevron} />
          </span>
        </button>
      </div>
      {onReview !== undefined && (
        <button
          type="button"
          className={styles.review}
          onClick={() => onReview()}
          data-hand-review=""
        >
          {en.handEnd.review}
        </button>
      )}
    </div>
  );
});
