/**
 * The Advanced quiz in the coach's place (PLAN §10.3, chunk 6.4): before the hero acts, three taps
 * (two when there is no bet to face): "Your win chance is about…" in four bands, "You need
 * about…" in four bands (facing a bet only), "Best move?" Fold, Check/Call or Bet/Raise. Then
 * "2 of 3 correct" with the right answers, and Row A works again; "Hint" stays one tap away. A
 * "Skip" button is always there while it asks.
 *
 * Presentational: it draws the store's `QuizData` (`selectQuiz`) and reports taps; the Table puts
 * it where the coach strip is (portrait: the strip's row grows; compact: over the bottom of the
 * table; landscape: the column's coach rows; wide: the inline panel). Part of the quiz's lazy
 * chunk (`ui/quizEntry.ts`, §15.3).
 */
import { memo, useId, type CSSProperties } from 'react';
import type { QuizData, QuizQuestion } from '../../app/store.ts';
import { quizWords } from '../../i18n/quiz.ts';
import screen from '../screens/Screen.module.css';
import s from './Levels.module.css';

export type QuizVariant = 'strip' | 'column' | 'panel' | 'overlay';

export interface QuizStripProps {
  readonly quiz: QuizData;
  readonly variant: QuizVariant;
  readonly onAnswer: (choice: number) => void;
  readonly onSkip: () => void;
  /** "Hint" beside the result (it marks the decision as helped, §10.2). */
  readonly onHint: () => void;
  readonly className?: string | undefined;
}

const cx = (...names: (string | false | null | undefined)[]): string =>
  names.filter(Boolean).join(' ');

/** The words of a question's choices. */
const choicesOf = (q: QuizQuestion): readonly string[] => quizWords.choices[q];

/** "Win chance: 25–50%. You need: 20–35%. Best move: Check/Call." */
export function rightText(quiz: QuizData): string {
  return quiz.questions
    .map((q, i) => {
      const words = (quiz.right[i] ?? []).map((c) => choicesOf(q)[c] ?? '');
      return quizWords.right[q](words.join(quizWords.or));
    })
    .join(' ');
}

export const QuizStrip = memo(function QuizStrip({
  quiz,
  variant,
  onAnswer,
  onSkip,
  onHint,
  className,
}: QuizStripProps) {
  const questionId = useId();
  const box = cx(s.quiz, s[variant], className);
  if (quiz.done) {
    return (
      <section className={box} aria-label={quizWords.title} data-quiz="done">
        <div className={s.row}>
          <div className={s.grow} role="status">
            <p className={s.bold}>{quizWords.score(quiz.score.correct, quiz.score.of)}</p>
            <p className={s.muted}>{rightText(quiz)}</p>
          </div>
          <button type="button" className={s.button} onClick={onHint} data-coach-hint="">
            {quizWords.hint}
          </button>
        </div>
      </section>
    );
  }
  const i = quiz.answers.length;
  const q = quiz.questions[i] as QuizQuestion;
  const choices = choicesOf(q);
  return (
    <section className={box} aria-label={quizWords.title} data-quiz={q}>
      <div className={s.row}>
        <p id={questionId} className={cx(s.grow, s.bold)}>
          {quizWords.questions[q]}{' '}
          <span className={cx(s.muted, s.nowrap)}>
            {quizWords.step(i + 1, quiz.questions.length)}
          </span>
        </p>
        <button type="button" className={screen.link} onClick={onSkip} data-quiz-skip="">
          {quizWords.skip}
        </button>
      </div>
      <div
        className={s.choices}
        role="group"
        aria-labelledby={questionId}
        style={{ '--choices': choices.length } as CSSProperties}
      >
        {choices.map((label, c) => (
          <button
            key={`${q}-${c}`}
            type="button"
            className={s.button}
            onClick={() => onAnswer(c)}
            data-quiz-choice={c}
          >
            {label}
          </button>
        ))}
      </div>
    </section>
  );
});
