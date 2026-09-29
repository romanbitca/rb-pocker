/**
 * The app's one Zustand store (PLAN §2.5): slices `game`, `equity`, `coach`, `ui` and `settings`.
 *
 * - It holds the reducer's output and UI state only; it never runs game logic. The TableController
 *   (`app/controller.ts`) drives every hand and writes the `game` slice; equity progress will write
 *   only the `equity` slice (Stage 4, pitfall 37).
 * - The UI may import only this module from `app` (PLAN §2.1), so everything the screens need
 *   comes from here: the state, narrow selectors, hooks and `dispatch`. `dispatch` applies UI
 *   commands (screens, overlays, Back, layout, toasts) itself and hands game commands to the
 *   controller, which registers with `setGameHandler`.
 * - Components subscribe with a narrow selector, never to the whole store: `useAppStore(selector)`
 *   for one value, `useAppStoreShallow(selector)` for several (`useShallow`). Seats are
 *   `React.memo` (pitfall 37).
 * - Gates (Appendix A.8): `ui.gates` lists the closed ones. It is derived from the page visibility
 *   (`hidden`), the screen (`offTable`), the open overlays (`OVERLAY_GATE`) and explicit holds
 *   (the `gate` command). Bots, think timers and `advance` wait while any gate is closed.
 */
import { useCallback } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { HandState, LegalActions, PlayerAction, TableState } from '../engine/types.ts';
import { defaultSettings } from '../persist/schema.ts';
import type { Settings } from '../persist/schema.ts';

export { useShallow };
// The view-model selectors (ui/views.ts shapes): the UI imports them from here (§2.1).
export * from './tableViews.ts';

// ---------------------------------------------------------------------------------------------
// Appendix A.8 (the controller's modes and gates; `app/controller.ts` re-exports them)

export type ControllerMode =
  | 'booting' // profile read, workers starting (§12.14)
  | 'idle' // no hand: between hands, bust dialog, or Table not open
  | 'botTurn'
  | 'heroTurn'
  | 'grading' // ≤ 1,500 ms after a hero act (§11.3 r5; Stage 6)
  | 'feedback' // mistake card open (Stage 6)
  | 'advancing' // animation pause before an `advance`
  | 'handEnd'; // banner / summary; then commit (§14.3) and next hand

export type Gate =
  'hidden' | 'offTable' | 'menu' | 'sheet' | 'dialog' | 'feedback' | 'quiz' | 'tip';
/** Every gate, in a fixed order (`ui.gates` lists the closed ones in this order). */
export const GATES: readonly Gate[] = [
  'hidden',
  'offTable',
  'menu',
  'sheet',
  'dialog',
  'feedback',
  'quiz',
  'tip',
];

// ---------------------------------------------------------------------------------------------
// UI vocabulary

/** Screens (§12.1). No router library: `ui.screen` is the current one. */
export type Screen =
  | 'welcome'
  | 'home'
  | 'setup'
  | 'table'
  | 'settings'
  | 'learn'
  | 'stats'
  | 'about'
  | 'review'
  | 'bench';

/**
 * Overlays: modal sheets, dialogs and the sizing tray. Each one open is a step for Android Back
 * (§12.1: Back closes the top-most overlay first). `OVERLAY_GATE` says which gate it closes.
 */
export type Overlay =
  | 'menu' // the ☰ menu sheet (§12.3)
  | 'rankings' // the hand-rankings drawer (§13.1)
  | 'coach' // the coach sheet (§12.6)
  | 'botCard' // tap a seat → bot card (§9.3)
  | 'summary' // the hand summary sheet (§12.9)
  | 'tray' // the sizing tray (§12.7): NOT a gate
  | 'outOfChips' // "You're out of chips" (§3.1)
  | 'confirmNewTable' // "Your unfinished hand will be folded. Start a new table?" (§3.1)
  | 'feedback' // the mistake card (§12.6; Stage 6)
  | 'quiz' // the Advanced quiz (§10.3)
  | 'tip'; // a first-table tip (§12.11)

/** The gate each overlay closes while it is open (Appendix A.8); null = no gate. */
export const OVERLAY_GATE: Readonly<Record<Overlay, Gate | null>> = {
  menu: 'menu',
  rankings: 'sheet',
  coach: 'sheet',
  botCard: 'sheet',
  summary: 'sheet',
  tray: null,
  outOfChips: 'dialog',
  confirmNewTable: 'dialog',
  feedback: 'feedback',
  quiz: 'quiz',
  tip: 'tip',
};

