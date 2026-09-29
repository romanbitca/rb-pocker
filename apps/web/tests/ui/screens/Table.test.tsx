// @vitest-environment jsdom
/**
 * The Table screen on the real store and controller, with fixed seeds (PLAN §12.3–§12.9, Stage 3
 * acceptance 5 and 8): the hero strip's label is `describe()`'s, Fold is disabled with its tooltip
 * when checking is free, Android Back closes the sizing tray, then the rankings drawer, and only
 * then leaves the table, and the hand-end banner says who won and starts the next hand on a tap.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectHandEnd } from '../../../src/app/store.ts';
import { cardAriaLabel } from '../../../src/core/cards.ts';
import { describe as describeHand } from '../../../src/eval/describe.ts';
import type { Card } from '../../../src/core/cards.ts';
import type { HandState } from '../../../src/engine/types.ts';
import { en } from '../../../src/i18n/en.ts';
import { App } from '../../../src/ui/App.tsx';
import { handEndLines } from '../../../src/ui/handEnd.ts';
import { heroPolicy } from '../../app/harness.ts';
import { elapse, playUntil, startTableHarness, type TableHarness } from '../tableHarness.ts';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [false, () => {}],
    offlineReady: [false, () => {}],
    updateServiceWorker: async () => {},
  }),
}));

let h: TableHarness;

beforeEach(() => {
  h = startTableHarness();
});

afterEach(() => {
  cleanup();
  h.dispose();
});

const hand = (): HandState => h.state().game.hand as HandState;

function renderTable() {
  const view = render(<App />);
  act(() => h.state().dispatch({ type: 'play' }));
  expect(h.state().ui.screen).toBe('table');
  return view;
}

/** The action-bar button in `slot` ('fold' | 'middle' | 'right'). */
const slot = (name: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-slot="${name}"]`);
  if (el === null) throw new Error(`no ${name} button`);
  return el;
};

describe('the Table screen', () => {
  it('one tap on Play shows the hero cards, face up, with their names', () => {
    renderTable();
    const hole = hand().seats[0]?.hole as [Card, Card];
    const cards = document.querySelectorAll('[data-hero-cards] [role="img"]');
    expect([...cards].map((c) => c.getAttribute('aria-label'))).toEqual(hole.map(cardAriaLabel));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(en.table.heading);
  });

  it("the hero strip's label and sub-label are describe()'s, at every hero turn", async () => {
    renderTable();
    const policy = heroPolicy('0badc0de0badc0de0badc0de0badc0de');
    let checked = 0;
    const check = () => {
      const s = h.state();
      if (s.game.mode !== 'heroTurn' || s.game.hand === null) return;
      const hole = s.game.hand.seats[0]?.hole as [Card, Card];
      const info = describeHand(hole, s.game.hand.board);
      expect(document.querySelector('[data-hero-name]')?.textContent).toBe(info.name);
      const label = document.querySelector('[data-hero-label]');
      expect(label?.textContent).toBe(info.name + (info.subLabel ?? ''));
      checked++;
    };
    const start = hand().handSeq;
    await playUntil(() => h.state().game.hand?.handSeq === start + 8, {
      hero: (legal) => {
        check();
        return policy(legal);
      },
    });
    expect(checked).toBeGreaterThan(10);
  }, 30_000);

  it('with checking free, Fold is disabled and a tap shows why (no action is sent)', async () => {
    renderTable();
    await playUntil(
      () => h.state().game.mode === 'heroTurn' && h.state().game.legal?.canCheck === true,
    );
    const fold = slot('fold');
    expect(fold.getAttribute('aria-disabled')).toBe('true');
    const inputs = h.controller.snapshot().inputs.length;
    fireEvent.click(fold);
    const tip = document.querySelector(`[aria-label="${en.actions.group}"] [role="status"]`);
    expect(tip?.textContent).toBe(en.actions.foldNotNeeded);
    expect(h.controller.snapshot().inputs.length).toBe(inputs);
    expect(h.state().game.mode).toBe('heroTurn');
    // Check works.
    fireEvent.click(slot('middle'));
    expect(h.controller.snapshot().inputs.length).toBe(inputs + 1);
  }, 20_000);

  it('Android Back closes the sizing tray, then the rankings drawer, then leaves the table', async () => {
    renderTable();
    await playUntil(
      () =>
        h.state().game.mode === 'heroTurn' &&
        slot('right').getAttribute('aria-expanded') !== null &&
        slot('right').getAttribute('aria-disabled') !== 'true',
    );
    const back = () =>
      act(() => {
        window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
      });

    // The drawer from the edge tab, then the tray from Row A's right button.
    const tab = document.querySelector<HTMLElement>(
      `[aria-label="${en.rankings.open}"][aria-haspopup="dialog"]`,
    );
    fireEvent.click(tab as HTMLElement);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(slot('right'));
    expect(h.state().ui.overlays).toEqual(['rankings', 'tray']);
    expect(document.querySelector('input[type="range"]')).not.toBeNull();
    expect(h.state().ui.gates).toEqual(['sheet']);

    back();
    expect(h.state().ui.overlays).toEqual(['rankings']);
    expect(document.querySelector('input[type="range"]')).toBeNull();
    expect(slot('right').getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('dialog')).toBeTruthy();

    back();
    expect(h.state().ui.overlays).toEqual([]);
    expect(h.state().ui.screen).toBe('table');
    await elapse(300);
    expect(screen.queryByRole('dialog')).toBeNull();

    back();
    expect(h.state().ui.screen).toBe('home');
    // The hand is still there: Home's Play goes back to it.
    expect(h.state().game.mode).toBe('heroTurn');
  }, 20_000);

  it('the hand-end banner says who won; a tap deals the next hand', async () => {
    renderTable();
    const start = hand().handSeq;
    await playUntil(() => h.state().game.mode === 'handEnd');
    const view = selectHandEnd(h.state());
    expect(view).not.toBeNull();
    const banner = document.querySelector<HTMLElement>('[data-hand-end]');
    expect(banner?.textContent).toBe(
      handEndLines(view as NonNullable<typeof view>).join('') + en.handEnd.nextHand,
    );
    fireEvent.click(banner as HTMLElement);
    expect(hand().handSeq).toBe(start + 1);
    expect(document.querySelector('[data-hand-end]')).toBeNull();
  }, 20_000);

  it('the top bar says the blinds and the hand; the Menu opens and pauses the bots', async () => {
    renderTable();
    expect(screen.getByText('Blinds 10/20 · Hand 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: en.table.menu }));
    expect(h.state().ui.overlays).toEqual(['menu']);
    expect(h.state().ui.gates).toEqual(['menu']);
    fireEvent.click(screen.getByRole('button', { name: en.menu.resume }));
    expect(h.state().ui.overlays).toEqual([]);
  });

  it('wide: the rankings column replaces the drawer; the top-bar Hands button collapses it', () => {
    renderTable();
    act(() => h.state().dispatch({ type: 'open', overlay: 'rankings' }));
    expect(h.state().ui.gates).toEqual(['sheet']);
    act(() => h.state().dispatch({ type: 'layout', layout: 'wide' }));
    // An open drawer would keep the sheet gate closed with nothing on screen to close it.
    expect(h.state().ui.overlays).toEqual([]);
    expect(h.state().ui.gates).toEqual([]);
    expect(document.querySelector('[data-layout="wide"]')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: en.rankings.title })).toBeTruthy();
    const [topBarButton] = screen.getAllByRole('button', { name: en.rankings.collapse });
    fireEvent.click(topBarButton as HTMLElement);
    expect(h.state().settings.handsPanel).toBe('collapsed');
    expect(screen.queryByRole('heading', { level: 2, name: en.rankings.title })).toBeNull();
    // The hand label opens it again.
    fireEvent.click(document.querySelector('[data-hero-label]') as HTMLElement);
    expect(h.state().settings.handsPanel).toBe('open');
  });

  it('landscape: the label heads the right column and gives way to the open tray', async () => {
    renderTable();
    act(() => h.state().dispatch({ type: 'layout', layout: 'landscape' }));
    await playUntil(
      () =>
        h.state().game.mode === 'heroTurn' &&
        slot('right').getAttribute('aria-expanded') !== null &&
        slot('right').getAttribute('aria-disabled') !== 'true',
    );
    expect(document.querySelector('[data-layout="landscape"]')).not.toBeNull();
    expect(document.querySelector('aside [data-hero-label]')).not.toBeNull();
    fireEvent.click(slot('right'));
    expect(document.querySelector('input[type="range"]')).not.toBeNull();
    expect(document.querySelector('[data-hero-label]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: en.sizing.close }));
    expect(h.state().ui.overlays).toEqual([]);
    expect(document.querySelector('aside [data-hero-label]')).not.toBeNull();
  }, 20_000);

  it('stays within 600 DOM nodes (§15.3): nine players, the wide rankings column, showdowns', async () => {
    h.dispose();
    h = startTableHarness({ settings: { players: 9 } });
    renderTable();
    act(() => h.state().dispatch({ type: 'layout', layout: 'wide' }));
    let most = 0;
    let shown = 0;
    const start = hand().handSeq;
    await playUntil(() => hand().handSeq >= start + 12, {
      onStep: () => {
        most = Math.max(most, document.querySelectorAll('*').length);
        shown = Math.max(shown, h.state().game.hand?.revealed.length ?? 0);
      },
    });
    expect(shown).toBeGreaterThanOrEqual(3);
    expect(most).toBeLessThanOrEqual(600);
  }, 30_000);
});
