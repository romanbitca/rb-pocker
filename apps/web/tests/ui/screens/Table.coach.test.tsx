// @vitest-environment jsdom
/**
 * The coach on the Table (chunks 5.9 and 5.7, PLAN §10.2, §12.3, §12.5–§12.7): a real controller
 * and store, and the real coach: the test brain answers every hero decision with `coachHint` (the
 * advice and chunk 5.6's explanation of it), as `brain.worker` does. Beginner shows the advice and
 * rings the button; the strip opens the sheet, which closes with the decision; "Use coach size"
 * opens the tray at the coach's amount; Intermediate waits for "Hint"; the wide panel and the
 * landscape rows; a coach that cannot answer offers to try again.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { realTimers } from '../../../src/app/controller.ts';
import {
  appStore,
  coachKeyOf,
  initialCoach,
  initialEquity,
  type AppState,
  type CoachSlice,
} from '../../../src/app/store.ts';
import { createBrainClient } from '../../../src/app/workerClient.ts';
import type { Decision } from '../../../src/brain/types.ts';
import { coachWords } from '../../../src/i18n/coachUi.ts';
import { en } from '../../../src/i18n/en.ts';
import { formatChips } from '../../../src/ui/actionBar.ts';
import { loadCoach } from '../../../src/ui/coachModule.ts';
import { Table } from '../../../src/ui/screens/Table.tsx';
import { simpleDecide } from '../../helpers/simpleDecide.ts';
import { fakeBrainWorker } from '../../workers/fakeBrainWorker.ts';
import { playUntil, startTableHarness, type TableHarness } from '../tableHarness.ts';

let h: TableHarness | null = null;

beforeAll(async () => {
  await loadCoach(); // the lazy chunk, as the Table asks for it at mount
});

afterEach(() => {
  cleanup();
  h?.dispose();
  h = null;
  appStore.setState({ equity: initialEquity(), coach: initialCoach() });
});

const state = (): AppState => appStore.getState();

/** Lets the brain's replies land (a few promise hops) and React render them. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

/** The hero's turn, and the coach has answered this decision (`status`). */
function answered(s: AppState, status: CoachSlice['status']): boolean {
  const hand = s.game.hand;
  return (
    s.game.mode === 'heroTurn' &&
    hand !== null &&
    s.coach.key === coachKeyOf(hand) &&
    s.coach.status === status
  );
}

/**
 * Plays (the hero checks or calls) until a hero turn whose advice has landed and `where` holds.
 * The coach is the real one, so `where` picks the spot a test needs from the advice itself.
 */
async function heroTurn(
  where: (s: AppState) => boolean = () => true,
  status: CoachSlice['status'] = 'ready',
): Promise<void> {
  await playUntil(() => answered(state(), status) && where(state()), { beforeHero: settle });
  await settle();
}

function start(settings: Partial<AppState['settings']> = {}): void {
  h = startTableHarness({ hints: true, settings: { players: 3, ...settings } });
  render(<Table />);
  act(() => state().dispatch({ type: 'play' }));
}

const decision = (): Decision => {
  const d = state().coach.decision;
  if (d === null) throw new Error('no hint');
  return d;
};

const strip = () => document.querySelector('[data-coach-strip]') as HTMLElement;
const ringed = () => document.querySelector('[data-coach][data-slot]');

