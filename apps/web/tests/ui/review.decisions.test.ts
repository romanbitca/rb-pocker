/**
 * The hero's decisions on Review's steps (PLAN §12.10, 1.3.101): which record shows on which step,
 * where a replay opens and what "Next decision" and "Previous decision" jump to. The hands are
 * played by the real engine; the records are the shape the controller writes (A.7).
 */
import { describe, expect, it } from 'vitest';
import type { ReviewHand } from '../../src/app/review.ts';
import { buildReview, type ReviewReplay } from '../../src/app/reviewViews.ts';
import { decisionSteps, jumpFrom, openingStep } from '../../src/ui/review.ts';
import { collectHands, undoneHand, withDecisions } from '../app/reviewFixtures.ts';

const [show] = collectHands(1, 'showdown') as [ReviewHand];

const viewOf = (hand: ReviewHand): ReviewReplay => buildReview(hand) as ReviewReplay;

/** The frames where the hero moves. */
const heroFrames = (view: ReviewReplay): number[] =>
  view.frames
    .filter((f) => f.events.some((e) => e.kind === 'act' && e.who.hero))
    .map((f) => f.index);

describe('decisionSteps', () => {
  it('puts every hero move on its own step, with its record, in order', () => {
    const hand = withDecisions(show);
    const view = viewOf(hand);
    const steps = decisionSteps(view);
    expect(hand.decisions.length).toBeGreaterThan(2);
    expect(steps.map((s) => s.index)).toEqual(heroFrames(view));
    expect(steps.map((s) => s.row.decisionId)).toEqual(hand.decisions.map((d) => d.decisionId));
    expect(steps.map((s) => s.row.street)).toEqual(hand.decisions.map((d) => d.street));
  });

  it('a hand without records has no decision steps', () => {
    expect(decisionSteps(viewOf(show))).toEqual([]);
  });

  it('a hero move without a record has no row, and the moves after it keep theirs', () => {
    const hand = withDecisions(show);
    const later = { ...hand, decisions: hand.decisions.slice(1) };
    const view = viewOf(later);
    const steps = decisionSteps(view);
    expect(steps.map((s) => s.row.decisionId)).toEqual(later.decisions.map((d) => d.decisionId));
    expect(steps.map((s) => s.index)).toEqual(heroFrames(view).slice(1));
  });

  it('an Undo: the record it took back is on the Undo`s step, the one that stood on the move', () => {
    const view = viewOf(undoneHand());
    const steps = decisionSteps(view);
    expect(steps.map((s) => s.index)).toEqual([
      view.frames.findIndex((f) => f.events.some((e) => e.kind === 'reshuffle')),
      heroFrames(view)[0],
    ]);
    expect(steps.map((s) => [s.row.taken.type, s.row.undone])).toEqual([
      ['call', true],
      ['fold', false],
    ]);
  });
});

describe('openingStep', () => {
  it('a hand with no mistake opens at the deal (Slightly off is not a mistake)', () => {
    const steps = decisionSteps(viewOf(withDecisions(show, () => 'inaccuracy')));
    expect(steps.length).toBeGreaterThan(0);
    expect(openingStep(steps)).toBe(0);
    expect(openingStep([])).toBe(0);
  });

  it('a hand with a Mistake or a Big mistake opens at the first one', () => {
    for (const grade of ['mistake', 'blunder'] as const) {
      const hand = withDecisions(show, (n) => (n >= 1 ? grade : 'best'));
      const steps = decisionSteps(viewOf(hand));
      expect(openingStep(steps)).toBe(steps[1]?.index);
    }
  });

  it('a mistake taken back with Undo is not where the replay opens', () => {
    expect(openingStep(decisionSteps(viewOf(undoneHand())))).toBe(0);
  });

  it('a decision that could not be graded is not a mistake', () => {
    expect(openingStep(decisionSteps(viewOf(withDecisions(show, () => null))))).toBe(0);
  });
});

describe('jumpFrom', () => {
  const steps = [3, 7, 12].map((index) => ({ index, row: {} as never }));

  it('goes to the next decision after the step, and the one before it', () => {
    expect(jumpFrom(steps, 0, 1)).toBe(3);
    expect(jumpFrom(steps, 3, 1)).toBe(7);
    expect(jumpFrom(steps, 5, 1)).toBe(7);
    expect(jumpFrom(steps, 12, -1)).toBe(7);
    expect(jumpFrom(steps, 5, -1)).toBe(3);
    expect(jumpFrom(steps, 20, -1)).toBe(12);
  });

  it('there is none past the ends', () => {
    expect(jumpFrom(steps, 12, 1)).toBeNull();
    expect(jumpFrom(steps, 20, 1)).toBeNull();
    expect(jumpFrom(steps, 3, -1)).toBeNull();
    expect(jumpFrom(steps, 0, -1)).toBeNull();
    expect(jumpFrom([], 0, 1)).toBeNull();
  });
});
