/**
 * The TableController (PLAN §2.3, Appendix A.8): it deals every hand, asks the bots, applies every
 * engine input, pauses before new cards, ends the hand and starts the next one. It is the only
 * code that uses timers (§0.3 "Time"), and the only writer of the store's `game` slice.
 *
 * One hand (§2.3):
 * - `startHand` → 'betting'. A bot's turn: `observe(state, seat)` → `brain.worker`'s `botDecision`
 *   (only an Observation crosses, §4.8) → wait `max(think time, compute time)` (§9.8) → `step`.
 *   The hero's turn: mode 'heroTurn' and `game.legal`; the hero's tap arrives as `act`.
 * - 'roundComplete' / 'showdown': an animation pause (mode 'advancing'), then `step(advance)`.
 *   New cards appear only through `advance` (pitfall 23).
 * - 'complete': `nextTable` (bots replaced), the result banner (mode 'handEnd'), the next-hand
 *   pause (or a tap), then the next hand. A hero with no chips gets the out-of-chips dialog (§3.1).
 *
 * Gates (A.8): bots, think timers and `advance` wait while ANY gate is closed (`ui.gates`). The one
 * flow timer (a bot's think time, an advance pause or the next-hand pause) pauses when a gate
 * closes and runs on with its remaining time when every gate is open again; no bot request is
 * sent while a gate is closed.
 *
 * Epoch (pitfall 22): a new hand, a voided hand and a new table raise the epoch. Every timer and
 * every brain reply carries the epoch (and its token or job id) it was made for and is dropped when
 * they no longer match, so a stale timer or reply can never act on a newer hand.
 *
 * Errors (§4.5): an input the engine refuses (`EngineError`) is logged and ignored; for a bot the
 * safest legal action (check, else fold) is taken instead. Anything else (a broken invariant) voids
 * the hand: every seat gets its hand-start stack back and the next hand starts.
 *
 * The brain worker (§12.14): a bot decision that gets no reply in 2 s, a worker that crashes with
 * the decision pending, or a worker that has failed for good (`brain.status === 'failed'`) all give
 * the bot the safest legal action, so the hand always finishes. The client (`app/workerClient.ts`)
 * owns the timeout and the restart.
 *
 * Grading, feedback and Undo (§11, chunk 6.2; the pure parts are `app/undo.ts`, the grade port
 * `app/grading.ts`):
 * - At every hero decision point the controller keeps an undo snapshot (state, meta, input count;
 *   saved in the session, §11.3 r1).
 * - After a hero act the hand is held in mode 'grading' (no bot request, no `advance`, no new card)
 *   until the grade arrives, at most 1,500 ms. A grade at or above the level's threshold opens the
 *   feedback card (mode 'feedback', the `feedback` gate closed) until Undo or Keep my move. A later
 *   grade is recorded without a pause. An error or a timeout (5 s) is retried once; a second
 *   failure records `grade: null` (r5). Without a grader (tests) every decision is recorded at once
 *   with `grade: null` and nothing waits.
 * - Undo (r3): a new epoch (every timer and job of before is stale), the snapshot's state with the
 *   undealt stub reshuffled, the inputs cut back to it plus the `reshuffle` input, the undone record
 *   kept with `undone: true`, the hand marked practice (`undoCount`). Bots' cards and the board
 *   never change (r4).
 *
 * Coach levels (§10, §10.2, chunk 6.4; the rules are `app/levels.ts`):
 * - The level of a hero decision is fixed when the decision starts (`game.coachLevel`): a level
 *   chosen in Settings meanwhile applies from the next decision. A Beginner decision has its hint
 *   on show, so it counts as helped (`meta.hintShown`, kept in the session).
 * - Advanced: the hint job of a decision that rolls the quiz (`app/quiz.ts`) starts it; its score
 *   goes into the decision's record when the hero acts.
 * - At the hand end the controller offers the hand summary (`game.summary`: the banner's "Hand
 *   summary", Exam's "Exam result") when the level of the hand's latest decision shows one; a late
 *   grade can still bring the offer during the hand end. It never opens the sheet (1.3.92): the
 *   player's tap opens the `summary` overlay, which closes the `sheet` gate, so the next hand
 *   waits for its "Next hand ›" (§12.8).
 *
 * The provable shuffle (§16.3, chunk 9.4, `app/shuffleCode.ts`): with a hash function (the app's
 * `crypto.subtle`; none on a plain-http page) every hand's seed is drawn and committed to (its
 * shuffle code) before the hand is dealt: the next hand's at this table as soon as a hand is dealt,
 * and the first hand's of the next new table, whose table seed is drawn ahead too. The deal never
 * waits for the digest. The code goes into the session, the replay record and the hand record;
 * never to a worker.
 *
 * One writer at a time (§14.7, chunk 8.3): with a tab lock (`app/tabLock.ts`) the controller boots
 * `pending` and only reads until the lock answers; granted, it reads the storage again and writes;
 * denied or taken, it is read-only: it writes nothing, its game stops and Home shows the §12.11
 * banner. A `rev` conflict (§14.3 step 2) does the same. The Data commands (§14.8: Export, Import,
 * Reset) run in their lazy chunk (`app/dataTools.ts`) through `dataHost()`.
 *
 * Install hints and level suggestions (§12.13, §10.4, chunk 8.4): the controller works out the
 * one-time install card of Home (`data.nudge`), keeps the browser's install offer (`data.install`)
 * and the level suggestion card (`data.suggestion`, `app/suggestions.ts`), and writes their
 * answers in the profile's flags.
 *
 * New versions (§15.1, chunk 9.5; the service worker is `app/swUpdate.ts`): a new version never
 * reloads the page mid-hand. It goes in before the next hand is dealt (the session is saved with
 * `resumeAfterUpdate`, so the new version goes straight back to the Table and deals that hand), or
 * at once when no hand is unfinished and Welcome or Home shows with nothing open. While a hand is
 * in play the toast "Update ready. It installs after this hand." says so. Only the tab with the
 * game lets a waiting version in, and never when the browser storage failed (a reload would lose
 * the game kept in memory). The controller asks the server for a new version when the page comes
 * back to the front and every hour.
 */
import { EngineError } from '../core/assert.ts';
import { deriveSeed, randomSeed, type Seed128 } from '../core/rng.ts';
import { legalActions } from '../engine/legal.ts';
import { observe } from '../engine/observe.ts';
import { startHand } from '../engine/start.ts';
import { step } from '../engine/step.ts';
import {
  createTable,
  initialSlots,
  nextTable,
  tableIdOf,
  topUp,
  withLevels,
} from '../engine/table.ts';
import {
  ENGINE_VERSION,
  type BotLevel,
  type CoachLevel,
  type EngineInput,
  type HandState,
  type LegalActions,
  type ObserveExtras,
  type PlayerAction,
  type ReplayRecord,
  type SeatStats,
  type TableConfig,
  type TableState,
} from '../engine/types.ts';
import type { HandCategory } from '../eval/evaluate.ts';
import { commitHand } from '../persist/commit.ts';
import { appendDiag } from '../persist/diag.ts';
import { loadHands } from '../persist/hands.ts';
import { PERSIST_KIT } from '../persist/kit.ts';
import { loadProfile, saveProfile, saveSettings } from '../persist/profile.ts';
import { emptyHandMeta, isBotLevel, settingsProblem } from '../persist/schema.ts';
import type {
  DecisionRecord,
  HandMeta,
  Profile,
  ProfileFlags,
  SessionState,
  SessionSummary,
  Settings,
  UndoSnapshot,
} from '../persist/schema.ts';
import { clearSession, loadSession, saveSession } from '../persist/session.ts';
import { endSession, SESSION_IDLE_MS } from '../persist/stats.ts';
import { STORAGE_KEYS, type SafeStorage } from '../persist/storage.ts';
import { updateSeatStats } from '../brain/opponentStats.ts';
import { profileFor } from '../brain/profiles.ts';
import type { BrainProfile, GradeResult } from '../brain/types.ts';
import type { BrainReply, BrainRequest } from '../workers/protocol.ts';
import { levelsOf, nextLevels, sameSeatLevels } from './botLevels.ts';
import { EquityJobs } from './equityJobs.ts';
import { countHand, handRecordOf } from './handRecord.ts';
import { readHistory, readReviewHand } from './history.ts';
import { coachKeyOf, finalHudEquity, HintJobs, type HintAsk } from './hintJobs.ts';
import { LEVEL_RULES, summaryShows } from './levels.ts';
import { quizRolls, quizScore } from './quiz.ts';
import {
  GRADE_ATTEMPTS,
  GRADE_PAUSE_MS,
  type GradeAsk,
  type Grader,
  type GradeOutcome,
} from './grading.ts';
import { addHand, addStoredHand, initialReview, type ReviewHand } from './review.ts';
import { startShuffleCode, type Sha256, type ShuffleCode } from './shuffleCode.ts';
import { handEndViewOf, labelVisible, seatLevelOf } from './tableViews.ts';
import type { DataCommand, DataCommands, DataHost, ShareEnv } from './dataTools.ts';
import { updateMayReload, type InstallEnv } from './lifecycle.ts';
import type { Suggestion, SuggestionTools } from './suggestions.ts';
import type { UpdateEvent, UpdatePort } from './swUpdate.ts';
import type { TabLock, TabLockEvent } from './tabLock.ts';
import {
  initialCoach,
  NO_SEAT_STATS,
  updateUi,
  type AppStore,
  type CoachSlice,
  type ControllerMode,
  type Diagnostics,
  type GameCommand,
  type ImportCheck,
  type Nudge,
  type Screen,
  type Speed,
  type SummaryOffer,
  type TabMode,
  type TipId,
  type Toast,
  type UiCommand,
  type UiSlice,
} from './store.ts';
import {
  decisionRecord,
  feedbackView,
  heroDecisionsTaken,
  hudEquityAt,
  isAssisted,
  isHeroTurn,
  pausesAt,
  priceNeed,
  restoreForUndo,
  snapshotAt,
  standingRecord,
  undoBlock,
  withRecord,
  type DecisionFacts,
  type FeedbackView,
  type Restored,
  type UndoBlock,
} from './undo.ts';
import {
  BOT_TIMEOUT_MS,
  type BrainClient,
  type EquityClient,
  type JobEvent,
  type WorkerLogEntry,
} from './workerClient.ts';

export type { ControllerMode, Gate } from './store.ts';

/** The hero's seat (§0.3). */
export const HERO = 0;

/** The controller's timings at Normal speed, in ms (§9.8, §12.8, §12.13, Appendix A.6). */
export const TIMING = {
  /** Deal one card: 180 ms with a 60 ms stagger (§12.8). The first bot waits until the cards land. */
  dealCardMs: 180,
  dealStaggerMs: 60,
  /** Chips to the pot at street end, 300 ms, then a 400 ms pause (§12.8): before every `advance`. */
  chipsToPotMs: 300,
  streetPauseMs: 400,
  /** Showdown reveal: 500 ms per shown hand (§12.8), added once, right after the reveal. */
  revealPerHandMs: 500,
  /**
   * Next hand on a tap, or after 3 s with "Deal the next hand by itself" on (§12.8; off by
   * default since 1.3.94); that wait never under 1 s, so the result can be read.
   */
  nextHandMs: 3000,
  nextHandMinMs: 1000,
  /** Bots at Instant speed take 80 ms, enough for the announcement (§9.8). */
  instantBotMs: 80,
  /** Play resumes 300 ms after the page is visible again (§12.13). */
  resumeAfterVisibleMs: 300,
  /** A bot decision that takes longer gets the safest legal action (Appendix A.6). */
  botTimeoutMs: BOT_TIMEOUT_MS,
  /**
   * The same for decisions until the brain worker has answered once: it may still be starting
   * (§12.14: "max 3 s" until `brain.worker` is ready).
   */
  botFirstTimeoutMs: 3000,
  /** How long a toast stays (§12.11). */
  toastMs: 4000,
  /** Settings changes are saved 250 ms after the last one (§14.2), and at once when hidden. */
  settingsDebounceMs: 250,
  /** After a hero act the hand waits this long for the grade (§11.3 r5, `app/grading.ts`). */
  gradePauseMs: GRADE_PAUSE_MS,
  /** §15.1: ask the server for a new version every hour while the page is in front… */
  updateCheckMs: 3_600_000,
  /** …and when it comes back to the front, but not twice within a minute. */
  updateCheckMinMs: 60_000,
  /**
   * After letting a new version in, the page reloads when it has taken over (within milliseconds),
   * and at the latest after this long.
   */
  updateReloadMs: 5000,
} as const;

/** Pause and animation factor per speed (§12.8: Normal 1, Fast 0.5, Instant 0). */
export const SPEED_FACTOR: Readonly<Record<Speed, number>> = { normal: 1, fast: 0.5, instant: 0 };

/** Where table and hand seeds come from (§2.4). The `?seed=` test hook fixes them. */
export interface SeedSource {
  /** The table seed of the next new table. */
  tableSeed(): Seed128;
  /** The hand seed of the hand with this `handSeq`. */
  handSeed(handSeq: number): Seed128;
}

/** Production seeds: a fresh `crypto.getRandomValues` seed for every table and every hand (§2.4). */
export function randomSeeds(): SeedSource {
  return { tableSeed: () => randomSeed(), handSeed: () => randomSeed() };
}

/**
 * §2.4: the seed of one bot decision, `deriveSeed(deriveSeed(tableSeed, 'bots'), 'bot', handSeq,
 * seat, log.length)`. It comes from the table seed only, never from the hand seed (the deck), so
 * nothing that reaches the brain carries deck information (§9.6 3b).
 */
export function botSeed(
  tableSeed: Seed128,
  handSeq: number,
  seat: number,
  logLength: number,
): Seed128 {
  return deriveSeed(deriveSeed(tableSeed, 'bots'), 'bot', handSeq, seat, logLength);
}

/** §4.5: the safest legal action, check if legal, else fold. */
export function safestAction(legal: LegalActions): PlayerAction {
  return legal.canCheck ? { type: 'check' } : { type: 'fold' };
}

/** The hero's `playerId` (Appendix A.3 `PlayerSlot`): the key of the hero model in `seatStats`. */
export const HERO_ID = 'hero';

/**
 * Only the hero's entry of `stats` (a new table: no bot seen yet), or `heroModel` instead when it
 * holds at least one hand (the profile's, §9.5).
 */
export function heroOnly(
  stats: Readonly<Record<string, SeatStats>>,
  heroModel?: SeatStats,
): Readonly<Record<string, SeatStats>> {
  const hero = heroModel !== undefined && heroModel.hands > 0 ? heroModel : stats[HERO_ID];
  return hero === undefined ? NO_SEAT_STATS : { [HERO_ID]: hero };
}

/**
 * `stats` after the finished hand `h` (§9.5, `updateSeatStats`): every seat dealt in gets the
 * hand added under its `playerId` in `table` (the table it was dealt from).
 */
export function withHandStats(
  stats: Readonly<Record<string, SeatStats>>,
  table: TableState,
  h: HandState,
): Readonly<Record<string, SeatStats>> {
  const next: Record<string, SeatStats> = { ...stats };
  h.seats.forEach((seat, i) => {
    const id = table.slots[i]?.playerId;
    if (!seat.dealtIn || id === undefined) return;
    next[id] = updateSeatStats(stats[id] ?? null, h.log, i);
  });
  return next;
}

/** The entries of `stats` for the players seated at `table` (the others have left it). */
export function seatedStats(
  stats: Readonly<Record<string, SeatStats>>,
  table: TableState,
): Readonly<Record<string, SeatStats>> {
  const out: Record<string, SeatStats> = {};
  let all = true;
  for (const id of Object.keys(stats)) {
    if (table.slots.some((slot) => slot.playerId === id)) out[id] = stats[id] as SeatStats;
    else all = false;
  }
  return all ? stats : out;
}

/** The observation's per-seat statistics (A.4 `ObserveExtras.seatStats`): null for a player not seen yet. */
export function statsBySeat(
  stats: Readonly<Record<string, SeatStats>>,
  table: TableState,
): (SeatStats | null)[] {
  return table.slots.map((slot) => stats[slot.playerId] ?? null);
}

/** What the log calls a brain job that gave no decision (§12.14). */
function failureOf(event: JobEvent<BrainReply>): string {
  switch (event.type) {
    case 'timeout':
      return 'bot timeout';
    case 'failed':
      return 'brain worker failed';
    default:
      return 'brain error';
  }
}

/** The reason text of a failed brain job, for the log. */
function messageOf(event: JobEvent<BrainReply>): { message?: string } {
  if (event.type === 'failed') return { message: event.reason };
  if (event.type === 'reply' && event.reply.kind === 'error') {
    return { message: event.reply.message };
  }
  return {};
}

/** The clock and timers the controller uses (tests use Vitest's fake timers through the defaults). */
export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

/** The real clock and timers (the only timer calls on the main thread, §0.3; boot gives them to the worker clients too). */
export const realTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

