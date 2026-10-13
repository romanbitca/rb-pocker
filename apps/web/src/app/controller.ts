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
 */
import { EngineError } from '../core/assert.ts';
import { deriveSeed, randomSeed, type Seed128 } from '../core/rng.ts';
import { legalActions } from '../engine/legal.ts';
import { observe } from '../engine/observe.ts';
import { startHand } from '../engine/start.ts';
import { step } from '../engine/step.ts';
import { createTable, initialSlots, nextTable, topUp, withLevels } from '../engine/table.ts';
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
  type TableConfig,
  type TableState,
} from '../engine/types.ts';
import { loadProfile, saveSettings } from '../persist/profile.ts';
import { emptyHandMeta, settingsProblem } from '../persist/schema.ts';
import type {
  DecisionRecord,
  HandMeta,
  Profile,
  SessionState,
  Settings,
  UndoSnapshot,
} from '../persist/schema.ts';
import { clearSession, loadSession, saveSession } from '../persist/session.ts';
import type { SafeStorage } from '../persist/storage.ts';
import { profileFor } from '../brain/profiles.ts';
import type { BrainProfile, GradeResult } from '../brain/types.ts';
import type { BrainReply, BrainRequest } from '../workers/protocol.ts';
import { EquityJobs } from './equityJobs.ts';
import { coachKeyOf, finalHudEquity, HintJobs, type HintAsk } from './hintJobs.ts';
import {
  GRADE_ATTEMPTS,
  GRADE_PAUSE_MS,
  type GradeAsk,
  type Grader,
  type GradeOutcome,
} from './grading.ts';
import { addHand, type ReviewHand } from './review.ts';
import { handEndViewOf } from './tableViews.ts';
import {
  updateUi,
  type AppStore,
  type ControllerMode,
  type Diagnostics,
  type GameCommand,
  type Speed,
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
  /** Next hand after 3 s or on tap (§12.8); never under 1 s, so the result can be read. */
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
   * The grade port (§11.3 r5, chunk 6.2, `app/grading.ts`): every hero decision is graded through
   * it (the app: `brainGrader(brain)`). Without it (tests) every decision is recorded at once with
   * `grade: null`, like a grade that failed: nothing waits or pauses, and Undo is there at once.
   */
  grader?: Grader | null;
}

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
  /** Replay records of the last 5 voided hands (§4.5; Stage 8 stores them under `pc.v1.diag`). */
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
  | { kind: 'undone' };

const RING = { events: 500, errors: 50, brain: 200, voided: 5 } as const;

function push<T>(ring: T[], item: T, max: number): void {
  ring.push(item);
  if (ring.length > max) ring.splice(0, ring.length - max);
}

/**
 * `current` with `patch` applied, or `current` itself when the result would not be valid
 * settings (`settingsProblem`, A.7): only known fields, and `seatLevels` resized to one entry per
 * seat with the hero's null (the stored settings need `seatLevels.length === players`).
 */
