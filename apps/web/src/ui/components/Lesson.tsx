/**
 * One lesson's picture and text (PLAN §12.1, Appendix F.8; chunk 9.2): the card picture first
 * (rows of `Card`s, each under its label; RB's SVG-masked cards, never Unicode suits), the line
 * under it, then the text: paragraphs, numbered steps, a plain list, or terms with their meaning.
 * Part of the lazy Learn chunk; the page around it is `ui/screens/Learn.tsx`.
 *
 * - The cards are examples, not dealt ones: the picture is a `data-examples` subtree (the E2E card
 *   watch skips it, as for the rankings panel).
 * - Screen readers (§12.12): the picture is a `figure` named by its line; each row is a group
 *   named by its label, each card by its name ("King of spades", "Hidden card"); where a row marks
 *   the best five, a card with the gold edge adds "part of your hand" and the others "does not
 *   count" (the eye sees the edge, §6.1). The price bar is an image named by both numbers.
 */
import { memo, useId, type CSSProperties } from 'react';
import { cardAriaLabel } from '../../core/cards.ts';
import type { DiagramGroup, Lesson, LessonBlock, LessonDiagram } from '../../data/lessons.ts';
import { en } from '../../i18n/en.ts';
import { learnWords as W } from '../../i18n/learn.ts';
import { diagramCards } from '../learn.ts';
import styles from '../screens/Learn.module.css';
import { Card } from './Card.tsx';

const cx = (...names: (string | false | undefined)[]): string => names.filter(Boolean).join(' ');

function Group({ group }: { group: DiagramGroup }) {
  const id = useId();
  return (
    <div
      role="group"
      aria-labelledby={id}
      className={cx(styles.group, group.mark === true && styles.mark)}
      data-mark={group.mark === true ? '' : undefined}
    >
      <p id={id} className={styles.groupLabel}>
        {group.label}
      </p>
      <div className={styles.cards}>
        {diagramCards(group).map(({ card, highlight, out }, i) => (
          <Card
            key={i}
            card={card}
            size="md"
            highlight={highlight}
            label={
              card === null
                ? undefined
                : highlight !== undefined
                  ? en.cards.yourHand(cardAriaLabel(card))
                  : out
                    ? W.notCounted(cardAriaLabel(card))
                    : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}

function PriceBar({ win, need }: { win: number; need: number }) {
  return (
    <div className={styles.price}>
      <div
        className={styles.bar}
        role="img"
        aria-label={W.priceLabel(win, need)}
        data-good={win >= need ? 'true' : 'false'}
        style={
          { '--win': (win / 100).toFixed(2), '--need': (need / 100).toFixed(2) } as CSSProperties
        }
      />
      <p className={styles.priceText} aria-hidden="true">
        {W.price(win, need)}
      </p>
    </div>
  );
}

/** The picture: its rows of cards, the price bar (lesson 6) and the line under it. */
export function LessonPicture({ diagram }: { diagram: LessonDiagram }) {
  const captionId = useId();
  return (
    <figure className={styles.picture} aria-labelledby={captionId} data-examples="">
      {diagram.groups.map((group) => (
        <Group key={group.label} group={group} />
      ))}
      {diagram.price !== undefined && (
        <PriceBar win={diagram.price.win} need={diagram.price.need} />
      )}
      <figcaption id={captionId} className={styles.caption}>
        {diagram.caption}
      </figcaption>
    </figure>
  );
}

function Block({ block }: { block: LessonBlock }) {
  if (typeof block === 'string') return <p className={styles.text}>{block}</p>;
  if ('steps' in block) {
    return (
      <ol className={styles.steps}>
        {block.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    );
  }
  if ('points' in block) {
    return (
      <ul className={styles.points}>
        {block.points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
    );
  }
  return (
    <dl className={styles.terms}>
      {block.terms.map(([term, meaning]) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{meaning}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A lesson's picture and text (its title is the page's heading). */
export const LessonView = memo(function LessonView({ lesson }: { lesson: Lesson }) {
  return (
    <>
      <LessonPicture diagram={lesson.diagram} />
      {lesson.body.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </>
  );
});
