// @vitest-environment jsdom
/**
 * The keyboard on the Table (PLAN §12.5, §12.12, chunk 9.3), with the real store and controller:
 * F, C, B/R press Row A as a tap does (the legal actions only: a disabled button says why and
 * sends nothing), 1–5 and ↑/↓ size the tray inside the legal bounds, Enter confirms it, H does what
 * a tap on the coach does, K shows and hides the hand rankings, ? lists the keys; nothing while a
 * text field, a dialog or a sheet has the keyboard. Each Row A button names its keys.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { coachKeyOf, selectActionBarInput, type AppState } from '../../../src/app/store.ts';
import type { EngineInput, PlayerAction } from '../../../src/engine/types.ts';
import { en } from '../../../src/i18n/en.ts';
import { shortcutWords } from '../../../src/i18n/shortcuts.ts';
import { actionBarView, stepAmount, trayActionLabel } from '../../../src/ui/actionBar.ts';
import { App } from '../../../src/ui/App.tsx';
import { loadCoach } from '../../../src/ui/coachModule.ts';
import { loadScreens } from '../../../src/ui/screensModule.ts';
import { playUntil, startTableHarness, type TableHarness } from '../tableHarness.ts';

beforeAll(async () => {
  await loadScreens(); // the screens lazy chunk, as App asks for it after the first paint
  await loadCoach(); // the coach's chunk, as the Table asks for it when it mounts
  await import('../../../src/ui/components/ShortcutsDialog.tsx'); // the "?" list's chunk
});

let h: TableHarness | null = null;

afterEach(() => {
  cleanup();
  h?.dispose();
  h = null;
});

const state = (): AppState => (h as TableHarness).state();
const inputs = (): readonly EngineInput[] => (h as TableHarness).controller.snapshot().inputs;
const lastAct = (): PlayerAction | null => {
  const last = inputs().at(-1);
  return last?.kind === 'act' && last.seat === 0 ? last.action : null;
};

const slot = (name: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-slot="${name}"]`);
  if (el === null) throw new Error(`no ${name} button`);
  return el;
};

/**
 * The open sizing tray's chips, in order (the presets, then the coach's chip): the tray that the
 * right button controls. Not `button[aria-pressed]` anywhere: the top bar's mute button (chunk
 * 9.1) is a toggle too.
 */
const trayChips = (): HTMLButtonElement[] => {
  const id = slot('right').getAttribute('aria-controls');
  const tray = id === null ? null : document.getElementById(id);
  return [...(tray?.querySelectorAll<HTMLButtonElement>('button[aria-pressed]') ?? [])];
};

/** A key pressed with the focus where it is (the page's heading after the Table opened). */
const press = (key: string, target: Element = document.activeElement ?? document.body): void => {
  act(() => {
    fireEvent.keyDown(target, { key });
  });
};

/** Lets brain replies land and React render them. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

function start(settings: Partial<AppState['settings']> = {}, hints = false): void {
  h = startTableHarness({
    hints,
    settings: { players: 3, speed: 'normal', ...settings },
  });
  render(<App />);
  act(() => state().dispatch({ type: 'play' }));
  expect(state().ui.screen).toBe('table');
}

/** A lazy dialog, once its chunk is in (the fake clock runs meanwhile). */
async function dialogShown(name: string): Promise<HTMLElement> {
  for (let i = 0; i < 200; i++) {
    const dialog = screen.queryByRole('dialog', { name });
    if (dialog !== null) return dialog;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5);
    });
  }
  throw new Error(`no dialog ${name}`);
}

/** Plays (check or call) until a hero turn where `where` holds. */
async function heroTurnWhere(where: (s: AppState) => boolean): Promise<void> {
  await playUntil(() => state().game.mode === 'heroTurn' && where(state()));
  await settle();
}