export interface ControllerOptions {
  store: AppStore;
  /** `brain.worker`'s client (chunk 5.8): every bot decision goes through it. */
  brain: BrainClient;
  /** The hero's name, from `en.ts` (the hero is always "You", Appendix F.10). */
  heroName: string;
  seeds?: SeedSource;
  timers?: Timers;
  /** The reducer (tests only: a failing one exercises the void path). */
  step?: typeof step;
  /**
   * The browser storage (chunk 3.2, `createSafeStorage()`): the profile's settings and the session
   * are loaded at boot and saved as the game goes. Without it (tests) nothing is loaded or saved.
   */
  storage?: SafeStorage;
  /** The wall clock for stored timestamps (default: now). */
  now?: () => Date;
  /**
   * `equity.worker`'s client (chunk 4.5): the HUD win chance and the hand analysis go to the
   * store's `equity` slice. Without it (tests) the slice stays 'off'.
   */
  equity?: EquityClient;
  /**
   * Ask `brain` for the coach's hint at every hero decision (chunk 5.7, `app/hintJobs.ts`): it
   * goes to the store's `coach` slice. The app turns it on; tests without a coach leave it off.
   */
  hints?: boolean;
  /**
   * Offer the end-of-hand summary on the hand-end banner when the coach level shows one (§10.2,
   * §12.9; chunk 6.4, on demand since 1.3.92): `game.summary`. The sheet opens only on the
   * player's tap; while it is open the `sheet` gate keeps the next hand waiting for its "Next
   * hand ›". The app turns it on; tests of other features leave it off (no offer).
   */
  summaries?: boolean;
  /**
   * The first-table tips (§12.11, chunk 9.3): the Table shows each once, and its closing marks it
   * seen in `profile.flags.tips` (in memory without storage). The app turns them on; tests of
   * other features leave them off (a tip closes the `tip` gate until a tap: their hands would
   * wait).
   */
  tips?: boolean;
  /**
   * The grade port (§11.3 r5, chunk 6.2, `app/grading.ts`): every hero decision is graded through
   * it (the app: `brainGrader(brain)`). Without it (tests) every decision is recorded at once with
   * `grade: null`, like a grade that failed: nothing waits or pauses, and Undo is there at once.
   */
  grader?: Grader | null;
  /**
   * One writer at a time (§14.7, chunk 8.3, `app/tabLock.ts`): the app passes the page's lock.
   * Without it (tests) this tab writes from the start; a `rev` conflict still makes it read-only.
   */
  tabLock?: TabLock | null;
  /** Where Export sends the file (§14.8): the page (`globalThis`); tests pass a fake. */
  shareEnv?: ShareEnv;
  /**
   * `navigator.storage` where `persist()` exists (secure pages, §12.14), else null (§14.8: then
   * nothing is asked and Settings says "No").
   */
  storageManager?: StorageManagerLike | null;
  /** Launched from the Home Screen (§12.13 "Installed"): `persist()` is asked at once (§14.8). */
  standalone?: boolean;
  /**
   * Installing (§12.13, chunk 8.4): the browser's install offer and whether this is iOS (the Share
   * tip). Without it (tests) there is no Install tile and no install card.
   */
  install?: InstallEnv | null;
  /**
   * The provable shuffle's hash (§16.3, chunk 9.4): the app passes `pageSha256()`, null where
   * `crypto.subtle` is missing (plain http, §12.14). Without it (tests) the seeds are drawn at the
   * deal as before and every hand's `commit` is null.
   */
  sha256?: Sha256 | null;
  /**
   * The service worker (§15.1, chunk 9.5, `app/swUpdate.ts`): new versions and offline-ready.
   * Null or missing: no service worker (an insecure page, §12.14; tests): nothing happens.
   */
  updates?: UpdatePort | null;
  /**
   * §12.11 "Ready to play offline." when the first service worker is installed (chunk 9.5).
   * Default on. The E2E build turns it off unless a spec asks for it (`app/testHooks.ts`): every
   * spec starts in a fresh browser profile, so the toast would show over the top of the screen at
   * a moment no spec controls (and stay there on a paused clock).
   */
  offlineToast?: boolean;
  /**
   * The system asks for reduced motion (`prefers-reduced-motion: reduce`, §12.8): then the
   * default speed is Fast, so a profile not written yet (the first launch, §12.1) starts at Fast.
   */
  reducedMotion?: boolean;
}

/** The parts of `navigator.storage` used to keep the data (§14.8). */
export interface StorageManagerLike {
  persisted(): Promise<boolean>;
  persist(): Promise<boolean>;
}

/**
 * Screens that offer Export or Import (§14.8): opening one loads the Data commands' chunk, so the
 * share sheet opens inside the Export tap. Settings' Data section and Stats → History's footer
 * (chunk 8.4).
 */
export const DATA_SCREENS: readonly Screen[] = ['settings', 'stats'];

/** One line of the controller's in-memory log (Diagnostics; `window.__pc.logs()` in test builds). */
export interface ControllerEvent {
  at: number;
  epoch: number;
  what: string;
  detail?: unknown;
}

export interface ControllerLogs {
  /** What the controller did: hand starts, inputs, drops of stale timers (last 500). */
  events: ControllerEvent[];
  /** Refused inputs, bot fallbacks and voided hands (last 50). */
  errors: ControllerEvent[];
  /** Brain requests, replies, drops and cancels, as the controller saw them (last 200). */
  brain: ControllerEvent[];
  /** Replay records of the last 5 voided hands (§4.5; also stored under `pc.v1.diag`, 8.1). */
  voided: ReplayRecord[];
  /** equity.worker's message log: requests, replies, drops, cancels, timeouts (last 200). */
  equity: WorkerLogEntry[];
  /** brain.worker's message log, the same kind of lines (last 200). */
  brainWorker: WorkerLogEntry[];
}

/** What the controller holds, for tests and (chunk 3.2) the session. Arrays are copies. */
export interface ControllerSnapshot {
  epoch: number;
  mode: ControllerMode;
  table: TableState | null;
  hand: HandState | null;
  next: TableState | null;
  inputs: EngineInput[];
  /** This hand's decision records, undo count and hints (A.7 `HandMeta`). */
  meta: HandMeta;
  /** The latest hero decision point (§11.3 r1), or null. */
  undoSnapshot: UndoSnapshot | null;
  /** §11.4: the hand had an undo, so it counts as practice. */
  assisted: boolean;
  /**
   * This tab writes the storage (§14.7): false while it waits for the lock, and once another tab
   * has the game (its lock, or another writer's `rev`, §14.3 step 2).
   */
  writer: boolean;
}

type FlowKind = 'act' | 'advance' | 'nextHand';

/** A hero decision whose grade is on its way (§11.3 r5). */
interface PendingGrade {
  epoch: number;
  ask: GradeAsk;
  facts: DecisionFacts;
  /** The coach level the decision was made at (§10: a change applies from the next decision). */
  level: CoachLevel;
  /** The state at the decision point, before the act (the feedback card's legal moves). */
  decision: HandState;
  /** Tries so far (the first, then one retry). */
  attempt: number;
  /** The running job, or null. */
  jobId: number | null;
  /** The 1,500 ms pause timer while the hand waits for this grade, else null. */
  pause: unknown;
}

/** The one pausable timer of the hand flow. */
interface FlowTimer {
  kind: FlowKind;
  token: number;
  epoch: number;
  /** Ms left to wait (up to date while paused). */
  remaining: number;
  /** When it last started running; null while paused. */
  startedAt: number | null;
  handle: unknown;
  run: () => void;
}

/** The one bot decision in flight. */
interface BotJob {
  jobId: number;
  epoch: number;
  seat: number;
  sentAt: number;
}

/** The bot decision a headless finish (§3.1) is waiting for. */
interface HeadlessJob {
  jobId: number;
  /** The epoch changed: let the waiting loop go on (it sees the new epoch and stops). */
  release(): void;
}

type NewToast =
  | { kind: 'botsJoined'; names: string[] }
  | { kind: 'handVoided' }
  | { kind: 'handNotRestored' }
  | { kind: 'dataRecovered' }
  | { kind: 'dataRestored' }
  | { kind: 'undone' }
  | { kind: 'exportCopied' | 'exportFailed' | 'imported' | 'statsReset' | 'dataNotChanged' }
  | { kind: 'session'; session: SessionSummary }
  | { kind: 'debugCopied' }
  | { kind: 'updateReady' | 'offlineReady' }
  | { kind: 'collection'; category: HandCategory };

/**
 * A new version of the game (§15.1): none found; one waits (`ready`); this tab let it in and
 * waits for it to take over (`applying`); it controls the page (`activated`), which reloads at the
 * next safe moment.
 */
type UpdateState = 'none' | 'ready' | 'applying' | 'activated';

const RING = { events: 500, errors: 50, brain: 200, voided: 5 } as const;

function push<T>(ring: T[], item: T, max: number): void {
  ring.push(item);
  if (ring.length > max) ring.splice(0, ring.length - max);
}

/**
 * `current` with `patch` applied, or `current` itself when the result would not be valid
 * settings (`settingsProblem`, A.7): only known fields, and `seatLevels` resized to one entry per
 * seat with the hero's null (the stored settings need `seatLevels.length === players`). `schema`
 * and `defaultsRev` (H.2 rule 6) are the app's, never a patch's.
 */
export function sanitize(current: Settings, patch: Partial<Settings>): Settings {
  const next: Settings = { ...current, seatLevels: [...current.seatLevels] };
  const target = next as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (!Object.hasOwn(current, key) || key === 'schema' || key === 'defaultsRev') continue;
    target[key] = Array.isArray(value) ? [...(value as unknown[])] : value;
  }
  const levels = next.seatLevels;
  if (Number.isSafeInteger(next.players) && next.players >= 2 && next.players <= 9) {
    next.seatLevels = Array.from({ length: next.players }, (_, i) =>
      i === HERO ? null : (levels[i] ?? null),
    );
  }
  return settingsProblem(next) === null ? next : current;
}

export class TableController {
  private readonly store: AppStore;
  private readonly brain: BrainClient;
  private readonly heroName: string;
  private readonly seeds: SeedSource;
  private readonly timers: Timers;
  private readonly stepFn: typeof step;
  private readonly unsubscribe: () => void;
  private readonly storage: SafeStorage | null;
  private readonly now: () => Date;
  private readonly equityClient: EquityClient | null;
  /** The win chance and hand-analysis jobs (§7.4); they write only the `equity` slice. */
  private readonly equityJobs: EquityJobs | null;
  /** The coach's hint jobs (§8.2, §12.6); they write only the `coach` slice. */
  private readonly hintJobs: HintJobs | null;
  /** The profile as stored, or as it would be (in memory after a failed write); null without storage. */
  private profile: Profile | null = null;
  /**
   * The finished hand waits to be committed (§14.3): until its last decision's grade is in, or the
   * next hand (or table) starts. Meanwhile the session keeps the complete hand.
   */
  private commitPending = false;
  /**
   * One writer at a time (§14.7): only a `writer` tab writes the storage. `pending` waits for the
   * lock's answer (boot reads only; Play waits in `queued`); `readOnly`: another tab has the game
   * (its lock, or its `rev`, §14.3 step 2), so this tab writes nothing and shows the banner.
   */
  private tab: TabMode;
  private readonly tabLock: TabLock | null;
  /** Play or New table while the lock had not answered: done once it is granted. */
  private queued: GameCommand | null = null;
  private disposed = false;
  /** The Data commands (§14.8), from their lazy chunk once loaded. */
  private data: DataCommands | null = null;
  private dataLoading: Promise<DataCommands | null> | null = null;
  private readonly shareEnv: ShareEnv;
  /** Import's preview in the store (`data.importCheck`), set by the Data commands. */
  private importCheck: ImportCheck | null = null;
  private readonly storageManager: StorageManagerLike | null;
  private readonly standalone: boolean;
  private readonly install: InstallEnv | null;
  /** §10.4: the level suggestions' lazy chunk (`app/suggestions.ts`), once loaded. */
  private suggestionTools: SuggestionTools | null = null;
  private suggestionsLoading = false;
  /** `persist()` was asked this launch (§14.8: at most once). */
  private keepAsked = false;
  /** The service worker (§15.1); null without one. */
  private readonly updates: UpdatePort | null;
  /** `ControllerOptions.offlineToast`. */
  private readonly offlineToast: boolean;
  /** `ControllerOptions.reducedMotion`. */
  private readonly reducedMotion: boolean;
  private update: UpdateState = 'none';
  /** "Update ready. It installs after this hand." was shown (once per launch). */
  private updateToastShown = false;
  /**
   * The reload's only reason is a lazy chunk that could not load (`stale`, §15.1 "Redeploys"): no
   * new version came from the service worker. A failed chunk proves none (a bad deploy, a 404 kept
   * by a cache), so no "Update ready" toast, and no reload while the page is offline.
   */
  private staleOnly = false;
  /** When the app last asked the server for a new version (`timers.now()`). */
  private updateCheckedAt = Number.NEGATIVE_INFINITY;
  private updateCheckTimer: unknown = null;
  /** The reload's safety net after `apply()`. */
  private updateReloadTimer: unknown = null;
  /** The page reloads into a new version: nothing more is dealt. */
  private reloading = false;
  /** The session saved for that reload says `resumeAfterUpdate`: the new version deals at the Table. */
  private updateResumes = false;
  /** The session says the page reloaded for a new version at the Table: Play once this tab writes. */
  private resumeTable = false;
  /** When this table's session began (§14.4); stored in the session. */
  private sessionStart: string | null = null;
  private settingsTimer: unknown = null;
  /** Setup's values while the §3.1 question is open (the 'newTable' dialog). */
  private pendingSetup: Partial<Settings> | null = null;
  private settingsSeq = 0;
  private settingsDirty = false;

  private epoch = 0;
  /** §19.6: a multiplayer table owns the `game` slice (`park`, `unpark`). */
  private parked = false;
  /** This game's coach slice while parked: the hint the player had open comes back with it. */
  private parkedCoach: CoachSlice | null = null;
  private mode: ControllerMode = 'booting';
  /** The table the current hand was dealt from, as at hand start. */
  private table: TableState | null = null;
  private hand: HandState | null = null;
  /** Between hands: the table the next hand is dealt from. Null while a hand is played. */
  private next: TableState | null = null;
  /** The current hand's inputs (the replay log, §4.7). */
  private inputs: EngineInput[] = [];
  private flow: FlowTimer | null = null;
  private job: BotJob | null = null;
  private headlessJob: HeadlessJob | null = null;
  /** `brain.worker` has answered at least once, so it is running (the first decision waits 3 s). */
  private brainWarm = false;
  private timerSeq = 0;
  private toastSeq = 0;
  private newTableSeq = 0;
  /** The first bot does not act before the hole cards have landed. */
  private dealUntil = 0;
  /** The reveal pause of this hand has been given. */
  private revealShown = false;
  /** A hand is being finished without animation (§3.1 new table mid-hand). */
  private headless = false;
  /** handSeq is global (§14.3): the next hand's handSeq is at least this. */
  private handSeqFloor = 1;
  /** Bots that sat down at the last `nextTable`; their toast shows when the next hand starts. */
  private newcomers: string[] = [];
  /**
   * §9.5 seat statistics by `playerId`, updated at hand end only, so every observation of a hand
   * sees the same numbers. The hero's ('hero') is the hero model: it stays across tables and is
   * the profile's `heroModel`, which every commit updates (§14.3); a bot's starts when it sits
   * down (a replaced bot's new `playerId` has none) and goes with its table.
   */
  private seatStats: Readonly<Record<string, SeatStats>> = NO_SEAT_STATS;
  private visibleTimer: unknown = null;
  private visibleSeq = 0;
  private readonly toastTimers = new Map<number, unknown>();
  private legalCache: { hand: HandState; legal: LegalActions | null } | null = null;
  private diag: Diagnostics = { engineErrors: 0, botFallbacks: 0, voidedHands: 0 };
  /** Grades every hero decision (§11.3 r5); null: decisions are recorded ungraded. */
  private readonly grader: Grader | null;
  /** This hand's decision records, undo count and hints (A.7 `HandMeta`; in the session). */
  private meta: HandMeta = emptyHandMeta();
  /** The latest hero decision point (§11.3 r1; in the session). */
  private undoSnapshot: UndoSnapshot | null = null;
  /** What holds the hand after a hero act: its grade (≤ 1,500 ms), or the open feedback card. */
  private hold: 'grading' | 'feedback' | null = null;
  /** The grade of the latest hero decision while it is on its way. */
  private grading: PendingGrade | null = null;
  /** The feedback card on show (mode 'feedback'). */
  private feedback: FeedbackView | null = null;
  /** The coach level of the latest hero decision (§10: level changes apply from the next one). */
  private decisionLevel: CoachLevel | null = null;
  /**
   * The coach level of each hero decision of this hand, fixed when the decision starts (§10, by
   * decisionId); `latched` is the latest one (the `game.coachLevel` in force), null before the first.
   */
  private readonly levels = new Map<number, CoachLevel>();
  private latched: CoachLevel | null = null;
  /** A resumed decision whose hint was open (`coachKeyOf`): it opens again on the hero's turn. */
  private reopenHint: string | null = null;
  /** Offer the end-of-hand summary (`ControllerOptions.summaries`). */
  private readonly summaries: boolean;
  /** The first-table tips are on (`ControllerOptions.tips`). */
  private readonly tips: boolean;
  /** The tips seen, without storage (with it they are the profile's `flags.tips`). */
  private memoryTips: Readonly<Record<string, boolean>> = {};
  /** §16.3: hashes the shuffle codes; null: no codes (`commit: null` everywhere). */
  private readonly sha256: Sha256 | null;
  /** §16.3: the seeds of the hands that may be dealt next, each committed to before its deal. */
  private readonly codes = new Map<string, ShuffleCode>();
  /** §16.3: the next new table's seed (and id), drawn ahead so its first hand is committed too. */
  private tableAhead: { seed: Seed128; id: string } | null = null;
  /** The current hand's shuffle code (also the finished hand's until the next deal). */
  private code: ShuffleCode | null = null;
  /** `code` was ready before its hand was dealt ('ready' in the 'hand start' line; §16.3). */
  private codeBeforeDeal = false;
  private readonly events: ControllerEvent[] = [];
  private readonly errors: ControllerEvent[] = [];
  private readonly brainEvents: ControllerEvent[] = [];
  private readonly voided: ReplayRecord[] = [];

