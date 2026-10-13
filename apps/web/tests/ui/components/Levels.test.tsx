// @vitest-environment jsdom
/**
 * The coach levels' lazy UI (PLAN §10.2, §10.3, §12.6, §12.9, §13.2, F.4; chunk 6.4): the grade
 * chip, the Advanced quiz, the hand summary (and the Exam result) and "Which hand wins?": what
 * they say, what a tap sends, and 44 px tap targets (56 px for the summary's Next hand).
 */
import '../../../src/ui/styles/tokens.css';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dealPair,
  quizQuestions,
  quizScore,
  rightAnswers,
  type QuizData,
} from '../../../src/app/store.ts';
import type { Decision, Grade } from '../../../src/brain/types.ts';
import { rngFromSeed } from '../../../src/core/rng.ts';
import { categoryOf, score5 } from '../../../src/eval/evaluate.ts';
import type { StripView } from '../../../src/ui/coach.ts';
import { CoachStrip } from '../../../src/ui/components/CoachStrip.tsx';
import { GRADE_CHIP_TEXT, GradeChip } from '../../../src/ui/components/GradeChip.tsx';
import { netText, rowNotes, SummarySheet } from '../../../src/ui/components/HandSummary.tsx';
import { QuizStrip, rightText } from '../../../src/ui/components/QuizStrip.tsx';
import { ruleText, WhichHandWins } from '../../../src/ui/components/WhichHandWins.tsx';
import type { SummaryData } from '../../../src/ui/summary.ts';
import { smallTargets } from '../screens/targets.ts';

afterEach(cleanup);

