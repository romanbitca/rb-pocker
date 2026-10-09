// @vitest-environment jsdom
// The coach sheet (chunk 5.9, PLAN §12.6, §8.10, §12.12): its sections per level, the labelled
// numbers and price bar, RANGE_ADJUST first, glossary popovers, "Your hand" with out cards, "Use
// coach size", and the sheet as a modal dialog that never covers the action bar. The words are
// chunk 5.6's `explain()` of the fixture decisions (chunk 5.7).
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeHand } from '../../../src/analysis/handinfo.ts';
import type { HandAnalysis } from '../../../src/analysis/types.ts';
import {
  appStore,
  initialCoach,
  initialEquity,
  initialGame,
  type CoachData,
} from '../../../src/app/store.ts';
import { legalActions } from '../../../src/engine/legal.ts';
import { coachWords } from '../../../src/i18n/coachUi.ts';
import { en } from '../../../src/i18n/en.ts';
import { coachView } from '../../../src/ui/coach.ts';
import { CoachDetails, CoachSheet } from '../../../src/ui/components/CoachSheet.tsx';
import { playSpot } from '../../brain/fixtures.ts';
import { tableWith } from '../../engine/helpers.ts';
import { bet, call, check } from '../../engine/play.ts';
import { card } from '../../helpers/cards.ts';
import { coachData, decision, FACING, input, r, rangeAdjusted } from '../coachFixtures.ts';
import { smallTapTargets } from '../dom.ts';

afterEach(() => {
  cleanup();
  appStore.setState({ game: initialGame(), equity: initialEquity(), coach: initialCoach() });
});

const view = (over: Partial<CoachData> = {}) => coachView(coachData(over), null, input(FACING));

const headings = (root: HTMLElement): string[] =>
  [...root.querySelectorAll('h3')].map((h) => h.textContent ?? '');

/** Every interactive element but the inline glossary terms (their hit area is CSS, §12.12). */
const smallTargets = (root: HTMLElement): string[] =>
  smallTapTargets(root).filter((t) => !t.includes('glossary'));

describe('CoachDetails (§12.6)', () => {
  it('Beginner: do this, why, the numbers with the price bar, why not, use coach size', () => {
    const onUseSize = vi.fn();
    const { container } = render(
      <CoachDetails view={view()} place="sheet" onUseSize={onUseSize} />,
    );
    expect(headings(container)).toEqual([
      coachWords.doThis,
      coachWords.whyTitle,
      coachWords.numbers,
      coachWords.whyNotTitle,
    ]);
    expect(screen.getByText('Call 40')).toBeTruthy();
    expect(screen.getByText(coachWords.clear)).toBeTruthy();
    // The strength meter: its word, and a name for screen readers.
    expect(screen.getByRole('img', { name: 'Hand strength: Decent' }).textContent).toBe('Decent');
    // The whole reason at Beginner, no "More".
    expect(screen.getByText(/You win about 45%\. You need 25% to call 40 into 120\./)).toBeTruthy();
    expect(screen.queryByRole('button', { name: coachWords.more })).toBeNull();
    const numbers = [...container.querySelectorAll('li')].map((li) => li.textContent);
    expect(numbers).toEqual([
      'Win chance 45% (any cards)',
      'Need 25%',
      'Pot 120',
      'To call 40',
      'Why not fold? You win more often than you need to.',
      'Why not raise? Worse hands fold, and better hands call.',
    ]);
    const bar = screen.getByRole('img', { name: 'Win chance 45% (any cards). Need 25%.' });
    expect(bar.getAttribute('data-good')).toBe('true');
    expect(bar.getAttribute('style')).toContain('--win: 0.450');
    expect(bar.getAttribute('style')).toContain('--need: 0.250');
    expect(screen.getByText(coachWords.barGood)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: en.badge.howLink }));
    expect(screen.getByText(en.badge.how('45%'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: coachWords.useSize }));
    expect(onUseSize).toHaveBeenCalledOnce();
    expect(smallTargets(container)).toEqual([]);
  });

  it('the panels leave the headline to their head row; no button without a size', () => {
    render(<CoachDetails view={view()} place="panel" onUseSize={null} />);
    expect(screen.queryByText('Call 40')).toBeNull();
    expect(screen.queryByRole('button', { name: coachWords.useSize })).toBeNull();
  });

  it('Intermediate: the reason’s first sentence and "More", no strength meter', () => {
    render(
      <CoachDetails
        view={view({ level: 'intermediate', opened: true })}
        place="sheet"
        onUseSize={null}
      />,
    );
    expect(screen.queryByRole('img', { name: /Hand strength/ })).toBeNull();
    expect(screen.getByText('You win about 45%.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: coachWords.more }));
    expect(screen.getByText(/so calling wins over time\.$/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: coachWords.more })).toBeNull();
  });

  it('a close call names the other action instead of "Clear choice"', () => {
    const close = decision({
      confidence: 'close',
      alt: { type: 'fold' },
      trace: [r('CALL_PROFITABLE', { toCall: 40, pot: 120 }), r('CLOSE_SPOT')],
    });
    render(<CoachDetails view={view({ decision: close })} place="sheet" onUseSize={null} />);
    expect(screen.getByText('Close call: Fold is also fine.')).toBeTruthy();
    expect(screen.queryByText(coachWords.clear)).toBeNull();
  });

  it('RANGE_ADJUST (§8.10): both equities, labelled, before the reason that uses the range one', () => {
    const { container } = render(
      <CoachDetails view={view({ decision: rangeAdjusted() })} place="sheet" onUseSize={null} />,
    );
    const why = container.querySelectorAll('section')[1] as HTMLElement;
    const lines = [...why.querySelectorAll('p')].map((p) => p.textContent);
    expect(lines).toEqual([
      'Against any cards you win 62%. This player bets only with good hands. Against those, you win about 20%.',
      'You need 25% to call. You win only about 20%. Folding saves chips.',
    ]);
    const numbers = [...container.querySelectorAll('li')].map((li) => li.textContent);
    expect(numbers.slice(0, 2)).toEqual([
      'Win chance 62% (any cards)',
      'Against their likely hands: about 20%',
    ]);
    expect(
      screen.getByRole('img', { name: 'Against their likely hands: about 20%. Need 25%.' }),
    ).toBeTruthy();
    expect(screen.getByText(coachWords.barBad)).toBeTruthy();
  });

  it('glossary terms are dotted buttons with a one-line definition (F.9)', () => {
    const setMining = decision({ trace: [r('SET_MINING')] });
    render(<CoachDetails view={view({ decision: setMining })} place="sheet" onUseSize={null} />);
    const term = screen.getByRole('button', { name: 'pocket pair' });
    expect(term.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(term);
    expect(term.getAttribute('aria-expanded')).toBe('true');
    const note = screen.getByRole('note');
    expect(note.textContent).toBe('pocket pair: Two hole cards of the same rank.');
    expect(term.getAttribute('aria-controls')).toBe(note.id);
    // Another term replaces it; Esc closes it.
    fireEvent.click(screen.getByRole('button', { name: 'set' }));
    expect(screen.getByRole('note').textContent).toBe(
      'set: Three of a kind made with a pocket pair.',
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('note')).toBeNull();
  });
});

