// @vitest-environment jsdom
// The coach strip (chunk 5.9, PLAN §12.3, §12.6, §10.2): each state of the strip and the compact
// pill, what a tap does, 44 px targets, and a small DOM (§15.3).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { coachWords } from '../../../src/i18n/coachUi.ts';
import { coachView, type StripView } from '../../../src/ui/coach.ts';
import { CoachStrip, type StripVariant } from '../../../src/ui/components/CoachStrip.tsx';
import { SHELL } from '../../../src/ui/layout/seats.ts';
import { coachData, FACING, input, raiserOnly } from '../coachFixtures.ts';
import { smallTapTargets } from '../dom.ts';

afterEach(cleanup);

const ADVICE: StripView = {
  kind: 'advice',
  headline: 'Call 40',
  headlineShort: 'Call 40',
  line: 'You win about 45%. You need 25%.',
  lineShort: '',
  why: false,
};

function strip(view: StripView, variant: StripVariant = 'strip') {
  const onOpen = vi.fn();
  const onHint = vi.fn();
  const onRetry = vi.fn();
  const r = render(
    <CoachStrip view={view} variant={variant} onOpen={onOpen} onHint={onHint} onRetry={onRetry} />,
  );
  return { ...r, onOpen, onHint, onRetry };
}

describe('CoachStrip (§12.6)', () => {
  it('Beginner: "Coach: Call 40" and its line; one tap anywhere opens the sheet', () => {
    const { container, onOpen } = strip(ADVICE);
    const button = screen.getByRole('button', {
      name: 'Coach: Call 40. You win about 45%. You need 25%. Show why',
    });
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    // Two sentences, one a line (the CSS keeps the "\n", §12.6), and "Why?" on its right end.
    expect(container.textContent).toBe('Coach: Call 40You win about 45%.\nYou need 25%.Why?');
    expect(container.querySelector('[data-coach-why]')?.textContent).toBe(coachWords.why);
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledOnce();
    // §15.3: the section, the button, the head (with its <strong>), the line and "Why?".
    expect(container.querySelectorAll('*')).toHaveLength(6);
    expect(smallTapTargets(container)).toEqual([]);
  });

  it('two numbers for different players (§8.10): the line says whom each counts', () => {
    // The owner's spot through the real view: the HUD's 26% for all 5, 44% for the raiser.
    const view = coachView(coachData(raiserOnly()), null, input(FACING)).strip;
    const { container } = strip(view);
    expect(container.textContent).toBe(
      'Coach: Call 40All 5 players: 26%.\nRaiser alone: about 44%.Why?',
    );
    expect(
      screen.getByRole('button', {
        name: 'Coach: Call 40. All 5 players: 26%. Raiser alone: about 44%. Show why',
      }),
    ).toBeTruthy();
    cleanup();
    // Intermediate after "Hint", with a caller already in: the same line beside "Why?".
    const one = coachView(
      coachData({ ...raiserOnly(1), level: 'intermediate', opened: true }),
      null,
      input(FACING),
    ).strip;
    const why = strip(one);
    expect(why.container.querySelector('[data-coach-advice]')?.textContent).toBe(
      'Coach: Call 40All 5 players: 26%.\nRaiser + 1 caller: about 44%.',
    );
    expect(screen.getByRole('button', { name: coachWords.why })).toBeTruthy();
  });

  it('Intermediate after "Hint": the advice as text and a "Why?" button', () => {
    const { container, onOpen } = strip({ ...ADVICE, line: 'You win about 45%.', why: true });
    expect(container.querySelector('[data-coach-advice]')?.tagName).toBe('P');
    fireEvent.click(screen.getByRole('button', { name: coachWords.why }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(smallTapTargets(container)).toEqual([]);
  });

  it('Intermediate before the tap: "Hint", disabled until the hint is ready', () => {
    const pending = strip({ kind: 'hint', ready: false, countsAsHelp: false });
    const hint = screen.getByRole('button', { name: coachWords.hint });
    expect(hint.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(hint);
    expect(pending.onHint).not.toHaveBeenCalled();
    cleanup();
    const ready = strip({ kind: 'hint', ready: true, countsAsHelp: false });
    fireEvent.click(screen.getByRole('button', { name: coachWords.hint }));
    expect(ready.onHint).toHaveBeenCalledOnce();
    expect(ready.onOpen).not.toHaveBeenCalled();
    expect(smallTapTargets(ready.container)).toEqual([]);
  });

  it('"Coach is thinking…", the narration, and an empty strip', () => {
    strip({ kind: 'thinking' });
    expect(screen.getByText(coachWords.thinking)).toBeTruthy();
    cleanup();
    strip({ kind: 'narration', text: 'Ben raises to 60.' });
    expect(screen.getByText('Ben raises to 60.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    cleanup();
    const empty = strip({ kind: 'empty' });
    expect(empty.container.querySelectorAll('*')).toHaveLength(1);
  });

  it('a failure offers to try again (§12.11)', () => {
    const { onRetry } = strip({ kind: 'failed' });
    fireEvent.click(screen.getByRole('button', { name: coachWords.failed }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('the panels’ head row shows the advice without opening a sheet', () => {
    const { container, onOpen } = strip(ADVICE, 'header');
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.textContent).toContain('Call 40');
    expect(onOpen).not.toHaveBeenCalled();
  });
});

/** A declared CSS length in px (jsdom does not lay out: it reports the stylesheet's values). */
function cssPx(value: string): number {
  if (value.endsWith('rem')) return parseFloat(value) * 16;
  if (value.endsWith('px')) return parseFloat(value);
  throw new Error(`not a length: "${value}"`);
}

/**
 * How far the action bar's "Coach" badge reaches above the bar (ActionBar.module.css: 9 px above
 * its button, whose top is 4 px under the bar's).
 */
const BADGE_REACH = 9 - 4;

/** The height of `lines` lines of an element: its declared font size × line height. */
function linesHeight(el: Element, lines: number): number {
  const cs = getComputedStyle(el);
  return lines * cssPx(cs.fontSize) * parseFloat(cs.lineHeight);
}

/**
 * The longest two-number line through the real view: "All 8 players: 26%. Raiser + 6 callers: about
 * 44%." On a 360–390 px phone the line has 210–294 px, so it takes two lines
 * (tests/e2e/coachStrip.spec.ts measures them in the browsers).
 */
function longestPair(): Extract<StripView, { kind: 'advice' }> {
  const view = coachView(coachData(raiserOnly(6, 8)), null, input(FACING)).strip;
  if (view.kind !== 'advice') throw new Error(`the strip shows ${view.kind}`);
  return view;
}

describe('the portrait strip on a narrow phone (§12.3, §12.6)', () => {
  it('the line wraps to two lines at most, under the head, above the action bar’s badge', () => {
    // Beginner (the strip is one button), then Intermediate after "Hint" (the words and "Why?").
    for (const view of [longestPair(), { ...longestPair(), why: true }]) {
      const { container } = strip(view);
      const section = container.querySelector('[data-coach-strip]') as HTMLElement;
      const [head, line] = [...(container.querySelector('[data-coach-advice]')?.children ?? [])];
      if (head === undefined || line === undefined) throw new Error('no head and line');
      // The words in full, one sentence a line: the view never cuts them, the CSS wraps them.
      expect(line.textContent).toBe('All 8 players: 26%.\nRaiser + 6 callers: about 44%.');
      expect(getComputedStyle(line).whiteSpace).toBe('pre-line');
      expect(getComputedStyle(line).getPropertyValue('-webkit-line-clamp')).toBe('2');
      // The strip is as tall as the table's layout counts it (SHELL, layout/seats.ts), whatever it
      // says: the head and two lines fill it above its bottom padding, the room the action bar's
      // "Coach" badge reaches into.
      const cs = getComputedStyle(section);
      expect(cssPx(cs.height)).toBe(SHELL.coachStrip);
      const room = cssPx(cs.paddingBottom);
      expect(room).toBeGreaterThan(BADGE_REACH);
      // (16.002 px lines: rounded to whole pixels.)
      expect(Math.round(linesHeight(head, 1) + linesHeight(line, 2))).toBeLessThanOrEqual(
        SHELL.coachStrip - room,
      );
      // §15.3: still the section, the advice, the head (with its <strong>) and the line (+ "Why?").
      expect(container.querySelectorAll('*')).toHaveLength(6);
      cleanup();
    }
  });

  it('the landscape column and the wide panel let the line take the lines it needs', () => {
    for (const props of [
      { variant: 'header' as const },
      { variant: 'strip' as const, wrap: true },
    ]) {
      const { container } = render(
        <CoachStrip
          view={longestPair()}
          onOpen={vi.fn()}
          onHint={vi.fn()}
          onRetry={vi.fn()}
          {...props}
        />,
      );
      const line = container.querySelector('[data-coach-advice] > :nth-child(2)') as HTMLElement;
      expect(getComputedStyle(line).getPropertyValue('-webkit-line-clamp')).toBe('none');
      expect(getComputedStyle(line).whiteSpace).toBe('pre-line');
      cleanup();
    }
  });

  it('"Coach is not available. Tap to try again." wraps too (§12.11)', () => {
    strip({ kind: 'failed' });
    const retry = screen.getByRole('button', { name: coachWords.failed });
    expect(getComputedStyle(retry).whiteSpace).not.toBe('nowrap');
    // Two lines fit in the 44 px button.
    expect(linesHeight(retry, 2)).toBeLessThanOrEqual(44 - 2);
  });
});

describe('the compact "Coach" pill (§12.3)', () => {
  it('opens the sheet when the advice is on show', () => {
    const { onOpen, container } = strip(ADVICE, 'pill');
    const pill = screen.getByRole('button', { name: 'Coach: Call 40. Show why' });
    expect(pill.textContent).toBe(coachWords.pill);
    fireEvent.click(pill);
    expect(onOpen).toHaveBeenCalledOnce();
    expect(smallTapTargets(container)).toEqual([]);
  });

  it('at Intermediate it opens the hint, then the sheet', () => {
    const { onOpen, onHint } = strip({ kind: 'hint', ready: true, countsAsHelp: false }, 'pill');
    fireEvent.click(screen.getByRole('button', { name: coachWords.hint }));
    expect(onHint).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('waits while the coach thinks, retries after a failure, hides while others act', () => {
    strip({ kind: 'thinking' }, 'pill');
    const pill = screen.getByRole('button', { name: coachWords.thinking });
    expect(pill.getAttribute('aria-disabled')).toBe('true');
    cleanup();
    const failed = strip({ kind: 'failed' }, 'pill');
    fireEvent.click(screen.getByRole('button', { name: coachWords.failed }));
    expect(failed.onRetry).toHaveBeenCalledOnce();
    cleanup();
    const narration = strip({ kind: 'narration', text: 'Ben folds.' }, 'pill');
    expect(narration.container.innerHTML).toBe('');
  });
});
