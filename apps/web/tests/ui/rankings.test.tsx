// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe as suite, expect, it } from 'vitest';
import { RANKINGS } from '../../src/data/rankings.ts';
import { describe } from '../../src/eval/describe.ts';
import {
  exampleCards,
  formatOneIn,
  formatRarity,
  heroHandView,
  rowIndex,
  rowLabel,
  rowStatus,
  useHandsTabDot,
  useImprovementPulse,
  youLine,
} from '../../src/ui/rankings.ts';
import type { HeroHandView } from '../../src/ui/views.ts';
import { cards, hole } from '../helpers/cards.ts';

function hero(holeText: string, boardText: string, folded = false, handSeq = 1): HeroHandView {
  const h = hole(holeText);
  return heroHandView(describe(h, cards(boardText)), h, folded, handSeq);
}

suite('rankings logic (PLAN §13.2–§13.4)', () => {
  it('prints rarity exactly as the §13.2 table', () => {
    expect(RANKINGS.map((r) => `${formatRarity(r.rarity)} (${formatOneIn(r.oneIn)})`)).toEqual([
      '0.003% (1 in 30,900)',
      '0.03% (1 in 3,600)',
      '0.17% (1 in 595)',
      '2.6% (1 in 39)',
      '3.0% (1 in 33)',
      '4.6% (1 in 22)',
      '4.8% (1 in 21)',
      '23.5% (1 in 4)',
      '43.8% (1 in 2)',
      '17.4% (1 in 6)',
    ]);
  });

  it('gives all five example cards the gold edge, the kickers not raised (1.3.100)', () => {
    const quads = exampleCards(RANKINGS[2]);
    expect(quads.map((c) => c.highlight)).toEqual(['core', 'core', 'core', 'core', 'kicker']);
    const high = exampleCards(RANKINGS[9]);
    expect(high.map((c) => c.highlight)).toEqual(['core', 'kicker', 'kicker', 'kicker', 'kicker']);
  });

  it('marks the hero’s row, the rows that beat it and the rows it beats', () => {
    const h = hero('Kh Kc', 'Kd 4s 4h 9c 2d'); // full house, row 3
    expect(rowIndex('fullHouse')).toBe(3);
    expect(RANKINGS.map((_, i) => rowStatus(i, h))).toEqual([
      'beatsYou',
      'beatsYou',
      'beatsYou',
      'you',
      'youBeat',
      'youBeat',
      'youBeat',
      'youBeat',
      'youBeat',
      'youBeat',
    ]);
  });

  it('greys the row after a fold and shows nothing between hands', () => {
    const folded = hero('Kh Kc', 'Kd 4s 2h', true);
    expect(RANKINGS.map((_, i) => rowStatus(i, folded))).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      'folded',
      null,
      null,
      null,
    ]);
    expect(RANKINGS.map((_, i) => rowStatus(i, null)).every((s) => s === null)).toBe(true);
  });

  it('highlights one pair for pocket pairs preflop and high card otherwise (§13.3)', () => {
    expect(hero('7h 7c', '').category).toBe('pair');
    expect(hero('Ah Kh', '').category).toBe('highCard');
  });

  it('builds the "You" line from the best five, gold edge on all five, own cards underlined', () => {
    const h = hero('Kh Qc', 'Kd 7s 2h');
    expect(youLine(h)).toEqual([
      { card: h.best5[0], used: true, highlight: 'core' },
      { card: h.best5[1], used: false, highlight: 'core' },
      { card: h.best5[2], used: true, highlight: 'kicker' },
      { card: h.best5[3], used: false, highlight: 'kicker' },
      { card: h.best5[4], used: false, highlight: 'kicker' },
    ]);
    // Preflop there is no best five yet: the two hole cards, plain.
    const pre = hero('Ah 9d', '');
    expect(youLine(pre).map((c) => c.card)).toEqual([...pre.hole]);
    expect(youLine(pre).every((c) => c.highlight === undefined)).toBe(true);
    // After a fold nothing has the gold edge (as on the Table).
    expect(youLine(hero('Kh Kc', 'Kd 4s 2h', true)).every((c) => c.highlight === undefined)).toBe(
      true,
    );
  });

  it('labels rows for screen readers as §13.4 shows', () => {
    expect(rowLabel(3, 'you')).toBe(
      'Rank 4, Full house. Example: King, King, King, Four, Four. ' +
        'Three of one rank plus two of another. You have this hand. How often: 2.6%, 1 in 39.',
    );
    expect(rowLabel(0, 'beatsYou')).toContain('Example: Ace, King, Queen, Jack, Ten.');
    expect(rowLabel(0, 'beatsYou')).toContain('It beats your hand.');
    expect(rowLabel(9, null)).not.toMatch(/your hand|You /);
  });
});

suite('improvement pulse and tab dot (§13.1, §13.3)', () => {
  it('pulses once per improvement within a hand, never across hands or after a fold', () => {
    let h: HeroHandView | null = hero('Kh Qc', '');
    const { result, rerender } = renderHook(() => useImprovementPulse(h));
    expect(result.current).toBe(0);
    h = hero('Kh Qc', 'Kd 7s 2h'); // high card → pair
    rerender();
    expect(result.current).toBe(1);
    h = hero('Kh Qc', 'Kd 7s 2h 9c'); // still a pair: no pulse
    rerender();
    expect(result.current).toBe(1);
    h = hero('Kh Qc', 'Kd 7s 2h 9c Qd'); // two pair
    rerender();
    expect(result.current).toBe(2);
    h = hero('7h 7c', '', false, 2); // next hand starts with a pair: not an improvement
    rerender();
    expect(result.current).toBe(2);
    h = hero('7h 7c', '7d 2s 3c', true, 2); // folded
    rerender();
    expect(result.current).toBe(2);
  });

  it('lights the tab dot on improvement while closed, and clears it on open', () => {
    let h: HeroHandView | null = hero('Kh Qc', '');
    let open = false;
    const { result, rerender } = renderHook(() => useHandsTabDot(h, open));
    expect(result.current).toBe(false);
    h = hero('Kh Qc', 'Kd 7s 2h');
    rerender();
    expect(result.current).toBe(true);
    open = true;
    rerender();
    expect(result.current).toBe(false);
    open = false;
    rerender();
    expect(result.current).toBe(false); // seen: stays off until the next improvement
    h = hero('Kh Qc', 'Kd 7s 2h 9c Qd');
    rerender();
    expect(result.current).toBe(true);
    act(() => {
      h = hero('Kh Qc', 'Kd 7s 2h 9c Qd', true); // folded: no dot
    });
    rerender();
    expect(result.current).toBe(false);
    h = hero('2h 7c', '', false, 9); // a new hand
    rerender();
    expect(result.current).toBe(false);
    h = null; // between hands
    rerender();
    expect(result.current).toBe(false);
  });
});