/**
 * What Android Back does when the overlay is on top: `close` it, or `leave` the screen (the
 * out-of-chips dialog cannot be dismissed any other way: Back returns to Home, §3.1).
 */
export const OVERLAY_BACK: Readonly<Record<Overlay, 'close' | 'leave'>> = {
  menu: 'close',
  rankings: 'close',
  coach: 'close',
  botCard: 'close',
  summary: 'close',
  tray: 'close',
  outOfChips: 'leave',
  confirmNewTable: 'close',
  feedback: 'close',
  quiz: 'close',
  tip: 'close',
};

/** Layout (§12.3): one CSS media query each; first match wins. */
export type Layout = 'portrait' | 'landscape' | 'wide';

/** Bot speed (§9.8, §12.8). */
export type Speed = 'normal' | 'fast' | 'instant';

/** Short messages the controller shows (§12.11); the UI turns them into text and removes them. */
export type Toast =
  /** "Nora sits down." / "Nora, Ben and Sam sit down." (§3.1) */
  | { id: number; kind: 'botsJoined'; names: string[] }
  /** "This hand was cancelled because of an internal error. Your chips were returned." (§4.5) */
  | { id: number; kind: 'handVoided' }
  /** "Your last hand could not be restored. Chips were returned." (§14.3 load table) */
  | { id: number; kind: 'handNotRestored' }
  /** "Your saved data was damaged. We started fresh and kept a copy." (§12.11) */
  | { id: number; kind: 'dataRecovered' };

/** An explicit gate close by `owner` (e.g. a first-table tip); the gate stays closed while any hold exists. */
export interface GateHold {
  gate: Gate;
  owner: string;
}

// ---------------------------------------------------------------------------------------------
// Slices

export interface GameSlice {
  mode: ControllerMode;
  /** The table the current hand was dealt from, as at hand start (names, levels); null before a table. */
  table: TableState | null;
  /** The hand being played, or the one that just ended (mode `handEnd`); null when there is none. */
  hand: HandState | null;
  /**
   * Between hands: the table the next hand is dealt from (after `nextTable`: final stacks,
   * replaced bots, top-ups). Null while a hand is being played.
   */
  next: TableState | null;
  /** The hero's legal actions while it is the hero's turn (mode `heroTurn`), else null. */
  legal: LegalActions | null;
  /** The hero has no chips: no next hand until Reload or Change table (§3.1). */
  heroBust: boolean;
  /** Settings → Diagnostics counters (§4.5, §12.14). */
  diag: Diagnostics;
}

export interface Diagnostics {
  /** Illegal inputs the engine refused (a UI or bot bug). */
  engineErrors: number;
  /** Bot turns that took the safest legal action instead (illegal action, error or timeout). */
  botFallbacks: number;
  /** Hands voided after an internal error (§4.5). */
  voidedHands: number;
}

/** Stage 4 fills this slice (the HUD win chance, §7). Only equity progress writes it (pitfall 37). */
export interface EquitySlice {
  status: 'off';
}

/** Stage 5 fills this slice (hints and grades, §8). */
export interface CoachSlice {
  status: 'off';
}

export interface UiSlice {
  screen: Screen;
  /** The screens under the current one; Back returns to the last (§12.1). Empty = a root screen. */
  backStack: Screen[];
  /** Open overlays, bottom to top. */
  overlays: Overlay[];
  /** The page is hidden, or became visible less than 300 ms ago (§12.13). */
  hidden: boolean;
  /** Explicit gate closes (the `gate` command). */
  holds: GateHold[];
  /** The closed gates, derived from the fields above (GATES order). Empty = every gate open. */
  gates: Gate[];
  layout: Layout;
  toasts: Toast[];
  /**
   * The §12.11 banner "Stats can't be saved in this browser mode…": the browser storage failed
   * (once per launch, `SafeStorage.onFailure`); [OK] sends `dismissStorageBanner`.
   */
  storageBanner: boolean;
}

/**
 * The player's settings: Appendix A.7 `Settings`, as stored in `pc.v1.profile` (chunk 3.2). The
 * controller saves every change (debounced 250 ms, §14.2) and keeps `seatLevels.length ===
 * players`.
 */
export type GameSettings = Settings;
export type { Settings };

/** First-launch values (§3.2, §12.1): you + 5 bots, 2,000 chips, blinds 10/20, Easy, Beginner. */
export const defaultGameSettings: () => Settings = defaultSettings;

