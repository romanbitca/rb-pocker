// @vitest-environment jsdom
/**
 * The draw chips (PLAN §6.2–§6.4, §12.3, Appendix F.3, D.2; pitfall 36): at most `max` chips and
 * "+1", a tap shows every draw with its out cards, risky outs are marked by a "!" shape and the
 * words "may help them too" (not by colour alone), and Exam shows names that do not open.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { analyzeHand } from '../../../src/analysis/handinfo.ts';
import { drawChipsOf } from '../../../src/app/store.ts';
import { cardAriaLabel } from '../../../src/core/cards.ts';
import type { HandState } from '../../../src/engine/types.ts';
import { en } from '../../../src/i18n/en.ts';
import { DrawChips } from '../../../src/ui/components/DrawChips.tsx';
import { drawChipViews, type DrawChipView } from '../../../src/ui/equity.ts';
import { card, cards, hole } from '../../helpers/cards.ts';

afterEach(cleanup);

/** The chips for a hand on the flop or turn (Appendix D.2 vectors). */
function chipsFor(holeText: string, boardText: string, level: 'beginner' | 'exam' = 'beginner') {
  const h = hole(holeText);
  const board = cards(boardText);
  const seat = (c: typeof h | null) => ({ dealtIn: true, hole: c, folded: false });
  const hand = {
    handSeq: 1,
    phase: 'betting',
    board,
    seats: [seat(h), seat(null)],
    runout: false,
  } as unknown as HandState;
  const analysis = { ...analyzeHand(h, board), nextCardPct: null, byRiverPct: null, chances: null };
  return drawChipViews(drawChipsOf(hand, analysis, level));
}

describe('DrawChips', () => {
  it('A♥K♥ on Q♥7♥2♣, one chip on a phone: the nut flush draw and "+1"', () => {
    const chips = chipsFor('A♥ K♥', 'Q♥ 7♥ 2♣');
    render(<DrawChips chips={chips} max={1} placement="up" />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual([
      'Nut flush draw · 9 outs · 35% by river (1 risky)',
      '+1',
    ]);
    expect(buttons[1]?.getAttribute('aria-label')).toBe(en.draws.moreLabel);
  });

  it('on a phone (compact): the short text and a "!" for risky outs; the full text is its name', () => {
    const chips = chipsFor('A♥ K♥', 'Q♥ 7♥ 2♣');
    render(<DrawChips chips={chips} max={1} placement="up" compact={true} />);
    const chip = screen.getByRole('button', {
      name: 'Nut flush draw · 9 outs · 35% by river (1 risky)',
    });
    expect(chip.textContent).toBe('Nut flush draw · 35% by river!');
  });

  it('two chips on a wide screen', () => {
    const chips = chipsFor('9♠ 8♠', '7♦ 6♣ 2♥');
    render(<DrawChips chips={chips} max={2} placement="up" />);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Open-ended straight draw · 8 outs · 31% by river',
      'Two overcards · 6 outs · 24% by river (6 risky)',
    ]);
  });

  it('a tap lists every draw with its out cards; risky ones carry "!" and say so', () => {
    const chips = chipsFor('A♥ K♥', 'Q♥ 7♥ 2♣');
    render(<DrawChips chips={chips} max={1} placement="up" />);
    fireEvent.click(screen.getByRole('button', { name: /Nut flush draw/ }));
    const flush = screen.getByRole('region', { name: /Nut flush draw/ });
    const flushCards = within(flush).getAllByRole('img');
    expect(flushCards).toHaveLength(9);
    // 2♥ is risky (R2, §6.4 / D.2): the "!" shape plus the words, never colour alone.
    const risky = within(flush).getByRole('img', {
      name: en.draws.riskyCard(cardAriaLabel(card('2♥'))),
    });
    expect(risky.parentElement?.textContent).toContain(en.draws.riskyMark);
    expect(within(flush).getByRole('img', { name: cardAriaLabel(card('9♥')) })).toBeTruthy();
    const over = screen.getByRole('region', { name: /Two overcards/ });
    expect(within(over).getAllByRole('img')).toHaveLength(6);
    expect(screen.getByText(en.draws.riskyCaption)).toBeTruthy();
    // Escape closes it.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('Exam: the names only, not buttons (§10.2)', () => {
    const chips = chipsFor('J♠ 10♠', 'Q♠ 9♦ 2♠', 'exam');
    render(<DrawChips chips={chips} max={1} placement="up" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(document.querySelector('[data-draw-chips]')?.textContent).toBe('Flush draw+1');
  });

  it('nothing without draws', () => {
    const none: DrawChipView[] = [];
    const { container } = render(<DrawChips chips={none} max={2} placement="up" />);
    expect(container.innerHTML).toBe('');
  });
});
