/**
 * The app's one Zustand store (PLAN §2.5): slices `game`, `equity`, `coach`, `ui` and `settings`.
 *
 * - It holds the reducer's output and UI state only; it never runs game logic. The TableController
 *   (`app/controller.ts`) drives every hand and writes the `game` slice; its equity jobs
 *   (`app/equityJobs.ts`) write only the `equity` slice (pitfall 37).
 * - The UI may import only this module from `app` (PLAN §2.1), so everything the screens need
 *   comes from here: the state, narrow selectors, hooks and `dispatch`. `dispatch` applies UI
 *   commands (the `NavAction`s of app/navigation.ts, the one navigation model: screens, overlays,
 *   Back; and gates, layout, toasts) itself and hands game commands to the controller, which
 *   registers with `setGameHandler`.
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
import type { EquityResult, HandAnalysis } from '../analysis/types.ts';
import type { Explanation } from '../brain/explain.ts';
import type { Decision } from '../brain/types.ts';
import type { Card } from '../core/cards.ts';
import type {
  CoachLevel,
  HandState,
  LegalActions,
  PlayerAction,
  SeatStats,
  TableState,
} from '../engine/types.ts';
import { defaultSettings } from '../persist/schema.ts';
import type { DecisionRecord, Settings } from '../persist/schema.ts';
import { heroDecisionKey, levelInForce } from './coachViews.ts';
import { choiceCount, quizQuestions } from './quiz.ts';
import { UNDO_POLICY, type FeedbackView } from './undo.ts';
import {
  currentScreen,
  initialNav,
  navigate,
  type Nav,
  type NavAction,
  type Overlay,
  type Screen,
} from './navigation.ts';
import {
  initialReview,
  listItemOf,
  selectHandSeq,
  type ReviewCommand,
  type ReviewHand,
  type ReviewListItem,
  type ReviewSlice,
} from './review.ts';

export { useShallow };
export type { Nav, NavAction, Overlay, Screen };
// Review (§12.10, chunk 6.3): the hands kept in memory, and the view model of one of them. The
// builder is small (it reuses the Table's view builders); the screen itself is lazy (ui/App.tsx).
export { buildReview } from './reviewViews.ts';
export type { ReviewCommand, ReviewHand, ReviewListItem, ReviewSlice };
export type {
  ReviewActor,
  ReviewEvent,
  ReviewFrame,
  ReviewReplay,
  ReviewSummary,
  ReviewView,
} from './reviewViews.ts';
// The view-model selectors (ui/views.ts shapes): the UI imports them from here (§2.1).
export * from './tableViews.ts';
// The HUD numbers (win badge, draw chips, big-move line, "By river"): the same, for Stage 4.
export * from './equityViews.ts';
// Secure-context feature detection (§12.14, pitfall 43): the UI reads it from here too (§2.1).
export { missingFeatures, secureFeatures, type SecureFeatures } from './secure.ts';
// All-in TV mode and the luck line (§7.6, chunk 4.7): the same, for the table.
export * from './runoutViews.ts';
// The bot card of a tapped seat (§9.3, chunk 5.10): the same.
export * from './botCardViews.ts';
// The coach strip, sheet and recommendation (§10.2, §12.6, chunk 5.9): the same, for the coach.
export * from './coachViews.ts';
// Undo and the feedback card (§10.2, §11, chunk 6.2): the level rules and the card's shapes.
export { UNDO_POLICY, type FeedbackView, type MoveView, type UndoPolicy } from './undo.ts';
// "Which hand wins?" (§13.2): two random hands that do not tie (the quiz is a lazy chunk).
export { dealPair, type WhichPair } from './whichWins.ts';
// The coach levels as data (§10.2, chunk 6.4) and the Advanced quiz (§10.3).
export {
  atLeast,
  chipShows,
  decisionScore,
  LEVEL_RULES,
  summaryShows,
  type LevelRules,
} from './levels.ts';
export {
  choiceCount,
  NEED_BANDS,
  quizQuestions,
  quizScore,
  rightAnswers,
  WIN_BANDS,
  type QuizQuestion,
  type QuizScore,
} from './quiz.ts';

// ---------------------------------------------------------------------------------------------
// Appendix A.8 (the controller's modes and gates; `app/controller.ts` re-exports them)

export type ControllerMode =
  | 'booting' // profile read, workers starting (§12.14)
  | 'idle' // no hand: between hands, bust dialog, or Table not open
  | 'botTurn'
  | 'heroTurn'
  | 'grading' // ≤ 1,500 ms after a hero act, waiting for its grade (§11.3 r5)
  | 'feedback' // the mistake card is open: nothing moves until Undo or Keep my move (§11.1)
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

/** The gate each overlay closes while it is open (Appendix A.8); null = no gate. */
export const OVERLAY_GATE: Readonly<Record<Overlay, Gate | null>> = {
  menu: 'menu',
  outOfChips: 'dialog',
  newTable: 'dialog',
  rankings: 'sheet',
  coach: 'sheet',
  botCard: 'sheet',
  summary: 'sheet',
  tray: null,
  feedback: 'feedback',
  quiz: 'quiz',
  tip: 'tip',
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
  | { id: number; kind: 'dataRecovered' }
  /** "Move taken back. The unseen cards were shuffled again." (§11.3 r3, Appendix F.10) */
  | { id: number; kind: 'undone' };

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
  /**
   * What the table has seen each player do (§9.5 seat statistics, by `playerId`; the hero's is the
   * hero model): updated at every hand end, read by the Hard/Expert bot card (§9.3, chunk 7.1). A
   * player not seen yet has no entry.
   */
  seatStats: Readonly<Record<string, SeatStats>>;
  /** Settings → Diagnostics counters (§4.5, §12.14). */
  diag: Diagnostics;
  /**
   * Undo can be taken now (§11.3 r2, r5; the decision's coach level, §10.2). Where it shows comes
   * from the level (`UNDO_POLICY`): the toolbar Undo at Beginner and Intermediate, only inside the
   * feedback card at Advanced, nowhere at Exam.
   */
  canUndo: boolean;
  /** The feedback card's content while it is open (mode `feedback`), else null (§11.1, §12.6). */
  feedback: FeedbackView | null;
  /**
   * This hand's hero decisions as recorded so far (A.7), the undone ones included: the grade chips
   * (§12.6) and the hand summary (6.3) read them.
   */
  decisions: readonly DecisionRecord[];
  /**
   * The coach level in force (§10, chunk 6.4): fixed when a hero decision starts, so a change in
   * Settings applies from the next decision; it stays the latest decision's until the hand ends.
   * Null before the hero's first decision of the hand: the settings' level is in force then
   * (`selectCoachLevel`).
   */
  coachLevel: CoachLevel | null;
}

