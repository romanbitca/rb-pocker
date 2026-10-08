/**
 * A TableController on its own store for tests, with Vitest's fake timers (the controller's default
 * timers call `globalThis.setTimeout` and `Date.now`, which `vi.useFakeTimers()` replaces).
 *
 * - the bots' brain is a real `WorkerClient` over a fake `brain.worker` (`tests/workers/`) that runs
 *   the production job runner with SimpleBot as its brain (`testBrain`, `simpleDecide`);
 * - `spyBrain` records every message the controller posts to it (the non-cheating checks read them);
 * - `manualBrain` holds every request until the test answers it (stale-reply, timeout and crash tests);
 * - `scriptedBrain` answers with a chosen action and a fixed think time;
 * - `heroPolicy` is a seeded "scripted hero" that picks random legal actions;
 * - `drive` plays until `hands` hands are complete, answering the hero's turns and reloads.
 */
import { vi } from 'vitest';
import { randInt, rngFromSeed, type Rng, type Seed128 } from '../../src/core/rng.ts';
import {
  createTableController,
  realTimers,
  type SeedSource,
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
import {
  createBrainClient,
  type BrainClient,
  type EquityClient,
} from '../../src/app/workerClient.ts';
import { simpleDecide } from '../helpers/simpleDecide.ts';
import { thinkMs } from '../../src/brain/think.ts';
import type { step } from '../../src/engine/step.ts';
import type { SafeStorage } from '../../src/persist/storage.ts';
import type { HandState, LegalActions, Observation, PlayerAction } from '../../src/engine/types.ts';
import type { BrainReply, BrainRequest } from '../../src/workers/protocol.ts';
import {
  fakeBrainWorker,
  testBrain,
  type FakeBrainInstance,
  type FakeBrainWorker,
} from '../workers/fakeBrainWorker.ts';

export const SEED: Seed128 = 'c0ffee00c0ffee00c0ffee00c0ffee00';

export interface Harness {
  store: AppStore;
  controller: TableController;
  dispatch(cmd: Command): void;
  state(): AppState;
}

export interface HarnessOptions {
  seed?: Seed128;
  /** Table and hand seeds of your own (default: `fixedSeeds(seed)`). */
  seeds?: SeedSource;
  settings?: Partial<GameSettings>;
  /** The bots' brain (default: `testBrain`, on the controller's timers). */
  brain?: BrainClient;
  step?: typeof step;
  timers?: Timers;
  /** Chunk 3.2 storage: the controller loads at boot and saves as it plays. */
  storage?: SafeStorage;
  /** Chunk 4.5: equity.worker's client (a fake worker in tests). */
  equity?: EquityClient;
  /** Chunk 5.7: ask the brain for the coach's hint at every hero decision. */
  hints?: boolean;
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
    brain: options.brain ?? testBrain(options.timers ?? realTimers),
    heroName: 'You',
    seeds: options.seeds ?? fixedSeeds(options.seed ?? SEED),
    ...(options.step !== undefined && { step: options.step }),
    ...(options.timers !== undefined && { timers: options.timers }),
    ...(options.storage !== undefined && { storage: options.storage }),
    ...(options.equity !== undefined && { equity: options.equity }),
    ...(options.hints !== undefined && { hints: options.hints }),
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

/** The `botDecision` message the controller posts to `brain.worker`. */
export type BotDecisionMsg = Extract<BrainRequest, { kind: 'botDecision' }>;

export interface SpyBrain {
  client: BrainClient;
  fake: FakeBrainWorker;
  /** Every `botDecision` posted, as the worker received it. */
  requests: BotDecisionMsg[];
  /** The job ids of every `cancel` posted. */
  cancelled: number[];
}

/** SimpleBot as the brain, recording every message (and calling `onRequest` synchronously with each `botDecision`). */
export function spyBrain(
  onRequest?: (req: BotDecisionMsg) => void,
  timers: Timers = realTimers,
): SpyBrain {
  const requests: BotDecisionMsg[] = [];
  const cancelled: number[] = [];
  const fake = fakeBrainWorker({
    service: { decide: simpleDecide },
    onReceive: (msg) => {
      if (msg.kind === 'botDecision') {
        requests.push(msg);
        onRequest?.(msg);
      } else if (msg.kind === 'cancel') {
        cancelled.push(msg.jobId);
      }
    },
  });
  return { client: createBrainClient(fake.spawn, timers), fake, requests, cancelled };
}

/** A brain that answers with `choose`'s action (default: SimpleBot's) and a fixed think time. */
export function scriptedBrain(options: {
  thinkMs: number;
  choose?: (obs: Observation) => PlayerAction;
  /** Called synchronously with every `botDecision` as it is posted. */
  onRequest?: (req: BotDecisionMsg) => void;
  timers?: Timers;
}): BrainClient {
  const { choose, onRequest } = options;
  const fake = fakeBrainWorker({
    service: {
      decide: (obs) => {
        const decision = simpleDecide(obs);
        return choose === undefined ? decision : { ...decision, action: choose(obs) };
      },
      thinkMs: () => options.thinkMs,
    },
    onReceive: (msg) => {
      if (msg.kind === 'botDecision') onRequest?.(msg);
    },
  });
  return createBrainClient(fake.spawn, options.timers ?? realTimers);
}

export interface ManualBrain {
  client: BrainClient;
  fake: FakeBrainWorker;
  /**
   * The jobs posted and not yet answered, cancelled ones too (answering one tests that a late
   * reply is dropped).
   */
  pending: Map<number, { req: BotDecisionMsg; instance: FakeBrainInstance }>;
  /** The job ids of every `cancel` posted (the client's cancels and its timeouts). */
  cancelled: number[];
  /** Answers one job as SimpleBot would, unless `reply` overrides parts of the reply. */
  answer(jobId: number, reply?: Partial<BrainReply>): void;
  /** Answers every pending job. */
  answerAll(): void;
}

/** A brain that answers only when the test says so. */
export function manualBrain(timers: Timers = realTimers): ManualBrain {
  const pending: ManualBrain['pending'] = new Map();
  const cancelled: number[] = [];
  const fake = fakeBrainWorker({
    onReceive: (msg, instance) => {
      if (msg.kind === 'botDecision') pending.set(msg.jobId, { req: msg, instance });
      else if (msg.kind === 'cancel') cancelled.push(msg.jobId);
    },
  });
  function answer(jobId: number, reply?: Partial<BrainReply>): void {
    const job = pending.get(jobId);
    if (job === undefined) throw new Error(`no pending job ${jobId}`);
    pending.delete(jobId);
    const { obs, seed, epoch } = job.req;
    const decision = simpleDecide(obs);
    job.instance.reply({
      kind: 'botDecision',
      jobId,
      epoch,
      decision,
      thinkMs: thinkMs(obs, decision, seed),
      ...reply,
    } as BrainReply);
  }
  return {
    client: createBrainClient(fake.spawn, timers),
    fake,
    pending,
    cancelled,
    answer,
    answerAll() {
      for (const jobId of [...pending.keys()]) answer(jobId);
    },
  };
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