/** Setup's four questions (§12.2): what a new table is made from. */
export type TableSetup = Pick<
  Settings,
  'players' | 'startingStack' | 'sb' | 'bb' | 'botLevel' | 'coachLevel' | 'seatLevels'
>;

// ---------------------------------------------------------------------------------------------
// Commands

/** Commands the store applies itself (UI state only). */
export type UiCommand =
  /**
   * Go to a screen and close every overlay. `push` (default) keeps the current screen for Back;
   * `replace` swaps it; `reset` clears Back (a root screen). A screen already in the back stack is
   * returned to (the stack above it is dropped), so Back never loops.
   */
  | { type: 'navigate'; screen: Screen; how?: 'push' | 'replace' | 'reset' }
  | { type: 'openOverlay'; overlay: Overlay }
  | { type: 'closeOverlay'; overlay: Overlay }
  /** Android Back / browser back (from `app/lifecycle.ts`): close the top overlay, else go back one screen. */
  | { type: 'back' }
  /** Close (or reopen) a gate explicitly, e.g. while a first-table tip is shown. */
  | { type: 'gate'; gate: Gate; closed: boolean; owner?: string }
  | { type: 'layout'; layout: Layout }
  | { type: 'dismissToast'; id: number }
  /** [OK] on the storage banner. */
  | { type: 'dismissStorageBanner' };

/** Commands the TableController handles. */
export type GameCommand =
  /** Welcome / Home Play (§12.1): continue the table, else start one with the last-used settings. */
  | { type: 'play' }
  /**
   * Setup's Start game, Menu → New table (§12.2): start a new table from the settings (`setup`
   * patches them first). An unfinished hand is folded and finished without animation (§3.1):
   * ask the §3.1 question before sending this mid-hand.
   */
  | { type: 'newTable'; setup?: Partial<TableSetup> }
  /** The hero's action; only in mode `heroTurn`, and only inside `game.legal`. */
  | { type: 'act'; action: PlayerAction }
  /** Tap on the hand-end banner or "Next hand ›": start the next hand now. */
  | { type: 'nextHand' }
  /** Out of chips → Reload {startingStack} chips (§3.1). */
  | { type: 'reload' }
  /** Menu → Top up to {startingStack} chips (between hands, when below it; §3.1). */
  | { type: 'topUp' }
  /** Menu → Leave table: Home; the unfinished hand stays saved (§3.1). */
  | { type: 'leaveTable' }
  /** Out of chips → Change table: Setup; the old table's session ends (§3.1). */
  | { type: 'changeTable' }
  | { type: 'settings'; patch: Partial<GameSettings> }
  /** From `app/lifecycle.ts`: `visibilitychange` (§12.13). */
  | { type: 'visibility'; hidden: boolean }
  /** From `app/lifecycle.ts`: `pagehide` (flush storage, §14.6). */
  | { type: 'pagehide' };

export type Command = UiCommand | GameCommand;

const UI_COMMANDS: ReadonlySet<string> = new Set([
  'navigate',
  'openOverlay',
  'closeOverlay',
  'back',
  'gate',
  'layout',
  'dismissToast',
  'dismissStorageBanner',
]);

export const isUiCommand = (cmd: Command): cmd is UiCommand => UI_COMMANDS.has(cmd.type);

// ---------------------------------------------------------------------------------------------
// The store

export interface AppState {
  game: GameSlice;
  equity: EquitySlice;
  coach: CoachSlice;
  ui: UiSlice;
  settings: GameSettings;
  /** The one way to change anything (the UI dispatches through the controller, §2.1). Stable. */
  dispatch: (cmd: Command) => void;
}

export interface AppStore extends StoreApi<AppState> {
  /** The TableController registers here (null to unregister); game commands go to it. */
  setGameHandler(handler: ((cmd: GameCommand) => void) | null): void;
}

export function initialGame(): GameSlice {
  return {
    mode: 'booting',
    table: null,
    hand: null,
    next: null,
    legal: null,
    heroBust: false,
    diag: { engineErrors: 0, botFallbacks: 0, voidedHands: 0 },
  };
}

export function initialUi(screen: Screen = 'welcome'): UiSlice {
  return withGates({
    screen,
    backStack: [],
    overlays: [],
    hidden: false,
    holds: [],
    gates: [],
    layout: 'portrait',
    toasts: [],
    storageBanner: false,
  });
}

