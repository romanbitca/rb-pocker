/**
 * The TableController (PLAN §2.3, Appendix A.8): it deals every hand, asks the bots, applies every
 * engine input, pauses before new cards, ends the hand and starts the next one. It is the only
 * code that uses timers (§0.3 "Time"), and the only writer of the store's `game` slice.
 *
 * One hand (§2.3):
 * - `startHand` → 'betting'. A bot's turn: `observe(state, seat)` → the brain's `botDecision`
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
 */
import { EngineError } from '../core/assert.ts';
import { deriveSeed, randomSeed, type Seed128 } from '../core/rng.ts';
import { legalActions } from '../engine/legal.ts';
import { observe } from '../engine/observe.ts';
import { startHand } from '../engine/start.ts';
import { step } from '../engine/step.ts';
import { createTable, initialSlots, nextTable, topUp } from '../engine/table.ts';
import type {
  BotLevel,
  EngineInput,
  HandState,
  LegalActions,
  ObserveExtras,
  PlayerAction,
  ReplayRecord,
  TableConfig,
  TableState,
} from '../engine/types.ts';
import type { BotDecisionRequest, BotProfileRef, BrainClient, BrainReply } from './brain.ts';
import {
  updateUi,
  type AppStore,
  type ControllerMode,
  type Diagnostics,
  type GameCommand,
  type GameSettings,
  type Speed,
  type Toast,
  type UiCommand,
} from './store.ts';

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
  botTimeoutMs: 2000,
  /** How long a toast stays (§12.11). */
  toastMs: 4000,
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

/** The clock and timers the controller uses (tests use Vitest's fake timers through the defaults). */
export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

const defaultTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

export interface ControllerOptions {
  store: AppStore;
  brain: BrainClient;
  /** The hero's name, from `en.ts` (the hero is always "You", Appendix F.10). */
  heroName: string;
  seeds?: SeedSource;
  timers?: Timers;
  /** The reducer (tests only: a failing one exercises the void path). */
  step?: typeof step;
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
  /** Brain requests, replies, drops and cancels: the "worker log" (last 200). */
  brain: ControllerEvent[];
  /** Replay records of the last 5 voided hands (§4.5; Stage 8 stores them under `pc.v1.diag`). */
  voided: ReplayRecord[];
}

/** What the controller holds, for tests and (chunk 3.2) the session. Arrays are copies. */
export interface ControllerSnapshot {
  epoch: number;
  mode: ControllerMode;
  table: TableState | null;
  hand: HandState | null;
  next: TableState | null;
  inputs: EngineInput[];
}

type FlowKind = 'act' | 'advance' | 'nextHand';

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
  timeout: unknown;
}

type NewToast = { kind: 'botsJoined'; names: string[] } | { kind: 'handVoided' };

const RING = { events: 500, errors: 50, brain: 200, voided: 5 } as const;

function push<T>(ring: T[], item: T, max: number): void {
  ring.push(item);
  if (ring.length > max) ring.splice(0, ring.length - max);
}

/** Only the settings fields we know, with the types they must have (commands may come from tests). */
function sanitize(current: GameSettings, patch: Partial<GameSettings>): GameSettings {
  const next: GameSettings = { ...current, seatLevels: [...current.seatLevels] };
  const target = next as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (!Object.hasOwn(current, key)) continue;
    const old = (current as unknown as Record<string, unknown>)[key];
    if (Array.isArray(old) ? Array.isArray(value) : typeof value === typeof old)
      target[key] = value;
  }
  return next;
}

export class TableController {
  private readonly store: AppStore;
  private readonly brain: BrainClient;
  private readonly heroName: string;
  private readonly seeds: SeedSource;
  private readonly timers: Timers;
  private readonly stepFn: typeof step;
  private readonly unsubscribe: () => void;

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
  private jobSeq = 0;
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
  private readonly events: ControllerEvent[] = [];
  private readonly errors: ControllerEvent[] = [];
  private readonly brainEvents: ControllerEvent[] = [];
  private readonly voided: ReplayRecord[] = [];

  constructor(options: ControllerOptions) {
    this.store = options.store;
    this.brain = options.brain;
    this.heroName = options.heroName;
    this.seeds = options.seeds ?? randomSeeds();
    this.timers = options.timers ?? defaultTimers;
    this.stepFn = options.step ?? step;
    this.unsubscribe = this.store.subscribe((s, prev) => {
      if (s.ui.gates !== prev.ui.gates) this.onGates();
    });
    this.store.setGameHandler((cmd) => this.dispatch(cmd));
  }

  /** Boot is done (chunk 3.2 reads the profile and session first): ready for Play. */
  boot(): void {
    if (this.mode === 'booting') this.mode = 'idle';
    this.publish();
  }

  /** Handles one game command (the store's `dispatch` sends them here). */
  dispatch(cmd: GameCommand): void {
    switch (cmd.type) {
      case 'play':
        this.play();
        break;
      case 'newTable':
        void this.newTable(cmd.setup);
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
        this.ui({ type: 'navigate', screen: 'home', how: 'reset' });
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
        // Chunk 3.2 flushes storage here (§12.13, §14.6).
        this.trace('pagehide');
        break;
      default:
        this.trace('unknown command', cmd);
    }
    this.publish();
  }

