/**
 * The ten hand-ranking rows and the tie-break footer (PLAN §13.2–§13.4): shared by the phone drawer,
 * the wide-screen column (and later the Learn page).
 *
 * Each row: rank number, name, 5 mini cards (kickers at 45%), a one-line tip, and how often it
 * happens (7-card odds). Live highlight (§13.3): the hero's row gets `aria-current="true"`, an
 * accent background, a "You" badge and a second line with the hero's actual best five; rows above
 * say "beats you", rows below "you beat"; after a fold the row turns grey with "You folded".
 * Tapping a row shows its details (Appendix F.7).
 */
import { memo, useState, type Ref } from 'react';
import { RANKINGS } from '../../data/rankings.ts';
import { en } from '../../i18n/en.ts';
import {
  exampleCards,
  formatOneIn,
  formatRarity,
  rowLabel,
  rowStatus,
  useImprovementPulse,
  youLine,
  type RowStatus,
} from '../rankings.ts';
import type { HeroHandView } from '../views.ts';
import { Card } from './Card.tsx';
import styles from './RankingsList.module.css';

export interface RankingsListProps {
  hero: HeroHandView | null;
  /** Mini cards: `sm` 24×34 in the phone drawer, `md` 30×42 in the wide column (§13.4). */
  cardSize: 'sm' | 'md';
  /** Tips shown (default); Intermediate collapses them (§10.2). */
  showTips?: boolean | undefined;
  /** Receives the highlighted row, so the drawer can scroll it into view. */
  currentRowRef?: Ref<HTMLLIElement> | undefined;
}

const join = (...names: (string | false | null | undefined)[]): string =>
  names.filter(Boolean).join(' ');

const STATUS_CLASS: Record<Exclude<RowStatus, null>, string | undefined> = {
  you: styles.you,
  folded: styles.folded,
  beatsYou: styles.beatsYou,
  youBeat: styles.youBeat,
};

function Caption({ status }: { status: RowStatus }) {
  const R = en.rankings;
  switch (status) {
    case 'you':
      return <span className={styles.badge}>{R.you}</span>;
    case 'folded':
      return <span className={join(styles.badge, styles.badgeFolded)}>{R.youFolded}</span>;
    case 'beatsYou':
      return <span className={styles.caption}>{R.beatsYou}</span>;
    case 'youBeat':
      return <span className={styles.caption}>{R.youBeat}</span>;
    default:
      return null;
  }
}

export const RankingsList = memo(function RankingsList({
  hero,
  cardSize,
  showTips = true,
  currentRowRef,
}: RankingsListProps) {
  const [openRow, setOpenRow] = useState<number | null>(null);
  const pulses = useImprovementPulse(hero);
  return (
    // `data-examples`: the rows name example cards (not dealt ones); the E2E bot-card watch
    // (tests/e2e/game.ts, Stage 3 acceptance 7) skips this subtree.
    <div className={join(styles.list, cardSize === 'md' && styles.wide)} data-examples="">
      <ol className={styles.rows}>
        {RANKINGS.map((row, i) => {
          const status = rowStatus(i, hero);
          const mine = status === 'you' || status === 'folded';
          const expanded = openRow === i;
          return (
            <li
              key={row.key}
              className={join(styles.row, status !== null && STATUS_CLASS[status])}
              data-category={row.key}
              aria-current={mine ? 'true' : undefined}
              ref={mine ? currentRowRef : undefined}
            >
              {status === 'you' && pulses > 0 && <span key={pulses} className={styles.pulse} />}
              <button
                type="button"
                className={styles.rowButton}
                aria-expanded={expanded}
                aria-label={rowLabel(i, status)}
                onClick={() => setOpenRow(expanded ? null : i)}
              >
                <span className={styles.rank}>{i + 1}</span>
                <span className={styles.title}>
                  <span className={styles.name}>{row.name}</span>
                  <Caption status={status} />
                </span>
                <span className={styles.rarity}>{formatRarity(row.rarity)}</span>
                <span className={styles.cards}>
                  {exampleCards(row).map(({ card, dim }) => (
                    <Card key={card} card={card} size={cardSize} dim={dim} />
                  ))}
                </span>
                <span className={styles.oneIn}>{formatOneIn(row.oneIn)}</span>
                {showTips && <span className={styles.tip}>{row.tip}</span>}
              </button>
              {mine && hero !== null && (
                <div className={styles.youLine}>
                  <span className={styles.youLabel}>{en.rankings.yourCards}</span>
                  <span className={styles.cards}>
                    {youLine(hero).map(({ card, used, dim }) => (
                      <Card key={card} card={card} size={cardSize} used={used} dim={dim} />
                    ))}
                  </span>
                </div>
              )}
              {expanded && <p className={styles.detail}>{row.detail}</p>}
            </li>
          );
        })}
      </ol>
      <ul className={styles.footer}>
        {en.rankings.footer.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
});
