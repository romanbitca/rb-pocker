/**
 * Worker thread of `runJobs` (`table-jobs.ts`): runs each job it is sent and posts the result back.
 * Not meant to be started by hand.
 */
import { parentPort } from 'node:worker_threads';
import { runJob, type Job } from './table-jobs.ts';

if (parentPort === null) throw new Error('table-worker.ts runs only as a worker thread');

const port = parentPort;
port.on('message', (message: { id: number; job: Job }) => {
  port.postMessage({ id: message.id, result: runJob(message.job) });
});