  constructor(options: ControllerOptions) {
    this.store = options.store;
    this.brain = options.brain;
    this.heroName = options.heroName;
    this.seeds = options.seeds ?? randomSeeds();
    this.timers = options.timers ?? realTimers;
    this.stepFn = options.step ?? step;
    this.storage = options.storage ?? null;
    this.now = options.now ?? ((): Date => new Date());
    this.equityClient = options.equity ?? null;
    this.equityJobs =
      this.equityClient === null ? null : new EquityJobs(this.store, this.equityClient);
    this.hintJobs = options.hints === true ? new HintJobs(this.store, this.brain) : null;
    this.grader = options.grader ?? null;
    this.summaries = options.summaries === true;
    this.tips = options.tips === true;
    this.tabLock = options.tabLock ?? null;
    this.tab = this.tabLock === null ? 'writer' : 'pending';
    this.shareEnv = options.shareEnv ?? (globalThis as ShareEnv);
    this.storageManager = options.storageManager ?? null;
    this.standalone = options.standalone === true;
    this.install = options.install ?? null;
    this.install?.listen(() => {
      if (!this.disposed) this.publish();
    });
    this.sha256 = options.sha256 ?? null;
    this.updates = options.updates ?? null;
    this.offlineToast = options.offlineToast !== false;
    this.reducedMotion = options.reducedMotion === true;
    this.unsubscribe = this.store.subscribe((s, prev) => {
      if (s.ui.nav !== prev.ui.nav) this.onNav(s.ui, prev.ui);
      // §15.1: a toast closed, or the page came to the front: a waiting version may go in now.
      if (
        (s.ui.toasts.length < prev.ui.toasts.length || (prev.ui.hidden && !s.ui.hidden)) &&
        s.ui.nav === prev.ui.nav
      ) {
        this.updateWhenSafe();
      }
      if (s.ui.gates !== prev.ui.gates) this.onGates();
      if (s.coach.opened !== prev.coach.opened) this.onHintOpened();
      if (prev.ui.tip !== null && s.ui.tip !== prev.ui.tip) this.tipSeen(prev.ui.tip);
    });
    this.store.setGameHandler((cmd) => this.dispatch(cmd));
  }

  /**
   * Boot (§12.14): with storage, reads the profile (its settings; Welcome on the first launch, else
   * Home) and the saved session (§14.5: Home's Play continues it; a hand that cannot be restored is
   * voided with its chips returned; a complete hand is committed now if it was not yet, §14.3 load
   * table). Then ready for Play.
   *
   * §14.7: the tab lock is asked first. Without Web Locks the answer comes at once; with them it
   * comes a few milliseconds later, so boot only reads (no write-back, no commit) and the lock's
   * answer decides: granted reads the storage again, writing this time; denied makes the tab
   * read-only. A Play tapped meanwhile waits for it (`queued`).
   *
   * §15.1: then the service worker starts (`updates`), and a page that reloaded into a new version
   * at the Table (`resumeAfterUpdate`) goes back there and deals the next hand, once it writes.
   */
  boot(): void {
    if (this.mode !== 'booting') return;
    this.tabLock?.start((event) => this.onTabLock(event));
    const storage = this.storage;
    if (storage !== null) {
      storage.onFailure(() => updateUi(this.store, (ui) => ({ ...ui, storageBanner: true })));
      const first = this.loadStorage(true);
      this.ui({ type: 'go', screen: first ? 'welcome' : 'home' });
    }
    this.mode = 'idle';
    this.publish();
    void this.keepData();
    this.startUpdates();
    this.resumeAfterUpdate();
  }

  /**
   * Reads the profile and the session (§12.14, §14.5, §14.6) into a fresh game: the settings, the
   * game Home's Play continues, a hand that could not be restored (voided, chips back). A writer
   * tab also writes back what loading repaired and counts a complete hand left in the session
   * (§14.3 load table); a tab without the lock only reads (§14.7). `notify`: the toasts and logs of
   * a repair (boot; not again when the lock's answer reads it a second time). Returns true when
   * there is no profile yet (Welcome).
   */
  private loadStorage(notify: boolean): boolean {
    const storage = this.storage as SafeStorage;
    const readOnly = this.tab !== 'writer';
    const now = this.now();
    this.forgetGame();
    this.sessionStart = null;
    const loaded = loadProfile(storage, { now, readOnly });
    this.profile = loaded.profile;
    this.suggestionTools?.forget(); // §10.4: the coach sample is read again when it matters
    this.seatStats = heroOnly(NO_SEAT_STATS, loaded.profile.heroModel);
    // §12.8: under reduced motion the default speed is Fast. The defaults are what a profile not
    // written yet holds (`rev` 0: the first launch, or a damaged one started again, §14.6), so
    // only they change; a stored speed is the player's.
    const fast = this.reducedMotion && loaded.profile.rev === 0;
    this.store.setState({
      settings: sanitize(loaded.profile.settings, fast ? { speed: 'fast' } : {}),
    });
    if (notify && (loaded.status === 'reset' || loaded.status === 'restored')) {
      this.error(`profile ${loaded.status}`, loaded.problem);
      this.toast({ kind: loaded.status === 'reset' ? 'dataRecovered' : 'dataRestored' });
    }
    const session = loadSession(storage, { engineVersion: ENGINE_VERSION, now, readOnly });
    const saved = session.status === 'ok' || session.status === 'voided' ? session.session : null;
    if (saved !== null) this.resume(saved);
    // §15.1: the page reloaded into a new version at a hand's end: back to the Table.
    this.resumeTable = saved?.resumeAfterUpdate === true;
    if (notify && session.status === 'voided') {
      this.error('session hand voided', session.problem);
      this.toast({ kind: 'handNotRestored' });
    } else if (notify && session.status === 'discarded') {
      this.error('session discarded', session.problem);
    }
    // §14.3 load table: a complete hand is committed now (or was already: step 5 only).
    if (!readOnly && this.hand?.phase === 'complete') this.recoverHand(this.hand);
    // §14.4: the stats' session ended after 30 minutes without an action (or with its game).
    const running = this.profile.stats.currentSession;
    const last =
      session.status === 'ok' || session.status === 'voided' ? session.session.savedAt : null;
    if (
      !readOnly &&
      running !== null &&
      (last === null || now.getTime() - Date.parse(last) >= SESSION_IDLE_MS)
    ) {
      this.endStatsSession();
    }
    this.publishStats(true);
    return loaded.status === 'new' || loaded.status === 'unavailable';
  }

  /** Handles one game command (the store's `dispatch` sends them here). */
  dispatch(cmd: GameCommand): void {
    switch (cmd.type) {
      case 'play':
        if (!this.waitsForLock(cmd)) this.play();
        break;
      case 'newTable':
        if (!this.waitsForLock(cmd)) void this.newTable(cmd.setup, cmd.confirmed === true);
        break;
      case 'playHere':
        this.playHere();
        break;
      case 'exportStats':
      case 'importFile':
      case 'importConfirm':
      case 'importCancel':
      case 'resetStats':
      case 'exportDebug':
        this.withData(cmd);
        break;
      case 'install':
        this.installApp();
        break;
      case 'dismissNudge':
        this.dismissNudge();
        break;
      case 'suggestion':
        this.answerSuggestion(cmd.accept);
        break;
      case 'act':
        this.heroAct(cmd.action);
        break;
      case 'nextHand':
        this.nextHandNow();
        break;
      case 'reload':
        this.reload();
        break;
      case 'topUp':
        this.topUpHero();
        break;
      case 'leaveTable':
        this.leaveTable();
        break;
      case 'changeTable':
        this.changeTable();
        break;
      case 'settings':
        this.changeSettings(cmd.patch);
        break;
      case 'seatLevel':
        this.setSeatLevel(cmd.seat, cmd.level);
        break;
      case 'visibility':
        this.visibility(cmd.hidden);
        break;
      case 'pagehide':
        // §14.6 rule 4: the session is saved after every step; the settings wait 250 ms.
        this.flushSettings();
        break;
      case 'retryCoach':
        this.hintJobs?.retry();
        break;
      case 'undo':
        this.undo();
        break;
      case 'keepMove':
        this.keepMove();
        break;
      case 'history':
        this.loadHistory();
        break;
      case 'historyReview':
        this.reviewStored(cmd.handSeq);
        break;
      default:
        this.trace('unknown command', cmd);
    }
    this.publish();
  }

  /** Stops every timer, lets the tab lock go and unhooks from the store. */
  dispose(): void {
    this.disposed = true;
    this.tabLock?.release();
    this.bumpEpoch();
    this.equityJobs?.dispose();
    this.hintJobs?.cancel();
    this.unsubscribe();
    this.store.setGameHandler(null);
    if (this.visibleTimer !== null) this.timers.clearTimeout(this.visibleTimer);
    this.visibleTimer = null;
    for (const handle of this.toastTimers.values()) this.timers.clearTimeout(handle);
    this.toastTimers.clear();
    if (this.settingsTimer !== null) this.timers.clearTimeout(this.settingsTimer);
    this.settingsTimer = null;
    if (this.updateCheckTimer !== null) this.timers.clearTimeout(this.updateCheckTimer);
    this.updateCheckTimer = null;
    if (this.updateReloadTimer !== null) this.timers.clearTimeout(this.updateReloadTimer);
    this.updateReloadTimer = null;
  }

  snapshot(): ControllerSnapshot {
    return {
      epoch: this.epoch,
      mode: this.mode,
      table: this.table,
      hand: this.hand,
      next: this.next,
      inputs: [...this.inputs],
      meta: this.meta,
      undoSnapshot: this.undoSnapshot,
      assisted: isAssisted(this.meta),
      writer: this.tab === 'writer',
    };
  }

  logs(): ControllerLogs {
    return {
      events: [...this.events],
      errors: [...this.errors],
      brain: [...this.brainEvents],
      voided: [...this.voided],
      equity: this.equityClient?.log() ?? [],
      brainWorker: this.brain.log(),
    };
  }

  // -------------------------------------------------------------------------------------------
  // Commands

  /** Welcome / Home Play (§12.1): continue the table, else start one with the last-used settings. */
  private play(): void {
    if (this.mode === 'booting' || this.headless) return;
    if (this.table === null && this.hand === null && this.next === null) {
      const table = this.buildTable();
      if (table === null) return;
      this.seatStats = heroOnly(this.seatStats); // a new table: its bots have not been seen yet
      this.endStatsSession(); // §14.4: a new table, a new session (none runs here, normally)
      this.beginSession();
      this.startHandAt(table);
    } else if (this.heroBust()) {
      this.navigateToTable();
      this.ui({ type: 'open', overlay: 'outOfChips' });
      return;
    } else if (this.hand === null) {
      this.startHandAt((this.next ?? this.table) as TableState);
    }
    this.navigateToTable();
  }

  /** §3.1, §12.2: a new table from the settings; an unfinished hand is folded and finished first. */
  private async newTable(setup: Partial<Settings> | undefined, confirmed: boolean): Promise<void> {
    if (this.mode === 'booting') return;
    const unfinished = this.hand !== null && this.hand.phase !== 'complete';
    if (unfinished && !confirmed) {
      // §3.1: "Your unfinished hand will be folded. Start a new table?" The dialog's Yes comes back
      // with `confirmed`; No (or Back) just closes it and the hand goes on.
      this.pendingSetup = setup ?? null;
      this.ui({ type: 'open', overlay: 'newTable' });
      return;
    }
    const patch = setup ?? this.pendingSetup ?? undefined;
    this.pendingSetup = null;
    this.ui({ type: 'close', overlay: 'newTable' });
    const token = ++this.newTableSeq;
    if (patch !== undefined) this.store.setState({ settings: sanitize(this.settings(), patch) });
    const table = this.buildTable();
    if (table === null) return;
    if (this.hand !== null && this.hand.phase !== 'complete') {
      this.dropGrading(true); // its grade cannot come now: recorded as failed (§11.3 r5)
      await this.finishHeadless();
      if (token !== this.newTableSeq) return;
      // §3.1: committed as a normal hand; the forced fold adds nothing to the hero model (§9.5
      // notes). Step 5 is the new table's first session, written as its hand is dealt below.
      const done = this.hand as HandState | null; // `await` above: no longer the unfinished one
      if (done?.phase === 'complete') this.commitFinished(done, null, false);
    }
    // A finished hand still waiting for a grade is committed by `closeTable`; then the stats'
    // session ends (§14.4).
    this.closeTable();
    if (this.tab === 'readOnly') return; // a commit found another writer (§14.7)
    this.endStatsSession();
    this.seatStats = heroOnly(this.seatStats); // a new table: its bots have not been seen yet
    this.beginSession();
    this.startHandAt(table);
    this.navigateToTable();
    this.publish();
  }

  /**
   * The hero's action (§2.3): only on the hero's turn; the engine checks it is legal. The undo
   * snapshot of this decision point was taken when the turn began (§11.3 r1); then the hand waits
   * for the decision's grade (§11.3 r5).
   */
  private heroAct(action: PlayerAction): void {
    const h = this.hand;
    if (this.mode !== 'heroTurn' || h === null || h.phase !== 'betting' || h.toAct !== HERO) {
      this.trace('hero act ignored', { mode: this.mode, action });
      return;
    }
    const input: EngineInput = { kind: 'act', seat: HERO, action };
    let next: HandState;
    try {
      next = this.stepFn(h, input);
    } catch (e) {
      if (e instanceof EngineError) this.refused(e, input);
      else this.voidHand(e, input);
      return;
    }
    this.ensureSnapshot(h);
    this.noteHintOpened(h);
    const decision = this.decisionAt(h, action);
    this.hand = next;
    this.inputs.push(input);
    this.trace('input', input);
    this.startGrading(decision);
    this.saveSession(); // after every step (§14.5)
    this.pump();
    this.publish();
  }

  /** A tap on the hand-end banner: the next hand now. */
  private nextHandNow(): void {
    if (this.mode !== 'handEnd') return;
    this.cancelFlow();
    this.continueToNextHand();
  }

  /** Out of chips → Reload (§3.1): the hero gets the starting stack and the next hand starts. */
  private reload(): void {
    const next = this.next;
    if (next === null || (next.slots[HERO]?.stack ?? 0) > 0) {
      this.trace('reload ignored');
      return;
    }
    let table: TableState;
    try {
      table = topUp(next, HERO, next.config.startingStack);
    } catch (e) {
      this.refused(e, null);
      return;
    }
    this.trace('reload', { reloads: table.reloads });
    this.countReload();
    this.startHandAt(table);
    this.ui({ type: 'close', overlay: 'outOfChips' });
  }

  /** Menu → Top up (§3.1, §12.3): between hands, when the hero is below the starting stack. */
  private topUpHero(): void {
    const next = this.next;
    if (next === null || (this.mode !== 'handEnd' && this.mode !== 'idle')) return;
    const stack = next.slots[HERO]?.stack ?? 0;
    if (stack === 0 || stack >= next.config.startingStack) return;
    try {
      this.next = topUp(next, HERO, next.config.startingStack);
    } catch (e) {
      this.refused(e, null);
      return;
    }
    this.trace('top up', { from: stack, reloads: this.next.reloads });
    this.countReload();
    this.saveSession();
  }

  /** Out of chips → Change table (§3.1): Setup; the old table's session ends. */
  private changeTable(): void {
    if (this.hand !== null && this.hand.phase !== 'complete') {
      this.trace('change table ignored: a hand is being played');
      return;
    }
    this.closeTable();
    if (this.tab === 'readOnly') return; // the commit found another writer (§14.7)
    this.endStatsSession();
    this.sessionStart = null;
    // §3.1: the old table's session ends.
    if (this.storage !== null && this.tab === 'writer') clearSession(this.storage);
    this.ui({ type: 'replace', screen: 'setup' });
  }

  private changeSettings(patch: Partial<Settings>): void {
    const current = this.settings();
    const settings = sanitize(current, patch);
    if (settings === current) {
      this.error('settings refused', patch);
      return;
    }
    this.store.setState({ settings });
    this.scheduleSettingsSave();
    if (this.flow?.kind === 'nextHand' && !settings.autoNext) this.cancelFlow();
    this.pump();
  }

  /**
   * A bot's own level, chosen on its card (§9.3, chunk 7.2). It is kept in the settings' per-seat
   * overrides (saved 250 ms later, §14.2), like the table level, and the table follows it when the
   * next hand is dealt (`withSettingsLevels`): the hand in play keeps the table it was dealt from,
   * and the seated bot keeps its name, personality and stack. A seat that is not a bot of this
   * table, or a level that is not one, is ignored.
   */
  private setSeatLevel(seat: number, level: BotLevel | null): void {
    const table = this.next ?? this.table;
    if (
      table === null ||
      !Number.isSafeInteger(seat) ||
      table.slots[seat]?.kind !== 'bot' ||
      (level !== null && !isBotLevel(level))
    ) {
      this.trace('seat level ignored', { seat, level });
      return;
    }
    const settings = this.settings();
    const { seatLevels } = nextLevels(settings, table);
    if (seatLevels[seat] === level && settings.players === table.config.seatCount) return;
    seatLevels[seat] = level;
    // `players` too: the settings keep one override per seat of the table in play (A.7).
    this.changeSettings({ players: table.config.seatCount, seatLevels });
  }

