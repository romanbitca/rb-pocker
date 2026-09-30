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
// (playwright.config.ts), which waits for every other project to finish and runs its tests one
// at a time, so each plays alone.

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
// Playwright 1.63's Chromium). So the long-task test slows the main thread for real, and the
// worker's numbers come from its timing logs (every reply's `timing`, Appendix A.6 `JobTiming`): a
// CPU r times slower stretches only the computing, so a reply at `ms` with `busyMs` of it spent
// computing would come at `ms + (r − 1) × busyMs`. That model is what the budgets are checked
// against; the real worker times are reported next to it.
//
// "6×" is 6× the dev Mac (Apple M1 Pro), the machine the budgets were checked on (PLAN §15.3,
// R16). CDP's rate is relative to the machine it runs on, and CI's 2-vCPU runner is about 2.5×
// slower: at a plain 6× it is a far slower "phone" (there the budgets passed only on a retry). So
// each test times a fixed loop on the main thread first, before any throttle, and uses
// r = 6 × REF_LOOP_MS ÷ that time (at least 1): 6 on the dev Mac, about 2.5 on CI.
//
// The halves are two tests. With the CDP throttle on, CI measured the worker 3–16× slower than the
// dev Mac (the throttled main thread, Playwright and the server share the runner's two CPUs), and
// the model would count that a second time. So the worker is measured with the main thread at full
// speed, and the long tasks with the throttle on.

/** The CPU slow-down, relative to the dev Mac (§15.3). */
const RATE = 6;
/** The dev Mac's time for `loopMs` (Chromium, best of five; 37.2–37.5 ms in five samples). */
const REF_LOOP_MS = 37.4;
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

/** Ms this machine's main thread takes for a fixed loop (the best of five). No throttle yet. */
function loopMs(page: Page): Promise<number> {
  return page.evaluate(() => {
    let best = Number.POSITIVE_INFINITY;
    let x = 0x9e3779b9 | 0;
    for (let run = 0; run < 5; run++) {
      const t = performance.now();
      for (let i = 0; i < 20_000_000; i++) {
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
      }
      best = Math.min(best, performance.now() - t);
    }
    return x === 0 ? Number.NaN : best; // x is never 0: it keeps the loop from being dropped
  });
}

/** The rate that makes this machine as slow as the dev Mac at 6× (see the note above). */
async function calibratedRate(page: Page): Promise<number> {
  const ms = await loopMs(page);
  const rate = Math.max(1, (RATE * REF_LOOP_MS) / ms);
  console.info(
    `speed loop ${ms.toFixed(1)} ms (dev Mac ${REF_LOOP_MS} ms): rate ${rate.toFixed(2)}×`,
  );
  return rate;
}

const modelled = (t: Timing, rate: number): number => t.ms + (rate - 1) * t.busyMs;

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
    // A light poll: the test's own work runs on the throttled main thread too.
    { polling: 100, timeout: 15_000 },
  );
}

const boardOf = (job: Job): number => Number(/board (\d)/.exec(job.detail)?.[1] ?? -1);

function report(testInfo: TestInfo, jobs: Job[], rate: number): string {
  const r = rate.toFixed(2);
  const row = (label: string, times: Timing[]) => {
    if (times.length === 0) return `${label.padEnd(34)} (none)`;
    const real = Math.max(...times.map((t) => t.ms));
    const model = Math.max(...times.map((t) => modelled(t, rate)));
    return `${label.padEnd(34)} n=${String(times.length).padStart(3)}  max ${real.toFixed(1).padStart(6)} ms real, ${model.toFixed(1).padStart(6)} ms at ${r}×`;
  };
  const pre = jobs.filter((j) => boardOf(j) === 0);
  const post = jobs.filter((j) => boardOf(j) >= 3);
  const text = [
    `win chance timings (worker timing logs; ${r}× = ms + ${(rate - 1).toFixed(2)} × busy ms):`,
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
  ].join('\n');
  void testInfo.attach('win-chance-timings.json', {
    body: JSON.stringify({ rate, jobs }, null, 2),
    contentType: 'application/json',
  });
  return text;
}

/**
 * 20 hands on a 9-player table (eight opponents is the heaviest win chance, §15.4) at Instant speed,
 * in real time (a fake clock would fire the 4 s equity timeout while the worker, on the real clock,
 * computes). At each hero turn it waits for the final win chance, then taps. `rate` > 1 throttles
 * the main thread over CDP. Returns the equity jobs of the worker message log.
 */
async function play20(page: Page, seed: string, rate: number): Promise<Job[]> {
  if (rate > 1) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  }
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
  return [...jobs.values()];
}

test('win chance within its budgets at 6× CPU, from the worker timing logs (Stage 4, 3)', async ({
  page,
}, testInfo) => {
  test.setTimeout(600_000);
  const errors = collectErrors(page);
  const seed = seedFor(testInfo);
  await openApp(page, seed);
  const rate = await calibratedRate(page);
  const all = await play20(page, seed, 1); // the main thread at full speed (see the note above)
  console.info(report(testInfo, all, rate));
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
  // Soft: one run reports every budget it misses.
  const worst = (times: number[]): number => Math.max(0, ...times);
  const at = (t: Timing | null): number[] => (t === null ? [] : [modelled(t, rate)]);
  const preFinals = pre.flatMap((j) => at(j.final));
  const postFirsts = post.flatMap((j) => at(j.first));
  const postFinals = post.flatMap((j) => at(j.final));
  expect.soft(worst(preFinals), 'preflop final at 6×').toBeLessThanOrEqual(BUDGET.preflopFinal);
  expect
    .soft(worst(postFirsts), 'first postflop number at 6×')
    .toBeLessThanOrEqual(BUDGET.firstPostflop);
  expect.soft(worst(postFinals), 'postflop final at 6×').toBeLessThanOrEqual(BUDGET.final);
  expect(errors).toEqual([]);
});

test('no main-thread task over 50 ms at 6× CPU in 20 hands (Stage 4, 3)', async ({
  page,
}, testInfo) => {
  test.setTimeout(600_000);
  const errors = collectErrors(page);
  const seed = seedFor(testInfo);
  await openApp(page, seed);
  const rate = await calibratedRate(page);
  await play20(page, seed, rate);
  const tasks = await longTasks(page);
  console.info(`main-thread tasks over 50 ms at ${rate.toFixed(2)}×: ${JSON.stringify(tasks)}`);
  expect(tasks).toEqual([]);
  expect(errors).toEqual([]);
});
