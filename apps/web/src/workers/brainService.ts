/**
 * The job runner of `brain.worker` (PLAN §2.2, §9.8, Appendix A.6), without the worker globals so
 * tests can run it in Node. `brain.worker.ts` connects it to `self`; the bot brain comes in
 * through the `decide` option (`brain/standIn.ts` until chunk 5.7, then `brain/decide.ts`; fakes in
 * tests).
 *
 * ⚠️ It reads an `Observation`, a profile and a seed, and nothing else about the hand (§2.2, §9.6,
 * pitfall 13): the message type has no field for a `HandState`, the deck or the hand seed, and
 * this module cannot import the engine at run time (§2.1).
 *
 * - `botDecision`: `decide` gives the `Decision`; `thinkMs` (§9.8, `brain/think.ts`) its think time
 *   at Normal speed; both go back in one reply. A throw becomes an `error` reply for the job.
 * - `hint` (chunk 5.7) and `grade` (chunk 6.1) answer `error` ("not available yet"), and so does
 *   `bench` (the hint-latency row of `#bench` comes with `hint`).
 * - `cancel`: every job runs to its end inside the message that brought it, so there is nothing
 *   left to stop. The main thread drops the reply of a cancelled job (`app/workerClient.ts`).
 */
import type { Seed128 } from '../core/rng.ts';
import type { Decision } from '../brain/types.ts';
import { thinkMs as defaultThinkMs } from '../brain/think.ts';
import type { Observation } from '../engine/types.ts';
import type { BotProfileRef, BrainReply, BrainRequest } from './protocol.ts';

/** `decide(obs, profile, seed)` of Appendix A.5 (`brain/decide.ts`), as the worker calls it. */
export type DecideFn = (obs: Observation, profile: BotProfileRef, seed: Seed128) => Decision;

/** §9.8: the think time at Normal speed for a decision, in ms (`brain/think.ts`). */
export type ThinkMsFn = (obs: Observation, decision: Decision, seed: Seed128) => number;

export interface BrainServiceOptions {
  decide: DecideFn;
  /** Default: `brain/think.ts`. */
  thinkMs?: ThinkMsFn;
  post(reply: BrainReply): void;
}

export interface BrainService {
  /** One message from the main thread. */
  handle(msg: BrainRequest): void;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function createBrainService(options: BrainServiceOptions): BrainService {
  const { decide, post } = options;
  const thinkMs = options.thinkMs ?? defaultThinkMs;

  const fail = (jobId: number, epoch: number, message: string): void =>
    post({ kind: 'error', jobId, epoch, message });

  return {
    handle(msg: BrainRequest): void {
      switch (msg.kind) {
        case 'cancel':
          return;
        case 'botDecision':
          try {
            const decision = decide(msg.obs, msg.profile, msg.seed);
            const think = thinkMs(msg.obs, decision, msg.seed);
            post({
              kind: 'botDecision',
              jobId: msg.jobId,
              epoch: msg.epoch,
              decision,
              thinkMs: think,
            });
          } catch (e) {
            fail(msg.jobId, msg.epoch, messageOf(e));
          }
          return;
        case 'hint':
          fail(msg.jobId, msg.epoch, 'hint: not available yet');
          return;
        case 'grade':
          fail(msg.jobId, msg.epoch, 'grade: not available yet');
          return;
        case 'bench':
          // The hint-latency row of the #bench screen comes with `hint` (chunk 5.7, §15.4).
          fail(msg.jobId, 0, 'bench: not available yet');
          return;
      }
    },
  };
}
