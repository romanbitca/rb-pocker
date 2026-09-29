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

const onTable = (): UiSlice => reduceUi(initialUi('home'), { type: 'navigate', screen: 'table' });

describe('screens and Back (§12.1)', () => {
  it('push, replace and reset; going to a screen in the back stack returns to it', () => {
    let ui = initialUi('home');
    ui = reduceUi(ui, { type: 'navigate', screen: 'table' });
    expect(ui).toMatchObject({ screen: 'table', backStack: ['home'] });
    ui = reduceUi(ui, { type: 'navigate', screen: 'settings' });
    expect(ui).toMatchObject({ screen: 'settings', backStack: ['home', 'table'] });
    ui = reduceUi(ui, { type: 'navigate', screen: 'table' });
    expect(ui).toMatchObject({ screen: 'table', backStack: ['home'] });
    ui = reduceUi(ui, { type: 'navigate', screen: 'setup', how: 'replace' });
    expect(ui).toMatchObject({ screen: 'setup', backStack: ['home'] });
    ui = reduceUi(ui, { type: 'navigate', screen: 'home', how: 'reset' });
    expect(ui).toMatchObject({ screen: 'home', backStack: [] });
  });

  it('Back closes the top-most overlay first, then goes back one screen, then does nothing', () => {
    let ui = onTable();
    ui = reduceUi(ui, { type: 'openOverlay', overlay: 'menu' });
    ui = reduceUi(ui, { type: 'openOverlay', overlay: 'rankings' });
    ui = reduceUi(ui, { type: 'back' });
    expect(ui.overlays).toEqual(['menu']);
    ui = reduceUi(ui, { type: 'back' });
    expect(ui).toMatchObject({ screen: 'table', overlays: [] });
    ui = reduceUi(ui, { type: 'back' });
    expect(ui).toMatchObject({ screen: 'home', backStack: [] });
    expect(reduceUi(ui, { type: 'back' })).toBe(ui);
  });

  it('Back with the sizing tray open closes the tray, not the table (Stage 3 acceptance 8)', () => {
    const ui = reduceUi(reduceUi(onTable(), { type: 'openOverlay', overlay: 'tray' }), {
      type: 'back',
    });
    expect(ui).toMatchObject({ screen: 'table', overlays: [] });
  });

  it('Back on the out-of-chips dialog returns Home (§3.1)', () => {
    const ui = reduceUi(reduceUi(onTable(), { type: 'openOverlay', overlay: 'outOfChips' }), {
      type: 'back',
    });
    expect(ui).toMatchObject({ screen: 'home', overlays: [] });
    const root = reduceUi(
      reduceUi(initialUi('table'), { type: 'openOverlay', overlay: 'outOfChips' }),
      { type: 'back' },
    );
    expect(root).toMatchObject({ screen: 'home', overlays: [] });
  });

  it('a screen change closes every overlay; opening twice or closing a closed one changes nothing', () => {
    let ui = reduceUi(onTable(), { type: 'openOverlay', overlay: 'menu' });
    expect(reduceUi(ui, { type: 'openOverlay', overlay: 'menu' })).toBe(ui);
    expect(reduceUi(ui, { type: 'closeOverlay', overlay: 'rankings' })).toBe(ui);
    ui = reduceUi(ui, { type: 'navigate', screen: 'settings' });
    expect(ui.overlays).toEqual([]);
  });
});

describe('gates (Appendix A.8)', () => {
  it('each overlay closes its gate; the tray closes none', () => {
    for (const overlay of Object.keys(OVERLAY_GATE) as Overlay[]) {
      const ui = reduceUi(onTable(), { type: 'openOverlay', overlay });
      const gate = OVERLAY_GATE[overlay];
      expect(ui.gates).toEqual(gate === null ? [] : [gate]);
    }
    expect(OVERLAY_GATE.tray).toBeNull();
    expect(OVERLAY_GATE.rankings).toBe('sheet');
    expect(OVERLAY_GATE.menu).toBe('menu');
  });

  it('offTable: any screen but the table; hidden; explicit holds by owner', () => {
    expect(initialUi('home').gates).toEqual(['offTable']);
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
    let ui = reduceUi(initialUi('home'), { type: 'openOverlay', overlay: 'tip' });
    ui = reduceUi(ui, { type: 'openOverlay', overlay: 'menu' });
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
    store.getState().dispatch({ type: 'navigate', screen: 'table' });
    expect(store.getState().ui.screen).toBe('table');
    expect(handler).not.toHaveBeenCalled();
    store.getState().dispatch({ type: 'act', action: { type: 'check' } });
    expect(handler).toHaveBeenCalledWith({ type: 'act', action: { type: 'check' } });
  });

  it('a UI command that changes nothing leaves the state object as it was', () => {
    const store = createAppStore();
    const before = store.getState();
    store.getState().dispatch({ type: 'closeOverlay', overlay: 'menu' });
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
    store.getState().dispatch({ type: 'openOverlay', overlay: 'menu' });
    store.getState().dispatch({ type: 'openOverlay', overlay: 'rankings' });
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