describe('Row A by keyboard (§12.5)', () => {
  it('each button names its keys (aria-keyshortcuts), the presets 1–5', async () => {
    start();
    await heroTurnWhere((s) => s.game.legal?.raise !== null || s.game.legal?.bet !== null);
    expect(slot('fold').getAttribute('aria-keyshortcuts')).toBe('F');
    expect(slot('middle').getAttribute('aria-keyshortcuts')).toBe('C');
    expect(slot('right').getAttribute('aria-keyshortcuts')).toBe('B R');
    press('r');
    const chips = trayChips();
    expect(chips.slice(0, 5).map((c) => c.getAttribute('aria-keyshortcuts'))).toEqual(
      ['1', '2', '3', '4', '5'].slice(0, Math.min(5, chips.length)),
    );
  }, 30_000);

  it('F with checking free shows why and sends nothing; C checks; F facing a bet folds', async () => {
    start();
    await heroTurnWhere((s) => s.game.legal?.canCheck === true);
    const before = inputs().length;
    press('f');
    expect(inputs()).toHaveLength(before);
    const tip = document.querySelector(`[aria-label="${en.actions.group}"] [role="status"]`);
    expect(tip?.textContent).toBe(en.actions.foldNotNeeded);
    press('c');
    expect(lastAct()).toEqual({ type: 'check' });

    await heroTurnWhere((s) => s.game.legal?.canFold === true);
    const legal = state().game.legal;
    expect(legal?.canFold).toBe(true);
    press('F');
    expect(lastAct()).toEqual({ type: 'fold' });
  }, 30_000);

  it('C calls when facing a bet; a second C before the next turn sends nothing', async () => {
    start();
    await heroTurnWhere((s) => s.game.legal?.canCall === true);
    const before = inputs().length;
    press('c');
    expect(lastAct()).toEqual({ type: 'call' });
    expect(inputs()).toHaveLength(before + 1);
    press('c'); // not the hero's turn any more: "Waiting…" is disabled
    expect(inputs()).toHaveLength(before + 1);
  }, 30_000);

  it('R opens the tray on its slider; 2 picks the second preset, ↑ one step, Enter raises it', async () => {
    start();
    await heroTurnWhere(
      (s) =>
        (s.game.legal?.raise ?? s.game.legal?.bet ?? null) !== null &&
        (s.game.legal?.raise ?? s.game.legal?.bet)?.min !==
          (s.game.legal?.raise ?? s.game.legal?.bet)?.max,
    );
    const legal = state().game.legal;
    const bounds = legal?.raise ?? legal?.bet;
    const input = selectActionBarInput(state());
    if (legal === null || bounds == null || input === null) throw new Error('no raise');
    const tray = actionBarView(input).tray;
    if (tray === null) throw new Error('no tray');
    press('r');
    expect(slot('right').getAttribute('aria-expanded')).toBe('true');
    expect(state().ui.overlays).toContain('tray');
    // The focus is on the slider: Enter cannot land on another button there.
    expect((document.activeElement as HTMLInputElement | null)?.type).toBe('range');
    const second = tray.presets[1];
    if (second === undefined) throw new Error('no second preset');
    press('2', document.body);
    const chosen = second.enabled ? second.amount : tray.start;
    if (second.enabled) {
      const chips = trayChips();
      expect(chips[1]?.getAttribute('aria-pressed')).toBe('true');
    }
    press('ArrowUp', document.body);
    const expected = stepAmount(tray, chosen, 1);
    expect(slot('right').textContent).toBe(trayActionLabel(tray, expected));
    press('Enter', document.activeElement ?? document.body);
    // Exactly the stepped amount, inside the legal bounds (pitfall 1).
    expect(lastAct()).toEqual({ type: tray.kind, to: expected });
    expect(expected).toBeGreaterThanOrEqual(bounds.min);
    expect(expected).toBeLessThanOrEqual(bounds.max);
    expect(state().ui.overlays).not.toContain('tray');
  }, 30_000);

  it('1–5 with the tray closed open it at that preset; ↓ steps down; Esc closes it, nothing sent', async () => {
    start();
    await heroTurnWhere(
      (s) =>
        (s.game.legal?.raise ?? s.game.legal?.bet ?? null) !== null &&
        (s.game.legal?.raise ?? s.game.legal?.bet)?.min !==
          (s.game.legal?.raise ?? s.game.legal?.bet)?.max,
    );
    const before = inputs().length;
    press('1', document.body);
    expect(slot('right').getAttribute('aria-expanded')).toBe('true');
    const first = trayChips()[0];
    if (first !== undefined && !first.disabled)
      expect(first.getAttribute('aria-pressed')).toBe('true');
    const slider = document.querySelector<HTMLInputElement>('input[type="range"]');
    const at = slider?.value;
    press('ArrowUp', document.body);
    press('ArrowDown', document.body);
    expect(slider?.value).toBe(at);
    press('Escape', document.body);
    expect(state().ui.overlays).not.toContain('tray');
    expect(inputs()).toHaveLength(before);
  }, 30_000);
});

