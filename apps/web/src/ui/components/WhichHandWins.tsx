/**
 * "Which hand wins?" (PLAN §13.2, §10.2 Advanced and Exam; chunk 6.4): two random 5-card hands;
 * the player taps the winner and gets the answer at once, with the rule that decided it (the
 * rankings footer's words). The score is kept in memory only, for this visit.
 *
 * The two hands never tie (a tie is drawn again: "which wins" needs a winner). The cards are
 * examples, not dealt ones: the panel's `data-examples` subtree holds them (the E2E card watch).
 * Part of a lazy chunk: the rankings panel loads it on the first tap of its button.
 */
import { memo, useMemo, useState } from 'react';
import { dealPair, type WhichPair } from '../../app/store.ts';
import { cardAriaLabel } from '../../core/cards.ts';
import { RANKINGS } from '../../data/rankings.ts';
import type { HandCategory } from '../../eval/evaluate.ts';
import { en } from '../../i18n/en.ts';
import { whichWinsWords as W } from '../../i18n/whichWins.ts';
import { Card } from './Card.tsx';
import s from './Levels.module.css';

const cx = (...names: (string | false | undefined)[]): string => names.filter(Boolean).join(' ');

const nameOf = (category: HandCategory): string =>
  RANKINGS.find((r) => r.key === category)?.name ?? category;

/** The rule that decided it: "Flush beats straight. A higher row always beats a lower row." */
export function ruleText(pair: WhichPair): string {
  const winner = pair.categories[pair.winner];
  const loser = pair.categories[pair.winner === 0 ? 1 : 0];
  const [higherRow, sameRow] = en.rankings.footer;
  if (winner !== loser)
    return `${W.beats(nameOf(winner), nameOf(loser).toLowerCase())} ${higherRow}`;
  return `${W.same(nameOf(winner).toLowerCase())} ${sameRow}`;
}

/** The score of this visit (§13.2: in memory only). */
const score = { right: 0, asked: 0 };

export const WhichHandWins = memo(function WhichHandWins({ onClose }: { onClose: () => void }) {
  const [pair, setPair] = useState<WhichPair>(() => dealPair());
  const [picked, setPicked] = useState<0 | 1 | null>(null);
  const winner = pair.winner;
  const rule = useMemo(() => ruleText(pair), [pair]);

  const pick = (i: 0 | 1): void => {
    if (picked !== null) return;
    setPicked(i);
    score.asked++;
    if (i === winner) score.right++;
  };
  const again = (): void => {
    setPair(dealPair());
    setPicked(null);
  };

  return (
    <section className={s.which} aria-label={en.rankings.whichWins} data-which-wins="">
      <p className={s.bold}>{W.ask}</p>
      {pair.hands.map((hand, i) => (
        <button
          key={i}
          type="button"
          className={cx(
            s.button,
            s.hand,
            picked !== null && i === winner && s.winner,
            picked === i && s.picked,
          )}
          aria-label={W.hand(i + 1, hand.map(cardAriaLabel).join(', '))}
          aria-pressed={picked === null ? undefined : picked === i}
          onClick={() => pick(i as 0 | 1)}
          data-which-hand={i}
        >
          <span className={s.cards}>
            {hand.map((card) => (
              <Card key={card} card={card} size="sm" />
            ))}
          </span>
          {picked !== null && nameOf(pair.categories[i] as HandCategory)}
        </button>
      ))}
      <p className={s.muted} role="status">
        {picked === null ? '' : `${picked === winner ? W.right : W.wrong} ${rule}`}
      </p>
      <div className={s.row}>
        <span className={cx(s.grow, s.muted)}>
          {score.asked > 0 ? W.score(score.right, score.asked) : ''}
        </span>
        {picked !== null && (
          <button type="button" className={s.button} onClick={again} data-which-next="">
            {W.next}
          </button>
        )}
        <button type="button" className={s.button} onClick={onClose}>
          {W.close}
        </button>
      </div>
    </section>
  );
});
