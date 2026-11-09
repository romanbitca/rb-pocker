/**
 * The Back trap and the remote handler (PLAN §19.6, Stage 10 acceptance 11): at a table of the
 * server's, a Back that would leave the screen asks instead, and `MpDriver` sees game commands
 * before the controller does.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createAppStore,
  initialMp,
  initialUi,
  isUiCommand,
  OVERLAY_GATE,
  reduceUi,
  selectInTelegram,
  type GameCommand,
  type UiCommand,
  type UiSlice,
} from '../../src/app/store.ts';

const run = (ui: UiSlice, ...cmds: UiCommand[]): UiSlice => cmds.reduce(reduceUi, ui);
const BACK: UiCommand = { type: 'back' };
const atTable = (): UiSlice =>
  run(initialUi(false), { type: 'go', screen: 'table' }, { type: 'backTrap', overlay: 'mpLeave' });

describe('the Back trap (`ui.backTrap`)', () => {
  it('starts off, and the command sets and clears it', () => {
    expect(initialUi(false).backTrap).toBeNull();
    const ui = atTable();
    expect(ui.backTrap).toBe('mpLeave');
    expect(reduceUi(ui, { type: 'backTrap', overlay: null }).backTrap).toBeNull();
  });

  it('the same value changes nothing', () => {
    const ui = atTable();
    expect(reduceUi(ui, { type: 'backTrap', overlay: 'mpLeave' })).toBe(ui);
  });

  it('is a UI command', () => {
    expect(isUiCommand({ type: 'backTrap', overlay: null })).toBe(true);
  });

  it('Back with nothing open asks instead of leaving the screen', () => {
    const ui = reduceUi(atTable(), BACK);
    expect(ui.nav).toEqual({ screens: ['home', 'table'], overlays: ['mpLeave'] });
    expect(ui.screen).toBe('table');
  });

  it('Back closes what it may close first', () => {
    const ui = run(atTable(), { type: 'open', overlay: 'rankings' }, BACK);
    expect(ui.overlays).toEqual([]);
    expect(run(atTable(), { type: 'open', overlay: 'tray' }, BACK).overlays).toEqual([]);
    expect(run(atTable(), { type: 'open', overlay: 'menu' }, BACK).overlays).toEqual([]);
  });

  it('Back on the question closes it, and again asks', () => {
    let ui = reduceUi(atTable(), BACK);
    ui = reduceUi(ui, BACK);
    expect(ui.nav).toEqual({ screens: ['home', 'table'], overlays: [] });
    ui = reduceUi(ui, BACK);
    expect(ui.overlays).toEqual(['mpLeave']);
  });

  it('over an overlay Back may not close, it opens on top and keeps the screen', () => {
    const ui = run(atTable(), { type: 'open', overlay: 'outOfChips' }, BACK);
    expect(ui.nav).toEqual({ screens: ['home', 'table'], overlays: ['outOfChips', 'mpLeave'] });
  });

  it('a trap that is the open dialog holds: Back changes nothing', () => {
    const ui = run(
      atTable(),
      { type: 'backTrap', overlay: 'mpProblem' },
      { type: 'open', overlay: 'mpProblem' },
    );
    expect(reduceUi(ui, BACK)).toBe(ui);
  });

  it('works in the waiting room too', () => {
    const ui = run(
      initialUi(false),
      { type: 'replace', screen: 'mpRoom' },
      { type: 'backTrap', overlay: 'mpLeave' },
      BACK,
    );
    expect(ui.nav).toEqual({ screens: ['home', 'mpRoom'], overlays: ['mpLeave'] });
  });

  it('the app`s own moves are not trapped', () => {
    const ui = reduceUi(atTable(), { type: 'go', screen: 'home' });
    expect(ui.nav.screens).toEqual(['home']);
    const replaced = reduceUi(atTable(), { type: 'replace', screen: 'mpRoom' });
    expect(replaced.nav.screens).toEqual(['home', 'mpRoom']);
  });

  it('with no trap, Back leaves the screen as always', () => {
    const ui = reduceUi(reduceUi(initialUi(false), { type: 'go', screen: 'table' }), BACK);
    expect(ui.nav).toEqual({ screens: ['home'], overlays: [] });
  });

  it('both new dialogs close the `dialog` gate (nothing local moves behind them)', () => {
    expect(OVERLAY_GATE.mpLeave).toBe('dialog');
    expect(OVERLAY_GATE.mpProblem).toBe('dialog');
    const ui = reduceUi(atTable(), BACK);
    expect(ui.gates).toContain('dialog');
  });
});

describe('the remote handler', () => {
  function rig() {
    const store = createAppStore();
    const game = vi.fn<(cmd: GameCommand) => void>();
    store.setGameHandler(game);
    return { store, game, dispatch: store.getState().dispatch };
  }

  it('is asked first; true keeps the command from the controller', () => {
    const { store, game, dispatch } = rig();
    const remote = vi.fn<(cmd: GameCommand) => boolean>(() => true);
    store.setRemoteHandler(remote);
    dispatch({ type: 'nextHand' });
    expect(remote).toHaveBeenCalledWith({ type: 'nextHand' });
    expect(game).not.toHaveBeenCalled();
  });

  it('false lets it through to the controller', () => {
    const { store, game, dispatch } = rig();
    store.setRemoteHandler(() => false);
    dispatch({ type: 'exportStats' });
    expect(game).toHaveBeenCalledWith({ type: 'exportStats' });
  });

  it('with none registered, the controller gets everything', () => {
    const { store, game, dispatch } = rig();
    store.setRemoteHandler(() => true);
    store.setRemoteHandler(null);
    dispatch({ type: 'nextHand' });
    expect(game).toHaveBeenCalledTimes(1);
  });

  it('is not asked for UI commands', () => {
    const { store, dispatch } = rig();
    const remote = vi.fn<(cmd: GameCommand) => boolean>(() => true);
    store.setRemoteHandler(remote);
    dispatch({ type: 'go', screen: 'table' });
    dispatch({ type: 'open', overlay: 'menu' });
    dispatch({ type: 'showHint' });
    expect(remote).not.toHaveBeenCalled();
    expect(store.getState().ui.overlays).toEqual(['menu']);
  });

  it('a store starts with no table', () => {
    expect(createAppStore().getState().mp).toEqual(initialMp());
  });

  it('selectInTelegram reads the `tg` slice', () => {
    const store = createAppStore();
    expect(selectInTelegram(store.getState())).toBe(false);
    store.setState({ tg: { inside: true } });
    expect(selectInTelegram(store.getState())).toBe(true);
  });
});