export function sanitize(current: Settings, patch: Partial<Settings>): Settings {
  const next: Settings = { ...current, seatLevels: [...current.seatLevels] };
  const target = next as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (!Object.hasOwn(current, key) || key === 'schema') continue;
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
  /** The stored profile (settings only in Stage 3); null without storage. */
  private profile: Profile | null = null;
  /** When this table's session began (§14.4); stored in the session. */
  private sessionStart: string | null = null;
  private settingsTimer: unknown = null;
  /** Setup's values while the §3.1 question is open (the 'newTable' dialog). */
  private pendingSetup: Partial<Settings> | null = null;
  private settingsSeq = 0;
  private settingsDirty = false;

  private epoch = 0;
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
    this.unsubscribe = this.store.subscribe((s, prev) => {
      if (s.ui.nav !== prev.ui.nav) this.onNav(s.ui, prev.ui);
      if (s.ui.gates !== prev.ui.gates) this.onGates();
    });
    this.store.setGameHandler((cmd) => this.dispatch(cmd));
  }

  /**
   * Boot (§12.14): with storage, reads the profile (its settings; Welcome on the first launch, else
   * Home) and the saved session (§14.5: Home's Play continues it; a hand that cannot be restored is
   * voided with its chips returned, §14.3). Then ready for Play.
   */
  boot(): void {
    if (this.mode !== 'booting') return;
    const storage = this.storage;
    if (storage !== null) {
      storage.onFailure(() => updateUi(this.store, (ui) => ({ ...ui, storageBanner: true })));
      const now = this.now();
      const loaded = loadProfile(storage, { now });
      this.profile = loaded.profile;
      this.store.setState({ settings: sanitize(loaded.profile.settings, {}) });
      if (loaded.status === 'reset') {
        this.error('profile reset', loaded.problem);
        this.toast({ kind: 'dataRecovered' });
      }
      const first = loaded.status === 'new' || loaded.status === 'unavailable';
      this.ui({ type: 'go', screen: first ? 'welcome' : 'home' });
      const session = loadSession(storage, { engineVersion: ENGINE_VERSION, now });
      if (session.status === 'ok' || session.status === 'voided') this.resume(session.session);
      if (session.status === 'voided') {
        this.error('session hand voided', session.problem);
        this.toast({ kind: 'handNotRestored' });
      } else if (session.status === 'discarded') {
        this.error('session discarded', session.problem);
      }
    }
    this.mode = 'idle';
    this.publish();
  }

  /** Handles one game command (the store's `dispatch` sends them here). */
  dispatch(cmd: GameCommand): void {
    switch (cmd.type) {
      case 'play':
        this.play();
        break;
      case 'newTable':
        void this.newTable(cmd.setup, cmd.confirmed === true);
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
        this.ui({ type: 'go', screen: 'home' });
        break;
      case 'changeTable':
        this.changeTable();
        break;
      case 'settings':
        this.changeSettings(cmd.patch);
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
      default:
        this.trace('unknown command', cmd);
    }
    this.publish();
  }

  /** Stops every timer and unhooks from the store. */
  dispose(): void {
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
      await this.finishHeadless();
      if (token !== this.newTableSeq) return;
    }
    // Stage 8 commits the finished hand here (§14.3) and ends the session (§14.4).
    this.closeTable();
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
    this.saveSession();
  }

  /** Out of chips → Change table (§3.1): Setup; the old table's session ends. */
  private changeTable(): void {
    if (this.hand !== null && this.hand.phase !== 'complete') {
      this.trace('change table ignored: a hand is being played');
      return;
    }
    this.closeTable();
    this.sessionStart = null;
    if (this.storage !== null) clearSession(this.storage); // §3.1: the old table's session ends
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

  /** Deals the next hand at `table` (§2.3 `startNextHand`), at the bot level the settings name now. */
  private startHandAt(table: TableState): void {
    this.bumpEpoch();
    const levelled = this.withSettingsLevel(table);
    const t =
      levelled.nextHandSeq < this.handSeqFloor
        ? { ...levelled, nextHandSeq: this.handSeqFloor }
        : levelled;
    let hand: HandState;
    try {
      hand = startHand(t, this.seeds.handSeed(t.nextHandSeq));
    } catch (e) {
      this.error('cannot deal', e);
      this.mode = 'idle';
      return;
    }
    this.table = t;
    this.hand = hand;
    this.next = null;
    this.inputs = [];
    this.revealShown = false;
    this.handSeqFloor = Math.max(this.handSeqFloor, hand.handSeq + 1);
    this.dealUntil = this.timers.now() + this.dealMs(hand);
    this.resetDecisions();
    this.ensureSnapshot(hand);
    this.trace('hand start', {
      handSeq: hand.handSeq,
      button: hand.button,
      seats: hand.seats.length,
    });
    this.saveSession();
    if (this.newcomers.length > 0) {
      this.toast({ kind: 'botsJoined', names: this.newcomers });
      this.newcomers = [];
    }
    this.pump();
    this.publish();
  }

  /** The hand is complete: the next table (§3.1 bot replacement), then the hand-end pause. */
  private finishHand(h: HandState): void {
    const table = this.table as TableState;
    let next: TableState;
    try {
      // The bots that sit down for the next hand are picked at the level it will be played at.
      next = nextTable(this.withSettingsLevel(table), h);
    } catch (e) {
      this.voidHand(e, null);
      return;
    }
    this.newcomers = next.slots
      .filter((slot, i) => slot.playerId !== table.slots[i]?.playerId)
      .map((slot) => slot.name);
    this.next = next;
    this.mode = 'handEnd';
    this.remember(h);
    this.trace('hand end', { handSeq: h.handSeq, net: h.result?.net ?? null });
    // Stage 8 commits the hand first (§14.3 steps 1–4); step 5: the session moves to the next table.
    this.saveSession();
  }

  /**
   * Keeps the finished hand for Review (§12.10, "from memory" until Stage 8): its replay record,
   * the hero's cards and the result the banner shows. A hand finished without animation (a new
   * table mid-hand, §3.1) and a voided hand are not kept: nobody played them out.
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
    }
    this.diag = { ...this.diag, voidedHands: this.diag.voidedHands + 1 };
    this.toast({ kind: 'handVoided' });
    this.closeTable();
    if (table === null) return;
    this.startHandAt({ ...table, nextHandSeq: Math.max(table.nextHandSeq + 1, this.handSeqFloor) });
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
          // Stage 8 commits this hand (§3.1: "commits it, and closes the table").
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

  /** What a hero decision at `h` is, before the act changes anything (§8.2: the HUD's number). */
  private decisionAt(h: HandState, action: PlayerAction): PendingGrade {
    const level = this.settings().coachLevel;
    const decisionId = heroDecisionsTaken(h);
    const hud = hudEquityAt(this.store.getState().equity, h);
    return {
      epoch: this.epoch,
      // Only an Observation crosses to the worker (§4.8).
      ask: {
        obs: observe(h, HERO, this.extras(this.table as TableState)),
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
        // §10.2: the hint is always on show at Beginner; above it, the player opened it.
        hintSeen: level === 'beginner' || this.meta.hintShown[decisionId] === true,
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
    // the §12.6 chip's, not built yet).
    this.saveSession();
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
    this.feedback = feedbackView(result, g.decision, this.undoBlocked(true) === null);
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
    if (this.hold !== 'feedback' || ui.overlays.includes('feedback')) return;
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
    this.closeFeedbackOverlay();
  }

  /**
   * After a reload (§11.3 r7): the snapshot and the records come back from the session. A grade
   * that was on its way when the page went is asked again, as a late one (no pause: the feedback
   * card does not come back after a reload; the toolbar Undo still works where rule 2 holds).
   */
  private resumeDecision(): void {
    const h = this.hand;
    const snap = this.undoSnapshot;
    if (h === null || snap === null || h.phase === 'complete') return;
    if (snap.state.handSeq !== h.handSeq || heroDecisionsTaken(h) !== snap.decisionId + 1) return;
    const act = this.inputs[snap.inputCount];
    if (act?.kind !== 'act' || act.seat !== HERO) return;
    if (standingRecord(this.meta, snap.decisionId) !== null) return;
    const g = this.decisionAt(snap.state, act.action);
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

  /** A saved session back in play (§14.5): exactly its table, hand and inputs. */
  private resume(session: SessionState): void {
    this.sessionStart = session.sessionStart;
    if (session.hand === null) {
      this.table = null;
      this.hand = null;
      this.next = session.table;
      this.inputs = [];
    } else {
      this.table = session.table;
      this.hand = session.hand;
      this.next = null;
      this.inputs = [...session.handInputs];
      this.meta = session.meta;
      this.undoSnapshot = session.undoSnapshot;
      this.resumeDecision();
    }
    const t = session.table;
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
   * `pc.v1.session` (§14.5, A.7), after every step: the table as at hand start with the hand and its
   * inputs; between hands (after `nextTable`) the next hand's table and no hand. `savedAt` is now.
   */
  private saveSession(): void {
    if (this.storage === null || this.headless) return;
    const withHand = this.hand !== null && this.next === null;
    const table = withHand ? this.table : (this.next ?? this.table);
    if (table === null) return;
    const now = this.now().toISOString();
    const session: SessionState = {
      schema: 1,
      savedAt: now,
      sessionStart: this.sessionStart ?? now,
      table,
      hand: withHand ? this.hand : null,
      handInputs: withHand ? this.inputs : [],
      meta: withHand ? this.meta : emptyHandMeta(),
      undoSnapshot: withHand ? this.undoSnapshot : null,
      seatStats: table.slots.map(() => null),
      resumeAfterUpdate: false,
    };
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
    if (this.storage === null || this.profile === null || !this.settingsDirty) return;
    const saved = saveSettings(this.storage, this.profile, this.settings(), this.now());
    this.profile = saved.profile;
    this.settingsDirty = false;
    if (!saved.result.ok && saved.result.reason === 'invalid') {
      this.error('settings not saved', saved.result.problem);
    }
  }

  /** Forgets the table and its hand (a new table, Change table, a voided hand). */
  private closeTable(): void {
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
      const tableSeed = this.seeds.tableSeed();
      return createTable(cfg, initialSlots(cfg, tableSeed, this.heroName), tableSeed);
    } catch (e) {
      this.refused(e, null);
      return null;
    }
  }

  /**
   * §10: a bot level chosen in Settings starts with the next hand. `table` keeps its seated bots
   * (names, personalities, stacks) and its per-seat overrides and gets the settings' table level;
   * the hand dealt from it reads that level for its pods' labels and its bots' profiles. A hand
   * that is already being played is not touched: its table is the one it was dealt from.
   */
  private withSettingsLevel(table: TableState): TableState {
    const level = this.settings().botLevel;
    if (table.config.botLevel === level) return table;
    try {
      return withLevels(table, level, table.config.seatLevels);
    } catch (e) {
      this.refused(e, null);
      return table;
    }
  }

  /** The Table, over Home (app/navigation.ts: Back from the Table goes Home). */
  private navigateToTable(): void {
    this.ui({ type: 'go', screen: 'table' });
  }

  /** What `observe` adds for the brain (§4.8, A.4). Stage 5 fills the seat statistics (§9.5). */
  private extras(table: TableState): ObserveExtras {
    const levels = table.slots.map((_, i) => table.config.seatLevels[i] ?? table.config.botLevel);
    return {
      seatStats: table.slots.map(() => null),
      visiblePersonality: table.slots.map((slot, i) =>
        slot.kind === 'bot' && (levels[i] === 'easy' || levels[i] === 'medium')
          ? slot.personality
          : null,
      ),
      seatLevels: levels,
    };
  }

  /** The seat's brain profile (§9.1 × §9.2): its personality at its effective level. */
  private profileOf(table: TableState, seat: number): BrainProfile {
    const level = table.config.seatLevels[seat] ?? table.config.botLevel;
    return profileFor(table.slots[seat]?.personality ?? 'tag', level);
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
    return {
      key: coachKeyOf(hand),
      epoch: this.epoch,
      build: () => ({
        obs: observe(hand, HERO, this.extras(table)),
        eRandom: finalHudEquity(this.store.getState().equity, hand),
      }),
    };
  }

  /** The replay record of the current hand so far (§4.7): its table as at hand start and its inputs. */
  private record(h: HandState): ReplayRecord {
    return {
      engineVersion: h.engineVersion,
      seed: h.seed,
      commit: null,
      table: this.table as TableState,
      inputs: [...this.inputs],
    };
  }

  private legalOf(h: HandState): LegalActions | null {
    if (this.legalCache?.hand !== h) this.legalCache = { hand: h, legal: legalActions(h) };
    return this.legalCache.legal;
  }

  /** Writes the `game` slice when something in it changed; the equity jobs follow the hand. */
  private publish(): void {
    const hand = this.hand;
    const legal = this.mode === 'heroTurn' && hand !== null ? this.legalOf(hand) : null;
    const heroBust = this.heroBust();
    const canUndo = this.undoBlocked() === null;
    const decisions = this.meta.decisions;
    const g = this.store.getState().game;
    if (
      g.mode !== this.mode ||
      g.table !== this.table ||
      g.hand !== hand ||
      g.next !== this.next ||
      g.legal !== legal ||
      g.heroBust !== heroBust ||
      g.diag !== this.diag ||
      g.canUndo !== canUndo ||
      g.feedback !== this.feedback ||
      g.decisions !== decisions
    ) {
      this.store.setState({
        game: {
          mode: this.mode,
          table: this.table,
          hand,
          next: this.next,
          legal,
          heroBust,
          diag: this.diag,
          canUndo,
          feedback: this.feedback,
          decisions,
        },
      });
    }
    // After the game slice, so the equity slice never describes a hand the store does not have.
    this.equityJobs?.sync(this.headless ? null : hand, this.epoch);
    // The coach's hint for the hero's decision; null cancels it (§8.2, chunk 5.7).
    this.hintJobs?.sync(this.hintAsk(hand, legal));
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