describe('Beginner (§10.2 "Full help")', () => {
  it('the strip says the advice; the recommended button has the ring and badge', async () => {
    start();
    await heroTurn();
    expect(strip().getAttribute('data-coach-strip')).toBe('advice');
    expect(strip().textContent).toContain(coachWords.prefix);
    const slot =
      decision().action.type === 'fold'
        ? 'fold'
        : ['check', 'call'].includes(decision().action.type)
          ? 'middle'
          : 'right';
    expect(ringed()?.getAttribute('data-slot')).toBe(slot);
  }, 20_000);

  it('the strip opens the sheet; it closes with Esc, and with the decision when the hero acts', async () => {
    start();
    await heroTurn();
    fireEvent.click(within(strip()).getByRole('button'));
    const dialog = screen.getByRole('dialog', { name: en.coachUi.title });
    expect(within(dialog).getByText(coachWords.doThis)).toBeTruthy();
    expect(state().ui.overlays).toContain('coach');
    // The action bar stays outside the sheet: the hero can act with it open.
    const bar = screen.getByRole('group', { name: en.actions.group });
    expect(dialog.contains(bar)).toBe(false);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(state().ui.overlays).not.toContain('coach');

    fireEvent.click(within(strip()).getByRole('button'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    const legal = state().game.legal;
    if (legal === null) throw new Error('not the hero turn');
    act(() =>
      state().dispatch({
        type: 'act',
        action: legal.canCheck ? { type: 'check' } : { type: 'call' },
      }),
    );
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(state().ui.overlays).not.toContain('coach');
  }, 20_000);

  it('"Use coach size" opens the tray at the coach’s bet, ringed', async () => {
    start();
    // The first spot where the coach bets (checked to the hero after the flop, not all-in).
    await heroTurn((s) => s.coach.decision?.kind === 'bet');
    const d = decision();
    if (d.action.type !== 'bet') throw new Error('not a bet');
    fireEvent.click(within(strip()).getByRole('button'));
    fireEvent.click(screen.getByRole('button', { name: coachWords.useSize }));
    expect(screen.queryByRole('dialog')).toBeNull();
    const slider = screen.getByRole('slider');
    expect(slider.getAttribute('aria-valuetext')).toMatch(
      new RegExp(`^Bet ${formatChips(d.action.to)},`),
    );
    expect(
      document.querySelector('[role="group"][aria-label="Choose your bet"] [data-coach]'),
    ).not.toBeNull();
  }, 20_000);
});

describe('Intermediate (§10.2 "Help on tap")', () => {
  it('"Hint" first (helped), then the advice, the ring and "Why?"', async () => {
    start({ coachLevel: 'intermediate' });
    await heroTurn();
    expect(strip().getAttribute('data-coach-strip')).toBe('hint');
    expect(ringed()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: coachWords.hint }));
    expect(state().coach.opened).toBe(state().coach.key);
    expect(strip().getAttribute('data-coach-strip')).toBe('advice');
    expect(ringed()).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: coachWords.why }));
    expect(screen.getByRole('dialog', { name: en.coachUi.title })).toBeTruthy();
    // The rankings' tips are Beginner's (§10.2).
    expect(state().settings.coachLevel).toBe('intermediate');
  }, 20_000);
});

describe('the layouts (§12.3, §12.5)', () => {
  it('wide: the inline panel shows the sections, no sheet', async () => {
    start();
    act(() => state().dispatch({ type: 'layout', layout: 'wide' }));
    await heroTurn();
    const panel = document.querySelector('[data-coach-panel]') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.querySelector('[data-coach-details="panel"]')).not.toBeNull();
    expect(within(panel).getByText(coachWords.numbers)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  }, 20_000);

  it('landscape: at a hand end the column holds the banner, no empty coach rows', async () => {
    start();
    act(() => state().dispatch({ type: 'layout', layout: 'landscape' }));
    await playUntil(() => state().game.mode === 'handEnd');
    await settle();
    expect(document.querySelector('aside [data-hand-end]')).not.toBeNull();
    expect(document.querySelector('aside [data-coach-strip]')).toBeNull();
  }, 20_000);

  it('landscape: the coach rows in the column, gone while the tray is open', async () => {
    start();
    act(() => state().dispatch({ type: 'layout', layout: 'landscape' }));
    await heroTurn((s) => s.game.legal?.bet !== null || s.game.legal?.raise !== null);
    expect(document.querySelector('aside [data-coach-strip]')).not.toBeNull();
    const right = document.querySelector('[data-slot="right"]') as HTMLElement;
    fireEvent.click(right);
    expect(screen.getByRole('slider')).toBeTruthy();
    expect(document.querySelector('aside [data-coach-strip]')).toBeNull();
  }, 20_000);
});

describe('a coach that cannot answer (§12.11)', () => {
  it('"Coach is not available. Tap to try again." asks again', async () => {
    let calls = 0;
    // The worker's coach throws: `brainService` answers the job with an `error` reply.
    const brain = createBrainClient(
      fakeBrainWorker({
        service: {
          decide: simpleDecide,
          coach: () => {
            calls++;
            throw new Error('coach failed');
          },
        },
      }).spawn,
      realTimers,
    );
    h = startTableHarness({ hints: true, brain, settings: { players: 3 } });
    render(<Table />);
    act(() => state().dispatch({ type: 'play' }));
    await heroTurn(() => true, 'failed');
    expect(calls).toBe(1);
    expect(strip().getAttribute('data-coach-strip')).toBe('failed');
    fireEvent.click(screen.getByRole('button', { name: coachWords.failed }));
    await settle();
    expect(calls).toBe(2);
    expect(strip().getAttribute('data-coach-strip')).toBe('failed');
    expect(vi.isFakeTimers()).toBe(true);
  }, 20_000);
});