  /** §12.13: hidden → the `hidden` gate closes and the bot job stops; visible → resume after 300 ms. */
  private visibility(hidden: boolean): void {
    const token = ++this.visibleSeq;
    if (this.visibleTimer !== null) {
      this.timers.clearTimeout(this.visibleTimer);
      this.visibleTimer = null;
    }
    if (hidden) {
      // The bot's turn is asked again once visible (same observation and seed: same decision).
      this.cancelJob();
      updateUi(this.store, (ui) => (ui.hidden ? ui : { ...ui, hidden: true }));
      this.flushSettings(); // §12.13: flush storage when hidden (the session is already saved)
      return;
    }
    // §15.1: back in front (a phone often resumes the app instead of loading it): a new version?
    this.checkForUpdate();
    if (!this.store.getState().ui.hidden) return;
    this.visibleTimer = this.timers.setTimeout(() => {
      if (token !== this.visibleSeq) return; // hidden again since (pitfall 22)
      this.visibleTimer = null;
      updateUi(this.store, (ui) => (ui.hidden ? { ...ui, hidden: false } : ui));
    }, TIMING.resumeAfterVisibleMs);
  }

  // -------------------------------------------------------------------------------------------
  // The hand flow

  /** Decides what happens next and starts it (a bot request, a pause, the hand end). */
  private pump(): void {
    if (this.headless) return;
    const h = this.hand;
    if (h === null) {
      if (this.mode !== 'booting') this.mode = 'idle';
      return;
    }
    // After a hero act: nothing moves (no bot, no `advance`, no new card) while its grade is on
    // its way or the feedback card is open (§2.3, §11.3 r5, pitfall 23).
    if (this.hold !== null) {
      this.mode = this.hold;
      return;
    }
    switch (h.phase) {
      case 'betting': {
        const seat = h.toAct as number;
        if (seat === HERO) {
          this.mode = 'heroTurn';
          this.ensureSnapshot(h);
          return;
        }
        this.mode = 'botTurn';
        if (this.flow === null && this.job === null && !this.gatesClosed())
          this.requestBot(h, seat);
        return;
      }
      case 'roundComplete':
      case 'showdown':
        this.mode = 'advancing';
        if (this.flow === null) {
          this.schedule('advance', this.advancePauseMs(h), () => this.applyAdvance());
        }
        return;
      case 'complete':
        if (this.next === null) this.finishHand(h);
        if (this.mode === 'handEnd' && this.flow === null && this.settings().autoNext) {
          this.schedule('nextHand', this.nextHandPauseMs(), () => this.continueToNextHand());
        }
        return;
    }
  }

  /**
   * Deals the next hand at `table` (§2.3 `startNextHand`), at the bot levels the settings name now.
   * When a new version waits (§15.1), it goes in now instead: the page reloads into it and deals
   * this hand there (`updateBeforeHand`). `toTable`: the player goes on at the Table (false for a
   * hand dealt while they are elsewhere: Import's, §14.8).
   */
  private startHandAt(table: TableState, toTable = true): void {
    this.flushCommit();
    if (this.tab === 'readOnly') return; // the commit found another writer (§14.7)
    if (this.updateBeforeHand(table, toTable)) return;
    // Its settings write may have found another writer too (the cast: `this.tab` may have changed
    // since the check above): a read-only tab never deals.
    if ((this.tab as TabMode) === 'readOnly') return;
    this.bumpEpoch();
    const levelled = this.withSettingsLevels(table);
    // §14.3 handSeq rule: global across tables, and above every hand the profile has counted.
    const seq = this.handSeqAt(levelled.nextHandSeq);
    const t = levelled.nextHandSeq < seq ? { ...levelled, nextHandSeq: seq } : levelled;
    // §16.3: the seed committed to before this deal (prepared when the previous hand was dealt,
    // or at boot); one drawn now only when nothing foresaw this hand.
    const code = this.codeFor(t.tableId, seq);
    let hand: HandState;
    try {
      hand = startHand(t, code?.seed ?? this.seeds.handSeed(seq));
    } catch (e) {
      this.error('cannot deal', e);
      this.mode = 'idle';
      return;
    }
    this.codes.clear();
    this.code = code;
    this.codeBeforeDeal = code !== null && code.commit !== null;
    this.table = t;
    this.hand = hand;
    this.next = null;
    this.inputs = [];
    this.revealShown = false;
    // The players who left the table at the last hand end take their statistics with them.
    this.seatStats = seatedStats(this.seatStats, t);
    this.handSeqFloor = Math.max(this.handSeqFloor, hand.handSeq + 1);
    this.dealUntil = this.timers.now() + this.dealMs(hand);
    this.resetDecisions();
    this.ensureSnapshot(hand);
    this.trace('hand start', {
      handSeq: hand.handSeq,
      button: hand.button,
      seats: hand.seats.length,
      levels: levelsOf(t).slice(1), // the levels in force, per bot seat (§10, §14.4)
      // §16.3: 'ready' = the shuffle code was computed before this deal; 'late' = not yet.
      shuffleCode: code === null ? 'off' : code.commit === null ? 'late' : 'ready',
    });
    this.saveSession();
    if (this.newcomers.length > 0) {
      this.toast({ kind: 'botsJoined', names: this.newcomers });
      this.newcomers = [];
    }
    this.pump();
    this.publish();
  }

  /** The hand is complete: the next table (§3.1 bot replacement), the hand-end pause, the commit. */
  private finishHand(h: HandState): void {
    if (!this.settle(h)) return;
    this.mode = 'handEnd';
    this.remember(h);
    this.trace('hand end', { handSeq: h.handSeq, net: h.result?.net ?? null });
    this.commitWhenGraded();
  }

  /**
   * The complete hand's next table (§3.1: busted bots replaced, at the levels the next hand is
   * played at); the commit is now due (§14.3). False when the hand could not be finished (voided).
   */
  private settle(h: HandState): boolean {
    const table = this.table as TableState;
    let next: TableState;
    try {
      next = nextTable(this.withSettingsLevels(table), h);
    } catch (e) {
      this.voidHand(e, null);
      return false;
    }
    this.newcomers = next.slots
      .filter((slot, i) => slot.playerId !== table.slots[i]?.playerId)
      .map((slot) => slot.name);
    this.next = next;
    this.commitPending = true;
    return true;
  }

  /**
   * §14.3: the finished hand is committed once every decision of it has its grade (§11.3 r5: a
   * late one still counts), or when the next hand or table starts (`flushCommit`). Until then the
   * session keeps the complete hand, so a crash commits it at the next launch. Then the seat
   * statistics move on (§9.5: only at hand end) and the session becomes the next table (step 5).
   */
  private commitWhenGraded(): void {
    const h = this.hand;
    const table = this.table;
    if (!this.commitPending || this.grading !== null || h === null || table === null) return;
    this.commitPending = false;
    this.seatStats = withHandStats(this.seatStats, table, h);
    if (this.storage === null || this.profile === null) return;
    this.commitFinished(h, this.sessionState(), true);
  }

  /** The next hand or table starts: a finished hand still waiting for a grade is committed now. */
  private flushCommit(): void {
    if (!this.commitPending) return;
    this.dropGrading(true); // r5: its grade did not come in time, recorded as failed
    this.commitWhenGraded();
  }

  /**
   * §14.3 steps 1–5 for the complete hand `h` (dealt from `this.table`, with `this.inputs` and
   * `this.meta`): its record, `applyHand` and the hero model in one profile write. `session` is
   * step 5's (null: the caller writes the next one); `heroModel` false for a hand the app finished
   * headless (§3.1). A second writer (`conflict`) makes this tab read-only (§14.7).
   */
  private commitFinished(h: HandState, session: SessionState | null, heroModel: boolean): void {
    const { storage, profile, table } = this;
    if (storage === null || profile === null || table === null || this.tab !== 'writer') return;
    const now = this.now();
    const record = handRecordOf({
      hand: h,
      table,
      inputs: this.inputs,
      meta: this.meta,
      coachLevel: this.latched ?? this.settings().coachLevel,
      allIn: this.store.getState().equity.allIn,
      at: now.toISOString(),
      commit: this.commitOf(h),
      commitBeforeDeal: this.commitBeforeDealOf(h),
    });
    if (record === null) {
      if (session !== null) saveSession(storage, session);
      return;
    }
    const log = heroModel ? h.log : null;
    const apply = (p: Profile): Profile => countHand(p, record, log);
    // The protocol's main-thread time (R21: the ring and the profile are rewritten every hand).
    const started = performance.now();
    const result = commitHand(storage, profile, { record, apply, session }, now);
    const ms = Math.round((performance.now() - started) * 10) / 10;
    this.trace('commit', { handSeq: h.handSeq, status: result.status, ms });
    if (result.status === 'conflict') {
      this.anotherWriter(profile.rev, result.storedRev);
      return;
    }
    if (result.status === 'invalid') this.error('hand not committed', result.problem);
    this.profile = result.profile;
    this.publishStats(true);
    // §12.9 collection moment: this commit gave the hand's category its first date (§14.4). The
    // date is stored with the hand, so the moment comes once per category, reloads included.
    const made = record.bestCategory;
    if (result.status === 'committed' && made !== null && !profile.stats.collection[made].first) {
      this.toast({ kind: 'collection', category: made });
    }
    // §10.4: the coach rule's sample follows the counted hands (read once it can matter).
    if (result.status === 'committed') this.suggestionTools?.counted(record);
    // §9.5: the hero model in memory is the profile's.
    if (heroModel && result.profile.heroModel.hands > 0) {
      this.seatStats = { ...this.seatStats, [HERO_ID]: result.profile.heroModel };
    }
    void this.keepData(); // §14.8: maybe the third finished session
  }

  /**
   * §14.3 load table: the saved hand is complete. It is counted now (steps 1–5) unless it already
   * was (step 5 only); either way the game is between hands at its next table, as after a session
   * saved with no hand (§14.5).
   */
  private recoverHand(h: HandState): void {
    if (!this.settle(h)) return;
    this.commitWhenGraded();
    this.table = null;
    this.hand = null;
    this.inputs = [];
    this.resetDecisions();
  }

  /**
   * Keeps the finished hand for Review (§12.10, from memory; the commit stores its record in
   * `pc.v1.hands`): its replay record, the hero's cards and the result the banner shows. A hand
   * finished without animation (a new table mid-hand, §3.1) and a voided hand are not kept:
   * nobody played them out.
   */
  private remember(h: HandState): void {
    const table = this.table;
    const end = table === null ? null : handEndViewOf(h, table);
    if (end === null) return;
    const hand: ReviewHand = {
      handSeq: h.handSeq,
      at: this.now().toISOString(),
      record: this.record(h),
      heroHole: h.seats[HERO]?.hole ?? null,
      board: [...h.board],
      undoCount: this.meta.undoCount,
      commitBeforeDeal: this.commitBeforeDealOf(h),
      end,
    };
    this.store.setState((s) => ({ review: addHand(s.review, hand) }));
  }

  /** After the hand-end pause: the next hand, or the out-of-chips dialog (§3.1). */
  private continueToNextHand(): void {
    const next = this.next;
    if (next === null) return;
    if ((next.slots[HERO]?.stack ?? 0) === 0) {
      this.mode = 'idle';
      this.trace('hero out of chips');
      this.ui({ type: 'open', overlay: 'outOfChips' });
      return;
    }
    this.startHandAt(next);
  }

  private requestBot(h: HandState, seat: number): void {
    const job: BotJob = { jobId: 0, epoch: this.epoch, seat, sentAt: this.timers.now() };
    const jobId = this.sendBot(h, seat, (event) => this.onBotEvent(job, event));
    if (jobId === null) {
      // The brain worker has failed for good (§12.14): the bot takes the safest legal action.
      this.fallback('brain unavailable', { seat });
      this.schedule('act', this.botWaitMs(0, job.sentAt), () => this.applyBot(seat, null));
      return;
    }
    job.jobId = jobId;
    this.job = job;
  }

  /**
   * Sends `seat`'s decision to `brain.worker`: its observation, its profile and the table-only
   * seed (§2.4), in the slot `bot:<seat>`. The client owns the 2 s timeout (§12.14). Returns the
   * job id, or null when the client sent nothing (the worker has failed for good).
   */
  private sendBot(
    h: HandState,
    seat: number,
    onEvent: (event: JobEvent<BrainReply>) => void,
  ): number | null {
    const table = this.table as TableState;
    const epoch = this.epoch;
    const obs = observe(h, seat, this.extras(table));
    const profile = this.profileOf(table, seat);
    const seed = botSeed(table.tableSeed, h.handSeq, seat, h.log.length);
    const jobId = this.brain.request({
      slot: `bot:${seat}`,
      epoch,
      timeoutMs: this.brainWarm ? TIMING.botTimeoutMs : TIMING.botFirstTimeoutMs,
      build: (id): BrainRequest => ({ kind: 'botDecision', jobId: id, epoch, obs, profile, seed }),
      onEvent: (event) => {
        if (event.type === 'reply') this.brainWarm = true;
        onEvent(event);
      },
    });
    this.brainLog('request', { jobId, seat, handSeq: h.handSeq, logLength: h.log.length });
    return jobId;
  }

  private onBotEvent(job: BotJob, event: JobEvent<BrainReply>): void {
    if (this.job !== job || job.epoch !== this.epoch) {
      this.brainLog('drop', { jobId: job.jobId, epoch: job.epoch, current: this.epoch });
      return;
    }
    this.job = null;
    let action: PlayerAction | null = null;
    let thinkMs = 0;
    const detail = { jobId: job.jobId, seat: job.seat };
    if (event.type === 'reply' && event.reply.kind === 'botDecision') {
      action = event.reply.decision.action;
      thinkMs = Number.isFinite(event.reply.thinkMs) ? Math.max(0, event.reply.thinkMs) : 0;
      this.brainLog('reply', { ...detail, action, thinkMs });
    } else {
      this.fallback(failureOf(event), { ...detail, ...messageOf(event) });
    }
    this.schedule('act', this.botWaitMs(thinkMs, job.sentAt), () =>
      this.applyBot(job.seat, action),
    );
    this.publish();
  }

  /** A bot's action after its think time; null = the safest legal action. */
  private applyBot(seat: number, action: PlayerAction | null): void {
    const h = this.hand;
    if (h === null || h.phase !== 'betting' || h.toAct !== seat) {
      this.trace('bot act dropped', { seat });
      this.pump();
      this.publish();
      return;
    }
    const legal = legalActions(h) as LegalActions;
    let input: EngineInput = { kind: 'act', seat, action: action ?? safestAction(legal) };
    let next: HandState;
    try {
      next = this.stepFn(h, input);
    } catch (e) {
      if (!(e instanceof EngineError)) {
        this.voidHand(e, input);
        return;
      }
      this.refused(e, input);
      this.fallback('illegal bot action', { seat });
      input = { kind: 'act', seat, action: safestAction(legal) };
      try {
        next = this.stepFn(h, input);
      } catch (e2) {
        this.voidHand(e2, input);
        return;
      }
    }
    this.commit(next, input);
  }

  private applyAdvance(): void {
    const h = this.hand;
    if (h === null || (h.phase !== 'roundComplete' && h.phase !== 'showdown')) {
      this.pump();
      this.publish();
      return;
    }
    const input: EngineInput = { kind: 'advance' };
    let next: HandState;
    try {
      next = this.stepFn(h, input);
    } catch (e) {
      this.voidHand(e, input);
      return;
    }
    this.commit(next, input);
  }

  /** A new state from `step`: keep it and its input, then carry on. */
  private commit(next: HandState, input: EngineInput): void {
    this.hand = next;
    this.inputs.push(input);
    this.trace('input', input);
    this.ensureSnapshot(next); // a new hero decision point (§11.3 r1)
    this.saveSession(); // after every step (§14.5)
    this.pump();
    this.publish();
  }

  /**
   * §4.5: a broken invariant (or any unexpected error) voids the hand. `table` is the table as at
   * hand start, so every seat gets its hand-start stack back; the replay record is kept for
   * Diagnostics; the next hand starts.
   */
  private voidHand(error: unknown, input: EngineInput | null): void {
    const table = this.table;
    const hand = this.hand;
    this.error('hand voided', error instanceof Error ? error.message : String(error));
    if (table !== null && hand !== null) {
      const record = this.record(hand);
      if (input !== null) record.inputs.push(input);
      push(this.voided, record, RING.voided);
      // §4.5, §14.2: stored under `pc.v1.diag` too (the last 5), unless another tab writes (§14.7).
      if (this.storage !== null && this.tab === 'writer') {
        appendDiag(this.storage, record, this.now());
      }
    }
    this.diag = { ...this.diag, voidedHands: this.diag.voidedHands + 1 };
    this.toast({ kind: 'handVoided' });
    this.closeTable();
    if (table === null) return;
    this.startHandAt(
      { ...table, nextHandSeq: Math.max(table.nextHandSeq + 1, this.handSeqFloor) },
      this.store.getState().ui.screen === 'table',
    );
  }

