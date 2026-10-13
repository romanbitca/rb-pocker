/**
 * The Advanced quiz (PLAN §10.3, chunk 6.4), the pure parts: when it fires, its questions, their
 * right answers and the score. The store keeps the answers (`coach.quiz`, the `quizAnswer` and
 * `quizSkip` commands), the quiz chunk (`ui/quizEntry.ts`) draws it in the coach's places, and the
 * controller writes the score into the decision's record (A.7 `DecisionRecord.quiz`).
 *
 * - It fires on 1 in 4 hero decisions: `fnv1a32('quiz|' + observationKey(obs)) % 4 === 0`, where
 *   the pot is at least 10 big blinds; the controller asks only at Advanced and never again on a
 *   decision the player took back with Undo (the answers were on show). It starts when the hint is
 *   ready (the quiz needs its numbers); from the start of the decision the win badge is hidden.
 * - The questions: (1) "Your win chance is about…" in four bands; (2) only when facing a bet,
 *   "You need about…" in four bands; (3) "Best move?" Fold, Check/Call or Bet/Raise.
 * - The right answers: the band holding the HUD's `eRandom` (the hint's, which is the HUD's
 *   number, C9) and the band holding `need`, both as the whole percentages the badge and the price
 *   chip show (lower bounds inclusive: 25% is "25–50%"); the recommendation's type (a call all-in
 *   is Check/Call, an all-in bet or raise is Bet/Raise); in a Close spot the also-fine move's type
 *   counts too.
 */
import type { Decision } from '../brain/types.ts';
import { fnv1a32 } from '../core/rng.ts';
import { observationKey, type Observation, type PlayerAction } from '../engine/types.ts';

export type QuizQuestion = 'win' | 'need' | 'move';

/** Band lower bounds in whole percent: "Under 25%" · "25–50%" · "50–75%" · "Over 75%". */
export const WIN_BANDS: readonly number[] = [25, 50, 75];
/** "Under 20%" · "20–35%" · "35–50%" · "Over 50%". */
export const NEED_BANDS: readonly number[] = [20, 35, 50];

/** "Best move?" choices: Fold, Check/Call, Bet/Raise. */
export const MOVE_CHOICES = 3;

/** §10.3: the pot is at least 10 big blinds and the observation's hash picks 1 in 4. */
export function quizRolls(obs: Observation): boolean {
  return obs.pot >= 10 * obs.bb && fnv1a32('quiz|' + observationKey(obs)) % 4 === 0;
}

/** The band of a fraction, from its whole percentage (as the badge shows it). */
export function bandOf(fraction: number, bounds: readonly number[]): number {
  const points = Math.round(100 * fraction);
  let band = 0;
  while (band < bounds.length && points >= (bounds[band] as number)) band++;
  return band;
}

/** The questions of the quiz on `decision`: the price question only when facing a bet. */
export function quizQuestions(decision: Pick<Decision, 'need'>): readonly QuizQuestion[] {
  return decision.need > 0 ? ['win', 'need', 'move'] : ['win', 'move'];
}

/** A move's "Best move?" choice: 0 Fold, 1 Check/Call, 2 Bet/Raise. */
export function moveChoice(action: PlayerAction): number {
  switch (action.type) {
    case 'fold':
      return 0;
    case 'check':
    case 'call':
      return 1;
    case 'bet':
    case 'raise':
      return 2;
  }
}

/** How many choices a question has. */
export function choiceCount(q: QuizQuestion): number {
  return q === 'win' ? WIN_BANDS.length + 1 : q === 'need' ? NEED_BANDS.length + 1 : MOVE_CHOICES;
}

/** The right answers of a question (two for the move in a Close spot with another type). */
export function rightAnswers(
  decision: Pick<Decision, 'eRandom' | 'need' | 'action' | 'confidence' | 'alt'>,
  q: QuizQuestion,
): readonly number[] {
  switch (q) {
    case 'win':
      return [bandOf(decision.eRandom, WIN_BANDS)];
    case 'need':
      return [bandOf(decision.need, NEED_BANDS)];
    case 'move': {
      const rec = moveChoice(decision.action);
      const alt =
        decision.confidence === 'close' && decision.alt !== null ? moveChoice(decision.alt) : rec;
      return alt === rec ? [rec] : [rec, alt].sort((a, b) => a - b);
    }
  }
}

export interface QuizScore {
  correct: number;
  of: number;
}

/** The score of the answers given so far (one per question, in order). */
export function quizScore(
  decision: Pick<Decision, 'eRandom' | 'need' | 'action' | 'confidence' | 'alt'>,
  answers: readonly number[],
): QuizScore {
  const questions = quizQuestions(decision);
  let correct = 0;
  let of = 0;
  answers.forEach((answer, i) => {
    const q = questions[i];
    if (q === undefined) return;
    of++;
    if (rightAnswers(decision, q).includes(answer)) correct++;
  });
  return { correct, of };
}