describe('the grade chip (§12.6, F.4)', () => {
  it('pairs the colour with a drawn mark and the words, never a text glyph', () => {
    const grades: Grade[] = ['best', 'good', 'inaccuracy', 'mistake', 'blunder'];
    for (const grade of grades) {
      const { container } = render(<GradeChip grade={grade} />);
      const chip = container.querySelector('[data-grade-chip]');
      expect(chip?.getAttribute('data-grade-chip')).toBe(grade);
      expect(chip?.textContent).toBe(GRADE_CHIP_TEXT[grade]);
      expect(chip?.querySelector('svg path')).not.toBeNull();
      cleanup();
    }
    expect(Object.values(GRADE_CHIP_TEXT)).toEqual([
      'Best move',
      'Good',
      'Slightly off',
      'Mistake',
      'Big mistake',
    ]);
  });

  it('the strip shows it in place of the narration; the compact pill too', () => {
    const narration: StripView = { kind: 'narration', text: 'Ben raises to 60.' };
    const noop = vi.fn();
    const props = { onOpen: noop, onHint: noop, onRetry: noop };
    const { container, rerender } = render(
      <CoachStrip view={narration} variant="strip" chip="mistake" {...props} />,
    );
    expect(container.textContent).toBe('Mistake');
    rerender(<CoachStrip view={narration} variant="strip" chip={null} {...props} />);
    expect(container.textContent).toBe('Ben raises to 60.');
    rerender(<CoachStrip view={{ kind: 'empty' }} variant="pill" chip="best" {...props} />);
    expect(container.querySelector('[data-grade-chip="best"]')).not.toBeNull();
  });

  it('Exam`s hint button reads "Hint (counts as help)" (§10.2, §12.6)', () => {
    const onHint = vi.fn();
    render(
      <CoachStrip
        view={{ kind: 'hint', ready: true, countsAsHelp: true }}
        variant="strip"
        onOpen={vi.fn()}
        onHint={onHint}
        onRetry={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Hint (counts as help)' }));
    expect(onHint).toHaveBeenCalledOnce();
  });
});

const DECISION: Decision = {
  action: { type: 'call' },
  kind: 'call',
  ev: {},
  eRandom: 0.45,
  eRange: 0.45,
  need: 0.25,
  bucket: null,
  strength: 'decent',
  confidence: 'close',
  alt: { type: 'raise', to: 120 },
  trace: [],
};

function quizData(answers: number[], decision: Decision = DECISION): QuizData {
  const questions = quizQuestions(decision);
  return {
    key: '1:9',
    questions,
    answers,
    done: answers.length >= questions.length,
    right: questions.map((q) => rightAnswers(decision, q)),
    score: quizScore(decision, answers),
  };
}

describe('the Advanced quiz (§10.3)', () => {
  it('asks one question at a time, with Skip; a tap sends the choice', () => {
    const onAnswer = vi.fn();
    const onSkip = vi.fn();
    const { container, rerender } = render(
      <QuizStrip
        quiz={quizData([])}
        variant="strip"
        onAnswer={onAnswer}
        onSkip={onSkip}
        onHint={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-quiz]')?.getAttribute('data-quiz')).toBe('win');
    expect(screen.getByRole('group', { name: /Your win chance is about…/ })).toBeTruthy();
    expect([...container.querySelectorAll('[data-quiz-choice]')].map((b) => b.textContent)).toEqual(
      ['Under 25%', '25–50%', '50–75%', 'Over 75%'],
    );
    expect(container.textContent).toContain('Question 1 of 3');
    fireEvent.click(screen.getByRole('button', { name: '25–50%' }));
    expect(onAnswer).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onSkip).toHaveBeenCalledOnce();
    expect(smallTargets(container, () => false)).toEqual([]);
    rerender(
      <QuizStrip
        quiz={quizData([1])}
        variant="strip"
        onAnswer={onAnswer}
        onSkip={onSkip}
        onHint={vi.fn()}
      />,
    );
    expect(screen.getByRole('group', { name: /You need about…/ })).toBeTruthy();
    rerender(
      <QuizStrip
        quiz={quizData([1, 1])}
        variant="strip"
        onAnswer={onAnswer}
        onSkip={onSkip}
        onHint={vi.fn()}
      />,
    );
    expect([...container.querySelectorAll('[data-quiz-choice]')].map((b) => b.textContent)).toEqual(
      ['Fold', 'Check/Call', 'Bet/Raise'],
    );
  });

  it('then "2 of 3 correct" with the right answers (a close spot names both moves), and Hint', () => {
    const onHint = vi.fn();
    const quiz = quizData([1, 0, 2]);
    render(
      <QuizStrip quiz={quiz} variant="panel" onAnswer={vi.fn()} onSkip={vi.fn()} onHint={onHint} />,
    );
    expect(screen.getByRole('status').textContent).toBe(
      '2 of 3 correct' +
        'Win chance: 25–50%. You need: 20–35%. Best move: Check/Call or Bet/Raise.',
    );
    expect(rightText(quiz)).toBe(
      'Win chance: 25–50%. You need: 20–35%. Best move: Check/Call or Bet/Raise.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Hint' }));
    expect(onHint).toHaveBeenCalledOnce();
  });

  it('no bet to face: two questions, no price', () => {
    const d: Decision = { ...DECISION, need: 0, action: { type: 'check' }, confidence: 'clear' };
    render(
      <QuizStrip
        quiz={quizData([], d)}
        variant="overlay"
        onAnswer={vi.fn()}
        onSkip={vi.fn()}
        onHint={vi.fn()}
      />,
    );
    expect(screen.getByText(/Question 1 of 2/)).toBeTruthy();
  });
});

const SUMMARY: SummaryData = {
  handSeq: 12,
  handNumber: 12,
  net: -40,
  bb: 20,
  exam: false,
  score: null,
  rows: [
    {
      decisionId: 0,
      street: 'preflop',
      taken: { type: 'call' },
      rec: { type: 'call' },
      grade: 'best',
      eRandom: 0.4,
      need: 0.2,
      undone: false,
    },
    {
      decisionId: 1,
      street: 'turn',
      taken: { type: 'fold' },
      rec: { type: 'call' },
      grade: 'mistake',
      eRandom: 0.45,
      need: 0.25,
      undone: true,
    },
    {
      decisionId: 1,
      street: 'turn',
      taken: { type: 'raise', to: 300 },
      rec: { type: 'call' },
      grade: null,
      eRandom: null,
      need: 0.25,
      undone: false,
    },
  ],
};