  /**
   * §3.1: finishes the unfinished hand with no animation and no UI. The hero folds at their next
   * turn (checks when checking is free: folding then is illegal, B32); bots decide at once.
   */
  private async finishHeadless(): Promise<void> {
    this.bumpEpoch();
    const epoch = this.epoch;
    this.headless = true;
    this.mode = 'idle';
    this.publish();
    try {
      // A hand always ends in ≤ 400 inputs (§18 Stage 2); the bound is a safety net.
      for (let n = 0; n < 1000; n++) {
        const h = this.hand;
        if (h === null) return;
        if (h.phase === 'complete') {
          // `newTable` commits it (§3.1: "commits it, and closes the table").
          this.trace('hand finished headless', { handSeq: h.handSeq, record: this.record(h) });
          return;
        }
        let input: EngineInput;
        if (h.phase === 'betting') {
          const seat = h.toAct as number;
          const legal = legalActions(h) as LegalActions;
          const action = seat === HERO ? safestAction(legal) : await this.decideNow(h, seat, legal);
          if (epoch !== this.epoch || this.hand !== h) {
            this.trace('headless finish dropped', { epoch });
            return;
          }
          input = { kind: 'act', seat, action };
        } else {
          input = { kind: 'advance' };
        }
        try {
          this.hand = this.stepFn(h, input);
        } catch (e) {
          if (!(e instanceof EngineError) || input.kind !== 'act') throw e;
          this.refused(e, input);
          input = {
            kind: 'act',
            seat: input.seat,
            action: safestAction(legalActions(h) as LegalActions),
          };
          this.hand = this.stepFn(h, input);
        }
        this.inputs.push(input);
      }
    } catch (e) {
      // A hand that cannot finish is dropped (§4.5): its chips go back with the old table.
      this.error('headless finish failed', e instanceof Error ? e.message : String(e));
      this.hand = null;
    } finally {
      if (epoch === this.epoch) this.headless = false;
    }
  }

  /** A bot decision with no think time (headless play), still with the 2 s timeout. */
  private decideNow(h: HandState, seat: number, legal: LegalActions): Promise<PlayerAction> {
    return new Promise((resolve) => {
      let jobId: number | null = null;
      const finish = (event: JobEvent<BrainReply> | null): void => {
        if (this.headlessJob?.jobId === jobId) this.headlessJob = null;
        if (event?.type === 'reply' && event.reply.kind === 'botDecision') {
          resolve(event.reply.decision.action);
          return;
        }
        const why = event === null ? 'brain unavailable' : failureOf(event);
        this.fallback(why, { jobId, seat, ...(event === null ? {} : messageOf(event)) });
        resolve(safestAction(legal));
      };
      jobId = this.sendBot(h, seat, finish);
      if (jobId === null) {
        finish(null);
        return;
      }
      this.headlessJob = { jobId, release: () => resolve(safestAction(legal)) };
    });
  }

  // -------------------------------------------------------------------------------------------
  // Grading, the feedback card and Undo (§11, chunk 6.2)

  /** §11.3 r1: the snapshot of the decision point `h` (the hero is to act), once per state. */
  private ensureSnapshot(h: HandState | null): void {
    if (h === null || this.headless || !isHeroTurn(h) || this.undoSnapshot?.state === h) return;
    this.undoSnapshot = snapshotAt(h, this.meta, this.inputs.length);
  }

  /**
   * §10.2 "Counts as on your own": the player opened the hint of the decision `h` ("Hint", the
   * coach sheet: the `coach` slice's `opened`, chunk 5.9) before acting. Kept in the hand's meta
   * (A.7 `hintShown`, by decisionId), so it outlives an Undo and a reload.
   */
  private noteHintOpened(h: HandState): void {
    if (this.store.getState().coach.opened !== coachKeyOf(h)) return;
    const decisionId = heroDecisionsTaken(h);
    if (this.meta.hintShown[decisionId] === true) return;
    this.meta = { ...this.meta, hintShown: { ...this.meta.hintShown, [decisionId]: true } };
  }

  /** "Hint" opened (§10.2): kept in the hand's meta at once, so it outlives a reload (§14.5). */
  private onHintOpened(): void {
    const h = this.hand;
    if (h === null || this.headless || this.mode !== 'heroTurn') return;
    const meta = this.meta;
    this.noteHintOpened(h);
    if (this.meta !== meta) this.saveSession();
  }

  /** The coach level of decision `decisionId` (§10): fixed when it started, else the settings'. */
  private levelOf(decisionId: number): CoachLevel {
    return this.levels.get(decisionId) ?? this.settings().coachLevel;
  }

  /**
   * §10: "coach level changes apply from the next hero decision". When the hero's decision starts,
   * its level is fixed for good (an Undo returns to it at the same level). A Beginner decision has
   * the hint on show: it is noted as seen (`hintShown`), so it counts as helped even if the level
   * changes before the act, and after a reload.
   */
  private latchLevel(): void {
    const h = this.hand;
    if (h === null || this.headless || this.mode !== 'heroTurn' || !isHeroTurn(h)) return;
    const decisionId = heroDecisionsTaken(h);
    const known = this.levels.get(decisionId);
    if (known !== undefined) {
      this.latched = known;
      return;
    }
    const level = this.settings().coachLevel;
    this.levels.set(decisionId, level);
    this.latched = level;
    if (LEVEL_RULES[level].hintAlwaysSeen && this.meta.hintShown[decisionId] !== true) {
      this.meta = { ...this.meta, hintShown: { ...this.meta.hintShown, [decisionId]: true } };
    }
  }

  /**
   * §10.3: the quiz score of the decision at `h` when the hero acts (Advanced): the answers given
   * (all of them, or those before "Skip"); null without a quiz, or with no answer.
   */
  private quizResult(h: HandState): { correct: number; of: number } | null {
    const { coach } = this.store.getState();
    const quiz = coach.quiz;
    const key = coachKeyOf(h);
    if (quiz === null || quiz.key !== key || coach.key !== key || coach.decision === null) {
      return null;
    }
    if (quiz.answers.length === 0) return null;
    return quizScore(coach.decision, quiz.answers);
  }

  /**
   * §10.2, §12.9: at the hand end, the hand summary the banner offers when the level of the hand's
   * latest decision shows one (a late grade can still bring it): Exam's "Exam result", else the
   * "Hand summary"; null for none. Since 1.3.92 (the owner: "i dont want to see exam result
   * automatically after every game, i need to have a button to open it if i want") nothing opens
   * by itself: the player's tap opens the `summary` overlay, and its `sheet` gate keeps the next
   * hand waiting for its "Next hand ›".
   */
  private summaryOffer(): SummaryOffer {
    const h = this.hand;
    if (!this.summaries || this.mode !== 'handEnd' || this.headless || h === null) return null;
    if (h.phase !== 'complete') return null;
    const level = this.latched ?? this.settings().coachLevel;
    const grades = this.meta.decisions.map((d) => d.grade);
    if (!summaryShows(level, grades)) return null;
    return LEVEL_RULES[level].exam ? 'exam' : 'hand';
  }

  /** What a hero decision at `h` is, before the act changes anything (§8.2: the HUD's number). */
  private decisionAt(h: HandState, action: PlayerAction): PendingGrade {
    const decisionId = heroDecisionsTaken(h);
    const level = this.levelOf(decisionId);
    const hud = hudEquityAt(this.store.getState().equity, h);
    const obs = observe(h, HERO, this.extras(this.table as TableState));
    return {
      epoch: this.epoch,
      // Only an Observation crosses to the worker (§4.8).
      ask: {
        obs,
        taken: action,
        eRandom: hud.final,
        decisionId,
      },
      facts: {
        decisionId,
        street: h.street,
        taken: action,
        eRandom: hud.latest,
        need: priceNeed(h),
        // The hero's all-in here, so the summary says "All-in 200" (§12.9, QA-2 item 6).
        allInTo: obs.legal.raise?.max ?? obs.legal.bet?.max ?? null,
        callAllIn: obs.legal.callIsAllIn,
        // §10.2: the hint is always on show at Beginner; above it, the player opened it.
        hintSeen: LEVEL_RULES[level].hintAlwaysSeen || this.meta.hintShown[decisionId] === true,
        quiz: level === 'advanced' ? this.quizResult(h) : null,
      },
      level,
      decision: h,
      attempt: 0,
      jobId: null,
      pause: null,
    };
  }

  /**
   * §11.3 r5: grades the decision just made. With `pause` the hand waits (mode 'grading') until the
   * grade comes, at most `GRADE_PAUSE_MS`; without a grader the decision is recorded ungraded at
   * once.
   */
  private startGrading(g: PendingGrade, pause = true): void {
    // An earlier decision's grade still on its way (it was late): recorded as failed.
    this.dropGrading(true);
    this.decisionLevel = g.level;
    if (this.grader === null) {
      this.addRecord(decisionRecord(g.facts, null));
      return;
    }
    this.grading = g;
    if (pause) {
      this.hold = 'grading';
      g.pause = this.timers.setTimeout(() => this.onGradePause(g), GRADE_PAUSE_MS);
    }
    this.sendGrade(g);
  }

  /** One try of `g`'s grade job (the same inputs every time, r5). */
  private sendGrade(g: PendingGrade): void {
    g.attempt++;
    const jobId = (this.grader as Grader).grade(g.ask, g.epoch, (outcome) =>
      this.onGradeOutcome(g, outcome),
    );
    this.brainLog('grade request', { jobId, decisionId: g.ask.decisionId, attempt: g.attempt });
    g.jobId = jobId;
    if (jobId === null) this.onGradeOutcome(g, { ok: false, reason: 'brain unavailable' });
  }

  private onGradeOutcome(g: PendingGrade, outcome: GradeOutcome): void {
    if (this.grading !== g || g.epoch !== this.epoch) {
      this.brainLog('grade drop', { decisionId: g.ask.decisionId, epoch: g.epoch });
      return; // stale (pitfall 22)
    }
    g.jobId = null;
    const decisionId = g.ask.decisionId;
    if (!outcome.ok) {
      this.brainLog('grade failed', { decisionId, attempt: g.attempt, reason: outcome.reason });
      if (g.attempt < GRADE_ATTEMPTS) {
        this.sendGrade(g); // once more, with the same inputs
        return;
      }
      this.finishGrading(g, null);
      return;
    }
    this.brainLog('grade', { decisionId, grade: outcome.result.grade });
    this.finishGrading(g, outcome.result);
  }

  /** The grade is in (or failed twice): record it; within the pause it may open the card. */
  private finishGrading(g: PendingGrade, result: GradeResult | null): void {
    if (g.pause !== null) this.timers.clearTimeout(g.pause);
    g.pause = null;
    this.grading = null;
    this.addRecord(decisionRecord(g.facts, result));
    if (this.hold === 'grading') {
      this.hold = null;
      if (result !== null && pausesAt(g.level, result.grade)) this.openFeedback(g, result);
    }
    // A late grade (after the pause) is only recorded: nothing else changes (r5; its grade chip is
    // the §12.6 chip's). At the hand end it was the last thing the commit waited for (§14.3).
    if (this.commitPending) this.commitWhenGraded();
    else this.saveSession();
    this.pump();
    this.publish();
  }

  /** `GRADE_PAUSE_MS` passed with no grade: the hand goes on; the grade may still come (r5). */
  private onGradePause(g: PendingGrade): void {
    if (this.grading !== g || g.epoch !== this.epoch) return; // stale (pitfall 22)
    g.pause = null;
    if (this.hold !== 'grading') return;
    this.trace('grade late', { decisionId: g.ask.decisionId });
    this.hold = null;
    this.pump();
    this.publish();
  }

  /** Forgets the grade on its way; with `record`, its decision is recorded ungraded. */
  private dropGrading(record = false): void {
    const g = this.grading;
    if (g === null) return;
    this.grading = null;
    if (g.pause !== null) this.timers.clearTimeout(g.pause);
    g.pause = null;
    if (g.jobId !== null) this.grader?.cancel(g.jobId);
    g.jobId = null;
    if (this.hold === 'grading') this.hold = null;
    if (record) this.addRecord(decisionRecord(g.facts, null));
  }

  private addRecord(record: DecisionRecord): void {
    this.meta = withRecord(this.meta, record);
  }

  /** §11.1: the feedback card; nothing moves until Undo or Keep my move. */
  private openFeedback(g: PendingGrade, result: GradeResult): void {
    this.hold = 'feedback';
    this.feedback = feedbackView(result, g.decision, this.undoBlocked(true));
    this.trace('feedback', { decisionId: result.decisionId, grade: result.grade });
    this.ui({ type: 'open', overlay: 'feedback' });
  }

  /** [Keep my move] (also Esc and Back): the hand goes on. */
  private keepMove(): void {
    if (this.hold !== 'feedback') {
      this.trace('keep ignored', { mode: this.mode });
      return;
    }
    this.hold = null;
    this.feedback = null;
    this.trace('keep move');
    this.closeFeedbackOverlay();
    this.pump();
    this.publish();
  }

  /**
   * The feedback card follows the navigation: closed on the Table (Back, Esc) = Keep my move;
   * closed by leaving the Table (the Menu's Leave table) = still waiting, and it opens again when
   * the Table is back (§11.1: it never goes away by itself).
   */
  private onNav(ui: UiSlice, prev: UiSlice): void {
    // §14.8: a screen with Export opens, so its chunk is there before the tap.
    if (ui.screen !== prev.screen && DATA_SCREENS.includes(ui.screen)) this.withData(null);
    // §10.4: the level suggestion card shows on the hand summary (the Table) and on Stats, where
    // the coach rule's sample is read if it can matter.
    if (ui.screen === 'table' || ui.screen === 'stats') this.loadSuggestions();
    if (ui.screen === 'stats' && prev.screen !== 'stats') this.suggestionTools?.counted(null);
    // Import's dialog closed by Back (or by leaving the screen) while a file waits: forget it.
    if (
      this.importCheck !== null &&
      prev.overlays.includes('dataImport') &&
      !ui.overlays.includes('dataImport')
    ) {
      this.withData({ type: 'importCancel' });
    }
    // §15.1: back on Home with nothing open, a waiting version may go in now.
    this.updateWhenSafe();
    // §19.6: the Table on show is a table of the server's: this game's card waits for its own.
    if (this.parked || this.hold !== 'feedback' || ui.overlays.includes('feedback')) return;
    if (ui.screen !== 'table') return;
    if (prev.screen === 'table' && prev.overlays.includes('feedback')) this.keepMove();
    else this.ui({ type: 'open', overlay: 'feedback' });
  }

  private closeFeedbackOverlay(): void {
    if (this.store.getState().ui.overlays.includes('feedback')) {
      this.ui({ type: 'close', overlay: 'feedback' });
    }
  }

  /** Why Undo is not possible now (§11.3 r2), or null. */
  private undoBlocked(feedbackOpen = this.hold === 'feedback'): UndoBlock | null {
    if (this.headless) return 'noDecision';
    return undoBlock({
      hand: this.hand,
      snapshot: this.undoSnapshot,
      meta: this.meta,
      level: this.decisionLevel ?? this.settings().coachLevel,
      feedbackOpen,
    });
  }

  /**
   * §11.3 r3: takes back the hero's latest decision. A refused Undo changes nothing (the button is
   * disabled then; the U key and a second tap land here).
   */
  private undo(): void {
    const block = this.undoBlocked();
    const snap = this.undoSnapshot;
    if (block !== null || snap === null) {
      this.trace('undo refused', { block });
      return;
    }
    let restored: Restored;
    try {
      restored = restoreForUndo(snap, { inputs: this.inputs, meta: this.meta }, this.stepFn);
    } catch (e) {
      // UNDO_USED and friends (§11.5): refused, nothing changed.
      if (e instanceof EngineError) this.refused(e, null);
      else this.voidHand(e, null);
      return;
    }
    // (1)–(2): a new epoch: every timer and every brain or equity reply of before is stale.
    this.bumpEpoch();
    // (3)–(5): the snapshot back, the stub reshuffled, the hand marked practice.
    this.hand = restored.state;
    this.inputs = restored.inputs;
    this.meta = restored.meta;
    this.hold = null;
    this.feedback = null;
    this.trace('undo', { decisionId: snap.decisionId, undoCount: this.meta.undoCount });
    this.trace('input', restored.reshuffle);
    this.closeFeedbackOverlay();
    // (6): the hero acts again (the same hint: determinism) at the same decision point.
    this.ensureSnapshot(restored.state);
    this.toast({ kind: 'undone' });
    this.saveSession();
    this.pump();
    this.publish();
  }

  /** A new hand, or none: no decisions, no snapshot, nothing held, no feedback card. */
  private resetDecisions(): void {
    this.dropGrading();
    this.meta = emptyHandMeta();
    this.undoSnapshot = null;
    this.hold = null;
    this.feedback = null;
    this.decisionLevel = null;
    this.levels.clear();
    this.latched = null;
    this.reopenHint = null;
    this.closeFeedbackOverlay();
    if (this.store.getState().ui.overlays.includes('summary')) {
      this.ui({ type: 'close', overlay: 'summary' });
    }
  }

  /**
   * After a reload (§11.3 r7): the snapshot and the records come back from the session. A grade
   * that was on its way when the page went is asked again, as a late one (no pause: the feedback
   * card does not come back after a reload; the toolbar Undo still works where rule 2 holds).
   */
  private resumeDecision(): void {
    const h = this.hand;
    const snap = this.undoSnapshot;
    if (h === null || snap === null) return;
    if (snap.state.handSeq !== h.handSeq || heroDecisionsTaken(h) !== snap.decisionId + 1) return;
    const act = this.inputs[snap.inputCount];
    if (act?.kind !== 'act' || act.seat !== HERO) return;
    if (standingRecord(this.meta, snap.decisionId) !== null) return;
    const g = this.decisionAt(snap.state, act.action);
    if (h.phase === 'complete') {
      // The hand is committed at boot (§14.3 load table): no grade can join it now (r5: failed).
      this.addRecord(decisionRecord(g.facts, null));
      return;
    }
    this.trace('grade asked again', { decisionId: g.ask.decisionId });
    this.startGrading(g, false); // a late grade: no pause
  }

