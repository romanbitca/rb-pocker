/**
 * `equity.worker` (PLAN §2.2): the HUD win chance (progressive, cancellable), the hand analysis
 * (draws, outs, risky outs, chances, beaters) and all-in run-out equities. It speaks the Appendix
 * A.6 protocol (`protocol.ts`); `equityService.ts` runs the jobs.
 *
 * ⚠️ It receives the hero's hole cards, the board and the number of live opponents, and face-up
 * hands only during an all-in run-out. Never an unrevealed bot card, never a `HandState` (§2.2,
 * pitfall 13); §2.1 keeps `engine` and `app` out of this module.
 *
 * Created with the literal `new Worker(new URL('./equity.worker.ts', import.meta.url),
 * { type: 'module' })` in `spawn.ts` (pitfall 38).
 */
import { runBench } from './bench.ts';
import { equityMath } from './equityMath.ts';
import { createEquityService } from './equityService.ts';
import type { EquityReply, EquityRequest } from './protocol.ts';

/** The part of `DedicatedWorkerGlobalScope` this worker uses (the app's tsconfig has no WebWorker lib). */
interface WorkerScope {
  postMessage(message: EquityReply): void;
  onmessage: ((event: MessageEvent<EquityRequest>) => void) | null;
}

const scope = self as unknown as WorkerScope;
const service = createEquityService({
  math: equityMath,
  post: (reply) => scope.postMessage(reply),
  // The `#bench` screen (§15.4): the worker measures itself.
  bench: () => runBench(equityMath),
});
scope.onmessage = (event) => service.handle(event.data);
