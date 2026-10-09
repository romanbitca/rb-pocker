/**
 * The grade port (PLAN §11.3 r5, §8.9, Appendix A.5–A.6; chunk 6.2): how the controller grades a
 * hero decision. The controller owns the policy (the 1,500 ms pause, the one retry, `grade: null`
 * after two failures); a `Grader` only runs one job and says how it ended.
 *
 * - The app grades in `brain.worker` (`brainGrader`): a `grade` job in the slot 'grade', with the
 *   hero's observation at the decision, the action taken, the HUD's final win chance when the
 *   controller has it (else null: the worker computes the same number, §8.2) and the decisionId.
 *   The worker answers with chunk 6.1's `grade()` (`brain/grade.ts`), from the same deliberation
 *   as the decision's hint (§8.11). The `?script=` hook grades the same way (its bots are scripted,
 *   its coach is brain.worker).
 * - Unit tests pass graders of their own (`tests/app/graders.ts`): a fixed grade, a slow one, one
 *   that fails, one that never answers; `tests/app/controller.grade.test.ts` runs the real one.
 *
 * ⚠️ Only an `Observation` crosses (§4.8, pitfall 13): never the `HandState`.
 */
import type { GradeResult } from '../brain/types.ts';
import type { Observation, PlayerAction } from '../engine/types.ts';
import type { BrainReply, BrainRequest } from '../workers/protocol.ts';
import type { BrainClient, JobEvent } from './workerClient.ts';

/**
 * §11.3 r5: after a hero act the hand waits this long for the grade (mode 'grading'). A grade that
 * comes later shows without a pause.
 */
export const GRADE_PAUSE_MS = 1500;

/** §11.3 r5: a grade job with no reply after this long has failed (and is retried once). */
export const GRADE_TIMEOUT_MS = 5000;

/** §11.3 r5: the first try and one retry with the same inputs; then `grade: null`. */
export const GRADE_ATTEMPTS = 2;

/** What grading one hero decision needs: A.5 `grade(obs, taken, eRandom, decisionId)`. */
export interface GradeAsk {
  /** The hero's observation at the decision point, before the act (`observe`, §4.8). */
  obs: Observation;
  taken: PlayerAction;
  /** The HUD's final win chance for this decision, or null (the worker computes it, §8.2). */
  eRandom: number | null;
  /** §11.3 r1: hero `act` events before this one in the hand's log. */
  decisionId: number;
}

/** How a grade job ended: its grade, or why there is none (an error reply, a timeout, no worker). */
export type GradeOutcome = { ok: true; result: GradeResult } | { ok: false; reason: string };

/** The controller's grade port. */
export interface Grader {
  /**
   * Starts a grade job made for `epoch`. `done` is called exactly once, unless the job is cancelled
   * first; never synchronously. Returns the job's id, or null when nothing could be sent (the
   * worker has failed for good): `done` is then never called.
   */
  grade(ask: GradeAsk, epoch: number, done: (outcome: GradeOutcome) => void): number | null;
  /** Cancels a job: its `done` is never called. */
  cancel(jobId: number): void;
}

/** The brain client's slot for grade jobs: a new one cancels an older one still running. */
export const GRADE_SLOT = 'grade';

/** What a brain job's end means for a grade. */
export function gradeOutcome(event: JobEvent<BrainReply>, decisionId: number): GradeOutcome {
  switch (event.type) {
    case 'timeout':
      return { ok: false, reason: 'grade timeout' };
    case 'failed':
      return { ok: false, reason: `brain worker failed: ${event.reason}` };
    case 'reply': {
      const reply = event.reply;
      if (reply.kind === 'error') return { ok: false, reason: reply.message };
      if (reply.kind !== 'grade') return { ok: false, reason: `unexpected ${reply.kind} reply` };
      if (reply.result.decisionId !== decisionId) {
        return { ok: false, reason: `grade for decision ${reply.result.decisionId}` };
      }
      return { ok: true, result: reply.result };
    }
  }
}

/** Grades in `brain.worker` through its client (the app's grader). */
export function brainGrader(brain: BrainClient): Grader {
  return {
    grade(ask, epoch, done) {
      return brain.request({
        slot: GRADE_SLOT,
        epoch,
        timeoutMs: GRADE_TIMEOUT_MS,
        build: (jobId): BrainRequest => ({
          kind: 'grade',
          jobId,
          epoch,
          obs: ask.obs,
          taken: ask.taken,
          eRandom: ask.eRandom,
          decisionId: ask.decisionId,
        }),
        onEvent: (event) => done(gradeOutcome(event, ask.decisionId)),
      });
    },
    cancel(jobId) {
      brain.cancel(jobId);
    },
  };
}
