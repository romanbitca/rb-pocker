/**
 * The job runner of `brain.worker` (PLAN §2.2, §8.11, §9.8, Appendix A.6), without the worker
 * globals so tests can run it in Node. `brain.worker.ts` connects it to `self` with the real brain
 * (`brain/decide.ts`, `brain/grade.ts`); tests pass fakes through the same options.
 *
 * ⚠️ It reads an `Observation`, a profile and a seed (or the HUD's number), and nothing else about
 * the hand (§2.2, §9.6, pitfall 13): the message types have no field for a `HandState`, the deck
 * or the hand seed, and this module cannot import the engine at run time (§2.1).
 *
 * - `botDecision`: `decide` gives the `Decision`; `thinkMs` (§9.8, `brain/think.ts`) its think time
 *   at Normal speed; both go back in one reply. A throw becomes an `error` reply for the job.
 * - `hint` (chunk 5.7) and `grade` (chunk 6.1) share one coach computation per observation
 *   (`coachAnswer(obs, eRandom)`: the advice, `explain()` of it, and the grade of any move from the
 *   same EVs), cached by `observationKey` (§8.11, LRU of 32). Asking again for the same
 *   observation (an undo, a resume, "Tap to try again") answers at once with the same advice; the
 *   hint's key also holds the `eRandom` the job brought (null: the worker computes the HUD's
 *   number), because its words show it. A grade reads any answer of its observation, whatever HUD
 *   number the hint job brought: the recommendation and its EVs never depend on it (only the
 *   feedback's wording does, and the grade job's own number is used for that). So grading after
 *   the action costs only the EV of the move taken when it is not a candidate yet (§8.9, §8.11).
 * - `bench` (the hint-latency row of `#bench`) answers `error` ("not available yet").
 * - `cancel`: every job runs to its end inside the message that brought it, so there is nothing
 *   left to stop. The main thread drops the reply of a cancelled job (`app/workerClient.ts`).
 */
import type { Seed128 } from '../core/rng.ts';
import type { CoachHint } from '../brain/decide.ts';
import type { CoachAnswer } from '../brain/grade.ts';
import type { BrainProfile, Decision } from '../brain/types.ts';
import { thinkMs as defaultThinkMs } from '../brain/think.ts';
import { observationKey, type Observation } from '../engine/types.ts';
import type { BrainReply, BrainRequest } from './protocol.ts';

/** `decide(obs, profile, seed)` of Appendix A.5 (`brain/decide.ts`), as the worker calls it. */
export type DecideFn = (obs: Observation, profile: BrainProfile, seed: Seed128) => Decision;

/** `coachHint(obs, eRandom)` (`brain/decide.ts`): A.5 `hint` with its explanation. */
export type HintFn = (obs: Observation, eRandom: number | null) => CoachHint;

/**
 * `coachAnswer(obs, eRandom)` (`brain/grade.ts`): the coach's hint of the observation and the
 * grade of any move from the same computation (A.5 `hint` and `grade`).
 */
export type CoachFn = (obs: Observation, eRandom: number | null) => CoachAnswer;

/** §9.8: the think time at Normal speed for a decision, in ms (`brain/think.ts`). */
export type ThinkMsFn = (obs: Observation, decision: Decision, seed: Seed128) => number;

/** §8.11: coach answers kept, newest last (a least-recently-used cache). */
export const HINT_CACHE_SIZE = 32;

export interface BrainServiceOptions {
  decide: DecideFn;
  /** The coach. Without it `hint` and `grade` jobs answer `error` (tests of the bot path only). */
  coach?: CoachFn;
  /** Default: `brain/think.ts`. */
  thinkMs?: ThinkMsFn;
  post(reply: BrainReply): void;
}

export interface BrainService {
  /** One message from the main thread. */
  handle(msg: BrainRequest): void;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The cache key of an answer: the HUD number the job brought and the observation's key. */
const keyOf = (obsKey: string, eRandom: number | null): string =>
  `${eRandom === null ? 'null' : String(eRandom)}|${obsKey}`;

/** The cache key of a hint: the observation and the HUD number the job brought. */
export function hintKey(obs: Observation, eRandom: number | null): string {
  return keyOf(observationKey(obs), eRandom);
}

interface Cached {
  obsKey: string;
  answer: CoachAnswer;
}

export function createBrainService(options: BrainServiceOptions): BrainService {
  const { decide, post } = options;
  const thinkMs = options.thinkMs ?? defaultThinkMs;
  const answers = new Map<string, Cached>();

  const fail = (jobId: number, epoch: number, message: string): void =>
    post({ kind: 'error', jobId, epoch, message });

  /** Makes `key` the newest entry. */
  const touch = (key: string, entry: Cached): CoachAnswer => {
    answers.delete(key);
    answers.set(key, entry);
    return entry.answer;
  };

  /** Computes and keeps the answer of `obs` for `eRandom` (dropping the oldest beyond 32). */
  const compute = (coach: CoachFn, obs: Observation, obsKey: string, eRandom: number | null) => {
    const answer = coach(obs, eRandom);
    answers.set(keyOf(obsKey, eRandom), { obsKey, answer });
    if (answers.size > HINT_CACHE_SIZE) answers.delete(answers.keys().next().value as string);
    return answer;
  };

  /** The answer of `obs` for exactly this HUD number (a hint shows it), from the cache if there. */
  const answerFor = (coach: CoachFn, obs: Observation, eRandom: number | null): CoachAnswer => {
    const obsKey = observationKey(obs);
    const key = keyOf(obsKey, eRandom);
    const cached = answers.get(key);
    return cached !== undefined ? touch(key, cached) : compute(coach, obs, obsKey, eRandom);
  };

  /**
   * The answer a grade reads: this HUD number's, else the newest answer of the same observation
   * (its recommendation and EVs are the same), else a new one.
   */
  const answerForGrade = (coach: CoachFn, obs: Observation, eRandom: number | null) => {
    const obsKey = observationKey(obs);
    const key = keyOf(obsKey, eRandom);
    const exact = answers.get(key);
    if (exact !== undefined) return touch(key, exact);
    let found: [string, Cached] | null = null;
    for (const entry of answers) if (entry[1].obsKey === obsKey) found = entry;
    return found !== null ? touch(found[0], found[1]) : compute(coach, obs, obsKey, eRandom);
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
          const coach = options.coach;
          if (coach === undefined) {
            fail(msg.jobId, msg.epoch, 'hint: no coach in this worker');
            return;
          }
          try {
            const { decision, explanation } = answerFor(coach, msg.obs, msg.eRandom).hint;
            post({ kind: 'hint', jobId: msg.jobId, epoch: msg.epoch, decision, explanation });
          } catch (e) {
            fail(msg.jobId, msg.epoch, messageOf(e));
          }
          return;
        }
        case 'grade': {
          const coach = options.coach;
          if (coach === undefined) {
            fail(msg.jobId, msg.epoch, 'grade: no coach in this worker');
            return;
          }
          try {
            const answer = answerForGrade(coach, msg.obs, msg.eRandom);
            const result = answer.grade(msg.taken, msg.decisionId, msg.eRandom);
            post({ kind: 'grade', jobId: msg.jobId, epoch: msg.epoch, result });
          } catch (e) {
            fail(msg.jobId, msg.epoch, messageOf(e));
          }
          return;
        }
        case 'bench':
          // The hint-latency row of the #bench screen (§15.4) is not built yet.
          fail(msg.jobId, 0, 'bench: not available yet');
          return;
      }
    },
  };
}