  /** Stops every timer and unhooks from the store. */
  dispose(): void {
    this.bumpEpoch();
    this.unsubscribe();
    this.store.setGameHandler(null);
    if (this.visibleTimer !== null) this.timers.clearTimeout(this.visibleTimer);
    this.visibleTimer = null;
    for (const handle of this.toastTimers.values()) this.timers.clearTimeout(handle);
    this.toastTimers.clear();
  }

  snapshot(): ControllerSnapshot {
    return {
      epoch: this.epoch,
      mode: this.mode,
      table: this.table,
      hand: this.hand,
      next: this.next,
      inputs: [...this.inputs],
    };
  }

  logs(): ControllerLogs {
    return {
      events: [...this.events],
      errors: [...this.errors],
      brain: [...this.brainEvents],
      voided: [...this.voided],
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
      this.startHandAt(table);
    } else if (this.heroBust()) {
      this.navigateToTable();
      this.ui({ type: 'openOverlay', overlay: 'outOfChips' });
      return;
    } else if (this.hand === null) {
      this.startHandAt((this.next ?? this.table) as TableState);
    }
    this.navigateToTable();
  }

  /** §3.1, §12.2: a new table from the settings; an unfinished hand is folded and finished first. */
  private async newTable(setup: Partial<GameSettings> | undefined): Promise<void> {
    if (this.mode === 'booting') return;
    const token = ++this.newTableSeq;
    if (setup !== undefined) this.store.setState({ settings: sanitize(this.settings(), setup) });
    const table = this.buildTable();
    if (table === null) return;
    if (this.hand !== null && this.hand.phase !== 'complete') {
      await this.finishHeadless();
      if (token !== this.newTableSeq) return;
    }
    // Stage 8 commits the finished hand here (§14.3) and ends the session (§14.4).
    this.closeTable();
    this.startHandAt(table);
    this.navigateToTable();
    this.publish();
  }