describe('focus rules (§12.5: never while typing, nor while a dialog or a sheet is open)', () => {
  it('the tray’s amount field types digits and letters; no key acts there', async () => {
    start();
    await heroTurnWhere(
      (s) =>
        (s.game.legal?.raise ?? s.game.legal?.bet ?? null) !== null &&
        (s.game.legal?.raise ?? s.game.legal?.bet)?.min !==
          (s.game.legal?.raise ?? s.game.legal?.bet)?.max,
    );
    press('r');
    const field = screen.getByRole('textbox');
    act(() => field.focus());
    const before = inputs().length;
    for (const key of ['c', 'f', 'r', '2', 'Enter', 'k', '?', 'h']) press(key, field);
    expect(inputs()).toHaveLength(before);
    expect(state().ui.overlays).toEqual(['tray']);
  }, 30_000);

  it('the Menu (a sheet) has the keyboard: C does nothing until it closes', async () => {
    start();
    await heroTurnWhere(() => true);
    act(() => state().dispatch({ type: 'open', overlay: 'menu' }));
    expect(screen.getByRole('dialog', { name: en.menu.title })).toBeTruthy();
    const before = inputs().length;
    press('c');
    press('c', document.body);
    expect(inputs()).toHaveLength(before);
    press('Escape');
    expect(state().ui.overlays).toEqual([]);
    press('c', document.body);
    expect(inputs()).toHaveLength(before + 1);
  }, 30_000);
});

describe('the table keys: K, ?, H (§12.5)', () => {
  it('? lists the keys (a dialog: the game waits, Row A keys do nothing); Esc closes it', async () => {
    start();
    await heroTurnWhere(() => true);
    press('?');
    const dialog = await dialogShown(shortcutWords.title);
    expect(state().ui.overlays).toEqual(['shortcuts']);
    expect(state().ui.gates).toContain('sheet');
    expect(dialog.textContent).toContain('Bet or raise');
    expect(dialog.querySelectorAll('kbd')).toHaveLength(shortcutWords.rows.length);
    const before = inputs().length;
    press('c');
    expect(inputs()).toHaveLength(before);
    press('Escape');
    expect(state().ui.overlays).toEqual([]);
  }, 30_000);

  it('K opens the rankings drawer and closes it (phones); toggles the column (wide)', async () => {
    start();
    await heroTurnWhere(() => true);
    press('k');
    expect(state().ui.overlays).toEqual(['rankings']);
    press('K'); // inside the drawer: K closes it, like ✕
    expect(state().ui.overlays).toEqual([]);
    act(() => state().dispatch({ type: 'layout', layout: 'wide' }));
    expect(state().settings.handsPanel).toBe('open');
    press('k', document.body);
    expect(state().settings.handsPanel).toBe('collapsed');
    press('k', document.body);
    expect(state().settings.handsPanel).toBe('open');
  }, 30_000);

  it('H at Intermediate: the hint (marked as opened), then the sheet', async () => {
    start({ coachLevel: 'intermediate' }, true);
    await playUntil(
      () => {
        const s = state();
        return (
          s.game.mode === 'heroTurn' &&
          s.game.hand !== null &&
          s.coach.key === coachKeyOf(s.game.hand) &&
          s.coach.status === 'ready'
        );
      },
      { beforeHero: settle },
    );
    await settle();
    const hand = state().game.hand;
    if (hand === null) throw new Error('no hand');
    expect(state().coach.opened).toBeNull();
    press('h');
    expect(state().coach.opened).toBe(coachKeyOf(hand));
    await settle();
    press('h', document.body);
    expect(state().ui.overlays).toEqual(['coach']);
  }, 30_000);
});
