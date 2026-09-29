/**
 * The hand-end banner (PLAN §12.9): who won what, at the table centre, until the next hand starts
 * (3 s, or at once on a tap; with "Deal the next hand by itself" off it waits for the tap). The
 * whole banner is one button, so it is easy to hit on a phone; "Next hand ›" says what it does.
 * A polite live region announces the result.
 */
import { memo, type CSSProperties } from 'react';
import { en } from '../../i18n/en.ts';
import styles from './HandEndBanner.module.css';
import { ICONS, SpriteIcon } from './SvgSprite.tsx';

export interface HandEndBannerProps {
  /** `handEndLines()` (ui/handEnd.ts): the winner line first. */
  lines: readonly string[];
  onNext: () => void;
  style?: CSSProperties | undefined;
  className?: string | undefined;
}

export const HandEndBanner = memo(function HandEndBanner({
  lines,
  onNext,
  style,
  className,
}: HandEndBannerProps) {
  return (
    <div
      role="status"
      className={[styles.holder, className].filter(Boolean).join(' ')}
      style={style}
    >
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
  );
});
