/**
 * The store (PLAN §2.5, §12.1, Appendix A.8): the UI reducer (screens, overlays, Back), gate
 * derivation, the dispatch split between UI and game commands, and the selectors.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  closedGates,
  createAppStore,
  GATES,
  initialUi,
  OVERLAY_GATE,
  reduceUi,
  selectCanTopUp,
  selectHandInProgress,
  selectOverlayOpen,
  selectTopOverlay,
  type AppState,
  type GameCommand,
  type Overlay,
  type UiSlice,
} from '../../src/app/store.ts';
import { deal, tableWith } from '../engine/helpers.ts';

const onTable = (): UiSlice => reduceUi(initialUi(false), { type: 'go', screen: 'table' });

describe('navigation in the store (app/navigation.ts, §12.1)', () => {
  it('the first launch starts on Welcome, later ones on Home; screen and overlays follow nav', () => {
    expect(initialUi(true)).toMatchObject({ screen: 'welcome', overlays: [] });
    expect(initialUi(false)).toMatchObject({ screen: 'home', overlays: [] });
    let ui = reduceUi(initialUi(true), { type: 'go', screen: 'table' });
    expect(ui.nav).toEqual({ screens: ['home', 'table'], overlays: [] });
    expect(ui.screen).toBe('table');
    ui = reduceUi(ui, { type: 'open', overlay: 'menu' });
    expect(ui.overlays).toBe(ui.nav.overlays);
    expect(ui.overlays).toEqual(['menu']);
  });

  it('Back closes the top-most overlay first, then goes back one screen, then does nothing', () => {
    let ui = onTable();
    ui = reduceUi(ui, { type: 'open', overlay: 'menu' });
    ui = reduceUi(ui, { type: 'open', overlay: 'rankings' });
    ui = reduceUi(ui, { type: 'back' });
    expect(ui.overlays).toEqual(['menu']);
    ui = reduceUi(ui, { type: 'back' });
    expect(ui).toMatchObject({ screen: 'table', overlays: [] });
    ui = reduceUi(ui, { type: 'back' });
    expect(ui.nav).toEqual({ screens: ['home'], overlays: [] });
    expect(reduceUi(ui, { type: 'back' })).toBe(ui);
  });

  it('Back with the sizing tray open closes the tray, not the table (Stage 3 acceptance 8)', () => {
    const ui = reduceUi(reduceUi(onTable(), { type: 'open', overlay: 'tray' }), { type: 'back' });
    expect(ui).toMatchObject({ screen: 'table', overlays: [] });
  });

  it('Back on the out-of-chips dialog returns Home (§3.1)', () => {
    const ui = reduceUi(reduceUi(onTable(), { type: 'open', overlay: 'outOfChips' }), {
      type: 'back',
    });
    expect(ui.nav).toEqual({ screens: ['home'], overlays: [] });
  });

  it('a navigation action that changes nothing leaves ui as it was', () => {
    const ui = reduceUi(onTable(), { type: 'open', overlay: 'menu' });
    expect(reduceUi(ui, { type: 'open', overlay: 'menu' })).toBe(ui);
    expect(reduceUi(ui, { type: 'close', overlay: 'rankings' })).toBe(ui);
    expect(reduceUi(ui, { type: 'go', screen: 'settings' }).overlays).toEqual([]);
  });
});

describe('gates (Appendix A.8)', () => {
  it('each overlay closes its gate; the tray closes none', () => {
    for (const overlay of Object.keys(OVERLAY_GATE) as Overlay[]) {
      const ui = reduceUi(onTable(), { type: 'open', overlay });
      const gate = OVERLAY_GATE[overlay];
      expect(ui.gates).toEqual(gate === null ? [] : [gate]);
    }
    expect(OVERLAY_GATE.tray).toBeNull();
    expect(OVERLAY_GATE.rankings).toBe('sheet');
    expect(OVERLAY_GATE.menu).toBe('menu');
  });

  it('offTable: any screen but the table; hidden; explicit holds by owner', () => {
    expect(initialUi(false).gates).toEqual(['offTable']);
    expect(onTable().gates).toEqual([]);
    expect(closedGates({ ...onTable(), hidden: true })).toEqual(['hidden']);
    let ui = reduceUi(onTable(), { type: 'gate', gate: 'tip', closed: true, owner: 'a' });
    ui = reduceUi(ui, { type: 'gate', gate: 'tip', closed: true, owner: 'b' });
    expect(ui.gates).toEqual(['tip']);
    ui = reduceUi(ui, { type: 'gate', gate: 'tip', closed: false, owner: 'a' });
    expect(ui.gates).toEqual(['tip']);
    ui = reduceUi(ui, { type: 'gate', gate: 'tip', closed: false, owner: 'b' });
    expect(ui.gates).toEqual([]);
  });

  it('lists closed gates in GATES order and keeps the same array when nothing changed', () => {
    let ui = reduceUi(initialUi(false), { type: 'open', overlay: 'tip' });
    ui = reduceUi(ui, { type: 'open', overlay: 'menu' });
    expect(ui.gates).toEqual(GATES.filter((g) => ['offTable', 'menu', 'tip'].includes(g)));
    const same = reduceUi(ui, { type: 'layout', layout: 'wide' });
    expect(same.gates).toBe(ui.gates);
  });
});

describe('dispatch', () => {
  it('applies UI commands itself and hands game commands to the controller', () => {
    const store = createAppStore();
    const handler = vi.fn<(cmd: GameCommand) => void>();
    store.getState().dispatch({ type: 'play' }); // no controller yet: ignored
    store.setGameHandler(handler);
    store.getState().dispatch({ type: 'go', screen: 'table' });
    expect(store.getState().ui.screen).toBe('table');
    expect(handler).not.toHaveBeenCalled();
    store.getState().dispatch({ type: 'act', action: { type: 'check' } });
    expect(handler).toHaveBeenCalledWith({ type: 'act', action: { type: 'check' } });
  });

  it('a UI command that changes nothing leaves the state object as it was', () => {
    const store = createAppStore();
    const before = store.getState();
    store.getState().dispatch({ type: 'close', overlay: 'menu' });
    expect(store.getState()).toBe(before);
  });

  it('toasts are dismissed by id', () => {
    const store = createAppStore();
    store.setState((s) => ({
      ui: {
        ...s.ui,
        toasts: [
          { id: 1, kind: 'handVoided' },
          { id: 2, kind: 'handVoided' },
        ],
      },
    }));
    store.getState().dispatch({ type: 'dismissToast', id: 1 });
    expect(store.getState().ui.toasts).toEqual([{ id: 2, kind: 'handVoided' }]);
  });
});

describe('selectors', () => {
  const withGame = (patch: Partial<AppState['game']>): AppState => {
    const store = createAppStore();
    store.setState((s) => ({ game: { ...s.game, ...patch } }));
    return store.getState();
  };

  it('selectHandInProgress and selectTopOverlay', () => {
    const hand = deal(tableWith([1000, 1000]));
    expect(selectHandInProgress(withGame({ hand }))).toBe(true);
    expect(selectHandInProgress(withGame({ hand: null }))).toBe(false);
    const store = createAppStore();
    expect(selectTopOverlay(store.getState())).toBeNull();
    store.getState().dispatch({ type: 'open', overlay: 'menu' });
    store.getState().dispatch({ type: 'open', overlay: 'rankings' });
    expect(selectTopOverlay(store.getState())).toBe('rankings');
    expect(selectOverlayOpen('menu')(store.getState())).toBe(true);
    expect(selectOverlayOpen('tray')(store.getState())).toBe(false);
  });

  it('selectCanTopUp: between hands, the hero below the starting stack but not bust', () => {
    const table = tableWith([1000, 10000], { startingStack: 10000 });
    expect(selectCanTopUp(withGame({ mode: 'handEnd', next: table }))).toBe(true);
    expect(selectCanTopUp(withGame({ mode: 'botTurn', next: table }))).toBe(false);
    expect(selectCanTopUp(withGame({ mode: 'handEnd', next: null }))).toBe(false);
    const full = tableWith([10000, 10000], { startingStack: 10000 });
    expect(selectCanTopUp(withGame({ mode: 'handEnd', next: full }))).toBe(false);
  });
});