export interface Diagnostics {
  /** Illegal inputs the engine refused (a UI or bot bug). */
  engineErrors: number;
  /** Bot turns that took the safest legal action instead (illegal action, error or timeout). */
  botFallbacks: number;
  /** Hands voided after an internal error (§4.5). */
  voidedHands: number;
}

/**
 * What the win badge shows (§7.6, §12.14):
 * - 'off': no badge (no hand, the hero is not dealt in, or the hand is over).
 * - 'folded': the hero folded: "Folded", no number.
 * - 'computing': a job is running for `situation` (or waits for the page to be visible): the
 *   skeleton "--%" while there is no estimate, else "~NN%" (hysteresis, §7.6).
 * - 'done': the final estimate: "NN%" ("~NN%" when `result.truncated`).
 * - 'timedOut': no final within 4 s, or the job failed: keep the last estimate with "~", or "—"
 *   when there is none; the next trigger (§7.4) computes again.
 * - 'unavailable': the worker failed after its restart: "—", popover "Win chance is not
 *   available right now".
 */
export type EquityStatus = 'off' | 'folded' | 'computing' | 'done' | 'timedOut' | 'unavailable';

/** The situation a HUD estimate is for (§7.1, §7.4): only a change of one of these recomputes. */
export interface EquitySituation {
  handSeq: number;
  /** The hero's hole cards, as dealt. */
  hero: [Card, Card];
  /** The board, in deal order. */
  board: Card[];
  /** Live opponents: dealt in and not folded (all-in players count). */
  nOpp: number;
}

