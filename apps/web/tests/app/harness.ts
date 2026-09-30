/**
 * A TableController on its own store for tests, with Vitest's fake timers (the controller's default
 * timers call `globalThis.setTimeout` and `Date.now`, which `vi.useFakeTimers()` replaces).
 *
 * - `spyBrain` records every request the controller sends (the non-cheating checks read them);
 * - `manualBrain` holds every request until the test answers it (stale-reply tests);
 * - `heroPolicy` is a seeded "scripted hero" that picks random legal actions;
 * - `drive` plays until `hands` hands are complete, answering the hero's turns and reloads.
 */
import { vi } from 'vitest';
import { randInt, rngFromSeed, type Rng, type Seed128 } from '../../src/core/rng.ts';
import {
  createSimpleBrain,
  type BotDecisionRequest,
  type BrainClient,
  type BrainReply,
} from '../../src/app/brain.ts';
import {
  createTableController,
  type TableController,
  type Timers,
} from '../../src/app/controller.ts';
import {
  createAppStore,
  defaultGameSettings,
  type AppState,
  type AppStore,
  type Command,
  type Gate,
  type GameSettings,
} from '../../src/app/store.ts';
import { fixedSeeds } from '../../src/app/testHooks.ts';
import { simpleBotAction, simpleBotThinkMs } from '../../src/brain/simpleBot.ts';
import type { step } from '../../src/engine/step.ts';
import type { SafeStorage } from '../../src/persist/storage.ts';
import type { EquityClient } from '../../src/app/workerClient.ts';
import type { HandState, LegalActions, PlayerAction } from '../../src/engine/types.ts';

export const SEED: Seed128 = 'c0ffee00c0ffee00c0ffee00c0ffee00';

export interface Harness {
  store: AppStore;
  controller: TableController;
  dispatch(cmd: Command): void;
  state(): AppState;
}

export interface HarnessOptions {
  seed?: Seed128;
  settings?: Partial<GameSettings>;
  brain?: BrainClient;
  step?: typeof step;
  timers?: Timers;
  /** Chunk 3.2 storage: the controller loads at boot and saves as it plays. */
  storage?: SafeStorage;
  /** Chunk 4.5: equity.worker's client (a fake worker in tests). */
  equity?: EquityClient;
}

export function makeHarness(options: HarnessOptions = {}): Harness {
  const store = createAppStore();
  const settings = { ...defaultGameSettings(), ...options.settings };
  if (options.settings?.players !== undefined && options.settings.seatLevels === undefined) {
    settings.seatLevels = new Array(settings.players).fill(null);
  }
  store.setState({ settings });
  const controller = createTableController({
    store,
    brain: options.brain ?? createSimpleBrain(),
    heroName: 'You',
    seeds: fixedSeeds(options.seed ?? SEED),
    ...(options.step !== undefined && { step: options.step }),
    ...(options.timers !== undefined && { timers: options.timers }),
    ...(options.storage !== undefined && { storage: options.storage }),
    ...(options.equity !== undefined && { equity: options.equity }),
  });
  controller.boot();
  return {
    store,
    controller,
    dispatch: (cmd) => store.getState().dispatch(cmd),
    state: () => store.getState(),
  };
}

/** Lets promise callbacks (brain replies) run, without moving the fake clock. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/** Runs the next due timer (after letting pending replies land). */
export async function tick(): Promise<void> {
  await flush();
  vi.advanceTimersToNextTimer();
  await flush();
}

/** Moves the fake clock by `ms`, running every timer due on the way (and pending replies). */
export async function elapse(ms: number): Promise<void> {
  await flush();
  await vi.advanceTimersByTimeAsync(ms);
  await flush();
}

export interface SpyBrain extends BrainClient {
  requests: BotDecisionRequest[];
  cancelled: number[];
}

/** SimpleBot, recording every request (and calling `onRequest` synchronously with it). */
export function spyBrain(onRequest?: (req: BotDecisionRequest) => void): SpyBrain {
  const inner = createSimpleBrain();
  const brain: SpyBrain = {
    requests: [],
    cancelled: [],
    request(req) {
      brain.requests.push(req);
      onRequest?.(req);
      return inner.request(req);
    },
    cancel(jobId) {
      brain.cancelled.push(jobId);
    },
  };
  return brain;
}