  // -------------------------------------------------------------------------------------------
  // Timings

  /** §11.3 r6: after the hero folds, a Normal-speed hand continues at Fast. */
  private effectiveSpeed(): Speed {
    const speed = this.settings().speed;
    return speed === 'normal' && this.hand?.seats[HERO]?.folded === true ? 'fast' : speed;
  }

  /** Dealing the hole cards: 180 ms + 60 ms per further card (§12.8). */
  private dealMs(h: HandState): number {
    const cards = 2 * h.seats.filter((s) => s.dealtIn).length;
    const ms = TIMING.dealCardMs + TIMING.dealStaggerMs * (cards - 1);
    return ms * SPEED_FACTOR[this.settings().speed];
  }

  /** The pause before an `advance`: chips to the pot, then the reveal once it has happened. */
  private advancePauseMs(h: HandState): number {
    let ms = TIMING.chipsToPotMs + TIMING.streetPauseMs;
    if (h.revealed.length > 0 && !this.revealShown) {
      this.revealShown = true;
      ms += TIMING.revealPerHandMs * h.revealed.length;
    }
    return ms * SPEED_FACTOR[this.effectiveSpeed()];
  }

  private nextHandPauseMs(): number {
    const ms = TIMING.nextHandMs * SPEED_FACTOR[this.settings().speed];
    return Math.max(TIMING.nextHandMinMs, ms);
  }

  /** §9.8: wait `max(think time, compute time)`, and not before the hole cards have landed. */
  private botWaitMs(thinkMs: number, sentAt: number): number {
    const speed = this.effectiveSpeed();
    const think = speed === 'instant' ? TIMING.instantBotMs : thinkMs * SPEED_FACTOR[speed];
    const now = this.timers.now();
    return Math.max(0, Math.round(think - (now - sentAt)), Math.round(this.dealUntil - now));
  }

  // -------------------------------------------------------------------------------------------
  // The flow timer and the gates

  private gatesClosed(): boolean {
    return this.store.getState().ui.gates.length > 0;
  }

  private onGates(): void {
    // Equity jobs follow the `hidden` gate: all cancelled while hidden (§15.3, acceptance 5).
    this.equityJobs?.setHidden(this.store.getState().ui.hidden);
    if (this.headless) return;
    if (this.gatesClosed()) {
      this.pauseFlow();
      return;
    }
    if (this.flow !== null) {
      this.startFlow(this.flow);
      return;
    }
    this.pump();
    this.publish();
  }

  /** Replaces the flow timer; it runs only while every gate is open. */
  private schedule(kind: FlowKind, ms: number, run: () => void): void {
    this.cancelFlow();
    const flow: FlowTimer = {
      kind,
      token: 0,
      epoch: this.epoch,
      remaining: Math.max(0, ms),
      startedAt: null,
      handle: null,
      run,
    };
    this.flow = flow;
    if (!this.gatesClosed()) this.startFlow(flow);
  }

  /** Runs the flow timer for its remaining time; each start gets its own token. */
  private startFlow(flow: FlowTimer): void {
    if (flow.handle !== null) return;
    const token = ++this.timerSeq;
    flow.token = token;
    flow.startedAt = this.timers.now();
    flow.handle = this.timers.setTimeout(() => this.fireFlow(flow, token), flow.remaining);
  }

  private pauseFlow(): void {
    const flow = this.flow;
    if (flow === null || flow.handle === null) return;
    this.timers.clearTimeout(flow.handle);
    flow.handle = null;
    flow.token = 0; // a callback of the paused run is stale
    const ran = this.timers.now() - (flow.startedAt ?? this.timers.now());
    flow.remaining = Math.max(0, flow.remaining - ran);
    flow.startedAt = null;
  }

  private cancelFlow(): void {
    const flow = this.flow;
    if (flow === null) return;
    if (flow.handle !== null) this.timers.clearTimeout(flow.handle);
    flow.token = 0;
    this.flow = null;
  }

  private fireFlow(flow: FlowTimer, token: number): void {
    if (this.flow !== flow || flow.token !== token || flow.epoch !== this.epoch) {
      this.trace('stale timer dropped', { kind: flow.kind, epoch: flow.epoch });
      return;
    }
    flow.handle = null;
    if (this.gatesClosed()) {
      // Cannot happen (a closing gate pauses the timer); wait for the gates all the same.
      flow.startedAt = null;
      flow.remaining = 0;
      return;
    }
    this.flow = null;
    flow.run();
    this.publish();
  }

  private cancelJob(): void {
    const job = this.job;
    if (job === null) return;
    this.job = null;
    this.brain.cancel(job.jobId);
    this.brainLog('cancel', { jobId: job.jobId, seat: job.seat });
  }

  /** A new epoch: every pending timer and brain reply of the old one is now stale. */
  private bumpEpoch(): void {
    this.epoch++;
    this.cancelFlow();
    this.cancelJob();
    this.hintJobs?.cancel();
    this.dropGrading();
    // A headless finish waits for its bot: cancelled jobs never answer, so let it go on.
    const headless = this.headlessJob;
    if (headless !== null) {
      this.headlessJob = null;
      this.brain.cancel(headless.jobId);
      headless.release();
    }
  }

  // -------------------------------------------------------------------------------------------
  // Storage (chunk 3.2, §14)

  /** A table's session begins (Play or Start game, §14.4); the settings become the last-used ones. */
  private beginSession(): void {
    this.sessionStart = this.now().toISOString();
    this.settingsDirty = true;
    this.flushSettings(); // also writes the profile on the first launch, so the next one opens Home
  }

  // -------------------------------------------------------------------------------------------
  // Stats (chunk 8.2, §14.4)

  /** Menu → Leave table (§3.1, §14.4): Home; the stats' session ends, and a toast says how it went. */
  private leaveTable(): void {
    // A finished hand still waiting for its grade belongs to this session: it is counted first.
    this.flushCommit();
    const session = this.endStatsSession();
    // The line first: Home with a toast on show is not yet a moment for a new version (§15.1).
    if (session !== null) this.toast({ kind: 'session', session });
    this.ui({ type: 'go', screen: 'home' });
  }

  /**
   * §14.4: the stats' running session ends (Leave table, New table, Change table, 30 minutes
   * without an action): it joins the recent sessions, written at once. Returns it; null when none
   * was running.
   */
  private endStatsSession(): SessionSummary | null {
    const profile = this.profile;
    const session = profile?.stats.currentSession ?? null;
    if (profile === null || session === null) return null;
    this.changeProfile({ ...profile, stats: endSession(profile.stats) });
    return session;
  }

  /** Out of chips → Reload, Menu → Top up (§3.1): one more reload in the stats (§14.4 Results). */
  private countReload(): void {
    const profile = this.profile;
    if (profile === null) return;
    const stats = { ...profile.stats, reloads: profile.stats.reloads + 1 };
    this.changeProfile({ ...profile, stats });
  }

  /**
   * A profile change between commits, written at once through the same `rev` check and backup as
   * every profile write (§14.3 steps 2–4). Without storage, or in a tab that is not the writer, it
   * lives in memory only (§14.6 rule 3, §14.7).
   */
  private changeProfile(next: Profile): void {
    if (this.storage === null || this.tab !== 'writer') {
      this.profile = next;
    } else {
      const saved = saveProfile(this.storage, next, this.now());
      const result = saved.result;
      if (!result.ok && result.reason === 'invalid') {
        this.error('profile not saved', result.problem); // a bug: keep the profile we had
        return;
      }
      // §14.3 step 2: another tab writes now (§14.7): this tab turns read-only.
      if (!result.ok && result.reason === 'conflict') {
        this.anotherWriter(next.rev, result.storedRev);
        return;
      }
      this.profile = saved.profile;
    }
    this.publishStats();
  }

  /** The profile's stats to the store (§14.4); a newly counted hand makes the History rows stale. */
  private publishStats(newHand = false): void {
    const stats = this.profile?.stats ?? null;
    this.store.setState((s) => {
      const stale = newHand && s.history !== null;
      if (s.stats === stats && !stale) return s;
      return stale ? { stats, history: null } : { stats };
    });
  }

  /** Stats → History (§14.4): the stored hands as rows. */
  private loadHistory(): void {
    const { storage, profile } = this;
    const rows =
      storage === null || profile === null
        ? []
        : readHistory(storage, profile.lastCommittedHandSeq);
    this.store.setState({ history: rows });
  }

  /**
   * A History row (§14.4 → §12.10): Review on that stored hand. A hand of this launch is in the
   * review slice already; another is read from `pc.v1.hands` and joins it, in its place.
   */
  private reviewStored(handSeq: number): void {
    const { storage, profile } = this;
    const kept = this.store.getState().review.hands.some((h) => h.handSeq === handSeq);
    if (!kept && storage !== null && profile !== null) {
      const hand = readReviewHand(storage, profile.lastCommittedHandSeq, handSeq);
      if (hand !== null) this.store.setState((s) => ({ review: addStoredHand(s.review, hand) }));
    }
    this.store.getState().dispatch({ type: 'review', handSeq });
  }

  /** A saved session back in play (§14.5): exactly its table, hand and inputs. */
  private resume(session: SessionState): void {
    this.sessionStart = session.sessionStart;
    const t = session.table;
    // §9.5: the saved statistics, so a resumed hand has the same observations (and hints); the
    // hero model the profile holds when the session has none for the hero. They come first: the
    // grade that `resumeDecision` asks again below is made from the decision's observation.
    // Between hands the hero's entry is the profile's hero model (§9.5, written by every commit);
    // a saved hand keeps the statistics it was dealt with, the hero's too.
    const stats: Record<string, SeatStats> = { ...heroOnly(this.seatStats) };
    const heroFromProfile = session.hand === null && this.profile !== null;
    t.slots.forEach((slot, i) => {
      const s = session.seatStats[i];
      if (s !== null && s !== undefined && !(i === HERO && heroFromProfile)) {
        stats[slot.playerId] = s;
      }
    });
    this.seatStats = stats;
    if (session.hand === null) {
      this.table = null;
      this.hand = null;
      this.next = session.table;
      this.inputs = [];
    } else {
      const h = session.hand;
      this.table = session.table;
      this.hand = h;
      this.next = null;
      this.inputs = [...session.handInputs];
      this.meta = session.meta;
      this.undoSnapshot = session.undoSnapshot;
      this.code = this.resumedCode(t.tableId, h, session.commit ?? null);
      // Only a session that says so: a code computed again now came after the deal.
      this.codeBeforeDeal = (session.commit ?? null) !== null && session.commitBeforeDeal === true;
      this.resumeDecision();
      // A hint opened before the page went is open again on that decision (§14.5).
      if (isHeroTurn(h) && this.meta.hintShown[heroDecisionsTaken(h)] === true) {
        this.reopenHint = coachKeyOf(h);
      }
    }
    this.handSeqFloor = Math.max(
      this.handSeqFloor,
      t.nextHandSeq,
      (session.hand?.handSeq ?? 0) + 1,
    );
    this.trace('resume', {
      handSeq: session.hand?.handSeq ?? null,
      phase: session.hand?.phase ?? null,
    });
  }

  /**
   * `pc.v1.session` (§14.5, A.7): the table as at hand start with the hand and its inputs (also a
   * complete hand until it is committed, §14.3); between hands (after `nextTable` and the commit)
   * the next hand's table and no hand. `savedAt` is now. Null without a table.
   */
  private sessionState(): SessionState | null {
    const withHand = this.hand !== null && (this.next === null || this.commitPending);
    const table = withHand ? this.table : (this.next ?? this.table);
    if (table === null) return null;
    const now = this.now().toISOString();
    return {
      schema: 1,
      savedAt: now,
      sessionStart: this.sessionStart ?? now,
      table,
      hand: withHand ? this.hand : null,
      handInputs: withHand ? this.inputs : [],
      meta: withHand ? this.meta : emptyHandMeta(),
      undoSnapshot: withHand ? this.undoSnapshot : null,
      seatStats: statsBySeat(this.seatStats, table),
      resumeAfterUpdate: false,
      ...(withHand &&
        this.hand !== null && {
          commit: this.commitOf(this.hand),
          commitBeforeDeal: this.commitBeforeDealOf(this.hand),
        }),
    };
  }

  /** Writes the session, after every step (§14.5). */
  private saveSession(): void {
    if (this.storage === null || this.headless || this.tab !== 'writer') return;
    // §15.1: the page reloads into a new version: the session it saved for that stays as it is.
    if (this.reloading || this.update === 'applying') return;
    const session = this.sessionState();
    if (session === null) return;
    const saved = saveSession(this.storage, session);
    if (!saved.ok && saved.reason === 'invalid') this.error('session not saved', saved.problem);
  }

  /** Saves the settings 250 ms after the last change (§14.2). */
  private scheduleSettingsSave(): void {
    this.settingsDirty = true;
    if (this.storage === null) return;
    if (this.settingsTimer !== null) this.timers.clearTimeout(this.settingsTimer);
    const token = ++this.settingsSeq;
    this.settingsTimer = this.timers.setTimeout(() => {
      if (token === this.settingsSeq) this.flushSettings();
    }, TIMING.settingsDebounceMs);
  }

  /** Writes changed settings now (on hidden, pagehide and a new table, §14.6 rule 4). */
  private flushSettings(): void {
    if (this.settingsTimer !== null) this.timers.clearTimeout(this.settingsTimer);
    this.settingsTimer = null;
    this.settingsSeq++;
    if (
      this.storage === null ||
      this.profile === null ||
      !this.settingsDirty ||
      this.tab !== 'writer'
    ) {
      return;
    }
    const saved = saveSettings(this.storage, this.profile, this.settings(), this.now());
    this.profile = saved.profile;
    this.settingsDirty = false;
    const result = saved.result;
    if (!result.ok && result.reason === 'invalid') this.error('settings not saved', result.problem);
    // §14.3 step 2: another tab writes now (§14.7).
    if (!result.ok && result.reason === 'conflict') {
      this.anotherWriter(saved.profile.rev, result.storedRev);
    }
  }

  // -------------------------------------------------------------------------------------------
  // One writer at a time (§14.7, chunk 8.3)

  /** Play or New table before the lock answered: they wait for it; read-only: ignored. */
  private waitsForLock(cmd: GameCommand): boolean {
    if (this.tab === 'writer') return false;
    if (this.tab === 'pending') this.queued = cmd;
    else this.trace('read-only: ignored', cmd.type);
    return true;
  }

  private onTabLock(event: TabLockEvent): void {
    if (this.disposed) return;
    this.trace('tab lock', event);
    switch (event) {
      case 'granted':
        this.becomeWriter();
        break;
      case 'denied':
      case 'lost':
        this.becomeReadOnly(event === 'denied' ? 'another tab has the game' : 'lock taken');
        break;
      case 'changed':
        if (this.tab === 'readOnly') this.refreshProfile();
        break;
    }
    this.publish();
  }

  /**
   * This tab writes now (§14.7). After boot (the lock's late answer, or "Play here") the storage
   * is read again, writing back what loading repairs: another tab may have played on since this
   * one read it. Without Web Locks the other tab hears this one only through its writes, so the
   * profile is written once at once. Then what waited for the lock runs.
   */
  private becomeWriter(): void {
    this.tab = 'writer';
    if (this.mode === 'booting' || this.storage === null) return;
    this.loadStorage(false);
    if (this.tabLock?.mode !== 'locks' && this.profile !== null) {
      const saved = saveProfile(this.storage, this.profile, this.now());
      const result = saved.result;
      // The other tab committed between our read and this write: it keeps the game.
      if (!result.ok && result.reason === 'conflict') {
        this.anotherWriter(this.profile.rev, result.storedRev);
        return;
      }
      this.profile = saved.profile;
    }
    void this.keepData();
    const queued = this.queued;
    this.queued = null;
    if (queued !== null) this.dispatch(queued);
    // §15.1: back to the Table after a reload into a new version; or a waiting version goes in.
    this.resumeAfterUpdate();
    this.updateWhenSafe();
  }

  /** A profile write found another tab's `rev` (§14.3 step 2): that tab has the game now. */
  private anotherWriter(rev: number, storedRev: number): void {
    this.error('another writer', { rev, storedRev });
    this.becomeReadOnly('another writer');
  }

  /**
   * Another tab has the game (§14.7): from now on this tab writes nothing (its unsaved settings
   * too), and the game stops: the game screens show the §12.11 banner. The stop runs on a
   * microtask, so a write path that found the other `rev` finishes its own steps first (they
   * write nothing any more).
   */
  private becomeReadOnly(why: string): void {
    if (this.tab === 'readOnly') return;
    this.tab = 'readOnly';
    this.queued = null;
    this.trace('read-only', why);
    queueMicrotask(() => {
      if (this.disposed || this.tab !== 'readOnly') return;
      this.data?.run({ type: 'importCancel' }); // a checked file waits for nobody now
      this.forgetGame();
      this.ui({ type: 'go', screen: 'home' });
      this.publish();
    });
  }

  /** "Play here" (§12.11): the game comes to this tab, and Play continues it. */
  private playHere(): void {
    if (this.tab !== 'readOnly') return;
    this.queued = { type: 'play' };
    this.tab = 'pending';
    if (this.tabLock === null) this.becomeWriter();
    else this.tabLock.takeOver(); // 'granted' follows (at once without Web Locks)
  }

  /** A read-only tab: the writer changed the profile, so show the new numbers (§14.7). */
  private refreshProfile(): void {
    if (this.storage === null) return;
    const loaded = loadProfile(this.storage, { now: this.now(), readOnly: true });
    this.profile = loaded.profile;
    this.suggestionTools?.forget();
    this.store.setState({ settings: sanitize(loaded.profile.settings, {}) });
    this.publishStats(true); // §14.7: Stats stay readable, with the other tab's numbers
  }

