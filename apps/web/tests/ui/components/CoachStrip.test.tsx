// @vitest-environment jsdom
// The coach strip (chunk 5.9, PLAN §12.3, §12.6, §10.2): each state of the strip and the compact
// pill, what a tap does, 44 px targets, and a small DOM (§15.3).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { coachWords } from '../../../src/i18n/coachUi.ts';
import type { StripView } from '../../../src/ui/coach.ts';
import { CoachStrip, type StripVariant } from '../../../src/ui/components/CoachStrip.tsx';
import { smallTapTargets } from '../dom.ts';

afterEach(cleanup);

const ADVICE: StripView = {
  kind: 'advice',
  headline: 'Call 40',
  line: 'You win about 45%. You need 25%.',
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
  it('Beginner: "Coach: Call 40" and one line; one tap anywhere opens the sheet', () => {
    const { container, onOpen } = strip(ADVICE);
    const button = screen.getByRole('button', {
      name: 'Coach: Call 40. You win about 45%. You need 25%. Show why',
    });
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(container.textContent).toBe('Coach: Call 40You win about 45%. You need 25%.');
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledOnce();
    // §15.3: the section, the button, the head (with its <strong>) and the line.
    expect(container.querySelectorAll('*')).toHaveLength(5);
    expect(smallTapTargets(container)).toEqual([]);
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
