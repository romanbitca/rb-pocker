// @vitest-environment jsdom
/**
 * All-in TV mode on the table (PLAN §7.6; chunk 4.7): the bars sit in the free bet slots of the
 * face-up players, name the player and the number for screen readers, and the hand-end banner gets
 * the luck line. The store is set by hand (the equity jobs are tested in tests/app).
 */
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appStore,
  faceUpSeats,
  initialEquity,
  initialGame,
  type KnownEquity,
} from '../../../src/app/store.ts';
import type { HandState, TableState } from '../../../src/engine/types.ts';
import { RunoutBars, useLuckLine } from '../../../src/ui/components/Runout.tsx';
import type { Rect } from '../../../src/ui/layout/seats.ts';
import { deal, rigDeck, tableWith } from '../../engine/helpers.ts';
import { ADVANCE, call, play, raise } from '../../engine/play.ts';

afterEach(cleanup);

let table: TableState;
let flop: HandState;
let complete: HandState;

beforeEach(() => {
  table = tableWith([10_000, 10_000], { button: 0 });
  const dealt = rigDeck(deal(table), {
    holes: { 0: '2c 3d', 1: 'Kh Kd' },
    board: 'Ks 7c 2h 9d 4s',
  });
  flop = play(dealt, raise(0, 10_000), call(1), ADVANCE);
  complete = play(flop, ADVANCE, ADVANCE, ADVANCE, ADVANCE);
  appStore.setState({ game: initialGame(), equity: initialEquity() });
});

const BETS: Rect[] = [{ x: 150, y: 90, w: 56, h: 20 }];
const HERO: Rect = { x: 160, y: 300, w: 56, h: 20 };

const knownFor = (hand: HandState, hero: number): KnownEquity => {
  const seats = faceUpSeats(hand);
  return {
    handSeq: hand.handSeq,
    seats,
    board: [...hand.board],
    perPlayer: seats.map((s) => (s === 0 ? hero : 1 - hero)),
    exact: true,
    final: true,
  };
};

function show(hand: HandState, eq: Partial<ReturnType<typeof initialEquity>>, mode = 'advancing') {
  act(() =>
    appStore.setState({
      game: { ...initialGame(), mode: mode as never, table, hand },
      equity: { ...initialEquity(), ...eq },
    }),
  );
}

describe('RunoutBars', () => {
  it('draws nothing without a run-out', () => {
    render(<RunoutBars bets={BETS} hero={HERO} />);
    expect(document.querySelectorAll('[data-runout-seat]')).toHaveLength(0);
    show(flop, {}); // face up, but no numbers yet
    expect(document.querySelectorAll('[data-runout-seat]')).toHaveLength(0);
  });

  it('one bar per face-up player, in its bet slot, named for screen readers', () => {
    render(<RunoutBars bets={BETS} hero={HERO} />);
    show(flop, { mode: 'known', known: knownFor(flop, 0.0808) });
    const bot = table.slots[1]?.name ?? '';
    const heroBar = screen.getByRole('img', { name: 'You: 8% win chance' });
    const botBar = screen.getByRole('img', { name: `${bot}: 92% win chance` });
    // Centred in the 56×20 slot: a 52×20 pill, 2 px in from its left edge.
    const place = (el: HTMLElement) => [el.style.left, el.style.top, el.dataset['runoutSeat']];
    expect(place(heroBar)).toEqual(['162px', '300px', '0']);
    expect(place(botBar)).toEqual(['152px', '90px', '1']);
    expect(heroBar.textContent).toBe('8%');
    // One element per bar; the fill is its ::after, scaled by --fill.
    expect(botBar.children).toHaveLength(0);
    expect(botBar.style.getPropertyValue('--fill')).toBe('0.92');
  });

  it('follows the new street’s numbers and leaves when the hand is complete', () => {
    render(<RunoutBars bets={BETS} hero={HERO} />);
    show(flop, { mode: 'known', known: knownFor(flop, 0.08) });
    expect(screen.getByRole('img', { name: 'You: 8% win chance' })).toBeTruthy();
    show(flop, { mode: 'known', known: knownFor(flop, 0.25) });
    expect(screen.getByRole('img', { name: 'You: 25% win chance' })).toBeTruthy();
    show(complete, { known: knownFor(complete, 0) }, 'handEnd');
    expect(document.querySelectorAll('[data-runout-seat]')).toHaveLength(0);
  });
});

describe('useLuckLine', () => {
  it('gives the §7.6 line at the hand end only', () => {
    const { result } = renderHook(() => useLuckLine());
    expect(result.current).toBeNull();
    // The hero lost the hand (2♣3♦ against K♥K♦); say it had 81% when the chips went in.
    const allIn = { ...knownFor(complete, 0.81), board: [] };
    show(complete, { allIn }, 'advancing');
    expect(result.current).toBeNull(); // the banner is not up yet
    show(complete, { allIn }, 'handEnd');
    expect(result.current).toBe(
      'You had 81% when the chips went in. Good decision. Unlucky this time.',
    );
  });
});
