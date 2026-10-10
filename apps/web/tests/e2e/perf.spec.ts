import { appendFileSync } from 'node:fs';
import type { Page, TestInfo } from '@playwright/test';
import { candidateKey } from '../../src/brain/ev.ts';
import type { PlayerAction } from '../../src/engine/types.ts';
import { expect, test } from './fixtures.ts';
import {
  collectErrors,
  installLongTaskObserver,
  longTasks,
  newTable,
  nextFlowPoint,
  openApp,
  pcState,
  playHands,
  prng,
  reloadAfterBust,
  seedFor,
  startTable,
  tapNextHand,
} from './game.ts';
import { tapAct } from './scripted.ts';

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
// Playwright 1.63's Chromium). So the long-task test runs the main thread truly 6× slower, and the
// worker's numbers come from its timing logs (every reply's `timing`, Appendix A.6 `JobTiming`): a
// CPU 6× slower stretches only the computing, so a reply at `ms` with `busyMs` of it spent
// computing would come at `ms + 5 × busyMs`. That model is what the budgets are checked against;
// the real (unthrottled) worker times are reported next to it.
//
// The rate is relative to the CPU that runs the test, and on the shared 2-vCPU CI runner the
// worker's busy time also holds the CPU it loses to the game, Playwright and the server, which the
// model then counts six times (PLAN R17: the postflop final was 539 to 748 ms there, 270 ms on the
// dev Mac). So these two checks only REPORT in CI (`PERF_REPORT_ONLY`, below); they are enforced
// on a developer machine by `npm run e2e:perf`, and on a real phone by `#bench` (§15.4).

/** The CPU slow-down (§15.3). */
const RATE = 6;
const BUDGET = { preflopFinal: 50, firstPostflop: 150, final: 600 } as const;

/**
 * Report-only: the numbers go to the console and the GitHub job summary, and a missed budget is a
 * warning, never a failure. On by default in CI (`CI` is set there) and with `PERF_REPORT_ONLY=1`;
 * off on a developer machine, where `npm run e2e:perf` fails on a missed budget, and with
 * `PERF_REPORT_ONLY=0`. A test that measured nothing, or a console error, fails in both modes.
 */
const REPORT_ONLY = (process.env.PERF_REPORT_ONLY ?? (process.env.CI ? '1' : '0')) === '1';
const MODE = REPORT_ONLY ? 'report only' : 'enforced';

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
    // A light poll: the test's own work runs on the throttled main thread too.
    { polling: 100, timeout: 15_000 },
  );
}

const boardOf = (job: Job): number => Number(/board (\d)/.exec(job.detail)?.[1] ?? -1);

/** One budget row of the report: the worst number measured, against its budget. */
interface Row {
  label: string;
  budget: number;
  /** How many replies were measured. */
  n: number;
  /** The worst reply as it came (the worker is not throttled). */
  real: number;
  /** The worst reply with the CPU 6× slower (§15.3): `ms + 5 × busyMs`. */
  at6x: number;
}

function winChanceRows(jobs: Job[]): Row[] {
  const pre = jobs.filter((j) => boardOf(j) === 0);
  const post = jobs.filter((j) => boardOf(j) >= 3);
  const row = (label: string, budget: number, times: Timing[]): Row => ({
    label,
    budget,
    n: times.length,
    real: Math.max(0, ...times.map((t) => t.ms)),
    at6x: Math.max(0, ...times.map(modelled)),
  });
  return [
    row(
      'Preflop final',
      BUDGET.preflopFinal,
      pre.flatMap((j) => j.final ?? []),
    ),
    row(
      'First postflop number',
      BUDGET.firstPostflop,
      post.flatMap((j) => j.first ?? []),
    ),
    row(
      'Postflop final',
      BUDGET.final,
      post.flatMap((j) => j.final ?? []),
    ),
  ];
}

/** Adds Markdown to the GitHub job summary (a file named by `GITHUB_STEP_SUMMARY`); nowhere else. */
function summarize(markdown: string): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file === undefined || file === '') return;
  try {
    appendFileSync(file, `${markdown}\n\n`);
  } catch {
    // The summary is a convenience: a test never fails because it could not be written.
  }
}

/**
 * Says that a budget was missed. On GitHub a `::warning::` line becomes an annotation on the run,
 * which stays green; elsewhere it is a plain line.
 */
function warn(message: string): void {
  const onGitHub = process.env.GITHUB_ACTIONS === 'true';
  console.info(
    onGitHub ? `::warning title=Perf budget (${MODE})::${message}` : `over budget: ${message}`,
  );
}

const NOTE =
  'CDP throttles the main thread only, so the worker is modelled: `ms + 5 × busy ms` from its ' +
  'timing logs. The shared CI runner is slower than the dev Mac, so a miss here is a hint, not ' +
  'a failure: the budgets are enforced by `npm run e2e:perf` on a developer machine and ' +
  'checked on a real phone with `#bench` (PLAN §15.3, §17.5).';