describe('the hand summary (§12.9) and the Exam result (§10.2)', () => {
  it('title, one row per decision, the coach`s move when it was another, the numbers', () => {
    const onNext = vi.fn();
    const onReview = vi.fn();
    const onClose = vi.fn();
    render(
      <SummarySheet
        summary={SUMMARY}
        unit="chips"
        onNext={onNext}
        onReview={onReview}
        onClose={onClose}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Hand 12: −40' });
    const rows = [...dialog.querySelectorAll('li')].map((li) => li.textContent);
    expect(rows).toEqual([
      'Before the flop · You calledBest moveYou had 40%, needed 20%.',
      'Turn · You foldedTaken back with UndoCoach: Call · You had 45%, needed 25%.',
      'Turn · You raised to 300No gradeCoach: Call',
    ]);
    expect(dialog.querySelector('[data-grade-chip="best"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next hand ›' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review hand' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onNext).toHaveBeenCalledOnce();
    expect(onReview).toHaveBeenCalledWith(12);
    expect(onClose).toHaveBeenCalledOnce();
    expect(smallTargets(dialog, (el) => el.getAttribute('data-summary-next') !== null)).toEqual([]);
  });

  it('Exam: "Exam result" over the title and the score of the hand', () => {
    render(
      <SummarySheet
        summary={{ ...SUMMARY, exam: true, score: 63, net: 160 }}
        unit="bb"
        onNext={vi.fn()}
        onReview={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Exam resultHand 12: +160' })).toBeTruthy();
    expect(screen.getByText('Your score: 63 of 100')).toBeTruthy();
    // Amounts in big blinds when the player chose them.
    expect(screen.getByText(/You raised to 15/)).toBeTruthy();
  });

  it('net text and row notes', () => {
    expect([netText(160), netText(-40), netText(0), netText(12_500)]).toEqual([
      '+160',
      '−40',
      '0',
      '+12,500',
    ]);
    const money = (x: number) => String(x);
    expect(rowNotes(SUMMARY.rows[0] as never, money)).toBe('You had 40%, needed 20%.');
    expect(
      rowNotes(
        { ...(SUMMARY.rows[0] as object), need: null, rec: { type: 'check' } } as never,
        money,
      ),
    ).toBe('Coach: Check · You had 40%.');
  });
});

describe('"Which hand wins?" (§13.2)', () => {
  it('never deals a tie; the winner is the higher score', () => {
    const rng = rngFromSeed('0000000000000000000000000000beef');
    for (let i = 0; i < 300; i++) {
      const pair = dealPair(rng);
      const [a, b] = pair.hands;
      expect(new Set([...a, ...b]).size).toBe(10);
      const sa = score5(a);
      const sb = score5(b);
      expect(sa).not.toBe(sb);
      expect(pair.winner).toBe(sa > sb ? 0 : 1);
      expect(pair.categories).toEqual([categoryOf(sa), categoryOf(sb)]);
    }
  });

  it('says the rule that decided it', () => {
    expect(ruleText({ hands: [[], []], categories: ['flush', 'straight'], winner: 0 })).toBe(
      'Flush beats straight. A higher row always beats a lower row.',
    );
    expect(ruleText({ hands: [[], []], categories: ['pair', 'pair'], winner: 1 })).toBe(
      'Both are one pair. Same row? The higher cards win: the higher pair, then the kickers.',
    );
  });

  it('a tap on a hand answers at once; the score stays for this visit', () => {
    const onClose = vi.fn();
    const { container } = render(<WhichHandWins onClose={onClose} />);
    const hands = [...container.querySelectorAll('[data-which-hand]')];
    expect(hands).toHaveLength(2);
    expect(container.querySelectorAll('[data-which-hand] [data-suit]')).toHaveLength(10);
    fireEvent.click(hands[0] as Element);
    expect(screen.getByRole('status').textContent).toMatch(/^(Right!|Not this time\.) /);
    expect(screen.getByText(/of 1 right$/)).toBeTruthy();
    fireEvent.click(hands[1] as Element); // answered: a second tap changes nothing
    expect(screen.getByText(/of 1 right$/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next hands' }));
    expect(screen.getByRole('status').textContent).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(smallTargets(container, () => false)).toEqual([]);
  });
});