  /** The hero's action (§2.3): only on the hero's turn; the engine checks it is legal. */
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
    // Stage 6 takes the undo snapshot before this act and enters 'grading' here (§11.3 r1, r5).
    this.commit(next, input);
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
    this.ui({ type: 'closeOverlay', overlay: 'outOfChips' });
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
  }

  /** Out of chips → Change table (§3.1): Setup; the old table's session ends. */
  private changeTable(): void {
    if (this.hand !== null && this.hand.phase !== 'complete') {
      this.trace('change table ignored: a hand is being played');
      return;
    }
    // Chunk 3.2 clears the saved session here.
    this.closeTable();
    this.ui({ type: 'navigate', screen: 'setup', how: 'replace' });
  }

  private changeSettings(patch: Partial<GameSettings>): void {
    const settings = sanitize(this.settings(), patch);
    this.store.setState({ settings });
    // Chunk 3.2 saves the settings (debounced 250 ms, §14.2).
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
      // Chunk 3.2 flushes storage here.
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
    switch (h.phase) {
      case 'betting': {
        const seat = h.toAct as number;
        if (seat === HERO) {
          this.mode = 'heroTurn';
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

  /** Deals the next hand at `table` (§2.3 `startNextHand`). */
  private startHandAt(table: TableState): void {
    this.bumpEpoch();
    const t =
      table.nextHandSeq < this.handSeqFloor ? { ...table, nextHandSeq: this.handSeqFloor } : table;
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
    this.trace('hand start', {
      handSeq: hand.handSeq,
      button: hand.button,
      seats: hand.seats.length,
    });
    // Chunk 3.2 saves the session here (after every step, §14.5).
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
      next = nextTable(table, h);
    } catch (e) {
      this.voidHand(e, null);
      return;
    }
    this.newcomers = next.slots
      .filter((slot, i) => slot.playerId !== table.slots[i]?.playerId)
      .map((slot) => slot.name);
    this.next = next;
    this.mode = 'handEnd';
    this.trace('hand end', { handSeq: h.handSeq, net: h.result?.net ?? null });
    // Stage 8 commits the hand here (§14.3); chunk 3.2 saves the session as { table: next, hand: null }.
  }

  /** After the hand-end pause: the next hand, or the out-of-chips dialog (§3.1). */
  private continueToNextHand(): void {
    const next = this.next;
    if (next === null) return;
    if ((next.slots[HERO]?.stack ?? 0) === 0) {
      this.mode = 'idle';
      this.trace('hero out of chips');
      this.ui({ type: 'openOverlay', overlay: 'outOfChips' });
      return;
    }
    this.startHandAt(next);
  }

  private requestBot(h: HandState, seat: number): void {
    const req = this.botRequest(h, seat);
    const job: BotJob = {
      jobId: req.jobId,
      epoch: this.epoch,
      seat,
      sentAt: this.timers.now(),
      timeout: null,
    };
    this.job = job;
    job.timeout = this.timers.setTimeout(() => this.onBotTimeout(job), TIMING.botTimeoutMs);
    void this.send(req).then((reply) => this.onBotReply(job, reply));
  }

  /** The request for `seat`'s decision: its observation, its profile and the table-only seed. */
  private botRequest(h: HandState, seat: number): BotDecisionRequest {
    const table = this.table as TableState;
    const jobId = ++this.jobSeq;
    this.brainLog('request', { jobId, seat, handSeq: h.handSeq, logLength: h.log.length });
    return {
      kind: 'botDecision',
      jobId,
      epoch: this.epoch,
      obs: observe(h, seat, this.extras(table)),
      profile: this.profileOf(table, seat),
      seed: botSeed(table.tableSeed, h.handSeq, seat, h.log.length),
    };
  }

  /** The brain's reply as a promise that never rejects (a throw becomes an `error` reply). */
  private send(req: BotDecisionRequest): Promise<BrainReply> {
    const failed = (e: unknown): BrainReply => ({
      kind: 'error',
      jobId: req.jobId,
      epoch: req.epoch,
      message: e instanceof Error ? e.message : String(e),
    });
    try {
      return this.brain.request(req).catch(failed);
    } catch (e) {
      return Promise.resolve(failed(e));
    }
  }

  private onBotReply(job: BotJob, reply: BrainReply): void {
    if (
      this.job !== job ||
      job.epoch !== this.epoch ||
      reply.jobId !== job.jobId ||
      reply.epoch !== job.epoch
    ) {
      this.brainLog('drop', { jobId: reply.jobId, epoch: reply.epoch, current: this.epoch });
      return;
    }
    this.timers.clearTimeout(job.timeout);
    this.job = null;
    let action: PlayerAction | null = null;
    let thinkMs = 0;
    if (reply.kind === 'botDecision') {
      action = reply.decision.action;
      thinkMs = Number.isFinite(reply.thinkMs) ? Math.max(0, reply.thinkMs) : 0;
      this.brainLog('reply', { jobId: reply.jobId, seat: job.seat, action, thinkMs });
    } else {
      this.fallback('brain error', { jobId: reply.jobId, seat: job.seat, message: reply.message });
    }
    this.schedule('act', this.botWaitMs(thinkMs, job.sentAt), () =>
      this.applyBot(job.seat, action),
    );
    this.publish();
  }

  private onBotTimeout(job: BotJob): void {
    if (this.job !== job || job.epoch !== this.epoch) return;
    this.job = null;
    this.brain.cancel(job.jobId);
    this.fallback('bot timeout', { jobId: job.jobId, seat: job.seat });
    this.schedule('act', this.botWaitMs(0, job.sentAt), () => this.applyBot(job.seat, null));
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
    // Chunk 3.2 saves the session here, after every step (§14.5).
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
          if (epoch !== this.epoch || this.hand !== h) return;
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
    const req = this.botRequest(h, seat);
    return new Promise((resolve) => {
      let done = false;
      const finish = (action: PlayerAction | null, why: string): void => {
        if (done) return;
        done = true;
        this.timers.clearTimeout(timeout);
        if (action === null) this.fallback(why, { jobId: req.jobId, seat });
        resolve(action ?? safestAction(legal));
      };
      const timeout = this.timers.setTimeout(() => {
        this.brain.cancel(req.jobId);
        finish(null, 'bot timeout');
      }, TIMING.botTimeoutMs);
      void this.send(req).then((reply) =>
        finish(reply.kind === 'botDecision' ? reply.decision.action : null, 'brain error'),
      );
    });
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
    this.timers.clearTimeout(job.timeout);
    this.brain.cancel(job.jobId);
    this.brainLog('cancel', { jobId: job.jobId, seat: job.seat });
  }

  /** A new epoch: every pending timer and brain reply of the old one is now stale. */
  private bumpEpoch(): void {
    this.epoch++;
    this.cancelFlow();
    this.cancelJob();
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
  }

  // -------------------------------------------------------------------------------------------
  // Helpers

  private settings(): GameSettings {
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

  private navigateToTable(): void {
    const from = this.store.getState().ui.screen;
    this.ui({ type: 'navigate', screen: 'table', how: from === 'setup' ? 'replace' : 'push' });
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

  private profileOf(table: TableState, seat: number): BotProfileRef {
    const slot = table.slots[seat];
    const level = table.config.seatLevels[seat] ?? table.config.botLevel;
    return { id: `${slot?.personality ?? 'unknown'}/${level}` };
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

  /** Writes the `game` slice when something in it changed. */
  private publish(): void {
    const hand = this.hand;
    const legal = this.mode === 'heroTurn' && hand !== null ? this.legalOf(hand) : null;
    const heroBust = this.heroBust();
    const g = this.store.getState().game;
    if (
      g.mode === this.mode &&
      g.table === this.table &&
      g.hand === hand &&
      g.next === this.next &&
      g.legal === legal &&
      g.heroBust === heroBust &&
      g.diag === this.diag
    ) {
      return;
    }
    this.store.setState({
      game: {
        mode: this.mode,
        table: this.table,
        hand,
        next: this.next,
        legal,
        heroBust,
        diag: this.diag,
      },
    });
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
