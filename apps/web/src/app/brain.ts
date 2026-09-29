/**
 * The brain as the controller sees it (PLAN §2.2, Appendix A.6): an asynchronous request/reply
 * port with job ids and epochs. `brain.worker` serves it from Stage 5; until then
 * `createSimpleBrain()` serves the temporary SimpleBot (§18 Stage 3) on the main thread behind
 * the same interface, so the controller does not change when the worker arrives.
 *
 * ⚠️ A request carries an `Observation` built by `observe()` and nothing else about the hand
 * (§4.8, pitfall 13): never a `HandState`, the deck or a value derived from the hand seed. The
 * bot seed comes from the table seed only (§2.4, §9.6 3b).
 */
import type { Seed128 } from '../core/rng.ts';
import type { Observation, PlayerAction } from '../engine/types.ts';
import { simpleBotAction, simpleBotThinkMs } from '../brain/simpleBot.ts';

/**
 * Which brain profile the bot plays. Stage 5 sends the full `BrainProfile` (Appendix A.5); its
 * `id` has the same form, "personality/level" (e.g. "station/easy").
 */
export interface BotProfileRef {
  id: string;
}

/** Appendix A.6 `BrainRequest`, the Stage 3 part. */
export interface BotDecisionRequest {
  kind: 'botDecision';
  jobId: number;
  epoch: number;
  obs: Observation;
  profile: BotProfileRef;
  seed: Seed128;
}

/** Appendix A.6 `BrainReply`, the Stage 3 part. `decision` is Stage 5's `Decision` (A.5) narrowed to its action. */
export type BrainReply =
  | {
      kind: 'botDecision';
      jobId: number;
      epoch: number;
      decision: { action: PlayerAction };
      /** Think time at Normal speed (§9.8); the controller applies the speed setting. */
      thinkMs: number;
    }
  | { kind: 'error'; jobId: number; epoch: number; message: string };

export interface BrainClient {
  /** Sends one request. The promise resolves with the reply; a brain failure is an `error` reply. */
  request(req: BotDecisionRequest): Promise<BrainReply>;
  /** The controller no longer wants this job; a reply that still comes is dropped as stale. */
  cancel(jobId: number): void;
}

/**
 * SimpleBot on the main thread. Like a worker, it answers asynchronously (a resolved promise, no
 * timer) and works on a copy of the request, as `postMessage` would give it.
 */
export function createSimpleBrain(): BrainClient {
  return {
    request(req: BotDecisionRequest): Promise<BrainReply> {
      // A structured-clone stand-in (the observation is plain JSON, §4.6).
      const copy = JSON.parse(JSON.stringify(req)) as BotDecisionRequest;
      return Promise.resolve().then((): BrainReply => {
        try {
          const action = simpleBotAction(copy.obs);
          const thinkMs = simpleBotThinkMs(copy.obs, action, copy.seed);
          return {
            kind: 'botDecision',
            jobId: copy.jobId,
            epoch: copy.epoch,
            decision: { action },
            thinkMs,
          };
        } catch (e) {
          return { kind: 'error', jobId: copy.jobId, epoch: copy.epoch, message: String(e) };
        }
      });
    },
    cancel(): void {
      // Nothing to stop: a SimpleBot reply costs microseconds, and a stale one is dropped.
    },
  };
}
