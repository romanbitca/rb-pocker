/**
 * Creates the workers (PLAN §2.2). ⚠️ Vite finds a worker only in this literal form, with the
 * `new URL(…, import.meta.url)` written inside `new Worker(…)` (pitfall 38): never build the URL
 * in a variable or a helper. Module workers: Safari/iOS 15+, Chrome 80+, Firefox 114+.
 */

/** A new `equity.worker`. Throws where module workers are missing (jsdom, old browsers). */
export function spawnEquityWorker(): Worker {
  return new Worker(new URL('./equity.worker.ts', import.meta.url), { type: 'module' });
}
