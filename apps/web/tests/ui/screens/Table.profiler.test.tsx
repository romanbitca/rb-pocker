// @vitest-environment jsdom
/**
 * PLAN pitfall 37 and §15.3 "Techniques": equity progress writes only the store's `equity` slice
 * and every table component subscribes with a narrow selector, so a stream of equity updates
 * renders nothing on the table. The Table is wrapped in React's `<Profiler>`; `Seat` is wrapped
 * (same `React.memo` comparator) to count its renders.
 */
import { act, cleanup, render } from '@testing-library/react';
import { Profiler } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appStore, initialEquity, type EquitySlice } from '../../../src/app/store.ts';
import type { SeatProps } from '../../../src/ui/components/Seat.tsx';
import { Table } from '../../../src/ui/screens/Table.tsx';
import { passive, playUntil, startTableHarness, type TableHarness } from '../tableHarness.ts';

const renders = vi.hoisted(() => ({ seat: 0 }));

vi.mock('../../../src/ui/components/Seat.tsx', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../src/ui/components/Seat.tsx')>();
  const { createElement, memo } = await import('react');
  const Counted = memo(function CountedSeat(props: SeatProps) {
    renders.seat++;
    return createElement(mod.Seat, props);
  }, mod.seatPropsEqual);
  return { ...mod, Seat: Counted };
});

let h: TableHarness | null = null;

afterEach(() => {
  cleanup();
  h?.dispose();
  h = null;
});

describe('pitfall 37: equity progress never re-renders the table', () => {
  it('50 equity-slice updates cause zero Seat renders (and no table render at all)', async () => {
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

    const seatsBefore = renders.seat;
    commits.length = 0;
    for (let i = 0; i < 50; i++) {
      // A new slice object each time, as a worker progress message would write it.
      const progress: EquitySlice = {
        ...initialEquity(),
        status: 'computing',
        result: {
          n: 2_500 + i,
          win: 0.5,
          split: 0.01,
          equity: 0.51,
          exact: false,
          final: false,
          truncated: false,
        },
      };
      act(() => appStore.setState({ equity: progress }));
    }
    expect(renders.seat).toBe(seatsBefore);
    expect(commits).toEqual([]);

    // A game change does render (the Profiler is live).
    const legal = h.state().game.legal;
    if (legal === null) throw new Error('hero turn without legal actions');
    act(() => h?.state().dispatch({ type: 'act', action: passive(legal) }));
    expect(commits.length).toBeGreaterThan(0);
  }, 20_000);
});
