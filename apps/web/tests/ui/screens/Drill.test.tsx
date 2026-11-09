// @vitest-environment jsdom
// The hand drill's page (PLAN §13.5): the answer flow, the keyboard, the sheets (and Android Back
// closing them first), the All hands drawer, the tap targets, and no Unicode suits.
import '../../../src/ui/styles/tokens.css';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as drillApp from '../../../src/app/drill.ts';
import { appStore, initialUi, type DrillModule } from '../../../src/app/store.ts';
import { deriveSeed, ZERO_SEED } from '../../../src/core/rng.ts';
import { emptyDrillData, type DrillData } from '../../../src/drill/data.ts';
import type { Position } from '../../../src/drill/ladder.ts';
import { rightName, rightOption, rightPosition } from '../../../src/drill/questions.ts';
import type { DrillSession } from '../../../src/drill/session.ts';
import { drillWords as W } from '../../../src/i18n/drill.ts';
import { createSafeStorage, STORAGE_KEYS } from '../../../src/persist/storage.ts';
import { RankingsDrawer } from '../../../src/ui/components/RankingsDrawer.tsx';
import { DrillPage } from '../../../src/ui/screens/Drill.tsx';
import { FakeStorage } from '../../persist/fakeStorage.ts';
import { SUIT_CODE_POINTS } from '../dom.ts';
import { controlCount, smallTargets } from './targets.ts';

interface Rendered {
  session: DrillSession;
  backend: FakeStorage;
}

/** The page on a fresh session (fixed seed, a fake storage), as the drill screen of `nav`. */
function renderDrill(data: Partial<DrillData> = {}, label = 'page'): Rendered {
  const backend = new FakeStorage({
    [STORAGE_KEYS.drill]: JSON.stringify({ ...emptyDrillData(), ...data }),
  });
  const session = drillApp.newDrillSession(
    deriveSeed(ZERO_SEED, `test|drill-ui|${label}`),
    createSafeStorage(() => backend),
  );
  const logic: DrillModule = { ...drillApp, drillSession: () => session };
  render(<DrillPage logic={logic} Drawer={RankingsDrawer} />);
  return { session, backend };
}

const nav = () => appStore.getState().ui.nav;
const stored = (backend: FakeStorage): DrillData =>
  JSON.parse(backend.data.get(STORAGE_KEYS.drill) ?? 'null') as DrillData;
const feedback = (): HTMLElement => document.querySelector('[data-feedback]') as HTMLElement;
const question = (): string | null =>
  document.querySelector('[data-question]')?.getAttribute('data-question') ?? null;

beforeEach(() => {
  appStore.setState({ ui: initialUi(false) });
  appStore.getState().dispatch({ type: 'go', screen: 'drill' });
  // No exit animation to wait for (each test that wants motion sets `full`).
  document.documentElement.dataset.motion = 'reduced';
});

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.motion;
  vi.useRealTimers();
});

