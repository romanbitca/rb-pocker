/**
 * `brain.worker`'s job runner with chunk 6.1's coach (`coachAnswer`: the real hints and grades) as
 * a fake worker, for the tests that run 6.1's grade through 6.2's flow (`controller.grade.test.ts`,
 * `botScripts.test.ts`). Bots are SimpleBot (`simpleDecide`) unless a bot script answers them
 * first (`scriptedBrain(name, timers, realCoach().spawn)`). Grade replies can come late (on the
 * fake clock: `setTimeout`) or fail (the coach throws, so the job runner answers `error`).
 *
 * The table of the Stage 6 acceptance 2 E2E spec: `?seed=46` (`SEED_46`), 3 players and the
 * `river-min-bet` script. In hand 1 the hero is the big blind with A♣3♣; the board runs 8♣5♥2♣,
 * J♦, T♣ (the nut flush on the river), and the small blind bets the minimum into it there.
 */
import { createBrainService, type CoachFn } from '../../src/workers/brainService.ts';
import type { SpawnWorker } from '../../src/app/workerClient.ts';
import { coachAnswer } from '../../src/brain/grade.ts';
import type { Seed128 } from '../../src/core/rng.ts';
import type { BrainReply, BrainRequest } from '../../src/workers/protocol.ts';
import { simpleDecide } from '../helpers/simpleDecide.ts';

/** `?seed=46` as `seedFromSearch` reads it. */
export const SEED_46: Seed128 = '00000000000000000000000000000046';

export interface RealCoachOptions {
  /** How much later the reply of the grade of `decisionId` comes, ms (default 0). */
  gradeDelayMs?: (decisionId: number) => number;
  /** Every grade job fails: the coach's `grade` throws, so the job runner answers `error`. */
  failGrades?: boolean;
}

export interface RealCoach {
  spawn: SpawnWorker<BrainRequest, BrainReply>;
  /** Every message any instance received, in order (as a worker receives it: a copy). */
  received: BrainRequest[];
}

const failingGrades: CoachFn = (obs, eRandom) => ({
  ...coachAnswer(obs, eRandom),
  grade: () => {
    throw new Error('grade failed');
  },
});

export function realCoach(options: RealCoachOptions = {}): RealCoach {
  const received: BrainRequest[] = [];
  const coach = options.failGrades === true ? failingGrades : coachAnswer;
  const spawn: SpawnWorker<BrainRequest, BrainReply> = (events) => {
    let live = true;
    const service = createBrainService({
      decide: simpleDecide,
      coach,
      // Like postMessage: the reply arrives in a later task.
      post: (reply) => {
        const copy = structuredClone(reply);
        void Promise.resolve().then(() => {
          if (live) events.message(copy);
        });
      },
    });
    const handle = (msg: BrainRequest): void => {
      if (live) service.handle(msg);
    };
    return {
      postMessage(message) {
        if (!live) throw new Error('posted to a terminated worker');
        const copy = structuredClone(message);
        received.push(copy);
        const delay = copy.kind === 'grade' ? (options.gradeDelayMs?.(copy.decisionId) ?? 0) : 0;
        if (delay > 0) setTimeout(() => handle(copy), delay);
        else void Promise.resolve().then(() => handle(copy));
      },
      terminate() {
        live = false;
      },
    };
  };
  return { spawn, received };
}
