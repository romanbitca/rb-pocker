import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import {
  collectErrors,
  installLongTaskObserver,
  longTasks,
  newTable,
  openApp,
  playHands,
  prng,
  seedFor,
  startTable,
} from './game.ts';

// PLAN §15.3: no main-thread long task (> 50 ms) during play, from a `longtask`
// PerformanceObserver (Chromium: WebKit has no Long Tasks API). A long task is wall time, so a
// busy machine makes them by itself: this spec runs in its own project, `chromium-perf-390x844`
// (playwright.config.ts), which waits for every other project to finish, so it plays alone.

test('no main-thread task over 50 ms during 25 hands with 6 players', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  const seed = seedFor(testInfo);
  await page.clock.install();
  await startTable(page, seed, { players: 6 });
  expect(await installLongTaskObserver(page), 'the Long Tasks API').toBe(true);

  const hands = await playHands(page, { hands: 25, random: prng(seed), fast: true });
  expect(hands).toHaveLength(25);
  expect(await longTasks(page)).toEqual([]);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------------------------
// Stage 4 acceptance 3 (§15.3 "Win %: preflop / first postflop number / final ≤ 50 / 150 / 600 ms
// at 6× throttle", checked by the worker timing logs; "no main-thread long task > 50 ms").
//
// ⚠️ CDP's `Emulation.setCPUThrottlingRate` slows the page's main thread only: sent to a worker's
// own CDP session it answers "Operation is only supported for pages, not workers" (checked with
// Playwright 1.63's Chromium). So the main thread runs truly 6× slower here, and the worker's
// numbers come from its timing logs (every reply's `timing`, Appendix A.6 `JobTiming`): a CPU 6×
// slower stretches only the computing, so a reply at `ms` with `busyMs` of it spent computing
// would come at `ms + 5 × busyMs`. That model is what the budgets are checked against; the real
// (unthrottled) worker times are reported next to it.

/** The CPU slow-down (§15.3). */
const RATE = 6;
const BUDGET = { preflopFinal: 50, firstPostflop: 150, final: 600 } as const;

interface Timing {
  ms: number;
  busyMs: number;
  final: boolean;
}

interface Job {
  jobId: number;
  /** The log's summary of the request: "board 3 · 5 opponents". */
  detail: string;
  first: Timing | null;
  final: Timing | null;
}

interface LogLine {
  what: string;
  kind?: string;
  jobId?: number;
  detail?: string;
  timing?: Timing;
}

const modelled = (t: Timing): number => t.ms + (RATE - 1) * t.busyMs;

/** Reads the worker message log (it keeps 200 lines) into `jobs`, by job id. */
async function collectJobs(page: Page, jobs: Map<number, Job>): Promise<void> {
  const log = await page.evaluate(
    () => (window.__pc?.logs() as unknown as { equity: LogLine[] }).equity,
  );
  for (const line of log) {
    if (line.kind !== 'equity' || line.jobId === undefined) continue;
    if (line.what === 'out' && !jobs.has(line.jobId)) {
      jobs.set(line.jobId, {
        jobId: line.jobId,
        detail: line.detail ?? '',
        first: null,
        final: null,
      });
    }
    const job = jobs.get(line.jobId);
    if (line.what !== 'in' || job === undefined || line.timing === undefined) continue;
    job.first ??= line.timing;
    if (line.timing.final) job.final = line.timing;
  }
}

/** Waits until the hero's win chance is no longer being computed. */
async function waitForEquity(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const eq = (window.__pc?.state() as unknown as { equity?: { status: string } }).equity;
      return eq !== undefined && eq.status !== 'computing';
    },
    undefined,
    { timeout: 15_000 },
  );
}

const boardOf = (job: Job): number => Number(/board (\d)/.exec(job.detail)?.[1] ?? -1);

function report(testInfo: TestInfo, jobs: Job[]): string {
  const row = (label: string, times: Timing[]) => {
    if (times.length === 0) return `${label.padEnd(34)} (none)`;
    const real = Math.max(...times.map((t) => t.ms));
    const model = Math.max(...times.map(modelled));
    return `${label.padEnd(34)} n=${String(times.length).padStart(3)}  max ${real.toFixed(1).padStart(6)} ms real, ${model.toFixed(1).padStart(6)} ms at ${RATE}×`;
  };
  const pre = jobs.filter((j) => boardOf(j) === 0);
  const post = jobs.filter((j) => boardOf(j) >= 3);
  const text = [
    `win chance timings (worker timing logs; ${RATE}× = ms + ${RATE - 1} × busy ms):`,
    row(
      `preflop final (≤ ${BUDGET.preflopFinal} ms)`,
      pre.flatMap((j) => j.final ?? []),
    ),
    row(
      `first postflop number (≤ ${BUDGET.firstPostflop} ms)`,
      post.flatMap((j) => j.first ?? []),
    ),
    row(
      `postflop final (≤ ${BUDGET.final} ms)`,
      post.flatMap((j) => j.final ?? []),
    ),
    row(
      `any final (≤ ${BUDGET.final} ms)`,
      jobs.flatMap((j) => j.final ?? []),
    ),
  ].join('\n');
  void testInfo.attach('win-chance-timings.json', {
    body: JSON.stringify(jobs, null, 2),
    contentType: 'application/json',
  });
  return text;
}

test('at 6× CPU: win chance within its budgets, no main-thread task over 50 ms in 20 hands (Stage 4, 3)', async ({
  page,
}, testInfo) => {
  test.setTimeout(600_000);
  const errors = collectErrors(page);
  const seed = seedFor(testInfo);
  await openApp(page, seed);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE });
  // Nine players: eight opponents is the heaviest win chance (§15.4). Real time: a fake clock
  // would fire the 4 s equity timeout while the worker (on the real clock) computes.
  await newTable(page, { players: 9, speed: 'instant' });
  expect(await installLongTaskObserver(page), 'the Long Tasks API').toBe(true);

  const jobs = new Map<number, Job>();
  const hands = await playHands(page, {
    hands: 20,
    random: prng(seed),
    beforeHeroAct: async () => {
      await waitForEquity(page);
      await collectJobs(page, jobs);
    },
    onHandEnd: () => collectJobs(page, jobs),
  });
  await collectJobs(page, jobs);
  expect(hands).toHaveLength(20);

  const all = [...jobs.values()];
  console.info(report(testInfo, all));
  const pre = all.filter((j) => boardOf(j) === 0);
  const post = all.filter((j) => boardOf(j) >= 3);
  expect(
    pre.some((j) => j.final !== null),
    'preflop finals measured',
  ).toBe(true);
  expect(
    post.some((j) => j.final !== null),
    'postflop finals measured',
  ).toBe(true);
  for (const job of pre) {
    if (job.final !== null)
      expect(modelled(job.final), job.detail).toBeLessThanOrEqual(BUDGET.preflopFinal);
  }
  for (const job of post) {
    if (job.first !== null)
      expect(modelled(job.first), job.detail).toBeLessThanOrEqual(BUDGET.firstPostflop);
    if (job.final !== null)
      expect(modelled(job.final), job.detail).toBeLessThanOrEqual(BUDGET.final);
  }
  expect(await longTasks(page)).toEqual([]);
  expect(errors).toEqual([]);
});
