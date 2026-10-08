/**
 * Screens and overlays without a router library (PLAN §12.1). The store's `ui` slice holds a `Nav`
 * and changes it only through `navigate`; `ui/screens/ScreenSwitcher.tsx` renders it. The URL
 * stays `/`.
 *
 * Pure: no DOM and no `history` here. `app/lifecycle.ts` connects Android Back and the browser's
 * back button: while Back has something to do (`historyDepth(nav) > 0`: an overlay is open, or a
 * screen has one below it) one extra history entry, the guard, sits on top; Back pops it and
 * `popstate` dispatches `{ type: 'back' }`, and the guard returns while more can be undone. So the
 * browser history never has to follow each screen, and a close by the UI (✕, scrim, Esc) never
 * calls `history.back()`. `back` closes the top-most overlay first, else goes back one screen;
 * an overlay that Back must not close (the out-of-chips dialog, §3.1) takes its screen with it.
 */

/**
 * The full-page screens built so far. Later stages add 'stats', 'learn', 'about'. 'review' (§12.10)
 * is a lazy screen: it is pushed over the Table, so Back returns to the hand.
 */
export type Screen = 'welcome' | 'home' | 'setup' | 'table' | 'settings' | 'review';

/**
 * Layers over a screen. Each one but the sizing tray keeps a controller gate closed while it is
 * open (Appendix A.8, `OVERLAY_GATE` in app/store.ts): 'menu' → `menu`, the dialogs → `dialog`, the
 * modal sheets → `sheet`.
 * - 'menu': the Table's ☰ sheet (§12.3).
 * - 'outOfChips': "You're out of chips…" (§3.1). Only its buttons close it.
 * - 'newTable': "Your unfinished hand will be folded. Start a new table?" (§3.1).
 * - 'rankings', 'coach', 'botCard', 'summary': the modal sheets (§13.1, §12.6, §9.3, §12.9).
 * - 'tray': the sizing tray (§12.7): Back closes it first, but it is not a gate.
 * - 'feedback', 'quiz', 'tip': the mistake card, the quiz and a first-table tip (Stages 6, 5, 9).
 */
export type Overlay =
  | 'menu'
  | 'outOfChips'
  | 'newTable'
  | 'rankings'
  | 'coach'
  | 'botCard'
  | 'summary'
  | 'tray'
  | 'feedback'
  | 'quiz'
  | 'tip';

export interface Nav {
  /** The back stack, oldest first; the last one is on screen. Never empty; [0] is a root. */
  readonly screens: readonly Screen[];
  /** Open overlays over the current screen, oldest first; the last one is on top. */
  readonly overlays: readonly Overlay[];
}

export type NavAction =
  /** Show a screen: a root resets the stack; 'table' always sits on 'home' (Back from the Table
   *  goes Home); any other screen is pushed, or the stack goes back to it if it is already there.
   *  Closes every overlay. */
  | { type: 'go'; screen: Screen }
  /** Like 'go', from the screen under the current one: the current screen leaves the stack
   *  (out-of-chips "Change table": the old table ends and Setup takes its place). */
  | { type: 'replace'; screen: Screen }
  /** Android Back, the browser's back button, the in-app Back button (see the module note). */
  | { type: 'back' }
  /** Opens an overlay on top (an open one moves to the top). */
  | { type: 'open'; overlay: Overlay }
  /** Closes the named overlay, or the top-most one. Buttons may close any overlay. */
  | { type: 'close'; overlay?: Overlay };

/** The screens a stack starts from: Welcome on the first launch, Home after that (§12.1). */
const ROOTS: readonly Screen[] = ['welcome', 'home'];

/** Whether Back (and Esc) may close an overlay (§3.1: the out-of-chips dialog stays). */
const BACK_CLOSES: Readonly<Record<Overlay, boolean>> = {
  menu: true,
  outOfChips: false,
  newTable: true,
  rankings: true,
  coach: true,
  botCard: true,
  summary: true,
  tray: true,
  feedback: true,
  quiz: true,
  tip: true,
};

/** The first screen: Welcome on the first launch (no saved profile), Home after that (§12.1). */
export function initialNav(firstLaunch: boolean): Nav {
  return { screens: [firstLaunch ? 'welcome' : 'home'], overlays: [] };
}

/** The screen on show. */
export function currentScreen(nav: Nav): Screen {
  return nav.screens[nav.screens.length - 1] ?? 'home';
}

/** The top-most open overlay, or null. */
export function topOverlay(nav: Nav): Overlay | null {
  return nav.overlays[nav.overlays.length - 1] ?? null;
}

/** How many browser history entries the app has pushed above its first one (module note). */
export function historyDepth(nav: Nav): number {
  return nav.screens.length - 1 + nav.overlays.length;
}

/** Whether Back closes this overlay (true) or leaves the screen under it (false). */
export function backCloses(overlay: Overlay): boolean {
  return BACK_CLOSES[overlay];
}

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** `nav` itself when nothing changes, so a store update can be skipped. */
function withState(nav: Nav, screens: readonly Screen[], overlays: readonly Overlay[]): Nav {
  return sameList(nav.screens, screens) && sameList(nav.overlays, overlays)
    ? nav
    : { screens, overlays };
}

/** The stack after showing `screen` over `stack` ('go'). */
function stackFor(stack: readonly Screen[], screen: Screen): readonly Screen[] {
  if (ROOTS.includes(screen)) return [screen];
  if (screen === 'table') return ['home', 'table'];
  const at = stack.indexOf(screen);
  return at >= 0 ? stack.slice(0, at + 1) : [...stack, screen];
}

/** The next navigation state. Pure; returns `nav` itself when the action changes nothing. */
export function navigate(nav: Nav, action: NavAction): Nav {
  const { screens, overlays } = nav;
  switch (action.type) {
    case 'go':
      return withState(nav, stackFor(screens, action.screen), []);
    case 'replace': {
      const under = screens.length > 1 ? screens.slice(0, -1) : screens;
      return withState(nav, stackFor(under, action.screen), []);
    }
    case 'back': {
      const top = topOverlay(nav);
      if (top !== null && backCloses(top)) return withState(nav, screens, overlays.slice(0, -1));
      if (screens.length > 1) return withState(nav, screens.slice(0, -1), []);
      return nav;
    }
    case 'open':
      return withState(nav, screens, [
        ...overlays.filter((o) => o !== action.overlay),
        action.overlay,
      ]);
    case 'close': {
      const target = action.overlay ?? topOverlay(nav);
      return withState(
        nav,
        screens,
        overlays.filter((o) => o !== target),
      );
    }
  }
}
