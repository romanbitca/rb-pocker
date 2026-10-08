// @vitest-environment jsdom
/**
 * The Table with the HUD on (PLAN §7.6, §12.3, §13.2, §15.3): nine players on a wide screen with
 * the rankings column, every step fed an `equity` slice as the equity jobs (chunk 4.5) write it
 * (a final estimate, the hand analysis with draws, and chances for all ten rows). The win badge,
 * the price chip, the draw chips and the "By river" column all show, the coach (chunk 5.9, its
 * stand-in answering from that slice) shows its inline panel at the hero's turns, and the screen
 * stays within 600 DOM nodes at every step, showdowns included. In portrait the coach strip is on
 * and its sheet is opened at every hero turn.
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { analyzeHand } from '../../../src/analysis/handinfo.ts';
import type { HandAnalysis } from '../../../src/analysis/types.ts';
import { appStore, initialEquity, type EquitySlice } from '../../../src/app/store.ts';
import { HAND_CATEGORIES } from '../../../src/eval/evaluate.ts';
import type { HandState } from '../../../src/engine/types.ts';
import { App } from '../../../src/ui/App.tsx';
import { loadCoach } from '../../../src/ui/coachModule.ts';
import { playUntil, startTableHarness, type TableHarness } from '../tableHarness.ts';

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

const CHANCES = Object.fromEntries(
  HAND_CATEGORIES.map((k) => [k, { exactly: 10, atLeast: 10, boardShared: false }]),
) as NonNullable<HandAnalysis['chances']>;

/** What the equity jobs would have written for this hand by now (a final estimate). */
function sliceFor(hand: HandState | null): EquitySlice {
  const hero = hand?.seats[0];
  if (hand === null || hand.phase === 'complete' || hero?.hole == null || !hero.dealtIn) {
    return initialEquity();
  }
  if (hero.folded) return { ...initialEquity(), status: 'folded' };
  const nOpp = hand.seats.filter((s, i) => i !== 0 && s.dealtIn && !s.folded).length;
  const analysis: HandAnalysis = {
    ...analyzeHand(hero.hole, hand.board),
    nextCardPct: null,
    byRiverPct: null,
    chances: CHANCES,
  };
  return {
    ...initialEquity(),
    status: 'done',
    situation: { handSeq: hand.handSeq, hero: hero.hole, board: [...hand.board], nOpp },
    result: {
      n: 40_000,
      win: 0.3,
      split: 0.01,
      equity: 0.31,
      exact: false,
      final: true,
      truncated: false,
    },
    analysis,
  };
}

/** Lets a hint's promise land (the stand-in answers once the slice has the win chance). */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

describe('the Table with the win badge, price chip, draw chips, "By river" and the coach (§15.3)', () => {
  beforeAll(async () => {
    await loadCoach(); // the coach's lazy chunk, as the Table asks for it at mount
  });

  it('stays within 600 DOM nodes with nine players on a wide screen, the coach panel open', async () => {
    h = startTableHarness({ settings: { players: 9 } });
    render(<App />);
    act(() => h?.state().dispatch({ type: 'play' }));
    act(() => h?.state().dispatch({ type: 'layout', layout: 'wide' }));
    const seen = { badge: 0, price: 0, chips: 0, river: 0, shown: 0, coach: 0 };
    let most = 0;
    const start = (h.state().game.hand as HandState).handSeq;
    await playUntil(() => (h?.state().game.hand?.handSeq ?? 0) >= start + 12, {
      onStep: () => {
        act(() => appStore.setState({ equity: sliceFor(appStore.getState().game.hand) }));
        most = Math.max(most, document.querySelectorAll('*').length);
        if (document.querySelector('[data-win-badge="value"]')) seen.badge++;
        if (document.querySelector('[data-price-chip]')) seen.price++;
        if (document.querySelector('[data-draw-chips]')) seen.chips++;
        if (document.querySelector('[data-by-river]')) seen.river++;
        if (document.querySelector('[data-coach-details="panel"]')) seen.coach++;
        seen.shown = Math.max(seen.shown, appStore.getState().game.hand?.revealed.length ?? 0);
      },
      // The hero waits a moment on its turn: the hint lands and the panel shows its sections.
      beforeHero: async () => {
        await settle();
        most = Math.max(most, document.querySelectorAll('*').length);
        if (document.querySelector('[data-coach-details="panel"]')) seen.coach++;
      },
    });
    // Everything was on screen at some point, and showdowns happened (the heaviest moments).
    expect(seen.badge).toBeGreaterThan(0);
    expect(seen.price).toBeGreaterThan(0);
    expect(seen.chips).toBeGreaterThan(0);
    expect(seen.river).toBeGreaterThan(0);
    expect(seen.shown).toBeGreaterThanOrEqual(3);
    expect(seen.coach).toBeGreaterThan(5);
    expect(most).toBeLessThanOrEqual(600);
  }, 90_000);

  it('stays within 600 DOM nodes with nine players in portrait, the strip on, the sheet open', async () => {
    h = startTableHarness({ settings: { players: 9 } });
    render(<App />);
    act(() => h?.state().dispatch({ type: 'play' }));
    const seen = { strip: 0, sheet: 0 };
    let most = 0;
    const start = (h.state().game.hand as HandState).handSeq;
    await playUntil(() => (h?.state().game.hand?.handSeq ?? 0) >= start + 8, {
      onStep: () => {
        act(() => appStore.setState({ equity: sliceFor(appStore.getState().game.hand) }));
        most = Math.max(most, document.querySelectorAll('*').length);
        if (document.querySelector('[data-coach-strip]')) seen.strip++;
      },
      beforeHero: async () => {
        await settle();
        const advice = document.querySelector('[data-coach-strip="advice"] button');
        if (advice instanceof HTMLElement) {
          act(() => advice.click());
          await settle();
        }
        if (document.querySelector('[data-coach-sheet]')) seen.sheet++;
        most = Math.max(most, document.querySelectorAll('*').length);
      },
    });
    expect(seen.strip).toBeGreaterThan(0);
    expect(seen.sheet).toBeGreaterThan(3);
    expect(most).toBeLessThanOrEqual(600);
  }, 90_000);
});
