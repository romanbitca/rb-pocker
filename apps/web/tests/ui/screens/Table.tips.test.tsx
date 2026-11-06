// @vitest-environment jsdom
/**
 * The first-table tips on the Table (PLAN §12.11, chunk 9.3), with the real store and controller:
 * none before the hero's cards are dealt; at the first hero turn the hero strip's, then the
 * coach's; Undo's after the first action; the Hands tab's after the first flop; each one at most
 * once, one at a time, never over another layer; a tap anywhere or a key closes it and still does
 * what it does; while it shows, the bots wait. The Table stays within its 600 DOM nodes (§15.3).
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AppState, TipId } from '../../../src/app/store.ts';
import { tipWords } from '../../../src/i18n/tips.ts';
import { createSafeStorage, STORAGE_KEYS } from '../../../src/persist/storage.ts';
import type { Profile } from '../../../src/persist/schema.ts';
import { App } from '../../../src/ui/App.tsx';
import { loadScreens } from '../../../src/ui/screensModule.ts';
import { TIP_DELAY_MS } from '../../../src/ui/tips.ts';
import { FakeStorage } from '../../persist/fakeStorage.ts';
import {
  elapse,
  nextTimer,
  playUntil,
  startTableHarness,
  type TableHarness,
} from '../tableHarness.ts';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [false, () => {}],
    offlineReady: [false, () => {}],
    updateServiceWorker: async () => {},
  }),
}));

beforeAll(async () => {
  await loadScreens(); // the screens lazy chunk, as App asks for it after the first paint
  // The bubble's chunk (precached in the app): it loads while the first tip's moment lasts.
  await import('../../../src/ui/components/TipBubble.tsx');
});

let h: TableHarness | null = null;

afterEach(() => {
  cleanup();
  h?.dispose();
  h = null;
});

const state = (): AppState => (h as TableHarness).state();
const inputs = (): number => (h as TableHarness).controller.snapshot().inputs.length;
const bubble = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-tip]');

function start(
  options: {
    players?: number;
    storage?: FakeStorage;
    settings?: Partial<AppState['settings']>;
  } = {},
): void {
  h = startTableHarness({
    tips: true,
    settings: { players: options.players ?? 3, speed: 'normal', ...options.settings },
    ...(options.storage !== undefined && {
      storage: createSafeStorage(() => options.storage as FakeStorage),
    }),
  });
  render(<App />);
  act(() => state().dispatch({ type: 'play' }));
  expect(state().ui.screen).toBe('table');
}

/** The tip `tip` is on show: in the store, and as its bubble with its words. */
function expectTip(tip: TipId): void {
  expect(state().ui.overlays).toEqual(['tip']);
  expect(state().ui.tip).toBe(tip);
  expect(state().ui.gates).toContain('tip');
  const el = bubble();
  expect(el?.getAttribute('data-tip')).toBe(tip);
  expect(el?.getAttribute('role')).toBe('status');
  expect(el?.textContent).toBe(tipWords[tip]);
}

/** Runs timers until a tip shows (or `max` steps). */
async function untilTip(max = 400): Promise<TipId> {
  for (let i = 0; i < max; i++) {
    const tip = state().ui.tip;
    if (tip !== null) return tip;
    const s = state();
    if (s.game.mode === 'heroTurn' && s.game.legal !== null) {
      // The hero waits (as a reader does): the tip comes after TIP_DELAY_MS.
      await elapse(50);
    } else {
      await nextTimer();
    }
  }
  throw new Error('no tip');
}

const tap = (target: Element = document.body): void => {
  act(() => {
    fireEvent.pointerDown(target);
  });
};