/** All-in run-out equities of the face-up hands (§7.2 known hands, §7.6 TV mode). */
export interface KnownEquity {
  handSeq: number;
  /** The face-up seats, in `hand.revealed` order. */
  seats: number[];
  /** The board these equities are for; the previous street's values stay until the new ones come. */
  board: Card[];
  /** Equity of each seat in `seats`, fractions in [0, 1] adding up to 1. */
  perPlayer: number[];
  exact: boolean;
  final: boolean;
}

/**
 * The HUD win chance (§7) and the hand analysis (§6), from `equity.worker`. Only the equity jobs
 * (`app/equityJobs.ts`) write this slice, and they write nothing else (pitfall 37).
 */
export interface EquitySlice {
  status: EquityStatus;
  /**
   * 'random': the hero's equity against unknown random hands (`result`). 'known': an all-in
   * run-out with the hands face up (`known`, which has the hero's number when the hero is live).
   */
  mode: 'random' | 'known';
  /** The situation `result` is for; null when there is none (no hand, folded, known mode). */
  situation: EquitySituation | null;
  /** The latest estimate for `situation`: progress (`final: false`), then the final one; null until the first. */
  result: EquityResult | null;
  /** The last final estimate of this hand before `situation` (the §7.6 big-move line), or null. */
  previous: { equity: number; nOpp: number; board: Card[] } | null;
  /** §6 for the hero's current cards (draws, outs, risky outs, chances, beaters, nuts); null until it comes, and when folded. */
  analysis: HandAnalysis | null;
  /** The run-out equities of this hand, or null. */
  known: KnownEquity | null;
  /**
   * The run-out equities for the board as it was when the hands turned face up, the chips all in
   * (chunk 4.7): the hero's number in the §7.6 luck line, and later the All-in luck stat (§14.4).
   * Only when the hero is one of the face-up hands; it stays after the hand is complete.
   */
  allIn: KnownEquity | null;
}

export function initialEquity(): EquitySlice {
  return {
    status: 'off',
    mode: 'random',
    situation: null,
    result: null,
    previous: null,
    analysis: null,
    known: null,
    allIn: null,
  };
}

/**
 * The coach's hint for the hero's decision (§8.10, §10.2, §12.6). The controller's hint jobs
 * (`app/hintJobs.ts`, chunk 5.7) write `key`, `status` and `decision` and nothing else (pitfall 37:
 * a hint re-renders only the coach's places); the `showHint` command writes `opened`. Grades join
 * it in Stage 6.
 */
export interface CoachSlice {
  /** `coachKeyOf(hand)` of the decision `status` and `decision` are for; null before the first. */
  key: string | null;
  /** 'ready': `decision` is the advice; 'failed': the coach could not answer (§12.11). */
  status: 'idle' | 'ready' | 'failed';
  decision: Decision | null;
  /** `explain()` of `decision` (chunk 5.6), from the worker: `i18n/coach.ts` renders it. */
  explanation: Explanation | null;
  /**
   * The decision whose hint the player opened (Intermediate's "Hint", §10.2), by its key. Above
   * Beginner, opening it marks the decision as helped (stats, Stage 6).
   */
  opened: string | null;
  /**
   * The Advanced quiz of a decision (§10.3, chunk 6.4): written by the hint jobs when they ask
   * about a decision that rolled one (null: this decision has none), then by the `quizAnswer` and
   * `quizSkip` commands.
   */
  quiz: CoachQuiz | null;
}

/** One decision's quiz: its answers so far (indices into each question's choices, in order). */
export interface CoachQuiz {
  /** `coachKeyOf(hand)` of the decision. */
  readonly key: string;
  readonly answers: readonly number[];
  /** "Skip": the quiz ends; the answers given so far still count (A.7 `quiz`). */
  readonly skipped: boolean;
}