/** A fresh store (tests make their own; the app uses `appStore`). */
export function createAppStore(): AppStore {
  let gameHandler: ((cmd: GameCommand) => void) | null = null;
  const api = createStore<AppState>()((set) => ({
    game: initialGame(),
    equity: { status: 'off' },
    coach: { status: 'off' },
    ui: initialUi(),
    settings: defaultGameSettings(),
    dispatch: (cmd) => {
      if (isUiCommand(cmd)) {
        set((s) => {
          const ui = reduceUi(s.ui, cmd);
          return ui === s.ui ? s : { ui };
        });
      } else if (gameHandler !== null) {
        gameHandler(cmd);
      }
    },
  }));
  return Object.assign(api, {
    setGameHandler(handler: ((cmd: GameCommand) => void) | null): void {
      gameHandler = handler;
    },
  });
}

/** Changes the `ui` slice (the controller uses it for `hidden` and toasts); gates are re-derived. */
export function updateUi(store: StoreApi<AppState>, change: (ui: UiSlice) => UiSlice): void {
  store.setState((s) => {
    const ui = withGates(change(s.ui));
    return ui === s.ui ? s : { ui };
  });
}

// ---------------------------------------------------------------------------------------------
// The UI reducer (pure)

/** Applies a UI command; returns `ui` itself when nothing changes. */
export function reduceUi(ui: UiSlice, cmd: UiCommand): UiSlice {
  switch (cmd.type) {
    case 'navigate':
      return withGates(navigate(ui, cmd.screen, cmd.how ?? 'push'));
    case 'openOverlay':
      if (ui.overlays.includes(cmd.overlay)) return ui;
      return withGates({ ...ui, overlays: [...ui.overlays, cmd.overlay] });
    case 'closeOverlay':
      if (!ui.overlays.includes(cmd.overlay)) return ui;
      return withGates({ ...ui, overlays: ui.overlays.filter((o) => o !== cmd.overlay) });
    case 'back':
      return withGates(back(ui));
    case 'gate': {
      const owner = cmd.owner ?? cmd.gate;
      const held = ui.holds.some((h) => h.gate === cmd.gate && h.owner === owner);
      if (held === cmd.closed) return ui;
      const holds = cmd.closed
        ? [...ui.holds, { gate: cmd.gate, owner }]
        : ui.holds.filter((h) => !(h.gate === cmd.gate && h.owner === owner));
      return withGates({ ...ui, holds });
    }
    case 'layout':
      return cmd.layout === ui.layout ? ui : { ...ui, layout: cmd.layout };
    case 'dismissToast':
      if (!ui.toasts.some((t) => t.id === cmd.id)) return ui;
      return { ...ui, toasts: ui.toasts.filter((t) => t.id !== cmd.id) };
    case 'dismissStorageBanner':
      return ui.storageBanner ? { ...ui, storageBanner: false } : ui;
  }
}

function navigate(ui: UiSlice, screen: Screen, how: 'push' | 'replace' | 'reset'): UiSlice {
  if (how === 'reset') return { ...ui, screen, backStack: [], overlays: [] };
  const at = ui.backStack.indexOf(screen);
  if (at >= 0) return { ...ui, screen, backStack: ui.backStack.slice(0, at), overlays: [] };
  if (screen === ui.screen) return ui.overlays.length === 0 ? ui : { ...ui, overlays: [] };
  const backStack = how === 'push' ? [...ui.backStack, ui.screen] : ui.backStack;
  return { ...ui, screen, backStack, overlays: [] };
}

function back(ui: UiSlice): UiSlice {
  const top = ui.overlays[ui.overlays.length - 1];
  if (top !== undefined && OVERLAY_BACK[top] === 'close') {
    return { ...ui, overlays: ui.overlays.slice(0, -1) };
  }
  const previous = ui.backStack[ui.backStack.length - 1];
  if (previous !== undefined) {
    return { ...ui, screen: previous, backStack: ui.backStack.slice(0, -1), overlays: [] };
  }
  // A `leave` overlay on a root screen: Home (§3.1: "Back returns to Home").
  if (top !== undefined) return { ...ui, screen: 'home', overlays: [] };
  return ui;
}

/** The gates `ui` closes (GATES order). */
export function closedGates(ui: Omit<UiSlice, 'gates'>): Gate[] {
  const closed = new Set<Gate>(ui.holds.map((h) => h.gate));
  if (ui.hidden) closed.add('hidden');
  if (ui.screen !== 'table') closed.add('offTable');
  for (const overlay of ui.overlays) {
    const gate = OVERLAY_GATE[overlay];
    if (gate !== null) closed.add(gate);
  }
  return GATES.filter((g) => closed.has(g));
}

