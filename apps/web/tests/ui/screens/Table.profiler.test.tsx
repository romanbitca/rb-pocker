// @vitest-environment jsdom
/**
 * PLAN pitfall 37 and §15.3 "Techniques": equity progress writes only the store's `equity` slice
 * and every table component subscribes with a narrow selector, so a stream of equity updates
 * re-renders the win badge and nothing else: zero `Seat` renders. The Table is wrapped in React's
 * `<Profiler>`; `Seat` and `WinBadge` are wrapped (same `React.memo`) to count their renders.
 */
import { act, cleanup, render } from '@testing-library/react';
import { Profiler } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HintSource } from '../../../src/app/coachJobs.ts';
import { appStore, initialEquity, type EquitySlice } from '../../../src/app/store.ts';
import type { Decision } from '../../../src/brain/types.ts';
import type { Card } from '../../../src/core/cards.ts';
import type { HandState } from '../../../src/engine/types.ts';
import { loadCoach } from '../../../src/ui/coachModule.ts';
import type { SeatProps } from '../../../src/ui/components/Seat.tsx';
import type { WinBadgeProps } from '../../../src/ui/components/WinBadge.tsx';
import { Table } from '../../../src/ui/screens/Table.tsx';
import { passive, playUntil, startTableHarness, type TableHarness } from '../tableHarness.ts';

const renders = vi.hoisted(() => ({ seat: 0, badge: 0 }));

vi.mock('../../../src/ui/components/Seat.tsx', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../src/ui/components/Seat.tsx')>();
  const { createElement, memo } = await import('react');
  const Counted = memo(function CountedSeat(props: SeatProps) {
    renders.seat++;
    return createElement(mod.Seat, props);
  }, mod.seatPropsEqual);
  return { ...mod, Seat: Counted };
});

vi.mock('../../../src/ui/components/WinBadge.tsx', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../src/ui/components/WinBadge.tsx')>();
  const { createElement, memo } = await import('react');
  const Counted = memo(function CountedBadge(props: WinBadgeProps) {
    renders.badge++;
    return createElement(mod.WinBadge, props);
  });
  return { ...mod, WinBadge: Counted };
});

let h: TableHarness | null = null;

afterEach(() => {
  cleanup();
  h?.dispose();
  h = null;
  appStore.setState({ equity: initialEquity() });
});

/**
 * An `equity` slice as the equity jobs (chunk 4.5) write a Monte Carlo progress message for the
 * current hand: a new object each time, a growing `n` and a drifting estimate.
 */
function progress(hand: HandState, i: number): EquitySlice {
  const nOpp = hand.seats.filter((s, seat) => seat !== 0 && s.dealtIn && !s.folded).length;
  return {
    ...initialEquity(),
    status: 'computing',
    situation: {
      handSeq: hand.handSeq,
      hero: hand.seats[0]?.hole as [Card, Card],
      board: [...hand.board],
      nOpp,
    },
    result: {
      n: 2_000 * (i + 1),
      win: 0.4 + 0.004 * i,
      split: 0.01,
      equity: 0.41 + 0.004 * i,
      exact: false,
      final: false,
      truncated: false,
    },
  };
}

describe('pitfall 37: equity progress never re-renders the table', () => {
  it('50 equity progress messages: the badge updates, zero Seat renders', async () => {
    h = startTableHarness();
    const commits: string[] = [];
    render(
      <Profiler id="table" onRender={(id, phase) => commits.push(`${id}:${phase}`)}>
        <Table />
      </Profiler>,
    );
    act(() => h?.state().dispatch({ type: 'play' }));
    await playUntil(() => h?.state().game.mode === 'heroTurn');
    // The counters work: the seats rendered while the hand was dealt and played.
    expect(renders.seat).toBeGreaterThan(0);
    expect(commits.length).toBeGreaterThan(0);

    const hand = h.state().game.hand as HandState;
    const seatsBefore = renders.seat;
    const badgeBefore = renders.badge;
    for (let i = 0; i < 50; i++) {
      act(() => appStore.setState({ equity: progress(hand, i) }));
    }
    expect(renders.seat).toBe(seatsBefore);
    // The progress reached the badge: it rendered, and shows the stream's end through the
    // hysteresis (60.6 is within 1.0 point of the 60 on show since 60.2).
    expect(renders.badge).toBeGreaterThan(badgeBefore);
    const badge = document.querySelector('[data-win-badge]');
    expect(badge?.textContent).toBe('~60%win chance');

    // Writes that change nothing on screen render nothing at all.
    act(() => appStore.setState({ equity: initialEquity() }));
    commits.length = 0;
    for (let i = 0; i < 50; i++) {
      act(() => appStore.setState({ equity: initialEquity() }));
    }
    expect(commits).toEqual([]);
    expect(renders.seat).toBe(seatsBefore);

    // A game change does render (the Profiler is live).
    const legal = h.state().game.legal;
    if (legal === null) throw new Error('hero turn without legal actions');
    act(() => h?.state().dispatch({ type: 'act', action: passive(legal) }));
    expect(commits.length).toBeGreaterThan(0);
  }, 20_000);

  it('a coach hint landing (chunk 5.9) renders the coach and Row A, zero Seat renders', async () => {
    await loadCoach();
    let answer: ((d: Decision) => void) | null = null;
    const hints: HintSource = {
      waitsForWinChance: false,
      request: () => new Promise<Decision>((resolve) => (answer = resolve)),
    };
    h = startTableHarness({ hints });
    render(<Table />);
    act(() => h?.state().dispatch({ type: 'play' }));
    await playUntil(() => h?.state().game.mode === 'heroTurn' && answer !== null);
    expect(document.querySelector('[data-coach-strip="thinking"]')).not.toBeNull();
    const seatsBefore = renders.seat;
    const legal = h.state().game.legal;
    if (legal === null || answer === null) throw new Error('no hero turn');
    const land = answer as (d: Decision) => void;
    await act(async () => {
      land({
        action: passive(legal),
        kind: legal.canCheck ? 'check' : 'call',
        ev: {},
        eRandom: 0.5,
        eRange: 0.5,
        need: 0.2,
        bucket: null,
        strength: 'decent',
        confidence: 'clear',
        alt: null,
        trace: [{ code: legal.canCheck ? 'CHECK_FREE' : 'CALL_PROFITABLE', data: {} }],
      });
      await Promise.resolve();
    });
    expect(document.querySelector('[data-coach-strip="advice"]')).not.toBeNull();
    expect(document.querySelector('[data-coach][data-slot]')).not.toBeNull();
    expect(renders.seat).toBe(seatsBefore);
  }, 20_000);
});