describe('the first-table tips (§12.11)', () => {
  it('none before the deal; then hero strip, coach, Undo, Hands tab: once each, tap to close', async () => {
    start();
    // Play reaches a dealt hand at once: no tip is open in between (§12.1).
    expect(state().game.hand?.seats[0]?.hole).not.toBeNull();
    expect(state().ui.overlays).toEqual([]);
    await playUntil(() => state().game.mode === 'heroTurn');
    // The moment lasts TIP_DELAY_MS before the tip shows.
    await elapse(TIP_DELAY_MS - 50);
    expect(state().ui.tip).toBeNull();
    await elapse(60);
    expectTip('heroStrip');
    // The bubble is not the focus and not a dialog: the keyboard stays on the table.
    expect(document.activeElement?.closest('[data-tip]')).toBeNull();

    tap();
    expect(state().ui.overlays).toEqual([]);
    expect(state().data.tips).toEqual({ heroStrip: true });
    await elapse(TIP_DELAY_MS + 10);
    expectTip('coachStrip');
    act(() => {
      fireEvent.keyDown(document.body, { key: 'Tab' }); // any key closes it too
    });
    expect(state().data.tips).toEqual({ heroStrip: true, coachStrip: true });

    // The hero acts: no grader here, so Undo can take it back at once; its tip follows.
    const legal = state().game.legal;
    if (legal === null) throw new Error('not the hero turn');
    act(() => {
      fireEvent.keyDown(document.body, { key: 'c' });
    });
    expect(await untilTip()).toBe('undo');
    expectTip('undo');
    // While it shows, the bots wait.
    const before = inputs();
    await elapse(5000);
    expect(inputs()).toBe(before);
    tap(document.querySelector('[data-tip]') as Element);
    expect(state().data.tips).toEqual({ heroStrip: true, coachStrip: true, undo: true });

    // After the first flop the hero still plays: the Hands tab.
    expect(await untilTip(3000)).toBe('handsTab');
    expect(state().game.hand?.board.length).toBeGreaterThanOrEqual(3);
    expect(state().game.hand?.seats[0]?.folded).toBe(false);
    expectTip('handsTab');
    tap();
    expect(state().data.tips).toEqual({
      heroStrip: true,
      coachStrip: true,
      undo: true,
      handsTab: true,
    });

    // Never again: a few more hands without a tip.
    const hand = state().game.hand?.handSeq ?? 0;
    await playUntil(() => (state().game.hand?.handSeq ?? 0) >= hand + 3, {
      onStep: () => expect(state().ui.tip).toBeNull(),
    });
  }, 60_000);

  it('a tap on Row A closes the tip and acts; the coach’s tip then waits for the next turn', async () => {
    start();
    await playUntil(() => state().game.mode === 'heroTurn');
    await elapse(TIP_DELAY_MS + 10);
    expectTip('heroStrip');
    const before = inputs();
    const middle = document.querySelector('[data-slot="middle"]') as HTMLElement;
    act(() => {
      fireEvent.pointerDown(middle);
      fireEvent.click(middle);
    });
    expect(state().ui.tip).toBeNull();
    expect(inputs()).toBe(before + 1); // the call went through
    expect(state().data.tips).toEqual({ heroStrip: true });
    // Not the hero's turn any more: the coach's tip is not due.
    await elapse(TIP_DELAY_MS + 10);
    expect(state().ui.tip === null || state().ui.tip === 'undo').toBe(true);
  }, 30_000);

  it('a key closes the tip and still acts (C calls or checks)', async () => {
    start();
    await playUntil(() => state().game.mode === 'heroTurn');
    await elapse(TIP_DELAY_MS + 10);
    expectTip('heroStrip');
    const before = inputs();
    act(() => {
      fireEvent.keyDown(document.body, { key: 'c' });
    });
    expect(state().ui.tip).toBeNull();
    expect(inputs()).toBe(before + 1);
  }, 30_000);

  it('Shift alone closes nothing; Back closes the tip and it counts as seen', async () => {
    start();
    await playUntil(() => state().game.mode === 'heroTurn');
    await elapse(TIP_DELAY_MS + 10);
    act(() => {
      fireEvent.keyDown(document.body, { key: 'Shift' });
    });
    expectTip('heroStrip');
    act(() => state().dispatch({ type: 'back' }));
    expect(state().ui.screen).toBe('table');
    expect(state().ui.tip).toBeNull();
    expect(state().data.tips).toEqual({ heroStrip: true });
  }, 30_000);

  it('never over another layer: the open tray keeps it waiting until it closes', async () => {
    start();
    await playUntil(() => state().game.mode === 'heroTurn' && state().game.legal?.raise != null);
    act(() => {
      fireEvent.keyDown(document.body, { key: 'r' });
    });
    expect(state().ui.overlays).toEqual(['tray']);
    await elapse(TIP_DELAY_MS * 3);
    expect(state().ui.tip).toBeNull();
    act(() => {
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });
    expect(state().ui.overlays).toEqual([]);
    await elapse(TIP_DELAY_MS + 10);
    expectTip('heroStrip');
  }, 30_000);

  it('seen in an earlier launch: never shown again (profile.flags.tips)', async () => {
    const backend = new FakeStorage();
    start({ storage: backend });
    await playUntil(() => state().game.mode === 'heroTurn');
    await elapse(TIP_DELAY_MS + 10);
    expectTip('heroStrip');
    tap();
    const stored = JSON.parse(backend.data.get(STORAGE_KEYS.profile) ?? 'null') as Profile;
    expect(stored.flags.tips).toEqual({ heroStrip: true });
    cleanup();
    h?.dispose();

    start({ storage: backend });
    expect(state().data.tips).toEqual({ heroStrip: true });
    await playUntil(() => state().game.mode === 'heroTurn');
    await elapse(TIP_DELAY_MS + 10);
    expectTip('coachStrip'); // the hero strip's is not shown again
  }, 30_000);

  it('stays within 600 DOM nodes while each tip shows: nine players, the wide column', async () => {
    start({ players: 9 });
    act(() => state().dispatch({ type: 'layout', layout: 'wide' }));
    let most = 0;
    const shown = new Set<TipId>();
    const hand = state().game.hand?.handSeq ?? 0;
    for (let i = 0; i < 4000 && shown.size < 4; i++) {
      const tip = state().ui.tip;
      if (tip !== null) {
        most = Math.max(most, document.querySelectorAll('*').length);
        shown.add(tip);
        tap();
        continue;
      }
      const s = state();
      if (s.game.mode === 'heroTurn' && s.game.legal !== null) {
        if (!(s.data.tips?.['heroStrip'] === true && s.data.tips['coachStrip'] === true)) {
          await elapse(50); // a reader: the hero-turn tips come first
          continue;
        }
        const legal = s.game.legal;
        act(() =>
          s.dispatch({
            type: 'act',
            action: legal.canCheck ? { type: 'check' } : { type: 'call' },
          }),
        );
      } else if (s.game.mode === 'idle' && s.ui.overlays.includes('outOfChips')) {
        act(() => s.dispatch({ type: 'reload' }));
      } else {
        await nextTimer();
      }
      if ((state().game.hand?.handSeq ?? 0) > hand + 20) break;
    }
    expect([...shown].sort()).toEqual(['coachStrip', 'handsTab', 'heroStrip', 'undo']);
    expect(most).toBeGreaterThan(0);
    expect(most).toBeLessThanOrEqual(600);
  }, 60_000);
});