export interface ManualBrain extends BrainClient {
  pending: Map<number, { req: BotDecisionRequest; resolve: (reply: BrainReply) => void }>;
  cancelled: number[];
  /** Answers one job (SimpleBot's own answer unless `reply` is given). */
  answer(jobId: number, reply?: Partial<BrainReply>): void;
  /** Answers every pending job. */
  answerAll(): void;
}

/** A brain that answers only when the test says so. */
export function manualBrain(): ManualBrain {
  const brain: ManualBrain = {
    pending: new Map(),
    cancelled: [],
    request(req) {
      return new Promise((resolve) => brain.pending.set(req.jobId, { req, resolve }));
    },
    cancel(jobId) {
      brain.cancelled.push(jobId);
    },
    answer(jobId, reply) {
      const job = brain.pending.get(jobId);
      if (job === undefined) throw new Error(`no pending job ${jobId}`);
      brain.pending.delete(jobId);
      const action = simpleBotAction(job.req.obs);
      job.resolve({
        kind: 'botDecision',
        jobId,
        epoch: job.req.epoch,
        decision: { action },
        thinkMs: simpleBotThinkMs(job.req.obs, action, job.req.seed),
        ...reply,
      } as BrainReply);
    },
    answerAll() {
      for (const jobId of [...brain.pending.keys()]) brain.answer(jobId);
    },
  };
  return brain;
}

/** A seeded scripted hero: folds sometimes, calls or checks often, bets and raises random sizes. */
export function heroPolicy(seed: Seed128): (legal: LegalActions) => PlayerAction {
  const rng: Rng = rngFromSeed(seed);
  const pick = (b: { min: number; max: number }): number => b.min + randInt(rng, b.max - b.min + 1);
  return (legal) => {
    const r = randInt(rng, 100);
    if (r < 15 && legal.canFold) return { type: 'fold' };
    if (r < 70) return legal.canCheck ? { type: 'check' } : { type: 'call' };
    if (legal.bet !== null) return { type: 'bet', to: pick(legal.bet) };
    if (legal.raise !== null) return { type: 'raise', to: pick(legal.raise) };
    return legal.canCheck ? { type: 'check' } : { type: 'call' };
  };
}

export interface DriveOptions {
  hands: number;
  hero: (legal: LegalActions) => PlayerAction;
  /** Called before every step of the loop (tests toggle gates here). */
  beforeStep?: (i: number) => void;
  /** Called with every completed hand, as soon as it is complete. */
  onComplete?: (hand: HandState, inputs: ReturnType<TableController['snapshot']>['inputs']) => void;
}

/** Plays until `hands` more hands are complete. Returns them in order. */
export async function drive(h: Harness, options: DriveOptions): Promise<HandState[]> {
  const done: HandState[] = [];
  const seen = new Set<number>();
  const unsubscribe = h.store.subscribe((s) => {
    const hand = s.game.hand;
    if (hand !== null && hand.phase === 'complete' && !seen.has(hand.handSeq)) {
      seen.add(hand.handSeq);
      done.push(hand);
      options.onComplete?.(hand, h.controller.snapshot().inputs);
    }
  });
  try {
    for (let i = 0; done.length < options.hands; i++) {
      if (i > options.hands * 400) throw new Error(`drive: stuck after ${done.length} hands`);
      options.beforeStep?.(i);
      const s = h.state();
      if (s.game.mode === 'heroTurn' && s.game.legal !== null) {
        h.dispatch({ type: 'act', action: options.hero(s.game.legal) });
        continue;
      }
      if (s.ui.overlays.includes('outOfChips')) {
        h.dispatch({ type: 'reload' });
        continue;
      }
      await tick();
    }
  } finally {
    unsubscribe();
  }
  return done;
}

/** Opens or closes `gate` the way the app does (screen, overlay, visibility or an explicit hold). */
export function setGate(h: Harness, gate: Gate, closed: boolean): void {
  switch (gate) {
    case 'hidden':
      h.dispatch({ type: 'visibility', hidden: closed });
      return;
    case 'offTable':
      h.dispatch({ type: 'go', screen: closed ? 'home' : 'table' });
      return;
    case 'menu':
    case 'feedback':
    case 'quiz':
    case 'tip':
      h.dispatch({ type: closed ? 'open' : 'close', overlay: gate });
      return;
    case 'sheet':
      h.dispatch({ type: closed ? 'open' : 'close', overlay: 'rankings' });
      return;
    case 'dialog':
      h.dispatch({ type: closed ? 'open' : 'close', overlay: 'newTable' });
      return;
  }
}