/** `ui` with `gates` re-derived; keeps the old array (and `ui` itself) when nothing changed. */
function withGates(ui: UiSlice): UiSlice {
  const gates = closedGates(ui);
  const same = gates.length === ui.gates.length && gates.every((g, i) => g === ui.gates[i]);
  return same ? ui : { ...ui, gates };
}

// ---------------------------------------------------------------------------------------------
// The app's store, selectors and hooks

/** The store the app renders from (main.tsx starts the controller on it). */
export const appStore: AppStore = createAppStore();

/** Dispatches on the app's store (for event handlers outside React). */
export function dispatch(cmd: Command): void {
  appStore.getState().dispatch(cmd);
}

/** One value from the app's store. Always pass a narrow selector (pitfall 37). */
export function useAppStore<T>(selector: (s: AppState) => T): T {
  return useStore(appStore, selector);
}

/** Several values from the app's store: the selector returns an object or array, compared shallowly. */
export function useAppStoreShallow<T>(selector: (s: AppState) => T): T {
  return useStore(appStore, useShallow(selector));
}

/** The stable `dispatch` of the app's store. */
export function useDispatch(): (cmd: Command) => void {
  return useStore(appStore, selectDispatch);
}

/**
 * An overlay as a controlled `open` / `onOpenChange` pair, for the rankings drawer
 * (`<RankingsDrawer open={open} onOpenChange={setOpen} …/>`), the menu, the sizing tray and the
 * dialogs. Opening it closes its gate (`OVERLAY_GATE`) and makes Android Back close it first.
 */
export function useOverlay(overlay: Overlay): [open: boolean, setOpen: (open: boolean) => void] {
  const open = useStore(appStore, (s) => s.ui.overlays.includes(overlay));
  const dispatchCmd = useDispatch();
  const setOpen = useCallback(
    (next: boolean) => dispatchCmd({ type: next ? 'openOverlay' : 'closeOverlay', overlay }),
    [dispatchCmd, overlay],
  );
  return [open, setOpen];
}

export const selectDispatch = (s: AppState): AppState['dispatch'] => s.dispatch;
export const selectMode = (s: AppState): ControllerMode => s.game.mode;
export const selectTable = (s: AppState): TableState | null => s.game.table;
export const selectHand = (s: AppState): HandState | null => s.game.hand;
export const selectNextTable = (s: AppState): TableState | null => s.game.next;
export const selectLegal = (s: AppState): LegalActions | null => s.game.legal;
export const selectHeroBust = (s: AppState): boolean => s.game.heroBust;
export const selectDiagnostics = (s: AppState): Diagnostics => s.game.diag;
export const selectScreen = (s: AppState): Screen => s.ui.screen;
export const selectOverlays = (s: AppState): Overlay[] => s.ui.overlays;
export const selectTopOverlay = (s: AppState): Overlay | null =>
  s.ui.overlays[s.ui.overlays.length - 1] ?? null;
export const selectGates = (s: AppState): Gate[] => s.ui.gates;
export const selectLayout = (s: AppState): Layout => s.ui.layout;
export const selectToasts = (s: AppState): Toast[] => s.ui.toasts;
export const selectSettings = (s: AppState): GameSettings => s.settings;
export const selectSpeed = (s: AppState): Speed => s.settings.speed;

/** Is `overlay` open? (A boolean, so the component re-renders only when it opens or closes.) */
export const selectOverlayOpen =
  (overlay: Overlay) =>
  (s: AppState): boolean =>
    s.ui.overlays.includes(overlay);

/** A hand is dealt and not over: starting a new table would fold it (§3.1). */
export const selectHandInProgress = (s: AppState): boolean =>
  s.game.hand !== null && s.game.hand.phase !== 'complete';

/** The table the top bar and Menu describe: the next hand's table between hands, else the hand's. */
export const selectCurrentTable = (s: AppState): TableState | null => s.game.next ?? s.game.table;

/** Menu → "Top up to {startingStack} chips" is offered (§3.1, §12.3): between hands, below it. */
export const selectCanTopUp = (s: AppState): boolean => {
  const next = s.game.next;
  if (next === null || (s.game.mode !== 'handEnd' && s.game.mode !== 'idle')) return false;
  const hero = next.slots[0];
  return hero !== undefined && hero.stack > 0 && hero.stack < next.config.startingStack;
};
