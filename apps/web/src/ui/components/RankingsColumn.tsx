/**
 * The hand-rankings column on wide screens (PLAN §13.1): persistent, `clamp(260px, 24vw, 320px)`
 * wide (the Table's grid sizes it), scrolling inside. It is not an overlay and never pauses the
 * game. Open by default at every coach level; the top-bar Hands button, K, or its own › button
 * collapse it to a 44 px rail with a vertical "Hands" button (`settings.handsPanel`).
 */
import { memo, useEffect, useId, useRef } from 'react';
import { en } from '../../i18n/en.ts';
import type { ByRiverView, HeroHandView } from '../views.ts';
import styles from './RankingsColumn.module.css';
import { RankingsList } from './RankingsList.tsx';
import { ICONS, SpriteIcon } from './SvgSprite.tsx';

export interface RankingsColumnProps {
  hero: HeroHandView | null;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  showTips?: boolean | undefined;
  /** The "By river" column (§13.2); null or absent = none. */
  byRiver?: ByRiverView | null | undefined;
  /** The "Which hand wins?" button (Advanced and Exam, §10.2). */
  whichWins?: boolean | undefined;
}

export const RankingsColumn = memo(function RankingsColumn({
  hero,
  collapsed,
  onCollapsedChange,
  showTips,
  byRiver,
  whichWins,
}: RankingsColumnProps) {
  const titleId = useId();
  const currentRowRef = useRef<HTMLLIElement>(null);
  const category = hero?.category;

  // Keep the hero's row in view as the hand changes.
  useEffect(() => {
    if (!collapsed && category !== undefined) {
      currentRowRef.current?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [category, collapsed]);

  if (collapsed) {
    return (
      <aside className={styles.rail} aria-label={en.rankings.title}>
        <button
          type="button"
          className={styles.railButton}
          aria-label={en.rankings.open}
          aria-expanded={false}
          onClick={() => onCollapsedChange(false)}
        >
          <span className={styles.railLabel}>{en.rankings.tab}</span>
        </button>
      </aside>
    );
  }
  return (
    <aside className={styles.column} aria-labelledby={titleId}>
      <header className={styles.header}>
        <h2 id={titleId} className={styles.title}>
          {en.rankings.title}
        </h2>
        <button
          type="button"
          className={styles.collapse}
          aria-label={en.rankings.collapse}
          aria-expanded={true}
          onClick={() => onCollapsedChange(true)}
        >
          <SpriteIcon id={ICONS.chevron} className={styles.icon} />
        </button>
      </header>
      <div className={styles.scroll}>
        <RankingsList
          hero={hero}
          cardSize="md"
          showTips={showTips}
          whichWins={whichWins}
          currentRowRef={currentRowRef}
          byRiver={byRiver}
        />
      </div>
    </aside>
  );
});
