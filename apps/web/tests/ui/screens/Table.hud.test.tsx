// @vitest-environment jsdom
/**
 * The Table with the HUD on (PLAN §7.6, §12.3, §13.2, §15.3): nine players on a wide screen with
 * the rankings column, every step fed an `equity` slice as the equity jobs (chunk 4.5) write it
 * (a final estimate, the hand analysis with draws, and chances for all ten rows). The win badge,
 * the price chip, the draw chips and the "By river" column all show, and the screen stays within
 * 600 DOM nodes at every step, showdowns included.
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeHand } from '../../../src/analysis/handinfo.ts';
import type { HandAnalysis } from '../../../src/analysis/types.ts';
import { appStore, type EquitySlice } from '../../../src/app/store.ts';
import { HAND_CATEGORIES } from '../../../src/eval/evaluate.ts';
import type { HandState } from '../../../src/engine/types.ts';
import { App } from '../../../src/ui/App.tsx';
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
  appStore.setState({ equity: { status: 'off' } });
});

const CHANCES = Object.fromEntries(
  HAND_CATEGORIES.map((k) => [k, { exactly: 10, atLeast: 10, boardShared: false }]),
) as NonNullable<HandAnalysis['chances']>;

/** What the equity jobs would have written for this hand by now (a final estimate). */
function sliceFor(hand: HandState | null): EquitySlice {
  const hero = hand?.seats[0];
  if (hand === null || hand.phase === 'complete' || hero?.hole == null || !hero.dealtIn) {
    return { status: 'off' };
  }
  if (hero.folded) return { status: 'folded' } as unknown as EquitySlice;
  const nOpp = hand.seats.filter((s, i) => i !== 0 && s.dealtIn && !s.folded).length;
  const analysis: HandAnalysis = {
    ...analyzeHand(hero.hole, hand.board),
    nextCardPct: null,
    byRiverPct: null,
    chances: CHANCES,
  };
  return {
    status: 'done',
    mode: 'random',
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
    previous: null,
    analysis,
    known: null,
  } as unknown as EquitySlice;
}

describe('the Table with the win badge, price chip, draw chips and "By river" (§15.3)', () => {
  it('stays within 600 DOM nodes with nine players on a wide screen', async () => {
    h = startTableHarness({ settings: { players: 9 } });
    render(<App />);
    act(() => h?.state().dispatch({ type: 'play' }));
    act(() => h?.state().dispatch({ type: 'layout', layout: 'wide' }));
    const seen = { badge: 0, price: 0, chips: 0, river: 0, shown: 0 };
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
        seen.shown = Math.max(seen.shown, appStore.getState().game.hand?.revealed.length ?? 0);
      },
    });
    // Everything was on screen at some point, and showdowns happened (the heaviest moments).
    expect(seen.badge).toBeGreaterThan(0);
    expect(seen.price).toBeGreaterThan(0);
    expect(seen.chips).toBeGreaterThan(0);
    expect(seen.river).toBeGreaterThan(0);
    expect(seen.shown).toBeGreaterThanOrEqual(3);
    expect(most).toBeLessThanOrEqual(600);
  }, 30_000);
});