  /** The game in this tab stops (read-only, or before the storage is read again): no writes. */
  private forgetGame(): void {
    this.bumpEpoch();
    this.commitPending = false;
    this.headless = false;
    this.pendingSetup = null;
    if (this.settingsTimer !== null) this.timers.clearTimeout(this.settingsTimer);
    this.settingsTimer = null;
    this.settingsDirty = false;
    this.table = null;
    this.hand = null;
    this.next = null;
    this.inputs = [];
    this.newcomers = [];
    if (this.mode !== 'booting') this.mode = 'idle';
    this.resetDecisions();
  }

  // -------------------------------------------------------------------------------------------
  // Install hints and level suggestions (§12.13, §12.11, §10.4, chunk 8.4)

  /**
   * The one-time card of Home (and Welcome), or null (§12.11, §12.13). Only with storage, and not
   * in a read-only tab: its answer is saved in the profile's flags, which are this device's (Import
   * keeps them, §14.8 notes). A tab still waiting for the lock's answer (`pending`, a few
   * milliseconds at boot) shows it already, so the card is there from the first paint.
   * - In a home-screen app on iOS, before any hand is counted: "Played in Safari before?…" (its
   *   storage is not Safari's), until [Skip] (`flags.safariImport`).
   * - In a browser tab, until answered (`flags.iosInstall`, for both cards: a device gets one of
   *   them): on iOS over https after the first finished session the Share tip; where the browser
   *   offers installing, after the second finished session, the install card.
   */
  private nudge(): Nudge | null {
    const { profile, install } = this;
    if (profile === null || install === null || this.storage === null || this.tab === 'readOnly') {
      return null;
    }
    const { flags, stats } = profile;
    if (this.standalone) {
      const hands = stats.results.clean.hands + stats.results.practice.hands;
      return install.ios && !flags.safariImport && hands === 0 ? 'safariImport' : null;
    }
    if (flags.iosInstall) return null;
    if (install.ios) return install.secure && stats.sessions >= 1 ? 'iosTip' : null;
    return install.ready() && stats.sessions >= 2 ? 'installCard' : null;
  }

  /** The card's [Got it], [Not now] or [Skip]: it does not come back on this device. */
  private dismissNudge(): void {
    const nudge = this.nudge();
    const profile = this.profile;
    if (nudge === null || profile === null) return;
    const flag = nudge === 'safariImport' ? 'safariImport' : 'iosInstall';
    this.changeFlags({ ...profile.flags, [flag]: true });
  }

  /**
   * "Install app" (§12.13): the browser's install dialog, from the tap itself. The offer is used
   * up at once (`data.install` turns false through `listen`), and the install card counts as
   * answered (the tile or the card: either way the player has seen it).
   */
  private installApp(): void {
    if (this.nudge() === 'installCard') this.dismissNudge();
    void this.install?.prompt()?.then((installed) => this.trace('install', { installed }));
  }

  /**
   * The level suggestion card (§10.4), or null: from the lazy chunk `app/suggestions.ts` once it
   * is loaded (the Table or Stats opened), only in the writer tab with storage (its answer is
   * saved).
   */
  private suggestion(): Suggestion | null {
    return this.suggestionTools?.current() ?? null;
  }

  /**
   * Loads the suggestions' chunk once (again after a failure), with storage only; then publishes
   * the card. The tools see the profile only in the writer tab, and read the ring only then.
   */
  private loadSuggestions(): void {
    if (this.suggestionsLoading || this.storage === null) return;
    this.suggestionsLoading = true;
    import('./suggestions.ts').then(
      (m) => {
        if (this.disposed) return;
        this.suggestionTools = m.suggestionTools({
          profile: () => (this.tab === 'writer' ? this.profile : null),
          settings: () => this.settings(),
          hands: () =>
            loadHands(this.storage as SafeStorage, (this.profile as Profile).lastCommittedHandSeq)
              .hands,
          now: this.now,
        });
        if (this.store.getState().ui.screen === 'stats') this.suggestionTools.counted(null);
        this.publish();
      },
      (e: unknown) => {
        this.suggestionsLoading = false;
        this.error('suggestions not loaded', e instanceof Error ? e.message : String(e));
      },
    );
  }

  /**
   * The card's answer (§10.4): yes changes the level through the same path as Settings (§10: the
   * bots from the next hand, the coach from the next decision); either answer hides the card for 7
   * days, saved at once.
   */
  private answerSuggestion(accept: boolean): void {
    const tools = this.suggestionTools;
    const offer = this.suggestion();
    if (tools === null || offer === null) return;
    const { patch, flags } = tools.answer(offer, accept);
    this.trace('suggestion', { ...offer, accept });
    if (patch !== null) this.changeSettings(patch);
    this.changeFlags(flags);
  }

  /**
   * The profile's flags changed (§10.4, §12.11): written at once, with the settings in force,
   * through the same `rev` check and backup as every profile write. A tab that is not the writer
   * keeps them in memory (it writes nothing, §14.7).
   */
  private changeFlags(flags: ProfileFlags): void {
    if (this.profile === null) return;
    this.profile = { ...this.profile, flags };
    this.settingsDirty = true;
    this.flushSettings();
  }

  // -------------------------------------------------------------------------------------------
  // New versions (§15.1, chunk 9.5; the service worker is `app/swUpdate.ts`)

  /** Starts the service worker and the hourly check for a new version. */
  private startUpdates(): void {
    const port = this.updates;
    if (port === null) return;
    port.start((event) => this.onUpdateEvent(event));
    this.scheduleUpdateCheck();
  }

  private onUpdateEvent(event: UpdateEvent): void {
    if (this.disposed) return;
    this.trace('update', event);
    switch (event) {
      case 'offlineReady':
        this.offlineReady();
        break;
      case 'updateReady':
        // After a failed chunk too: the version waiting in the service worker goes in first.
        if (this.update === 'none' || this.staleOnly) this.update = 'ready';
        this.staleOnly = false;
        this.updateWhenSafe();
        break;
      case 'activated':
        this.staleOnly = false;
        if (this.update === 'applying') {
          // This tab let it in, at a safe moment, with everything saved: reload now.
          this.reloadForUpdate();
          return;
        }
        // Another tab let it in: this page still runs the old code; it reloads when safe. A tab
        // without the game leaves the line for it (§14.7): when the tab that let it in reloads,
        // the game must go to that tab's new page, not to this old one.
        this.update = 'activated';
        if (this.tab !== 'writer') this.tabLock?.standAside();
        this.updateWhenSafe();
        break;
      case 'stale':
        // §15.1 "Redeploys": a lazy chunk of this page's version could not load: the server may
        // run a newer version. The page reloads when safe, as for `activated` (a version waiting
        // in the service worker goes in first: `ready` stays), but without the toast.
        if (this.update === 'none') {
          this.update = 'activated';
          this.staleOnly = true;
        }
        this.updateWhenSafe();
        break;
    }
    this.publish();
  }

  /**
   * §15.1: a new version reloads the page only where nothing is lost and nobody is interrupted:
   * now, when no hand is unfinished and Welcome or Home shows with nothing open
   * (`updateMayReload`); else before the next hand is dealt (`startHandAt`). Meanwhile, at the
   * Table, the toast says it installs after this hand (once per launch).
   */
  private updateWhenSafe(): void {
    if (this.update === 'none' || this.update === 'applying' || this.reloading) return;
    const { screen, overlays, toasts, hidden } = this.store.getState().ui;
    const unfinished = this.hand !== null && this.hand.phase !== 'complete';
    const busy = this.mode === 'booting' || this.headless || this.commitPending || unfinished;
    const moment = {
      tab: this.tab,
      busy,
      screen,
      overlays,
      toasts: toasts.length,
      hidden,
      update: this.update,
    };
    if (updateMayReload(moment) && this.takeUpdate(false)) return;
    // "…installs after this hand": with a hand unfinished, or finished with its banner on show
    // (not on Home after Leave table, where it goes in once the session line has closed).
    const handOnShow = unfinished || (this.hand !== null && screen === 'table');
    if (
      this.tab === 'writer' &&
      handOnShow &&
      !this.updateToastShown &&
      !this.staleOnly &&
      this.storage?.failure === null
    ) {
      this.updateToastShown = true;
      this.toast({ kind: 'updateReady' });
    }
  }

  /**
   * §15.1: a hand is about to be dealt at `table` and a new version waits. It goes in now: the
   * session is saved as between hands at `table` (with `resumeAfterUpdate` when the player goes on
   * at the Table, so the new version deals this hand at once) and the page reloads. Returns false
   * to deal as usual: no new version, another tab has the game, or nothing could be saved.
   *
   * When the reload is on its way already (Home let the new version in, and it takes up to 5 s to
   * take over), nothing is dealt either; a Play tapped meanwhile saves the session once more, at
   * `table` and with `resumeAfterUpdate`, so the new version comes back at the Table and deals.
   */
  private updateBeforeHand(table: TableState, toTable: boolean): boolean {
    if (this.reloading || this.update === 'applying') {
      if (toTable && !this.updateResumes) this.resumeAtTableAfterUpdate(table);
      return true;
    }
    if (this.update === 'none' || this.tab !== 'writer') return false;
    this.next = table; // the session's table; the finished hand stays on show until the reload
    return this.takeUpdate(toTable);
  }

  /** The reload saved the session for Home; the player went on to the Table: save it for there. */
  private resumeAtTableAfterUpdate(table: TableState): void {
    const storage = this.storage;
    if (storage === null || storage.failure !== null || this.tab !== 'writer') return;
    this.next = table;
    const session = this.sessionState();
    if (session === null || !saveSession(storage, { ...session, resumeAfterUpdate: true }).ok) {
      return;
    }
    this.updateResumes = true;
    this.trace('update: back to the table after the reload');
  }

  /**
   * Saves what the reload must not lose (the session, between hands, and the settings), then lets
   * the new version in and reloads. Returns false, and nothing happens, when that cannot be saved
   * (§14.6: the game lives in memory, so the new version waits for the next launch) or when this
   * tab does not know yet whether it has the game.
   */
  private takeUpdate(resumeAfterUpdate: boolean): boolean {
    const storage = this.storage;
    const port = this.updates;
    if (storage === null || port === null || storage.failure !== null || this.tab === 'pending') {
      return false;
    }
    // Only a chunk failed, and the page is offline now: the chunk is only out of reach, and the
    // reload would show the browser's error page (§15.1 "Redeploys"). The next safe moment asks.
    if (this.staleOnly && port.online?.() === false) return false;
    if (this.tab === 'writer') {
      this.flushSettings();
      // The settings could not be written, or the write found another tab's game (§14.7): a
      // read-only tab writes nothing more, not even this session.
      if (storage.failure !== null || this.tab !== 'writer') return false;
      const session = this.sessionState();
      if (session !== null && !saveSession(storage, { ...session, resumeAfterUpdate }).ok) {
        return false;
      }
      if (storage.failure !== null) return false;
      this.updateResumes = resumeAfterUpdate;
    }
    this.trace('update: reload', { resumeAfterUpdate });
    if (this.update === 'activated') {
      this.reloadForUpdate();
      return true;
    }
    this.update = 'applying';
    this.updateReloadTimer = this.timers.setTimeout(() => {
      this.updateReloadTimer = null;
      this.reloadForUpdate();
    }, TIMING.updateReloadMs);
    port.apply(); // `activated` follows, then the reload
    return true;
  }

  /** The page reloads into the new version; from now on nothing is dealt or written here. */
  private reloadForUpdate(): void {
    if (this.reloading || this.disposed) return;
    this.reloading = true;
    if (this.updateReloadTimer !== null) this.timers.clearTimeout(this.updateReloadTimer);
    this.updateReloadTimer = null;
    this.bumpEpoch();
    this.updates?.reload();
  }

  /**
   * §15.1: the page reloaded into a new version at a hand's end (`resumeAfterUpdate`): back to
   * the Table, and the next hand is dealt, as Play would. Only once this tab writes (§14.7).
   */
  private resumeAfterUpdate(): void {
    if (!this.resumeTable || this.tab !== 'writer' || this.mode === 'booting') return;
    this.resumeTable = false;
    this.trace('update: back to the table');
    this.play();
    this.publish();
  }

  /**
   * §12.11: "Ready to play offline.", once ever (`profile.flags.offlineReady`), in the tab with
   * the game. On a first launch the flag waits in memory and is written with the profile at the
   * first Play (until then the next launch is a first launch too, §12.1).
   */
  private offlineReady(): void {
    const { profile, storage } = this;
    if (!this.offlineToast) return;
    if (profile === null || storage === null || profile.flags.offlineReady) return;
    if (this.tab !== 'writer') return;
    this.toast({ kind: 'offlineReady' });
    const marked: Profile = { ...profile, flags: { ...profile.flags, offlineReady: true } };
    this.profile = marked;
    const stored = storage.get(STORAGE_KEYS.profile);
    if (!stored.ok || stored.value === null) return;
    const saved = saveProfile(storage, marked, this.now());
    if (!saved.result.ok && saved.result.reason === 'conflict') {
      this.anotherWriter(marked.rev, saved.result.storedRev);
      return;
    }
    this.profile = saved.profile;
  }

  /**
   * §15.1: asks the server for a new version (one GET of `sw.js`), at most once a minute. The
   * browser checks by itself only when a page loads.
   */
  private checkForUpdate(): void {
    const port = this.updates;
    if (port === null || this.reloading) return;
    if (this.update === 'applying' || this.update === 'activated') return;
    const now = this.timers.now();
    if (now - this.updateCheckedAt < TIMING.updateCheckMinMs) return;
    this.updateCheckedAt = now;
    this.trace('update: check');
    port.check();
  }

  /** Every hour while the page is in front (a hidden page checks when it comes back). */
  private scheduleUpdateCheck(): void {
    this.updateCheckTimer = this.timers.setTimeout(() => {
      this.updateCheckTimer = null;
      if (this.disposed) return;
      if (!this.store.getState().ui.hidden) this.checkForUpdate();
      this.scheduleUpdateCheck();
    }, TIMING.updateCheckMs);
  }

  // -------------------------------------------------------------------------------------------
  // Keeping the data: persist(), Export, Import, Reset (§14.8, chunk 8.3)

  /**
   * §14.8: asks the browser to keep this site's data (`navigator.storage.persist()`), at most once
   * per launch: on a launch from the Home Screen until it is granted, and in a browser tab once,
   * after the third finished session (`stats.sessions`, chunk 8.2). The answer is kept in
   * `persistGranted` (Settings: "Protected from automatic clean-up: Yes/No").
   */
  private async keepData(): Promise<void> {
    const manager = this.storageManager;
    const asked = this.profile;
    if (manager === null || asked === null || this.tab !== 'writer' || this.keepAsked) return;
    const due = this.standalone
      ? asked.persistGranted !== true
      : asked.persistGranted === null && asked.stats.sessions >= 3;
    if (!due) return;
    this.keepAsked = true;
    let granted: boolean;
    try {
      granted = (await manager.persisted()) || (await manager.persist());
    } catch (e) {
      this.error('persist() failed', e instanceof Error ? e.message : String(e));
      return;
    }
    this.trace('persist()', { granted });
    const profile = this.profile;
    const storage = this.storage;
    if (this.disposed || this.tab !== 'writer' || storage === null || profile === null) return;
    if (profile.persistGranted === granted) return;
    const saved = saveProfile(storage, { ...profile, persistGranted: granted }, this.now());
    const result = saved.result;
    if (!result.ok && result.reason === 'conflict') {
      this.anotherWriter(profile.rev, result.storedRev);
      return;
    }
    this.profile = saved.profile;
    this.publish();
  }

  /**
   * The Data commands (§14.8: Export, Import, Reset) run in their lazy chunk (`app/dataTools.ts`).
   * Loaded already (a Data screen opened it), a command runs inside this call, so Export's share
   * sheet opens inside the tap; else once the chunk is there. When it cannot load (offline, not
   * cached), Export says it failed, Import and Reset that nothing changed.
   */
  private withData(cmd: DataCommand | null): void {
    const storage = this.storage;
    if (storage === null) return;
    if (this.data !== null) {
      if (cmd !== null) this.data.run(cmd);
      return;
    }
    this.dataLoading ??= import('./dataTools.ts').then(
      (tools) => (this.data = tools.dataCommands(this.dataHost(storage))),
      (e: unknown) => {
        this.dataLoading = null;
        this.error('data commands not loaded', e instanceof Error ? e.message : String(e));
        return null;
      },
    );
    void this.dataLoading.then((data) => {
      if (this.disposed || cmd === null) return;
      if (data !== null) data.run(cmd);
      else if (cmd.type !== 'importCancel') {
        this.toast({ kind: cmd.type === 'exportStats' ? 'exportFailed' : 'dataNotChanged' });
      }
    });
  }