// Some of these take about a second alone (the first render loads the drawer and the cards).
describe('the hand drill page', { timeout: 15_000 }, () => {
  it('answers a question: name, then position, then the feedback and Next', () => {
    const { session, backend } = renderDrill();
    expect(question()).toBe('cards');
    expect(feedback().getAttribute('role')).toBe('status');
    expect(feedback().textContent).toBe(W.hints.cards);
    const q = session.view().question;
    const pos = rightPosition(q) as Position;

    fireEvent.click(document.querySelector(`[data-name] + [data-name]`) as HTMLElement); // any name
    fireEvent.click(screen.getByRole('button', { name: W.positionName(pos) }));
    const v = session.view();
    expect(v.result).not.toBeNull();
    const next = screen.getByRole('button', { name: W.next });
    expect(document.activeElement).toBe(next); // the focus moves to Next
    expect(feedback().getAttribute('data-feedback')).toBe(v.result === true ? 'right' : 'wrong');
    // The right name and position are marked; the stats are stored at once.
    expect(stored(backend).answered).toBe(1);
    const counters = document.body.textContent ?? '';
    expect(counters).toContain(W.scoreValue(v.right, 1));

    fireEvent.click(next);
    expect(session.view().seq).toBe(2);
    expect(screen.queryByRole('button', { name: W.next })).toBeNull();
    // Next had the focus: the new question's prompt takes it.
    expect(document.activeElement?.getAttribute('data-question')).toBe('cards');
  });

  it('marks the cards that make the hand once it is answered (§6.1 highlight)', () => {
    const { session } = renderDrill({}, 'marks');
    const q = session.view().question;
    if (q.type !== 'cards') throw new Error(q.type);
    expect(document.querySelectorAll('[data-answered]')).toHaveLength(0);
    act(() => {
      session.pickName(rightName(q) as Position);
      session.pickPosition(rightPosition(q) as Position);
    });
    expect(document.querySelectorAll('[data-answered]')).toHaveLength(1);
    expect(feedback().textContent).toContain(`Correct. `);
    expect(feedback().textContent).toContain(`${q.hand.name}.`);
  });

  it('plays from the keyboard: digits pick a position, Enter deals the next question', () => {
    const { session } = renderDrill({ game: 'name2pos' }, 'keys');
    const q = session.view().question;
    const pos = rightPosition(q) as Position;
    fireEvent.keyDown(document.body, { key: pos === 10 ? '0' : String(pos) });
    expect(session.view().result).toBe(true);
    // Enter on a focused button is the button's; on the page it deals the next question.
    act(() => (document.activeElement as HTMLElement).blur());
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(session.view().seq).toBe(2);
    expect(session.view().result).toBeNull();
  });

  it('plays Which wins from the keyboard: A, B and T, or 1, 2, 3', () => {
    const { session } = renderDrill({ game: 'versus' }, 'versus');
    const right = rightOption(session.view().question) as string;
    const key = right === 'tie' ? 't' : right;
    fireEvent.keyDown(document.body, { key: key.toUpperCase() });
    expect(session.view().picks.option).toBe(right);
    expect(session.view().result).toBe(true);
    act(() => session.next());
    fireEvent.keyDown(document.body, { key: '3' });
    expect(session.view().picks.option).toBe('tie');
  });

  it('waits for the exit animation before the next question, unless motion is reduced', () => {
    vi.useFakeTimers();
    document.documentElement.dataset.motion = 'full';
    const { session } = renderDrill({ game: 'pos2name' }, 'motion');
    act(() => session.pickName(rightName(session.view().question) as Position));
    fireEvent.click(screen.getByRole('button', { name: W.next }));
    expect(session.view().seq).toBe(1); // the cards are leaving
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(session.view().seq).toBe(2);
  });

  it('opens and closes the All hands drawer with H, marking this round’s hands', () => {
    const { session } = renderDrill({ game: 'versus' }, 'drawer');
    fireEvent.keyDown(document.body, { key: 'h' });
    expect(nav().overlays).toEqual(['rankings']);
    const drawer = screen.getByRole('dialog', { name: /Poker hands/ });
    expect(within(drawer).queryAllByText(W.thisRound)).toHaveLength(0); // nothing answered yet
    fireEvent.keyDown(document.body, { key: 'H' });
    expect(nav().overlays).toEqual([]);

    act(() => session.pickOption('tie'));
    fireEvent.click(screen.getByRole('button', { name: W.allHands }));
    const rows = document.querySelectorAll('[data-marked]');
    const hands = session.view().question;
    if (hands.type !== 'versus') throw new Error(hands.type);
    const want = new Set(hands.hands.map((h) => h.pos)).size;
    expect(rows).toHaveLength(want);
  });

  it('chooses a game and a difficulty in the game sheet; Back closes the sheet first', () => {
    const { session, backend } = renderDrill({}, 'games');
    fireEvent.click(screen.getByRole('button', { name: /Choose game and difficulty/ }));
    const sheet = screen.getByRole('dialog', { name: W.gamesTitle });
    expect(nav().overlays).toEqual(['drillGames']);

    // Difficulty: radio chips; the sheet stays open and a new question is dealt.
    fireEvent.click(within(sheet).getByRole('radio', { name: W.difficulties.hard.name }));
    expect(stored(backend).difficulty).toBe('hard');
    expect(session.view().seq).toBe(2);
    expect(within(sheet).getByText(W.difficulties.hard.desc)).toBeTruthy();
    expect(nav().overlays).toEqual(['drillGames']);

    // Android Back closes the sheet, then leaves the page.
    act(() => appStore.getState().dispatch({ type: 'back' }));
    expect(nav()).toEqual({ screens: ['home', 'drill'], overlays: [] });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Choose game and difficulty/ }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${W.games.showdown.name}`) }));
    expect(nav().overlays).toEqual([]); // a game closes the sheet
    expect(question()).toBe('showdown');
    expect(stored(backend).game).toBe('showdown');
    act(() => appStore.getState().dispatch({ type: 'back' }));
    expect(nav()).toEqual({ screens: ['home'], overlays: [] });
  });

  it('shows the stats sheet; Reset stats needs a second tap', () => {
    const { session, backend } = renderDrill({ game: 'pos2name' }, 'stats');
    act(() => session.pickName(rightName(session.view().question) as Position));
    fireEvent.click(screen.getByRole('button', { name: W.stats }));
    const sheet = screen.getByRole('dialog', { name: W.statsTitle });
    expect(within(sheet).getByText(W.statsSummary(1, 1))).toBeTruthy();
    expect(sheet.querySelectorAll('li[data-category]')).toHaveLength(10);
    // The first control takes the focus: Close, not Reset.
    expect(document.activeElement?.textContent).toBe(W.close);

    const reset = within(sheet).getByRole('button', { name: W.reset });
    fireEvent.click(reset);
    expect(reset.textContent).toBe(W.resetConfirm);
    expect(stored(backend).answered).toBe(1);
    fireEvent.click(reset);
    expect(stored(backend).answered).toBe(0);
    expect(within(sheet).getByText(W.statsSummary(0, 0))).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(nav().overlays).toEqual([]);
  });

  it('compact pickers (1.3.101): three names to a row, 44 px chips, one line for the counters', () => {
    renderDrill({}, 'compact');
    const names = document.querySelector<HTMLElement>('[data-name]')?.parentElement as HTMLElement;
    expect(names.style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
    expect(names.querySelectorAll('[data-name]')).toHaveLength(10);
    const chip = document.querySelector<HTMLElement>('[data-position="1"]') as HTMLElement;
    expect([chip.style.width, chip.style.height]).toEqual(['44px', '44px']);
    const streak = screen.getByText(W.streak).parentElement as HTMLElement;
    expect(streak.style.display).toBe('flex');
  });

  it('Hold’em names its two rows beside the cards', () => {
    renderDrill({ game: 'holdem' }, 'holdem-rows');
    expect(question()).toBe('holdem');
    const table = screen.getByText(W.table);
    expect(table.parentElement?.style.gridTemplateColumns).toBe('56px auto');
    expect(table.nextElementSibling?.querySelectorAll('[role="img"]')).toHaveLength(5);
    expect(
      screen.getByText(W.yourHand).nextElementSibling?.querySelectorAll('[role="img"]'),
    ).toHaveLength(2);
  });

  it('the pickers’ labels leave the screen once answered, and the pickers keep their names', () => {
    const { session } = renderDrill({}, 'labels');
    const section = () =>
      document.querySelector('section[aria-labelledby$="-names"]') as HTMLElement;
    const label = () =>
      document.getElementById(section().getAttribute('aria-labelledby') ?? '') as HTMLElement;
    expect(label().className).toBe('');
    expect(label().textContent).toContain(W.pickOne);
    const q = session.view().question;
    act(() => {
      session.pickName(rightName(q) as Position);
      session.pickPosition(rightPosition(q) as Position);
    });
    expect(label().className).toMatch(/srOnly/);
    expect(label().textContent).toContain(W.hand);
  });

  it('keeps every control at least 44 px and draws no Unicode suit', () => {
    const { session } = renderDrill({ game: 'mixed' }, 'targets');
    const isPrimary = () => false;
    for (let i = 0; i < 12; i++) {
      expect(smallTargets(document.body, isPrimary)).toEqual([]);
      expect(SUIT_CODE_POINTS.test(document.body.innerHTML)).toBe(false);
      act(() => session.next());
    }
    expect(controlCount(document.body)).toBeGreaterThan(3);
    fireEvent.click(screen.getByRole('button', { name: W.stats }));
    expect(smallTargets(screen.getByRole('dialog'), isPrimary)).toEqual([]);
  });
});
