/**
 * A fake `brain.worker` for tests (no real Worker in Node). Every message the client posts is
 * recorded as the worker would receive it (a structured clone). Two modes, like `fakeWorker.ts`:
 * - manual: the test answers with `reply(...)` (stale-reply, timeout and crash tests);
 * - service: `createBrainService` runs "inside" the fake with the given brain, and its replies
 *   arrive asynchronously, like `postMessage` (end-to-end tests with the controller).
 */
import { realTimers, type Timers } from '../../src/app/controller.ts';
import {
  createBrainClient,
  type BrainClient,
  type SpawnWorker,
} from '../../src/app/workerClient.ts';
import { simpleDecide } from '../helpers/simpleDecide.ts';
import { coachHint } from '../../src/brain/decide.ts';
import {
  createBrainService,
  type BrainServiceOptions,
  type HintFn,
} from '../../src/workers/brainService.ts';
import type { BrainReply, BrainRequest } from '../../src/workers/protocol.ts';

export interface FakeBrainInstance {
  /** What this worker instance received, in order. */
  received: BrainRequest[];
  terminated: boolean;
  /** Delivers a reply from this instance (synchronously). */
  reply(reply: BrainReply): void;
  /** Fires the worker's `error` event. */
  crash(reason?: string): void;
}

export interface FakeBrainWorker {
  spawn: SpawnWorker<BrainRequest, BrainReply>;
  /** Every worker started, oldest first. */
  instances: FakeBrainInstance[];
  /** Everything posted to any instance, in order. */
  received: BrainRequest[];
  /** The newest instance. */
  current(): FakeBrainInstance;
  /** Makes the next `spawn` calls throw (no module workers). */
  failSpawns: number;
}

export interface FakeBrainOptions {
  /** Service mode: run the real job runner with this brain. Default: manual mode. */
  service?: Omit<BrainServiceOptions, 'post'>;
  /** Called with every message as it is posted (synchronously, before the worker sees it). */
  onReceive?: (message: BrainRequest, instance: FakeBrainInstance) => void;
}

export function fakeBrainWorker(options: FakeBrainOptions = {}): FakeBrainWorker {
  const fake: FakeBrainWorker = {
    instances: [],
    received: [],
    failSpawns: 0,
    current() {
      const last = fake.instances[fake.instances.length - 1];
      if (last === undefined) throw new Error('no brain worker started');
      return last;
    },
    spawn(events) {
      if (fake.failSpawns > 0) {
        fake.failSpawns--;
        throw new ReferenceError('Worker is not defined');
      }
      const instance: FakeBrainInstance = {
        received: [],
        terminated: false,
        reply(reply) {
          if (!instance.terminated) events.message(structuredClone(reply));
        },
        crash(reason = 'boom') {
          if (!instance.terminated) events.error(reason);
        },
      };
      const service =
        options.service === undefined
          ? null
          : createBrainService({
              ...options.service,
              // Like postMessage: the reply arrives in a later task.
              post: (reply) => {
                const copy = structuredClone(reply);
                void Promise.resolve().then(() => instance.reply(copy));
              },
            });
      fake.instances.push(instance);
      return {
        postMessage(message) {
          if (instance.terminated) throw new Error('posted to a terminated worker');
          const copy = structuredClone(message);
          instance.received.push(copy);
          fake.received.push(copy);
          options.onReceive?.(copy, instance);
          if (service !== null) {
            const delivered = structuredClone(message);
            void Promise.resolve().then(() => {
              if (!instance.terminated) service.handle(delivered);
            });
          }
        },
        terminate() {
          instance.terminated = true;
        },
      };
    },
  };
  return fake;
}

/**
 * A brain client on a fake worker that runs the production job runner with SimpleBot as its brain (`simpleDecide`):
 * what the app has, minus the thread (component and controller tests that need bots).
 */
export function testBrain(timers: Timers = realTimers): BrainClient {
  return createBrainClient(
    fakeBrainWorker({ service: { decide: simpleDecide, hint: coachHint } }).spawn,
    timers,
  );
}

/** A `hint` request, as the worker receives it. */
export type HintMsg = Extract<BrainRequest, { kind: 'hint' }>;

export interface CoachBrain {
  client: BrainClient;
  /** Every hint request, as the worker received it. */
  hints: HintMsg[];
  /** The job ids of every `cancel` posted. */
  cancelled: number[];
  /** Hint jobs held unanswered (`hold`). */
  held: Map<number, { msg: HintMsg; instance: FakeBrainInstance }>;
  /** Answers a held hint job: with `reply`, else with the coach's answer. */
  answer(jobId: number, reply?: BrainReply): void;
}

/**
 * A brain client whose bots are SimpleBot (answered at once, no think time) and whose coach is
 * `coach` (default: the real `coachHint`); with `hold`, hint requests wait for `answer` (a hint
 * on its way, a late one, an `error` reply). `failSpawns`: no worker can start.
 */
export function coachBrain(
  options: { coach?: HintFn; hold?: boolean; failSpawns?: number; timers?: Timers } = {},
): CoachBrain {
  const coach = options.coach ?? coachHint;
  const hints: HintMsg[] = [];
  const cancelled: number[] = [];
  const held = new Map<number, { msg: HintMsg; instance: FakeBrainInstance }>();
  const fake = fakeBrainWorker({
    onReceive: (msg, instance) => {
      if (msg.kind === 'botDecision') {
        const decision = simpleDecide(msg.obs);
        const { jobId, epoch } = msg;
        void Promise.resolve().then(() =>
          instance.reply({ kind: 'botDecision', jobId, epoch, decision, thinkMs: 0 }),
        );
      } else if (msg.kind === 'hint') {
        hints.push(msg);
        if (options.hold === true) {
          held.set(msg.jobId, { msg, instance });
        } else {
          const { decision, explanation } = coach(msg.obs, msg.eRandom);
          const { jobId, epoch } = msg;
          void Promise.resolve().then(() =>
            instance.reply({ kind: 'hint', jobId, epoch, decision, explanation }),
          );
        }
      } else if (msg.kind === 'cancel') {
        cancelled.push(msg.jobId);
      }
    },
  });
  fake.failSpawns = options.failSpawns ?? 0;
  return {
    client: createBrainClient(fake.spawn, options.timers ?? realTimers),
    hints,
    cancelled,
    held,
    answer(jobId, reply) {
      const job = held.get(jobId);
      if (job === undefined) throw new Error(`no held hint ${jobId}`);
      held.delete(jobId);
      const { msg, instance } = job;
      instance.reply(
        reply ?? { kind: 'hint', jobId, epoch: msg.epoch, ...coach(msg.obs, msg.eRandom) },
      );
    },
  };
}