  /** What the Data commands may see and do in this controller (`DataHost`). */
  private dataHost(storage: SafeStorage): DataHost {
    const canChange = (): boolean =>
      !this.disposed && this.tab === 'writer' && this.profile !== null && !this.headless;
    return {
      storage,
      kit: PERSIST_KIT,
      env: this.shareEnv,
      now: this.now,
      canChange,
      exportProfile: () =>
        this.tab === 'writer' && this.profile !== null
          ? this.profile
          : loadProfile(storage, { now: this.now(), readOnly: true }).profile,
      profile: () => this.profile as Profile,
      prepare: () => this.flushCommit(), // §14.3: counted in the stats pc.v1.preimport keeps
      cancelHand: () => (canChange() ? this.cancelUnfinished() : null),
      adopt: (profile, table) => {
        if (this.disposed) return;
        this.adoptProfile(profile);
        if (table !== null && this.tab === 'writer') this.startHandAt(table, false);
        this.publish();
      },
      conflict: (storedRev) => this.anotherWriter(this.profile?.rev ?? 0, storedRev),
      importCheck: (check) => {
        this.importCheck = check;
        if (this.disposed) return;
        // The 'dataImport' dialog shows the check (chunk 8.4): open while there is one.
        const open = this.store.getState().ui.overlays.includes('dataImport');
        if (check !== null && !open) this.ui({ type: 'open', overlay: 'dataImport' });
        else if (check === null && open) this.ui({ type: 'close', overlay: 'dataImport' });
        this.publish();
      },
      // §4.5: this launch's counters and last errors (no cards of a hand in play).
      debugReport: () => ({ counters: this.diag, errors: this.errors.slice(-20) }),
      toast: (kind) => {
        if (!this.disposed) this.toast({ kind });
      },
      log: (what, detail) => this.trace(what, detail),
    };
  }

  /**
   * Import (§14.8): an unfinished hand cannot go on, as its number may already be counted in the
   * file (§14.3 handSeq rule). It is dropped and the table waits as at hand start, so every seat
   * has its hand-start stack back; the session says so. Returns that table, or null.
   */
  private cancelUnfinished(): TableState | null {
    const h = this.hand;
    const table = this.table;
    if (h === null || h.phase === 'complete' || table === null) return null;
    this.trace('hand cancelled', { handSeq: h.handSeq });
    this.bumpEpoch();
    this.hand = null;
    this.table = null;
    this.next = table;
    this.inputs = [];
    this.mode = 'idle';
    this.resetDecisions();
    this.saveSession();
    return table;
  }

  /**
   * After Import or Reset: the new profile in memory (settings, the handSeq floor that follows
   * `lastCommittedHandSeq`, the hero model), Review's list emptied (its hands were the old
   * stats'). During a hand (Reset) the hero model in memory waits for that hand's commit (§9.5).
   */
  private adoptProfile(profile: Profile): void {
    this.profile = profile;
    this.publishStats(true); // Stats show the new numbers; History reads the new hands
    this.suggestionTools?.forget(); // §10.4: the old hands' sample (read again when it matters)
    if (this.settingsTimer !== null) this.timers.clearTimeout(this.settingsTimer);
    this.settingsTimer = null;
    this.settingsDirty = false;
    this.store.setState({ settings: sanitize(profile.settings, {}), review: initialReview() });
    if (this.hand === null || this.hand.phase === 'complete') {
      const others = Object.entries(this.seatStats).filter(([id]) => id !== HERO_ID);
      if (profile.heroModel.hands > 0) others.push([HERO_ID, profile.heroModel]);
      this.seatStats = Object.fromEntries(others);
    }
  }

  /** Forgets the table and its hand (a new table, Change table, a voided hand). */
  private closeTable(): void {
    this.flushCommit();
    this.commitPending = false;
    this.bumpEpoch();
    this.headless = false;
    this.table = null;
    this.hand = null;
    this.next = null;
    this.inputs = [];
    this.newcomers = [];
    this.mode = 'idle';
    this.resetDecisions();
  }

  // -------------------------------------------------------------------------------------------
  // Helpers

  private settings(): Settings {
    return this.store.getState().settings;
  }

  private heroBust(): boolean {
    return this.next !== null && (this.next.slots[HERO]?.stack ?? 0) === 0;
  }

  /** A table from the settings (null when they break §3.2; Setup never sends such values). */
  private buildTable(): TableState | null {
    const s = this.settings();
    const seatLevels: (BotLevel | null)[] = Array.from({ length: s.players }, (_, i) =>
      i === HERO ? null : (s.seatLevels[i] ?? null),
    );
    const cfg: TableConfig = {
      seatCount: s.players,
      sb: s.sb,
      bb: s.bb,
      startingStack: s.startingStack,
      botLevel: s.botLevel,
      seatLevels,
    };
    try {
      // §16.3: the seed drawn ahead (its first hand is committed to already), else a new one.
      const tableSeed = this.tableAhead?.seed ?? this.seeds.tableSeed();
      this.tableAhead = null;
      return createTable(cfg, initialSlots(cfg, tableSeed, this.heroName), tableSeed);
    } catch (e) {
      this.refused(e, null);
      return null;
    }
  }

  /**
   * §10, §9.3: a bot level chosen in Settings, in Setup or on a bot's card starts with the next
   * hand. `table` keeps its seated bots (names, personalities, stacks) and gets the settings'
   * table level and per-seat overrides (`nextLevels`); the hand dealt from it reads those for its
   * pods' labels and its bots' profiles, and it is the table the hand records (§14.3), so a hand
   * records the levels in force, per seat. A hand that is already being played is not touched: its
   * table is the one it was dealt from.
   */
  private withSettingsLevels(table: TableState): TableState {
    const { botLevel, seatLevels } = nextLevels(this.settings(), table);
    if (table.config.botLevel === botLevel && sameSeatLevels(table.config.seatLevels, seatLevels)) {
      return table;
    }
    try {
      return withLevels(table, botLevel, seatLevels);
    } catch (e) {
      this.refused(e, null);
      return table;
    }
  }

  /** The Table, over Home (app/navigation.ts: Back from the Table goes Home). */
  private navigateToTable(): void {
    this.ui({ type: 'go', screen: 'table' });
  }

  /**
   * What `observe` adds for the brain (§4.8, A.4): the seat statistics as at hand start (§9.5),
   * the labels a seat's level shows, and the levels.
   */
  private extras(table: TableState): ObserveExtras {
    const levels = levelsOf(table);
    return {
      seatStats: statsBySeat(this.seatStats, table),
      visiblePersonality: table.slots.map((slot, i) =>
        slot.kind === 'bot' && labelVisible(levels[i] as BotLevel) ? slot.personality : null,
      ),
      seatLevels: levels,
    };
  }

  /** The seat's brain profile (§9.1 × §9.2): its personality at its effective level. */
  private profileOf(table: TableState, seat: number): BrainProfile {
    return profileFor(table.slots[seat]?.personality ?? 'tag', seatLevelOf(table, seat));
  }

  /**
   * The hero's decision for the coach (§8.2, §12.6): its key, the epoch, and how to build the
   * request (the hero's observation and the HUD's final number when the equity slice has it).
   * Null when it is not the hero's turn.
   */
  private hintAsk(hand: HandState | null, legal: LegalActions | null): HintAsk | null {
    const table = this.table;
    if (
      this.headless ||
      this.mode !== 'heroTurn' ||
      hand === null ||
      legal === null ||
      table === null ||
      hand.toAct !== HERO
    ) {
      return null;
    }
    const decisionId = heroDecisionsTaken(hand);
    // §10.3: Advanced only, and never again on a decision taken back with Undo (its answers showed).
    const quizzes =
      this.levelOf(decisionId) === 'advanced' && !hand.undoneDecisions.includes(decisionId);
    return {
      key: coachKeyOf(hand),
      epoch: this.epoch,
      build: () => {
        const obs = observe(hand, HERO, this.extras(table));
        return {
          obs,
          eRandom: finalHudEquity(this.store.getState().equity, hand),
          quiz: quizzes && quizRolls(obs),
        };
      },
    };
  }

  /** The replay record of the current hand so far (§4.7): its table as at hand start and its inputs. */
  private record(h: HandState): ReplayRecord {
    return {
      engineVersion: h.engineVersion,
      seed: h.seed,
      commit: this.commitOf(h),
      table: this.table as TableState,
      inputs: [...this.inputs],
    };
  }

  /** §14.3 handSeq rule: the handSeq of the next hand dealt from a table at `nextHandSeq`. */
  private handSeqAt(nextHandSeq: number): number {
    return Math.max(nextHandSeq, this.handSeqFloor, (this.profile?.lastCommittedHandSeq ?? 0) + 1);
  }

  /**
   * §16.3: the code of the hand (tableId, handSeq), its seed drawn and its digest started on the
   * first ask (null without a hash function). Kept until the next deal.
   */
  private codeFor(tableId: string, handSeq: number): ShuffleCode | null {
    const sha256 = this.sha256;
    if (sha256 === null) return null;
    const key = `${tableId}:${handSeq}`;
    let code = this.codes.get(key);
    if (code === undefined) {
      code = startShuffleCode(sha256, this.seeds.handSeed(handSeq), tableId, handSeq);
      this.codes.set(key, code);
    }
    return code;
  }

  /**
   * §16.3, off the deal's path (every `publish`; a no-op once done): the next hand's code at this
   * table, and the first hand's at the next new table, whose table seed is drawn ahead for it.
   */
  private prepareCodes(): void {
    if (this.sha256 === null) return;
    const table = this.next ?? this.table;
    if (table !== null) this.codeFor(table.tableId, this.handSeqAt(table.nextHandSeq));
    if (this.tableAhead === null) {
      const seed = this.seeds.tableSeed();
      this.tableAhead = { seed, id: tableIdOf(seed) };
    }
    this.codeFor(this.tableAhead.id, this.handSeqAt(1));
  }

  /** A resumed hand's code: the session's, else computed again from its seed (§16.3). */
  private resumedCode(tableId: string, h: HandState, commit: string | null): ShuffleCode | null {
    if (commit !== null) return { handSeq: h.handSeq, seed: h.seed, commit };
    return this.sha256 === null ? null : startShuffleCode(this.sha256, h.seed, tableId, h.handSeq);
  }

  /** The shuffle code of `h` (§16.3), or null (none, or its digest has not answered). */
  private commitOf(h: HandState): string | null {
    const code = this.code;
    return code !== null && code.handSeq === h.handSeq && code.seed === h.seed ? code.commit : null;
  }

  /** `h` has a shuffle code, and it was ready before `h` was dealt (Review may say so, §16.3). */
  private commitBeforeDealOf(h: HandState): boolean {
    return this.codeBeforeDeal && this.commitOf(h) !== null;
  }

  private legalOf(h: HandState): LegalActions | null {
    if (this.legalCache?.hand !== h) this.legalCache = { hand: h, legal: legalActions(h) };
    return this.legalCache.legal;
  }

  /** Everything the store shows of this game, except while parked (§19.6): then only `data`. */
  private publish(): void {
    this.prepareCodes();
    this.latchLevel();
    if (!this.parked) this.publishGame();
    this.publishData();
  }

  /**
   * §19.6: a multiplayer table takes the `game` slice. This game stands still and its equity and
   * coach slices empty; `offTable` is held closed by the driver, so nothing here moves meanwhile.
   */
  park(): void {
    if (this.parked) return;
    this.parked = true;
    this.equityJobs?.sync(null, this.epoch);
    this.hintJobs?.sync(null);
    this.parkedCoach = this.store.getState().coach;
    this.store.setState({ coach: initialCoach() });
  }

  /** The multiplayer table is over: this game comes back exactly as it was. */
  unpark(): void {
    if (!this.parked) return;
    this.parked = false;
    if (this.parkedCoach !== null) this.store.setState({ coach: this.parkedCoach });
    this.parkedCoach = null;
    this.publish();
  }

  /** Writes the `game` slice when something in it changed; the equity jobs follow the hand. */
  private publishGame(): void {
    const hand = this.hand;
    const legal = this.mode === 'heroTurn' && hand !== null ? this.legalOf(hand) : null;
    const heroBust = this.heroBust();
    const canUndo = this.undoBlocked() === null;
    const decisions = this.meta.decisions;
    const summary = this.summaryOffer();
    const g = this.store.getState().game;
    if (summary !== null && g.summary !== summary && hand !== null) {
      this.trace('summary offered', { handSeq: hand.handSeq, summary });
    }
    if (
      g.mode !== this.mode ||
      g.table !== this.table ||
      g.hand !== hand ||
      g.next !== this.next ||
      g.legal !== legal ||
      g.heroBust !== heroBust ||
      g.seatStats !== this.seatStats ||
      g.diag !== this.diag ||
      g.canUndo !== canUndo ||
      g.feedback !== this.feedback ||
      g.decisions !== decisions ||
      g.coachLevel !== this.latched ||
      g.summary !== summary
    ) {
      this.store.setState({
        game: {
          mode: this.mode,
          table: this.table,
          hand,
          next: this.next,
          legal,
          heroBust,
          seatStats: this.seatStats,
          diag: this.diag,
          canUndo,
          feedback: this.feedback,
          decisions,
          coachLevel: this.latched,
          summary,
        },
      });
    }
    // §14.5: a resumed decision's hint that was open opens again (the "Hint" tap, A.8 `showHint`).
    const reopen = this.reopenHint;
    if (
      reopen !== null &&
      this.mode === 'heroTurn' &&
      hand !== null &&
      coachKeyOf(hand) === reopen
    ) {
      this.reopenHint = null;
      this.store.getState().dispatch({ type: 'showHint' });
    }
    // After the game slice, so the equity slice never describes a hand the store does not have.
    this.equityJobs?.sync(this.headless ? null : hand, this.epoch);
    // The coach's hint for the hero's decision; null cancels it (§8.2, chunk 5.7).
    this.hintJobs?.sync(this.hintAsk(hand, legal));
  }

  /**
   * §14.7, §14.8: the tab mode, "Protected from automatic clean-up", Import's preview; §12.13,
   * §10.4: the install offer, the one-time install card, the level suggestion; §12.11: the
   * first-table tips seen.
   */
  private publishData(): void {
    const persisted = this.profile?.persistGranted ?? null;
    const install = this.install?.ready() === true;
    const nudge = this.nudge();
    const suggestion = this.suggestion();
    const tips = this.tips ? this.tipsSeen() : null;
    const data = this.store.getState().data;
    if (
      data.tab !== this.tab ||
      data.persisted !== persisted ||
      data.importCheck !== this.importCheck ||
      data.install !== install ||
      data.nudge !== nudge ||
      data.suggestion !== suggestion ||
      data.tips !== tips
    ) {
      this.store.setState({
        data: {
          tab: this.tab,
          persisted,
          importCheck: this.importCheck,
          install,
          nudge,
          suggestion,
          tips,
        },
      });
    }
  }

  /** The first-table tips seen (§12.11): the profile's flags, or the memory's without storage. */
  private tipsSeen(): Readonly<Record<string, boolean>> {
    return this.profile?.flags.tips ?? this.memoryTips;
  }

  /**
   * A first-table tip closed (§12.11, chunk 9.3: a tap, a key, Back, or the Table left): it is seen
   * and never shows again. `profile.flags.tips` is written at once, a few times in a player's life
   * (a profile write of its own, with the §14.3 `rev` check; no hand waits for it); a read-only
   * tab keeps it in memory.
   */
  private tipSeen(tip: TipId): void {
    if (!this.tips || this.tipsSeen()[tip] === true) return;
    this.trace('tip seen', tip);
    const profile = this.profile;
    if (profile === null) {
      this.memoryTips = { ...this.memoryTips, [tip]: true };
    } else {
      const flags = { ...profile.flags, tips: { ...profile.flags.tips, [tip]: true } };
      const next = { ...profile, flags };
      if (this.storage === null || this.tab !== 'writer') {
        this.profile = next;
      } else {
        const saved = saveProfile(this.storage, next, this.now());
        const result = saved.result;
        if (!result.ok && result.reason === 'conflict') {
          this.anotherWriter(profile.rev, result.storedRev);
          return;
        }
        if (!result.ok && result.reason === 'invalid') this.error('tip not saved', result.problem);
        this.profile = saved.profile;
      }
    }
    this.publish();
  }

  private ui(cmd: UiCommand): void {
    this.store.getState().dispatch(cmd);
  }

  private toast(t: NewToast): void {
    const id = ++this.toastSeq;
    const toast = { ...t, id } as Toast;
    updateUi(this.store, (ui) => ({ ...ui, toasts: [...ui.toasts, toast] }));
    const handle = this.timers.setTimeout(() => {
      this.toastTimers.delete(id);
      this.ui({ type: 'dismissToast', id });
    }, TIMING.toastMs);
    this.toastTimers.set(id, handle);
  }

  // -------------------------------------------------------------------------------------------
  // Logs

  private entry(what: string, detail?: unknown): ControllerEvent {
    const e: ControllerEvent = { at: this.timers.now(), epoch: this.epoch, what };
    if (detail !== undefined) e.detail = detail;
    return e;
  }

  private trace(what: string, detail?: unknown): void {
    push(this.events, this.entry(what, detail), RING.events);
  }

  private error(what: string, detail?: unknown): void {
    push(this.errors, this.entry(what, detail), RING.errors);
  }

  private brainLog(what: string, detail?: unknown): void {
    push(this.brainEvents, this.entry(what, detail), RING.brain);
  }

  /** An input or a table call the engine refused (§4.5): logged and counted, then ignored. */
  private refused(e: unknown, input: EngineInput | null): void {
    this.error('refused', { input, error: e instanceof Error ? e.message : String(e) });
    this.diag = { ...this.diag, engineErrors: this.diag.engineErrors + 1 };
  }

  /** A bot took the safest legal action instead of its own (§4.5, A.6). */
  private fallback(why: string, detail: unknown): void {
    this.error(why, detail);
    this.diag = { ...this.diag, botFallbacks: this.diag.botFallbacks + 1 };
  }
}

/** Creates the controller and registers it with the store (call `boot()` next). */
export function createTableController(options: ControllerOptions): TableController {
  return new TableController(options);
}
