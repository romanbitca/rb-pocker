/**
 * `brain.worker` (PLAN §2.2): bot decisions, coach hints (chunk 5.7) and grades (chunk 6.1). It
 * speaks the Appendix A.6 protocol (`protocol.ts`); `brainService.ts` runs the jobs with the one
 * decision engine of `brain/decide.ts` (§8.1 C1); hint and grade come from one coach computation
 * per observation (`brain/grade.ts` `coachAnswer`, §8.11).
 *
 * ⚠️ It receives an `Observation` built by `observe()`, a profile and a seed (or the HUD's win
 * chance), and nothing else about the hand: never a `HandState`, the deck, another seat's hidden
 * cards or a value derived from the hand seed (§2.2, §9.6, pitfall 13); §2.1 keeps `engine` and
 * `app` out of this module.
 *
 * Created with the literal `new Worker(new URL('./brain.worker.ts', import.meta.url),
 * { type: 'module' })` in `spawn.ts` (pitfall 38).
 */
import { decide } from '../brain/decide.ts';
import { coachAnswer } from '../brain/grade.ts';
import { createBrainService } from './brainService.ts';
import type { BrainReply, BrainRequest } from './protocol.ts';

/** The part of `DedicatedWorkerGlobalScope` this worker uses (the app's tsconfig has no WebWorker lib). */
interface WorkerScope {
  postMessage(message: BrainReply): void;
  onmessage: ((event: MessageEvent<BrainRequest>) => void) | null;
}

const scope = self as unknown as WorkerScope;
const service = createBrainService({
  decide,
  coach: coachAnswer,
  post: (reply) => scope.postMessage(reply),
});
scope.onmessage = (event) => service.handle(event.data);
