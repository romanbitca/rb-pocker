// @vitest-environment jsdom
/**
 * Undo and the feedback card on the Table, with the real store and controller (PLAN §11, §10.2,
 * §12.3, §12.5, §12.6; chunk 6.2). Grades come from stub graders (the real one, chunk 6.1's, runs
 * in `tests/app/controller.grade.test.ts` and the E2E specs).
 * - The toolbar Undo: disabled until the grade is in, then a tap takes the move back; after that
 *   it is disabled again, and U does nothing (§11.5: "UI disabled, keyboard shortcut ignored").
 * - The feedback card: over the table with the action bar disabled, Undo / Keep my move.
 * - Levels: no toolbar Undo at Advanced (the card has it) or at Exam (no card either).
 * - Placement: the coach row (portrait, wide), the right column (landscape), the top bar (compact).
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoachLevel } from '../../../src/engine/types.ts';
import { en } from '../../../src/i18n/en.ts';
import { App } from '../../../src/ui/App.tsx';
import { stubGrader, type StubAnswer } from '../../app/graders.ts';
import { passive, startTableHarness, type TableHarness } from '../tableHarness.ts';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [false, () => {}],
    offlineReady: [false, () => {}],
    updateServiceWorker: async () => {},
  }),
}));

let h: TableHarness | null = null;

afterEach(() => {
  cleanup();
  h?.dispose();
  h = null;
  vi.unstubAllGlobals();
});

/** The Table at `level`, the hero to act; grades answer `answer` (default Best). */
async function tableAt(level: CoachLevel, answer: StubAnswer = 'best'): Promise<TableHarness> {
  const harness = startTableHarness({
    settings: { coachLevel: level, speed: 'normal', players: 3 },
    grader: stubGrader({ answer: () => answer }),
  });
  h = harness;
  render(<App />);
  act(() => harness.state().dispatch({ type: 'play' }));
  for (let i = 0; i < 200 && harness.state().game.mode !== 'heroTurn'; i++) {
    await act(async () => {
      await vi.advanceTimersToNextTimerAsync();
    });
  }
  expect(harness.state().game.mode).toBe('heroTurn');
  return harness;
}

/** The hero acts (check or call) and the grade lands. */
async function heroActs(harness: TableHarness): Promise<void> {
  const legal = harness.state().game.legal;
  if (legal === null) throw new Error('not the hero turn');
  await act(async () => {
    harness.state().dispatch({ type: 'act', action: passive(legal) });
    await Promise.resolve();
    await Promise.resolve();
  });
}

const toolbarUndo = (): HTMLElement | null => document.querySelector('[data-undo]');

/** The feedback card, once its lazy chunk is in (the fake clock runs meanwhile). */
async function cardShown(): Promise<HTMLElement> {
  for (let i = 0; i < 100; i++) {
    const card = screen.queryByRole('alertdialog');
    if (card !== null) return card;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5);
    });
  }
  throw new Error('no feedback card');
}

describe('the toolbar Undo (§11.3 r2, r5)', () => {
  it('disabled, then a tap takes the move back; disabled again after; U ignored', async () => {
    const harness = await tableAt('beginner');
    expect(toolbarUndo()?.getAttribute('aria-disabled')).toBe('true');
    expect(toolbarUndo()?.parentElement?.className).toMatch(/coach/);
    await heroActs(harness);
    expect(toolbarUndo()?.getAttribute('aria-disabled')).toBeNull();
    const inputs = harness.controller.snapshot().inputs.length;
    act(() => {
      fireEvent.click(toolbarUndo() as HTMLElement);
    });
    expect(harness.state().game.mode).toBe('heroTurn');
    expect(harness.controller.snapshot().inputs).toHaveLength(inputs); // the act out, the reshuffle in
    expect(screen.getByText('Move taken back. The unseen cards were shuffled again.')).toBeTruthy();
    expect(toolbarUndo()?.getAttribute('aria-disabled')).toBe('true');
    // The keyboard shortcut does nothing now.
    act(() => {
      fireEvent.keyDown(document, { key: 'u' });
    });
    expect(harness.controller.snapshot().inputs).toHaveLength(inputs);
    expect(harness.controller.snapshot().meta.undoCount).toBe(1);
  });

  it('U takes the move back when the toolbar Undo can', async () => {
    const harness = await tableAt('intermediate');
    await heroActs(harness);
    act(() => {
      fireEvent.keyDown(document, { key: 'U' });
    });
    expect(harness.controller.snapshot().meta.undoCount).toBe(1);
  });
});

describe('the feedback card (§11.1, §12.6)', () => {
  it('a blunder: the card over the table, the action bar disabled; Undo, then the card again with Undo disabled', async () => {
    const harness = await tableAt('beginner', 'blunder');
    await heroActs(harness);
    const card = await cardShown();
    expect(within(card).getByRole('heading', { level: 2 }).textContent).toBe('Big mistake');
    expect(document.activeElement?.textContent).toBe(en.feedback.undo);
    // The action bar waits.
    expect(document.querySelector('[data-slot="middle"]')?.textContent).toBe(en.actions.waiting);
    act(() => {
      fireEvent.click(within(card).getByRole('button', { name: en.feedback.undo }));
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(harness.state().game.mode).toBe('heroTurn');
    await heroActs(harness);
    const again = await cardShown();
    const undo = within(again).getByRole('button', { name: en.feedback.undo });
    expect(undo.getAttribute('aria-disabled')).toBe('true');
    act(() => {
      fireEvent.click(undo);
    });
    expect(harness.state().game.mode).toBe('feedback');
    act(() => {
      fireEvent.click(within(again).getByRole('button', { name: en.feedback.keep }));
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(harness.state().game.mode).not.toBe('feedback');
  });

  it('Advanced: no toolbar Undo, the card has one; Exam: no Undo and no card', async () => {
    const advanced = await tableAt('advanced', 'mistake');
    expect(toolbarUndo()).toBeNull();
    await heroActs(advanced);
    const undo = within(await cardShown()).getByRole('button', {
      name: en.feedback.undo,
    });
    expect(undo.getAttribute('aria-disabled')).toBeNull();
    act(() => {
      fireEvent.click(undo);
    });
    expect(advanced.controller.snapshot().meta.undoCount).toBe(1);
    cleanup();
    advanced.dispose();
    h = null;

    const exam = await tableAt('exam', 'blunder');
    expect(toolbarUndo()).toBeNull();
    await heroActs(exam);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(toolbarUndo()).toBeNull();
    expect(exam.state().game.mode).not.toBe('feedback');
  });
});

describe('where the toolbar Undo sits (§12.3, §12.5)', () => {
  it('landscape: in the right column; wide: in the coach row; compact: in the top bar', async () => {
    const harness = await tableAt('beginner');
    act(() => harness.state().dispatch({ type: 'layout', layout: 'landscape' }));
    expect(toolbarUndo()?.closest('aside')).not.toBeNull();
    act(() => harness.state().dispatch({ type: 'layout', layout: 'wide' }));
    expect(toolbarUndo()?.parentElement?.className).toMatch(/coach/);
    cleanup();
    harness.dispose();
    h = null;

    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(max-height: 640px)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    await tableAt('beginner');
    expect(toolbarUndo()?.closest('header')).not.toBeNull();
  });
});
