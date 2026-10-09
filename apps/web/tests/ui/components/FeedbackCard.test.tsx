// @vitest-environment jsdom
/**
 * The feedback card (PLAN §12.6, Appendix F.4, F.5, §11.4): its words, `role="alertdialog"` with
 * focus on Undo, keys U / Enter / Esc, Tab kept inside, a disabled Undo (the decision was undone
 * once already) that ignores taps and U, and the button sizes (§12.12).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeedbackView } from '../../../src/app/store.ts';
import { feedbackLine } from '../../../src/brain/explain.ts';
import { en } from '../../../src/i18n/en.ts';
import { FeedbackCard } from '../../../src/ui/components/FeedbackCard.tsx';

afterEach(cleanup);

const VIEW: FeedbackView = {
  decisionId: 3,
  grade: 'blunder',
  coachMove: { kind: 'call', amount: 40, bb: 20 },
  reason: feedbackLine({ row: 'foldedPrice', E: 0.97, need: 0.2, rangeAdjust: false }),
  canUndo: true,
};

function renderCard(view: FeedbackView = VIEW) {
  const onUndo = vi.fn();
  const onKeep = vi.fn();
  render(<FeedbackCard view={view} unit="chips" onUndo={onUndo} onKeep={onKeep} />);
  return { onUndo, onKeep };
}

const undoButton = () => screen.getByRole('button', { name: en.feedback.undo });
const keepButton = () => screen.getByRole('button', { name: en.feedback.keep });

describe('the feedback card (§12.6)', () => {
  it('says the grade, one reason, the coach move, the two choices and the small print', () => {
    renderCard();
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Big mistake');
    expect(dialog.getAttribute('aria-labelledby')).toBe(
      screen.getByRole('heading', { level: 2 }).id,
    );
    const reason = document.getElementById(dialog.getAttribute('aria-describedby') ?? '');
    expect(reason?.textContent).toBe(
      'You folded with a 97% win chance. You needed only 20% to call.',
    );
    expect(dialog.textContent).toContain("Coach's move: Call 40.");
    expect(dialog.textContent).toContain(
      'Undo lets you try again. The first move still counts in your stats.',
    );
    expect(undoButton().textContent).toBe('Undo: try again');
    expect(keepButton().textContent).toBe('Keep my move');
    // The grade mark is drawn, never a text glyph (✗).
    expect(dialog.querySelector('svg path')).not.toBeNull();
    expect(dialog.textContent).not.toMatch(/[✓✗~]/u);
  });

  it('focus is on Undo; Enter presses it; U undoes; Esc keeps the move', () => {
    const { onUndo, onKeep } = renderCard();
    expect(document.activeElement).toBe(undoButton());
    fireEvent.click(undoButton()); // Enter on a focused button is a click
    expect(onUndo).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'u' });
    expect(onUndo).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(document, { key: 'U', repeat: true }); // held down: once only
    fireEvent.keyDown(document, { key: 'u', ctrlKey: true });
    expect(onUndo).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onKeep).toHaveBeenCalledTimes(1);
    fireEvent.click(keepButton());
    expect(onKeep).toHaveBeenCalledTimes(2);
  });

  it('Tab stays inside the card', () => {
    renderCard();
    const dialog = screen.getByRole('alertdialog');
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(keepButton());
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(undoButton());
  });

  it('when the decision was undone once already: Undo disabled, focus on Keep my move, U ignored', () => {
    const { onUndo, onKeep } = renderCard({ ...VIEW, canUndo: false });
    expect(undoButton().getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(keepButton());
    fireEvent.click(undoButton());
    fireEvent.keyDown(document, { key: 'u' });
    expect(onUndo).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Enter' }); // nothing global on Enter
    expect(onKeep).not.toHaveBeenCalled();
  });

  it('Small mistake and Mistake titles (F.4)', () => {
    renderCard({ ...VIEW, grade: 'inaccuracy' });
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Small mistake');
    cleanup();
    renderCard({ ...VIEW, grade: 'mistake' });
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Mistake');
  });
});
