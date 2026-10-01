/**
 * `brain.worker` (PLAN §2.2): bot decisions now, coach hints (chunk 5.7) and grades (chunk 6.1)
 * later. It speaks the Appendix A.6 protocol (`protocol.ts`); `brainService.ts` runs the jobs.
 *
 * ⚠️ It receives an `Observation` built by `observe()`, a profile and a seed, and nothing else
 * about the hand: never a `HandState`, the deck, another seat's hidden cards or a value derived
 * from the hand seed (§2.2, §9.6, pitfall 13); §2.1 keeps `engine` and `app` out of this module.
 *
 * Created with the literal `new Worker(new URL('./brain.worker.ts', import.meta.url),
 * { type: 'module' })` in `spawn.ts` (pitfall 38).
 */
// Chunk 5.7 replaces this one import with `decide` from '../brain/decide.ts' (see standIn.ts).
import { decide } from '../brain/standIn.ts';
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
  post: (reply) => scope.postMessage(reply),
});
scope.onmessage = (event) => service.handle(event.data);
