// @vitest-environment jsdom
/**
 * The coach level matrix on the Table (PLAN §10.2, chunk 6.4; Stage 6 acceptance 5's level part):
 * with the real store and controller, the test brain's real coach and stub grades, each level
 * shows exactly its §10.2 elements:
 * - before you act: the advice on show (Beginner), "Hint" (Intermediate, Advanced), "Hint (counts
 *   as help)" (Exam); the win badge (not at Exam); the price chip (Beginner and Intermediate);
 *   the toolbar Undo (Beginner and Intermediate); "Which hand wins?" (Advanced and Exam);
 * - after you act: the grade chip from the level's grade on (none at Exam);
 * - at the hand end: the summary when the level shows one (Exam: the "Exam result").
 * The wide layout: the coach is the inline panel and the rankings are the column, all on screen.
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { appStore, initialEquity, type EquitySlice } from '../../../src/app/store.ts';
import type { Grade } from '../../../src/brain/types.ts';
import type { CoachLevel, HandState } from '../../../src/engine/types.ts';
import { App } from '../../../src/ui/App.tsx';
import { loadCoach } from '../../../src/ui/coachModule.ts';
import { stubGrader } from '../../app/graders.ts';
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
  appStore.setState({ equity: initialEquity() });
});

beforeAll(async () => {
  await loadCoach();
  // The lazy chunks the Table asks for at mount: in place before the first hand ends.
  await import('../../../src/ui/summaryEntry.ts');
  await import('../../../src/ui/quizEntry.ts');
});

/** A final HUD estimate for the hero's situation (what the equity jobs would have written). */
function sliceFor(hand: HandState | null): EquitySlice {
  const hero = hand?.seats[0];
  if (hand === null || hand.phase === 'complete' || hero?.hole == null || hero.folded) {
    return initialEquity();
  }
  const nOpp = hand.seats.filter((s, i) => i !== 0 && s.dealtIn && !s.folded).length;
  return {
    ...initialEquity(),
    status: 'done',
    situation: { handSeq: hand.handSeq, hero: hero.hole, board: [...hand.board], nOpp },
    result: { n: 1, win: 0.4, split: 0, equity: 0.4, exact: false, final: true, truncated: false },
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
}

async function nextTimer(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersToNextTimerAsync();
  });
}

const $ = (selector: string): Element | null => document.querySelector(selector);

interface Seen {
  advice: number;
  hint: number;
  hintExam: number;
  quiz: number;
  badge: number;
  price: number;
  undo: number;
  whichWins: number;
  chips: Set<string>;
  summary: Set<string>;
}

/**
 * Plays `hands` hands at `level` on a wide screen (grades from `grade`), recording what shows at
 * each hero turn, right after each act (the grade chip) and at each hand end (the summary).
 */
async function playAt(level: CoachLevel, grade: Grade, hands = 3): Promise<Seen> {
  h = startTableHarness({
    hints: true,
    summaries: true,
    settings: { coachLevel: level, players: 3, speed: 'normal' },
    grader: stubGrader({ answer: () => grade }),
  });
  render(<App />);
  act(() => h?.state().dispatch({ type: 'play' }));
  act(() => h?.state().dispatch({ type: 'layout', layout: 'wide' }));
  const seen: Seen = {
    advice: 0,
    hint: 0,
    hintExam: 0,
    quiz: 0,
    badge: 0,
    price: 0,
    undo: 0,
    whichWins: 0,
    chips: new Set(),
    summary: new Set(),
  };
  const start = (h.state().game.hand as HandState).handSeq;
  for (let i = 0; i < 5000; i++) {
    const s = appStore.getState();
    if ((s.game.hand?.handSeq ?? 0) >= start + hands) return seen;
    act(() => appStore.setState({ equity: sliceFor(s.game.hand) }));
    if (s.game.mode === 'heroTurn' && s.game.legal !== null) {
      await settle();
      if ($('[data-coach-advice]')) seen.advice++;
      const hint = $('[data-coach-hint]');
      if (hint?.textContent === 'Hint') seen.hint++;
      if (hint?.textContent === 'Hint (counts as help)') seen.hintExam++;
      if ($('[data-quiz]')) {
        seen.quiz++;
        act(() => appStore.getState().dispatch({ type: 'quizSkip' }));
      }
      if ($('[data-win-badge="value"]')) seen.badge++;
      if ($('[data-price-chip]')) seen.price++;
      if ($('[data-undo]')) seen.undo++;
      if ($('[data-which-wins-open]')) seen.whichWins++;
      const legal = appStore.getState().game.legal;
      if (legal === null) continue;
      act(() => appStore.getState().dispatch({ type: 'act', action: passive(legal) }));
      await settle();
      const chip = $('[data-grade-chip]');
      if (chip !== null) seen.chips.add(chip.getAttribute('data-grade-chip') ?? '');
    } else if (s.game.mode === 'feedback') {
      act(() => s.dispatch({ type: 'keepMove' }));
    } else if (s.ui.overlays.includes('outOfChips')) {
      act(() => s.dispatch({ type: 'reload' }));
    } else if (s.game.mode === 'handEnd' && s.ui.overlays.includes('summary')) {
      await settle();
      const sheet = $('[data-summary]');
      if (sheet !== null) seen.summary.add(sheet.getAttribute('data-summary') ?? '');
      const next = $('[data-summary-next]');
      act(() => (next as HTMLElement | null)?.click());
      if (next === null) act(() => s.dispatch({ type: 'nextHand' }));
    } else {
      await nextTimer();
    }
  }
  throw new Error('playAt: not done');
}