/** Prints the win-chance numbers (console and job summary), and enforces them unless report-only. */
function concludeWinChance(testInfo: TestInfo, jobs: Job[]): void {
  const rows = winChanceRows(jobs);
  const ms = (x: number): string => `${x.toFixed(1)} ms`;
  const over = (r: Row): boolean => r.at6x > r.budget;
  console.info(
    [
      `win chance at ${RATE}× CPU (${MODE}; worker timing logs, ${RATE}× = ms + ${RATE - 1} × busy ms):`,
      ...rows.map(
        (r) =>
          `${r.label.padEnd(22)} n=${String(r.n).padStart(3)}  budget ${ms(r.budget).padStart(9)}  ` +
          `real ${ms(r.real).padStart(9)}  at ${RATE}× ${ms(r.at6x).padStart(9)}  ${over(r) ? 'OVER' : 'ok'}`,
      ),
    ].join('\n'),
  );
  summarize(
    [
      `#### Win chance at ${RATE}× CPU (${MODE})`,
      '',
      `20 hands, 9 players, Chromium. ${NOTE}`,
      '',
      `| Check | Budget | At ${RATE}× (model) | Real | Measured | Result |`,
      '|---|---|---|---|---|---|',
      ...rows.map(
        (r) =>
          `| ${r.label} | ${ms(r.budget)} | ${ms(r.at6x)} | ${ms(r.real)} | ${r.n} | ${over(r) ? 'over budget' : 'ok'} |`,
      ),
    ].join('\n'),
  );
  void testInfo.attach('win-chance-timings.json', {
    body: JSON.stringify({ rows, jobs }, null, 2),
    contentType: 'application/json',
  });
  for (const r of rows) {
    if (REPORT_ONLY) {
      if (over(r)) warn(`${r.label} at ${RATE}×: ${ms(r.at6x)}, budget ${ms(r.budget)}`);
    } else {
      // Soft: one run reports every budget it misses.
      expect.soft(r.at6x, `${r.label} at ${RATE}×`).toBeLessThanOrEqual(r.budget);
    }
  }
}

/** Prints the long tasks (console and job summary), and enforces "none" unless report-only. */
function concludeLongTasks(tasks: { start: number; duration: number }[]): void {
  const list = tasks.map((t) => `${t.duration} ms`).join(', ');
  console.info(
    `main-thread tasks over 50 ms at ${RATE}× (${MODE}): ${JSON.stringify(tasks)} (budget: none)`,
  );
  summarize(
    [
      `#### Main-thread long tasks at ${RATE}× CPU (${MODE})`,
      '',
      `20 hands, 9 players, Chromium, the page's CPU throttled ${RATE}× over CDP. ${NOTE}`,
      '',
      '| Check | Budget | Measured | Result |',
      '|---|---|---|---|',
      `| Tasks over 50 ms | none | ${tasks.length === 0 ? 'none' : `${tasks.length} (${list})`} | ${tasks.length === 0 ? 'ok' : 'over budget'} |`,
    ].join('\n'),
  );
  if (REPORT_ONLY) {
    if (tasks.length > 0)
      warn(`${tasks.length} main-thread task(s) over 50 ms at ${RATE}×: ${list}`);
  } else {
    expect(tasks).toEqual([]);
  }
}

/**
 * 20 hands on a 9-player table (eight opponents is the heaviest win chance, §15.4) at Instant speed,
 * in real time (a fake clock would fire the 4 s equity timeout while the worker, on the real clock,
 * computes). At each hero turn it waits for the final win chance, then taps. `throttle` slows the
 * page's main thread 6× over CDP. Returns the equity jobs of the worker message log.
 */
async function play20(page: Page, seed: string, throttle: boolean): Promise<Job[]> {
  await openApp(page, seed);
  if (throttle) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE });
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

// The two halves of acceptance 3 are two tests. With the CDP throttle on, CI's 2-vCPU runner
// measured the worker 3 to 16 times slower than the same run on the dev Mac (the throttled main
// thread, Playwright and the server share the runner), and the 6× model would count that a second
// time. So the worker is measured with the main thread at full speed and modelled 6× slower, and
// the long tasks are measured with the throttle on.

test('win chance within its budgets at 6× CPU, from the worker timing logs (Stage 4, 3)', async ({
  page,
}, testInfo) => {
  test.setTimeout(600_000);
  const errors = collectErrors(page);
  const jobs = await play20(page, seedFor(testInfo), false);
  // Never skipped, even report-only: without these numbers there is nothing to report.
  expect(
    jobs.some((j) => boardOf(j) === 0 && j.final !== null),
    'preflop finals measured',
  ).toBe(true);
  expect(
    jobs.some((j) => boardOf(j) >= 3 && j.final !== null),
    'postflop finals measured',
  ).toBe(true);
  concludeWinChance(testInfo, jobs);
  expect(errors).toEqual([]);
});

