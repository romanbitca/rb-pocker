/**
 * Worker thread of `runSelfPlay` (`selfplay-jobs.ts`): plays each job it is sent and posts the
 * tallies back. Not meant to be started by hand.
 */
import { parentPort } from 'node:worker_threads';
import { runJob, type SelfPlayJob } from './selfplay-jobs.ts';

if (parentPort === null) throw new Error('selfplay-worker.ts runs only as a worker thread');

const port = parentPort;
port.on('message', (message: { id: number; job: SelfPlayJob }) => {
  port.postMessage({ id: message.id, result: runJob(message.job) });
});
