/**
 * Graders for tests (the grade port, `app/grading.ts`, chunk 6.2): a fixed grade per decision,
 * answered on the next microtask or after a delay on the (fake) clock, an error, or no answer at
 * all. They stand in for chunk 6.1's real `grade()`, which `controller.grade.test.ts` runs.
 */
import type { GradeAsk, Grader, GradeOutcome } from '../../src/app/grading.ts';
import { feedbackLine, type FeedbackInput } from '../../src/brain/explain.ts';
import type { Grade, GradeResult } from '../../src/brain/types.ts';
import type { LegalActions, PlayerAction } from '../../src/engine/types.ts';

/** What a stub answers: a grade, an `error` reply, or nothing ever. */
export type StubAnswer = Grade | 'error' | 'never';

export interface StubGrader extends Grader {
  /** Every ask, retries included (structured clones, as a worker would receive them). */
  readonly asks: GradeAsk[];
  /** Job ids cancelled. */
  readonly cancelled: number[];
  /** Job ids not answered (and not cancelled) yet. */
  pending(): number[];
}

export interface StubGraderOptions {
  /**
   * The answer to `ask` (default 'best'). `attempt` counts the tries of this one decision from 1
   * (the controller sends the same ask again for its retry).
   */
  answer?: (ask: GradeAsk, attempt: number) => StubAnswer;
  /** Delay on the clock before answering, ms (default 0: the next microtask). */
  delayMs?: number;
  /** The F.5 row the grade carries (default none: the card says the fallback row). */
  feedback?: (ask: GradeAsk) => FeedbackInput | null;
}

/** A legal move other than `taken`: what a stub recommends when it grades `taken` down. */
export function otherMove(taken: PlayerAction, legal: LegalActions): PlayerAction {
  if (taken.type === 'fold') return legal.canCheck ? { type: 'check' } : { type: 'call' };
  if (taken.type === 'check' && legal.bet !== null) return { type: 'bet', to: legal.bet.min };
  return legal.canFold ? { type: 'fold' } : { type: 'check' };
}

/** A grade of `ask`: Best = the move taken; anything else recommends `otherMove`. */
export function gradeResult(
  ask: GradeAsk,
  grade: Grade,
  feedback: FeedbackInput | null = null,
): GradeResult {
  const best = grade === 'best';
  return {
    decisionId: ask.decisionId,
    grade,
    rec: best ? ask.taken : otherMove(ask.taken, ask.obs.legal),
    taken: ask.taken,
    lossChips: best ? 0 : 30,
    lossPot: best ? 0 : 0.5,
    lossMilliBB: best ? 0 : 1500,
    leak: null,
    trace: [],
    feedback: feedback === null ? null : feedbackLine(feedback),
  };
}

export function stubGrader(options: StubGraderOptions = {}): StubGrader {
  const asks: GradeAsk[] = [];
  const cancelled: number[] = [];
  const live = new Map<number, ReturnType<typeof setTimeout> | null>();
  const tries = new WeakMap<GradeAsk, number>();
  let seq = 0;
  return {
    asks,
    cancelled,
    pending: () => [...live.keys()],
    grade(ask, _epoch, done) {
      const jobId = ++seq;
      asks.push(structuredClone(ask));
      const attempt = (tries.get(ask) ?? 0) + 1;
      tries.set(ask, attempt);
      const answer = options.answer?.(ask, attempt) ?? 'best';
      const fire = (): void => {
        if (!live.has(jobId)) return; // cancelled
        live.delete(jobId);
        const outcome: GradeOutcome =
          answer === 'error'
            ? { ok: false, reason: 'stub error' }
            : {
                ok: true,
                result: gradeResult(ask, answer as Grade, options.feedback?.(ask) ?? null),
              };
        done(outcome);
      };
      const delay = options.delayMs ?? 0;
      if (answer === 'never') live.set(jobId, null);
      else if (delay > 0) live.set(jobId, setTimeout(fire, delay));
      else {
        live.set(jobId, null);
        void Promise.resolve().then(fire);
      }
      return jobId;
    },
    cancel(jobId) {
      const timer = live.get(jobId);
      if (timer !== undefined && timer !== null) clearTimeout(timer);
      if (live.delete(jobId)) cancelled.push(jobId);
    },
  };
}
