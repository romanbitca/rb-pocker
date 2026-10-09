/**
 * The job runner of `brain.worker` (PLAN §2.2, §8.11, §9.8, Appendix A.6), without the worker
 * globals so tests can run it in Node. `brain.worker.ts` connects it to `self` with the real brain
 * (`brain/decide.ts`); tests pass fakes through the same options.
 *
 * ⚠️ It reads an `Observation`, a profile and a seed (or the HUD's number), and nothing else about
 * the hand (§2.2, §9.6, pitfall 13): the message types have no field for a `HandState`, the deck
 * or the hand seed, and this module cannot import the engine at run time (§2.1).
 *
 * - `botDecision`: `decide` gives the `Decision`; `thinkMs` (§9.8, `brain/think.ts`) its think time
 *   at Normal speed; both go back in one reply. A throw becomes an `error` reply for the job.
 * - `hint` (chunk 5.7): `coachHint(obs, eRandom)`, the coach's advice and `explain()` of it (the
 *   words need the brain's features; the main thread only renders them). Hint and grade share one
 *   computation, cached by `observationKey` (§8.11, LRU of 32): asking again for the same
 *   observation (an undo, a resume, "Tap to try again") answers at once with the same advice. The
 *   key also holds the `eRandom` the job brought (null: the worker computes the HUD's number).
 * - `grade` (chunk 6.1) and `bench` (the hint-latency row of `#bench`) answer `error` ("not
 *   available yet").
 * - `cancel`: every job runs to its end inside the message that brought it, so there is nothing
 *   left to stop. The main thread drops the reply of a cancelled job (`app/workerClient.ts`).
 */
import type { Seed128 } from '../core/rng.ts';
import type { CoachHint } from '../brain/decide.ts';
import type { BrainProfile, Decision } from '../brain/types.ts';
import { thinkMs as defaultThinkMs } from '../brain/think.ts';
import { observationKey, type Observation } from '../engine/types.ts';
import type { BrainReply, BrainRequest } from './protocol.ts';

/** `decide(obs, profile, seed)` of Appendix A.5 (`brain/decide.ts`), as the worker calls it. */
export type DecideFn = (obs: Observation, profile: BrainProfile, seed: Seed128) => Decision;

/** `coachHint(obs, eRandom)` (`brain/decide.ts`): A.5 `hint` with its explanation. */
export type HintFn = (obs: Observation, eRandom: number | null) => CoachHint;

/** §9.8: the think time at Normal speed for a decision, in ms (`brain/think.ts`). */
export type ThinkMsFn = (obs: Observation, decision: Decision, seed: Seed128) => number;

/** §8.11: hints kept, newest last (a least-recently-used cache). */
export const HINT_CACHE_SIZE = 32;

export interface BrainServiceOptions {
  decide: DecideFn;
  /** The coach. Without it a `hint` job answers `error` (tests of the bot path only). */
  hint?: HintFn;
  /** Default: `brain/think.ts`. */
  thinkMs?: ThinkMsFn;
  post(reply: BrainReply): void;
}

export interface BrainService {
  /** One message from the main thread. */
  handle(msg: BrainRequest): void;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The cache key of a hint: the observation and the HUD number the job brought. */
export function hintKey(obs: Observation, eRandom: number | null): string {
  return `${eRandom === null ? 'null' : String(eRandom)}|${observationKey(obs)}`;
}

export function createBrainService(options: BrainServiceOptions): BrainService {
  const { decide, post } = options;
  const thinkMs = options.thinkMs ?? defaultThinkMs;
  const hints = new Map<string, CoachHint>();

  const fail = (jobId: number, epoch: number, message: string): void =>
    post({ kind: 'error', jobId, epoch, message });

  /** The hint of `obs`, from the cache when it has it (then it becomes the newest entry). */
  const hintOf = (hint: HintFn, obs: Observation, eRandom: number | null): CoachHint => {
    const key = hintKey(obs, eRandom);
    const cached = hints.get(key);
    if (cached !== undefined) {
      hints.delete(key);
      hints.set(key, cached);
      return cached;
    }
    const answer = hint(obs, eRandom);
    hints.set(key, answer);
    if (hints.size > HINT_CACHE_SIZE) hints.delete(hints.keys().next().value as string);
    return answer;
  };

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
        case 'hint': {
          const hint = options.hint;
          if (hint === undefined) {
            fail(msg.jobId, msg.epoch, 'hint: no coach in this worker');
            return;
          }
          try {
            const { decision, explanation } = hintOf(hint, msg.obs, msg.eRandom);
            post({ kind: 'hint', jobId: msg.jobId, epoch: msg.epoch, decision, explanation });
          } catch (e) {
            fail(msg.jobId, msg.epoch, messageOf(e));
          }
          return;
        }
        case 'grade':
          fail(msg.jobId, msg.epoch, 'grade: not available yet');
          return;
        case 'bench':
          // The hint-latency row of the #bench screen (§15.4) is not built yet.
          fail(msg.jobId, 0, 'bench: not available yet');
          return;
      }
    },
  };
}
