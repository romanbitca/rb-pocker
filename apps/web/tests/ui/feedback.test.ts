/**
 * The feedback card's words (PLAN §12.6, Appendix F.4, F.5; `ui/feedback.ts`): the F.4 title,
 * the F.5 reason (chunk 5.6's templates, `feedbackLine` + `lineText`) and the coach's move as the
 * action bar names it.
 */
import { describe, expect, it } from 'vitest';
import type { FeedbackView, MoveView } from '../../src/app/store.ts';
import { feedbackLine, type FeedbackInput } from '../../src/brain/explain.ts';
import type { LegalActions } from '../../src/engine/types.ts';
import { feedbackTexts, moveText } from '../../src/ui/feedback.ts';

const LEGAL: LegalActions = {
  seat: 0,
  toCall: 40,
  callAmount: 40,
  callIsAllIn: false,
  canFold: true,
  canCheck: false,
  canCall: true,
  bet: null,
  raise: { min: 80, max: 2000 },
};

const move = (kind: MoveView['kind'], amount: number | null = null): MoveView => ({
  kind,
  amount,
  bb: 20,
});

const view = (reason: FeedbackInput, grade: FeedbackView['grade'] = 'mistake'): FeedbackView => ({
  decisionId: 1,
  grade,
  coachMove: move('call', 40),
  reason: feedbackLine(reason),
  canUndo: true,
});

describe('moves (§12.7, F.10)', () => {
  it('as the action bar names them, in chips or big blinds', () => {
    expect(moveText(move('fold'), 'chips')).toBe('Fold');
    expect(moveText(move('check'), 'chips')).toBe('Check');
    expect(moveText(move('call', 40), 'chips')).toBe('Call 40');
    expect(moveText(move('callAllIn', 2340), 'chips')).toBe('Call all-in 2,340');
    expect(moveText(move('bet', 120), 'chips')).toBe('Bet 120');
    expect(moveText(move('raise', 120), 'chips')).toBe('Raise to 120');
    expect(moveText(move('allIn', 2340), 'chips')).toBe('All-in 2,340');
    expect(moveText(move('raise', 130), 'bb')).toBe('Raise to 6.5 BB');
  });
});

describe('the card (F.4, F.5)', () => {
  it('title by grade, the F.5 reason, the coach move', () => {
    const texts = feedbackTexts(
      view({ row: 'foldedPrice', E: 0.999, need: 0.2, rangeAdjust: false }, 'blunder'),
      'chips',
    );
    expect(texts).toEqual({
      title: 'Big mistake',
      reason: 'You folded with a >99% win chance. You needed only 20% to call.',
      coachMove: "Coach's move: Call 40.",
    });
    const slightly = view({ row: 'checkedStrong' }, 'inaccuracy');
    expect(feedbackTexts(slightly, 'chips').title).toBe('Small mistake');
    expect(feedbackTexts(slightly, 'bb').coachMove).toBe("Coach's move: Call 2 BB.");
  });

  it('every F.5 row reads as one plain reason', () => {
    const rows: [FeedbackInput, string][] = [
      [
        { row: 'calledPrice', E: 0.2, need: 0.25, rangeAdjust: true },
        'You called with a 20% win chance against their likely hands. You needed 25%. Calling loses chips over time.',
      ],
      [
        { row: 'airMultiway', players: 3 },
        'You bet with almost nothing into 3 players. Someone usually calls.',
      ],
      [{ row: 'airHeadsUp' }, 'This bet rarely makes better hands fold. Checking was cheaper.'],
      [
        { row: 'foldedStrong', hand: 'Ace-King suited', rankPct: 2.3 },
        'Ace-King suited is in the top 3% of hands. It is strong enough to play.',
      ],
      [
        { row: 'fallback', alt: { type: 'raise', to: 2000 }, legal: LEGAL, toCall: 40, bb: 20 },
        "The coach's move wins more chips here: All-in 2,000.",
      ],
    ];
    for (const [row, text] of rows) expect(feedbackTexts(view(row), 'chips').reason).toBe(text);
  });

  it("no row from the grader: the fallback row with the coach's move, in the player's unit", () => {
    const none: FeedbackView = { ...view({ row: 'airHeadsUp' }), reason: null };
    expect(feedbackTexts(none, 'chips').reason).toBe(
      "The coach's move wins more chips here: Call 40.",
    );
    expect(feedbackTexts(none, 'bb').reason).toBe(
      "The coach's move wins more chips here: Call 2\u00A0BB.",
    );
  });
});
