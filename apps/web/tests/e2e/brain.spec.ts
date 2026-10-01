import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { collectErrors, playHands, prng, seedFor, sizeOf, startTable } from './game.ts';

/**
 * `brain.worker` in real browsers (chunk 5.8; PLAN §2.2, §12.14, §15.3): the module worker loads
 * under the production CSP and every bot decision comes back from it, as the worker message log
 * (`window.__pc.logs().brainWorker`) shows: no timeout, crash or restart, and no bot had to take
 * the fallback action (`diag.botFallbacks`). The worker is the same at every size, so one viewport
 * per browser runs it (Chromium and WebKit). Cancelling a job, stale replies and a dead worker
 * need a worker the test controls: tests/app/controller.brain.test.ts.
 */

interface LogEntry {
  what: string;
  kind?: string;
  jobId?: number;
}

const brainLog = (page: Page): Promise<LogEntry[]> =>
  page.evaluate(() => (window.__pc?.logs() as unknown as { brainWorker: LogEntry[] }).brainWorker);

const fallbacks = (page: Page): Promise<number> =>
  page.evaluate(
    () =>
      (window.__pc?.state() as unknown as { game: { diag: { botFallbacks: number } } }).game.diag
        .botFallbacks,
  );

test.describe('brain.worker', () => {
  test('the bots decide in the worker: every decision comes back, none falls back', async ({
    page,
  }, testInfo) => {
    test.skip(sizeOf(testInfo) !== '1280x800', 'one viewport per browser');
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    const seed = seedFor(testInfo);
    await startTable(page, seed, { players: 6 });
    // The log as it stands when the last hand ends: before the banner is tapped nothing is in flight.
    let log: LogEntry[] = [];
    const hands = await playHands(page, {
      hands: 4,
      random: prng(seed),
      onHandEnd: async () => {
        log = await brainLog(page);
      },
    });
    expect(hands).toHaveLength(4);

    // The log keeps the last 200 lines: at least the decisions of the last hand or two.
    const sent = log.filter((e) => e.what === 'out' && e.kind === 'botDecision');
    const answered = new Set(
      log.filter((e) => e.what === 'in' && e.kind === 'botDecision').map((e) => e.jobId),
    );
    expect(sent.length).toBeGreaterThan(8);
    // Every request that was not cancelled (a new hand) got its answer from the worker.
    const cancelled = new Set(
      log.filter((e) => e.what === 'out' && e.kind === 'cancel').map((e) => e.jobId),
    );
    for (const { jobId } of sent.filter((e) => !cancelled.has(e.jobId))) {
      expect(answered.has(jobId), `job ${jobId} was answered`).toBe(true);
    }
    expect(log.some((e) => ['timeout', 'crash', 'restart', 'failed'].includes(e.what))).toBe(false);
    expect(await fallbacks(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});