describe('"Your hand" (§12.6 (4))', () => {
  beforeEach(() => {
    // Heads-up flop: the hero has A♥K♥ on K♠ 8♥ 3♥ (top pair and a nut flush draw).
    const hand = playSpot({
      stacks: [10_000, 10_000],
      button: 0,
      holes: { 0: 'Ah Kh', 1: '7c 2d' },
      board: 'Ks 8h 3h',
      inputs: [call(0), check(1), bet(1, 100)],
    });
    const analysis: HandAnalysis = {
      ...analyzeHand([card('Ah'), card('Kh')], [...hand.board]),
      nextCardPct: 19.15,
      byRiverPct: 34.97,
      chances: null,
    };
    appStore.setState({
      game: {
        ...initialGame(),
        mode: 'heroTurn',
        hand,
        table: tableWith([10_000, 10_000]),
        legal: legalActions(hand),
      },
      equity: {
        ...initialEquity(),
        status: 'done',
        situation: {
          handSeq: hand.handSeq,
          hero: [card('Ah'), card('Kh')],
          board: [...hand.board],
          nOpp: 1,
        },
        analysis,
      },
    });
  });

  it('the label, the draws with their out cards, next card and by river, the beaters', () => {
    const { container } = render(<CoachDetails view={view()} place="sheet" onUseSize={null} />);
    const section = [...container.querySelectorAll('section')].find(
      (s) => s.querySelector('h3')?.textContent === coachWords.yourHand,
    ) as HTMLElement;
    expect(section).toBeTruthy();
    const text = section.textContent ?? '';
    expect(text).toContain('Pair of Kings');
    expect(text).toContain('Nut flush draw');
    expect(text).toContain('Next card: 19% · By river: 35%');
    expect(text).toMatch(/Hands that beat you right now: \d+ of \d+ possible/);
    // Out cards are example cards for the leak watch (Stage 3 acceptance 7).
    const outs = section.querySelector('[data-examples]') as HTMLElement;
    expect(within(outs).getAllByRole('img').length).toBeGreaterThan(0);
  });
});

describe('CoachSheet (§12.6, §12.12)', () => {
  it('a modal dialog: focus moves in, Esc, the scrim and ✕ close it, focus returns', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const onClose = vi.fn();
    const { container, unmount } = render(
      <CoachSheet view={view()} onClose={onClose} onUseSize={null} />,
    );
    const dialog = screen.getByRole('dialog', { name: en.coachUi.title });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: coachWords.close }));
    fireEvent.click(container.querySelector('[aria-hidden="true"]') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(smallTargets(dialog)).toEqual([]);
    act(() => unmount());
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('keeps Tab inside the sheet', () => {
    render(<CoachSheet view={view()} onClose={() => {}} onUseSize={() => {}} />);
    const dialog = screen.getByRole('dialog');
    const buttons = within(dialog).getAllByRole('button');
    const last = buttons[buttons.length - 1] as HTMLElement;
    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});