describe('each coach level shows exactly its §10.2 elements', () => {
  it('Beginner: the advice, badge, price chip, toolbar Undo; every grade chip; a summary every hand', async () => {
    const seen = await playAt('beginner', 'good');
    expect(seen.advice).toBeGreaterThan(0);
    expect(seen.hint + seen.hintExam + seen.quiz).toBe(0);
    expect(seen.badge).toBeGreaterThan(0);
    expect(seen.price).toBeGreaterThan(0);
    expect(seen.undo).toBeGreaterThan(0);
    expect(seen.whichWins).toBe(0);
    expect([...seen.chips]).toEqual(['good']);
    expect([...seen.summary]).toEqual(['hand']);
  }, 60_000);

  it('Intermediate: "Hint", badge, price chip, toolbar Undo; chips and the summary from an Inaccuracy', async () => {
    const good = await playAt('intermediate', 'good');
    expect(good.hint).toBeGreaterThan(0);
    expect(good.advice + good.hintExam + good.quiz).toBe(0);
    expect(good.badge).toBeGreaterThan(0);
    expect(good.price).toBeGreaterThan(0);
    expect(good.undo).toBeGreaterThan(0);
    expect(good.whichWins).toBe(0);
    expect(good.chips.size).toBe(0);
    expect(good.summary.size).toBe(0);
    cleanup();
    h?.dispose();
    const off = await playAt('intermediate', 'inaccuracy');
    expect([...off.chips]).toEqual(['inaccuracy']);
    expect([...off.summary]).toEqual(['hand']);
  }, 60_000);

  it('Advanced: "Hint" (or the quiz), badge, no price chip, no toolbar Undo, "Which hand wins?"; Mistake+ only', async () => {
    const seen = await playAt('advanced', 'inaccuracy');
    expect(seen.hint + seen.quiz).toBeGreaterThan(0);
    expect(seen.advice + seen.hintExam).toBe(0);
    expect(seen.badge).toBeGreaterThan(0);
    expect(seen.price).toBe(0);
    expect(seen.undo).toBe(0);
    expect(seen.whichWins).toBeGreaterThan(0);
    expect(seen.chips.size).toBe(0);
    expect(seen.summary.size).toBe(0);
    cleanup();
    h?.dispose();
    const mistake = await playAt('advanced', 'mistake');
    expect([...mistake.chips]).toEqual(['mistake']);
    expect([...mistake.summary]).toEqual(['hand']);
    expect(mistake.undo).toBe(0);
  }, 60_000);

  it('Exam: "Hint (counts as help)", no badge, no price chip, no Undo, no chips; the Exam result every hand', async () => {
    const seen = await playAt('exam', 'blunder');
    expect(seen.hintExam).toBeGreaterThan(0);
    expect(seen.advice + seen.hint + seen.quiz).toBe(0);
    expect(seen.badge).toBe(0);
    expect(seen.price).toBe(0);
    expect(seen.undo).toBe(0);
    expect(seen.whichWins).toBeGreaterThan(0);
    expect(seen.chips.size).toBe(0);
    expect([...seen.summary]).toEqual(['exam']);
  }, 60_000);
});