export function initialCoach(): CoachSlice {
  return { key: null, status: 'idle', decision: null, explanation: null, opened: null, quiz: null };
}

export interface UiSlice {
  /** Screens and overlays (app/navigation.ts): the one navigation model. Changed by `NavAction`s. */
  nav: Nav;
  /** Derived from `nav`: the screen on show. */
  screen: Screen;
  /** Derived from `nav`: the open overlays, bottom to top. */
  overlays: readonly Overlay[];
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
  /**
   * The seat whose bot card is open (§9.3): set by the `botCard` command, which also opens the
   * `botCard` overlay, and null whenever that overlay is not open.
   */
  botCardSeat: number | null;
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

/**
 * Commands the store applies itself (UI state only): the navigation actions of app/navigation.ts
 * (`go`, `replace`, `back`, `open`, `close`; Android Back arrives as `back` from app/lifecycle.ts),
 * and gates, layout, toasts, the storage banner.
 */
export type UiCommand =
  | NavAction
  /** Close (or reopen) a gate explicitly, e.g. while a first-table tip is shown. */
  | { type: 'gate'; gate: Gate; closed: boolean; owner?: string }
  | { type: 'layout'; layout: Layout }
  | { type: 'dismissToast'; id: number }
  /** [OK] on the storage banner. */
  | { type: 'dismissStorageBanner' }
  /**
   * A tap on a bot's seat (§9.3): opens the `botCard` overlay for `seat` (1..8). It closes the
   * `sheet` gate, so no bot acts while the card is open; close it with `close` (Esc, ✕, Back).
   */
  | { type: 'botCard'; seat: number };

/** Commands the TableController handles. */
export type GameCommand =
  /** Welcome / Home Play (§12.1): continue the table, else start one with the last-used settings. */
  | { type: 'play' }
  /**
   * Setup's Start game (§12.2): a new table from the settings (`setup` patches them first; they
   * become the last-used values). With a hand unfinished the controller first asks the §3.1
   * question (the 'newTable' dialog) and keeps `setup`; the dialog's Yes sends `confirmed: true`:
   * the hand is folded, finished without animation, and the new table starts.
   */
  | { type: 'newTable'; setup?: Partial<TableSetup>; confirmed?: boolean }
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
  | { type: 'pagehide' }
  /** "Coach is not available. Tap to try again." (§12.11): ask the coach again. */
  | { type: 'retryCoach' }
  /**
   * Undo (§11.3): the toolbar Undo, the feedback card's [Undo: try again], the U key. The
   * controller ignores it unless Undo is possible (`game.canUndo`).
   */
  | { type: 'undo' }
  /** The feedback card's [Keep my move] (also Esc and Back): the hand goes on (§11.1). */
  | { type: 'keepMove' };

/**
 * Commands the store applies to the `coach` slice itself: the player opened the hint of the
 * hero's decision ("Hint", §10.2; the coach sheet), answered the Advanced quiz's question or
 * skipped the quiz (§10.3). Nothing happens when it is not the hero's turn, or there is no quiz.
 */
export type CoachCommand =
  | { type: 'showHint' }
  /** The answer to the quiz's next question: an index into its choices. */
  | { type: 'quizAnswer'; choice: number }
  | { type: 'quizSkip' };

export type Command = UiCommand | GameCommand | CoachCommand | ReviewCommand;

const UI_COMMANDS: ReadonlySet<string> = new Set([
  'go',
  'replace',
  'back',
  'open',
  'close',
  'gate',
  'layout',
  'dismissToast',
  'dismissStorageBanner',
  'botCard',
]);

export const isUiCommand = (cmd: Command): cmd is UiCommand => UI_COMMANDS.has(cmd.type);

export const isCoachCommand = (cmd: Command): cmd is CoachCommand =>
  cmd.type === 'showHint' || cmd.type === 'quizAnswer' || cmd.type === 'quizSkip';

/**
 * `showHint`: marks the hero's current decision as opened. `quizAnswer`, `quizSkip`: the quiz of
 * the hero's current decision, while it asks (Advanced, the hint ready, not finished or skipped).
 * Returns `coach` itself when nothing changes.
 */
export function reduceCoach(
  s: Pick<AppState, 'game' | 'coach' | 'settings'>,
  cmd: CoachCommand,
): CoachSlice {
  const key = heroDecisionKey(s.game.mode, s.game.hand, s.game.legal);
  if (key === null) return s.coach;
  if (cmd.type === 'showHint') {
    return s.coach.opened === key ? s.coach : { ...s.coach, opened: key };
  }
  const { coach } = s;
  const quiz = coach.quiz;
  if (
    levelInForce(s) !== 'advanced' ||
    quiz === null ||
    quiz.key !== key ||
    quiz.skipped ||
    coach.key !== key ||
    coach.status !== 'ready' ||
    coach.decision === null
  ) {
    return coach;
  }
  const questions = quizQuestions(coach.decision);
  const q = questions[quiz.answers.length];
  if (q === undefined) return coach; // finished: the result shows until the hero acts
  if (cmd.type === 'quizSkip') return { ...coach, quiz: { ...quiz, skipped: true } };
  const { choice } = cmd;
  if (!Number.isSafeInteger(choice) || choice < 0 || choice >= choiceCount(q)) return coach;
  return { ...coach, quiz: { ...quiz, answers: [...quiz.answers, choice] } };
}

// ---------------------------------------------------------------------------------------------
// The store

export interface AppState {
  game: GameSlice;
  equity: EquitySlice;
  coach: CoachSlice;
  ui: UiSlice;
  settings: GameSettings;
  /** The last finished hands, kept in memory for Review (written by the controller; §12.10). */
  review: ReviewSlice;
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
    seatStats: NO_SEAT_STATS,
    diag: { engineErrors: 0, botFallbacks: 0, voidedHands: 0 },
    canUndo: false,
    feedback: null,
    decisions: [],
    coachLevel: null,
  };
}

