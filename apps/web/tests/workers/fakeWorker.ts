/**
 * A fake `equity.worker` for tests (no real Worker in Node). Every message the client posts is
 * recorded as the worker would receive it (a structured clone). Two modes:
 * - manual: the test answers with `reply(...)` (stale-reply and timeout tests);
 * - service: `createEquityService` runs "inside" the fake with the given maths, and its replies
 *   arrive asynchronously, like `postMessage` (end-to-end tests with the controller).
 */
import type { SpawnWorker } from '../../src/app/workerClient.ts';
import { createEquityService, type EquityMath } from '../../src/workers/equityService.ts';
import type { EquityReply, EquityRequest } from '../../src/workers/protocol.ts';

export interface FakeInstance {
  /** What this worker instance received, in order. */
  received: EquityRequest[];
  terminated: boolean;
  /** Delivers a reply from this instance (synchronously). */
  reply(reply: EquityReply): void;
  /** Fires the worker's `error` event. */
  crash(reason?: string): void;
}

export interface FakeWorker {
  spawn: SpawnWorker<EquityRequest, EquityReply>;
  /** Every worker started, oldest first. */
  instances: FakeInstance[];
  /** Everything posted to any instance, in order. */
  received: EquityRequest[];
  /** The newest instance. */
  current(): FakeInstance;
  /** Makes the next `spawn` calls throw (no module workers). */
  failSpawns: number;
}

export interface FakeWorkerOptions {
  /** Service mode: run the real job runner with this maths. Default: manual mode. */
  math?: EquityMath;
  /** Service mode: the runner's options (tests pass a clock and a pause). */
  service?: {
    pause?: () => Promise<void>;
    now?: () => number;
    sliceMs?: number;
    capMs?: number;
  };
}

export function fakeWorker(options: FakeWorkerOptions = {}): FakeWorker {
  const fake: FakeWorker = {
    instances: [],
    received: [],
    failSpawns: 0,
    current() {
      const last = fake.instances[fake.instances.length - 1];
      if (last === undefined) throw new Error('no worker started');
      return last;
    },
    spawn(events) {
      if (fake.failSpawns > 0) {
        fake.failSpawns--;
        throw new ReferenceError('Worker is not defined');
      }
      const instance: FakeInstance = {
        received: [],
        terminated: false,
        reply(reply) {
          if (!instance.terminated) events.message(structuredClone(reply));
        },
        crash(reason = 'boom') {
          if (!instance.terminated) events.error(reason);
        },
      };
      const math = options.math;
      const service =
        math === undefined
          ? null
          : createEquityService({
              math,
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