test('no main-thread task over 50 ms at 6× CPU in 20 hands (Stage 4, 3)', async ({
  page,
}, testInfo) => {
  test.setTimeout(600_000);
  const errors = collectErrors(page);
  await play20(page, seedFor(testInfo), true);
  concludeLongTasks(await longTasks(page));
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------------------------
// Stage 6 acceptance 6 (§8.11, §11.3 r5): grading adds at most 50 ms after the action when the
// coach's EVs are cached (the hint was made at the start of the decision) and at most 150 ms when
// an exact-size EV is needed (a bet or raise whose size is not one of the hint's candidates, §8.9).
//
// What is timed is the grade job in the real brain.worker, from the moment the controller posts it
// (at the act) to the moment its reply is delivered, from the worker message log (`brainWorker`,
// `at` in ms). Real time, no throttle, Instant speed, a few untimed samples first (the first tap
// loads lazy code). A cached sample is a check or call, an exact-size sample a bet or raise of a
// size picked off the hint's candidates and more than 15% from the coach's own size (that one is
// graded Best without its EV, §8.9); both enter as a `dispatch` of the act, so that the reply is
// not queued behind the render of a tap (React draws a tap's update before the page reads the
// next message: a third row, a real tap on the middle button, reports that stretch, which is the
// page's own and has no budget). Like the Stage 4 checks it is report-only in CI (R17: the shared
// runner's load is the noise, here the page and the worker compete for 2 vCPUs) and enforced by
// `npm run e2e:perf`.

const GRADE_BUDGET = { cached: 50, exact: 150 } as const;
/** Timed samples of each kind, after `GRADE_WARM_UP` untimed ones. */
const GRADE_SAMPLES = 10;
const GRADE_WARM_UP = 2;

interface GradeLine {
  at: number;
  what: string;
  kind?: string;
  jobId?: number;
}

/** The newest grade job after `after` that has been answered: its id and its round trip, in ms. */
async function gradeTrip(page: Page, after: number): Promise<{ jobId: number; ms: number }> {
  let found: { jobId: number; ms: number } | null = null;
  await expect
    .poll(
      async () => {
        const log = await page.evaluate(
          () => (window.__pc?.logs() as unknown as { brainWorker: GradeLine[] }).brainWorker,
        );
        const out = log.findLast((l) => l.kind === 'grade' && l.what === 'out');
        if (out?.jobId === undefined || out.jobId <= after) return null;
        const back = log.find(
          (l) => l.kind === 'grade' && l.what === 'in' && l.jobId === out.jobId,
        );
        if (back === undefined) return null;
        found = { jobId: out.jobId, ms: back.at - out.at };
        return found.jobId;
      },
      { message: 'the grade came back', timeout: 15_000 },
    )
    .not.toBeNull();
  if (found === null) throw new Error('no grade job');
  return found;
}

/** A bet or raise of a legal size that is not a candidate of the hint, nor near its own size. */
async function offCandidate(page: Page): Promise<PlayerAction | null> {
  const s = await pcState(page);
  const [legal, decision] = [s.game.legal, s.coach.decision];
  if (legal === null || decision === null) return null;
  const type = legal.bet !== null ? 'bet' : legal.raise !== null ? 'raise' : null;
  if (type === null) return null;
  const { min, max } = legal[type] as { min: number; max: number };
  const rec = decision.action;
  for (let k = 1; k <= 40; k++) {
    const to = Math.min(max - 1, min + Math.round((k * (max - min)) / 41));
    if (to < min) break;
    const action: PlayerAction = { type, to };
    if (decision.ev[candidateKey(legal, action)] !== undefined) continue;
    if (rec.to !== undefined && Math.abs(to - rec.to) <= 0.15 * rec.to) continue;
    return action;
  }
  return null;
}

type GradeKind = 'cached' | 'exact' | 'tapped';
type GradeTimes = Record<GradeKind, number[]>;

/** Plays real hands (Keep my move on cards) and times the grade of each kind of move. */
async function gradeTimes(page: Page, seed: string): Promise<GradeTimes> {
  await openApp(page, seed);
  await newTable(page, { players: 6, speed: 'instant' });
  const times: GradeTimes = { cached: [], exact: [], tapped: [] };
  const want = GRADE_SAMPLES + GRADE_WARM_UP;
  let lastJob = 0;
  for (let hands = 0; hands < 80;) {
    if (Object.values(times).every((t) => t.length >= want)) break;
    const point = await nextFlowPoint(page);
    if (point === 'end') {
      hands++;
      await tapNextHand(page);
      continue;
    }
    if (point === 'bust') {
      await reloadAfterBust(page);
      continue;
    }
    // The hero's turn, its hint in: the answer the grade reads from the cache.
    await page.waitForFunction(() => {
      const s = window.__pc?.state();
      const h = s?.game.hand;
      return h !== null && h !== undefined && s?.coach.key === `${h.handSeq}:${h.log.length}`;
    });
    const off = times.exact.length <= times.cached.length ? await offCandidate(page) : null;
    let kind: GradeKind = 'tapped';
    if (off !== null) kind = 'exact';
    else if (times.cached.length < want) kind = 'cached';
    if (kind === 'tapped') {
      await tapAct(page, 'middle');
    } else {
      const legal = (await pcState(page)).game.legal;
      const action: PlayerAction =
        off ?? (legal?.canCheck === true ? { type: 'check' } : { type: 'call' });
      await page.evaluate((action) => {
        window.__pc?.dispatch({ type: 'act', action });
      }, action);
    }
    const trip = await gradeTrip(page, lastJob);
    lastJob = trip.jobId;
    times[kind].push(trip.ms);
  }
  return {
    cached: times.cached.slice(GRADE_WARM_UP),
    exact: times.exact.slice(GRADE_WARM_UP),
    tapped: times.tapped.slice(GRADE_WARM_UP),
  };
}

const spread = (times: number[]): { p50: number; p95: number; max: number } => {
  const sorted = [...times].sort((a, b) => a - b);
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return { p50: at(0.5), p95: at(0.95), max: sorted.at(-1) ?? 0 };
};

test('grading adds at most 50 ms (cached EVs) and 150 ms (an exact-size EV) after the action (Stage 6, 6)', async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000);
  const errors = collectErrors(page);
  const times = await gradeTimes(page, seedFor(testInfo));
  // Never skipped, even report-only: without these numbers there is nothing to report.
  expect(times.cached.length, 'cached grades measured').toBeGreaterThanOrEqual(GRADE_SAMPLES);
  expect(times.exact.length, 'exact-size grades measured').toBeGreaterThanOrEqual(GRADE_SAMPLES);

  const rows = [
    {
      label: 'Cached EVs',
      budget: GRADE_BUDGET.cached as number | null,
      n: times.cached.length,
      ...spread(times.cached),
    },
    {
      label: 'Exact-size EV',
      budget: GRADE_BUDGET.exact as number | null,
      n: times.exact.length,
      ...spread(times.exact),
    },
    // The same cached grade after a real tap: the page's own render comes first (no budget).
    { label: 'Cached, by a tap', budget: null, n: times.tapped.length, ...spread(times.tapped) },
  ];
  const ms = (x: number): string => `${x.toFixed(0)} ms`;
  const result = (r: (typeof rows)[number]): string =>
    r.budget === null ? 'reported' : r.max > r.budget ? 'over budget' : 'ok';
  console.info(
    [
      `grade after the action (${MODE}; brain.worker round trip, real time):`,
      ...rows.map(
        (r) =>
          `${r.label.padEnd(17)} n=${String(r.n).padStart(3)}  budget ${(r.budget === null ? '-' : ms(r.budget)).padStart(7)}  ` +
          `p50 ${ms(r.p50).padStart(6)}  p95 ${ms(r.p95).padStart(6)}  max ${ms(r.max).padStart(6)}  ${result(r)}`,
      ),
    ].join('\n'),
  );
  summarize(
    [
      `#### Grading after the action (${MODE})`,
      '',
      'Real time, 6 players, Chromium: the grade job from the act to its reply, from the brain.worker ' +
        'message log (whole milliseconds). A miss here is a hint, not a failure on this runner; ' +
        'enforced by `npm run e2e:perf` on a developer machine (PLAN §8.11, §17.5).',
      '',
      '| Check | Budget | Measured | p50 | p95 | Max | Result |',
      '|---|---|---|---|---|---|---|',
      ...rows.map(
        (r) =>
          `| ${r.label} | ${r.budget === null ? '-' : ms(r.budget)} | ${r.n} | ${ms(r.p50)} | ${ms(r.p95)} | ${ms(r.max)} | ${result(r)} |`,
      ),
    ].join('\n'),
  );
  void testInfo.attach('grade-timings.json', {
    body: JSON.stringify({ rows, times }, null, 2),
    contentType: 'application/json',
  });
  for (const r of rows) {
    if (r.budget === null) continue;
    if (REPORT_ONLY) {
      if (r.max > r.budget) warn(`${r.label} grade: max ${ms(r.max)}, budget ${ms(r.budget)}`);
    } else {
      expect.soft(r.max, `${r.label} grade, slowest of ${r.n}`).toBeLessThanOrEqual(r.budget);
    }
  }
  expect(errors).toEqual([]);
});