/** No player seen yet (`GameSlice.seatStats`). */
export const NO_SEAT_STATS: Readonly<Record<string, SeatStats>> = Object.freeze({});

/** The UI state of a launch: Welcome on the first launch, Home after it (§12.1). */
export function initialUi(firstLaunch = true): UiSlice {
  const nav = initialNav(firstLaunch);
  return withGates({
    nav,
    screen: currentScreen(nav),
    overlays: nav.overlays,
    hidden: false,
    holds: [],
    gates: [],
    layout: 'portrait',
    toasts: [],
    storageBanner: false,
    botCardSeat: null,
  });
}

/** A fresh store (tests make their own; the app uses `appStore`). */
export function createAppStore(): AppStore {
  let gameHandler: ((cmd: GameCommand) => void) | null = null;
  const api = createStore<AppState>()((set) => ({
    game: initialGame(),
    equity: initialEquity(),
    coach: initialCoach(),
    ui: initialUi(),
    settings: defaultGameSettings(),
    review: initialReview(),
    dispatch: (cmd) => {
      if (cmd.type === 'review') {
        set((s) => showReview(s, cmd));
      } else if (isUiCommand(cmd)) {
        set((s) => {
          const ui = reduceUi(s.ui, cmd);
          return ui === s.ui ? s : { ui };
        });
      } else if (isCoachCommand(cmd)) {
        set((s) => {
          const coach = reduceCoach(s, cmd);
          return coach === s.coach ? s : { coach };
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

/** `review` command: the Review screen on a hand (or the list), over whatever screen is on show. */
function showReview(s: AppState, cmd: ReviewCommand): Partial<AppState> | AppState {
  const review = selectHandSeq(s.review, cmd.handSeq);
  const ui = reduceUi(s.ui, { type: 'go', screen: 'review' });
  return review === s.review && ui === s.ui ? s : { review, ui };
}

// ---------------------------------------------------------------------------------------------
// The UI reducer (pure)

/** Applies a UI command; returns `ui` itself when nothing changes. */
export function reduceUi(ui: UiSlice, cmd: UiCommand): UiSlice {
  switch (cmd.type) {
    case 'go':
    case 'replace':
    case 'back':
    case 'open':
    case 'close': {
      const nav = navigate(ui.nav, cmd);
      if (nav === ui.nav) return ui;
      return withGates({
        ...ui,
        nav,
        screen: currentScreen(nav),
        overlays: nav.overlays,
        // Whatever closes the card (✕, Esc, Back, a new screen) also forgets its seat.
        botCardSeat: nav.overlays.includes('botCard') ? ui.botCardSeat : null,
      });
    }
    case 'botCard': {
      // The hero (seat 0) is drawn by the hero strip and has no card.
      if (!Number.isSafeInteger(cmd.seat) || cmd.seat < 1) return ui;
      const nav = navigate(ui.nav, { type: 'open', overlay: 'botCard' });
      if (nav === ui.nav && ui.botCardSeat === cmd.seat) return ui;
      return withGates({
        ...ui,
        nav,
        screen: currentScreen(nav),
        overlays: nav.overlays,
        botCardSeat: cmd.seat,
      });
    }
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
    (next: boolean) => dispatchCmd({ type: next ? 'open' : 'close', overlay }),
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
export const selectCanUndo = (s: AppState): boolean => s.game.canUndo;
export const selectFeedback = (s: AppState): FeedbackView | null => s.game.feedback;
export const selectDecisions = (s: AppState): readonly DecisionRecord[] => s.game.decisions;
/**
 * The toolbar Undo (§10.2, §12.3): 'hidden' unless the coach level in force shows it (Beginner and
 * Intermediate), then 'enabled' when Undo is possible, else 'disabled' (shown, not hidden). The
 * level is the latest decision's (§10), the one Undo would take back.
 */
export const selectUndoButton = (s: AppState): 'hidden' | 'disabled' | 'enabled' =>
  UNDO_POLICY[levelInForce(s)].undo !== 'toolbar'
    ? 'hidden'
    : s.game.canUndo
      ? 'enabled'
      : 'disabled';
/** The navigation state for `ScreenSwitcher` (ui/screens). */
export const selectNav = (s: AppState): Nav => s.ui.nav;
export const selectScreen = (s: AppState): Screen => s.ui.screen;
export const selectOverlays = (s: AppState): readonly Overlay[] => s.ui.overlays;
export const selectTopOverlay = (s: AppState): Overlay | null =>
  s.ui.overlays[s.ui.overlays.length - 1] ?? null;
export const selectGates = (s: AppState): Gate[] => s.ui.gates;
export const selectLayout = (s: AppState): Layout => s.ui.layout;
export const selectToasts = (s: AppState): Toast[] => s.ui.toasts;
export const selectSettings = (s: AppState): GameSettings => s.settings;
/** The whole equity slice (the win badge, §7.6; select narrower fields where you can). */
export const selectEquity = (s: AppState): EquitySlice => s.equity;
export const selectEquityStatus = (s: AppState): EquityStatus => s.equity.status;
export const selectEquityResult = (s: AppState): EquityResult | null => s.equity.result;
/** The hand analysis (§6): draw chips, out cards, the "By river" column. */
export const selectHandAnalysis = (s: AppState): HandAnalysis | null => s.equity.analysis;
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

// ---------------------------------------------------------------------------------------------
// Review (§12.10)

let listedHands: readonly ReviewHand[] | null = null;
let listed: readonly ReviewListItem[] = [];

/** The list of recent hands, newest first: rows without records (a new array only when a hand is added). */
export const selectReviewList = (s: AppState): readonly ReviewListItem[] => {
  if (s.review.hands !== listedHands) {
    listedHands = s.review.hands;
    listed = s.review.hands.map(listItemOf);
  }
  return listed;
};

/** How many finished hands Review has. */
export const selectReviewCount = (s: AppState): number => s.review.hands.length;

/** The hand the Review screen shows, or null for the list. ⚠️ Holds the seed: for view builders only. */
export const selectReviewHand = (s: AppState): ReviewHand | null => {
  const { hands, selected } = s.review;
  return selected === null ? null : (hands.find((h) => h.handSeq === selected) ?? null);
};
