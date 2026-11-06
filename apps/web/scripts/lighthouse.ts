/**
 * Lighthouse, mobile (PLAN §15.3 "Lighthouse mobile", Stage 9 acceptance 1; the `slow` job of
 * §17.5). `npm run lighthouse` (root) builds the production app and the server, then runs this:
 * `node scripts/lighthouse.ts [--port <n>] [--out <dir>]` from apps/web (`npm run lighthouse --
 * --port 3316` passes the flags through). The port is `--port`, else PORT, else 3000.
 *
 * 1. Serves apps/web/dist with the real server (`node apps/server/dist/main.js`, what `npm start`
 *    runs: the §17.2 headers, the cache rules, the service worker), after checking that nothing
 *    listens on the port already, so a server left running is never measured by mistake.
 * 2. Starts Chromium headless with a fresh profile (Playwright's, the one the E2E tests use;
 *    CHROME_PATH picks another) and runs one Lighthouse user flow with Lighthouse's default mobile
 *    settings (a Moto G Power screen; slow 4G and a 4× slower CPU, simulated):
 *    a. "First visit": a cold load of the app, which shows Welcome. Then the install check:
 *       Chrome's own (`Page.getInstallabilityErrors`, what Lighthouse's "installable" audit asked
 *       before Lighthouse 12 removed it with the PWA category) and the manifest's parse errors;
 *    b. "The Table, one tap after Play": Play tapped once, a snapshot when the hero has a decision;
 *    c. "Later visit": the app loaded again with the profile that first Play saved, so Home, and
 *       the service worker in control (a returning player's load).
 * 3. Passes when both visits score Performance ≥ 90, every step scores Accessibility ≥ 95, and the
 *    app is installable. Prints the scores, the metrics and what fell short, with the machine's
 *    load (Performance is measured on this machine's CPU: a busy machine scores lower); writes the
 *    report (`flow.html`) and its data (`flow.json`) to `lighthouse-report/` (gitignored). Exits 1
 *    when a budget is missed, 2 when it could not measure.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { availableParallelism, loadavg } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { generateReport, startFlow, type Config, type FlowResult } from 'lighthouse';
import puppeteer, { type Page } from 'puppeteer-core';
import { en } from '../src/i18n/en.ts';

const WEB = resolve(import.meta.dirname, '..');
const REPO = resolve(WEB, '../..');
const SERVER_MAIN = join(REPO, 'apps/server/dist/main.js');

/** PLAN §15.3, as Lighthouse scores them (0 to 1). */
export const LIGHTHOUSE_BUDGETS = { performance: 0.9, accessibility: 0.95 } as const;

/** The default (mobile) config; SEO and the agentic checks say nothing about an offline game. */
const CONFIG: Config = {
  extends: 'lighthouse:default',
  settings: { onlyCategories: ['performance', 'accessibility', 'best-practices'] },
};

const STEPS = {
  first: 'First visit (Welcome)',
  table: 'The Table, one tap after Play',
  later: 'Later visit (Home)',
} as const;

/** True while the action bar waits for the bots: the hero has no decision yet. */
const HERO_HAS_DECISION = `(() => {
  const bar = document.querySelector('[role="group"][aria-label=${JSON.stringify(en.actions.group)}]');
  return bar !== null && !(bar.textContent ?? '').includes(${JSON.stringify(en.actions.waiting)});
})()`;

class CannotMeasure extends Error {}

function options(): { port: number; out: string } {
  const { values } = parseArgs({
    options: { port: { type: 'string' }, out: { type: 'string' } },
    allowPositionals: false,
  });
  const port = Number(values.port ?? process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new CannotMeasure(`bad port ${values.port ?? process.env.PORT}`);
  }
  return { port, out: resolve(WEB, values.out ?? 'lighthouse-report') };
}

/** Nothing listens on `port`: it can be bound, and no server answers there. */
async function portFree(port: number): Promise<boolean> {
  const bindable = await new Promise<boolean>((done) => {
    const probe = createServer();
    probe.once('error', () => done(false));
    probe.listen({ port, host: '0.0.0.0', exclusive: true }, () => probe.close(() => done(true)));
  });
  if (!bindable) return false;
  try {
    await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(1000) });
    return false;
  } catch {
    return true;
  }
}

/** The server of `npm start` on `port`, once `/api/health` answers. */
async function startServer(port: number): Promise<ChildProcess> {
  const server = spawn(process.execPath, [SERVER_MAIN], {
    cwd: REPO,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  server.stderr?.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString('utf8')).slice(-2000);
  });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new CannotMeasure(`the server stopped (exit ${server.exitCode}):\n${stderr}`);
    }
    try {
      const health = await fetch(`http://localhost:${port}/api/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (health.ok) return server;
    } catch {
      // Not listening yet.
    }
    await new Promise((wake) => setTimeout(wake, 250));
  }
  server.kill();
  throw new CannotMeasure(`the server did not answer /api/health within 60 s:\n${stderr}`);
}

/**
 * Chrome's install check on the page as it is: its installability errors (none: Chrome would
 * offer to install it) and the manifest's own errors. One line per problem.
 */
async function installProblems(page: Page): Promise<string[]> {
  const cdp = await page.createCDPSession();
  try {
    const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
    const manifest = await cdp.send('Page.getAppManifest', {});
    const problems = installabilityErrors.map((error) => {
      const args = error.errorArguments.map((a) => `${a.name}=${a.value}`).join(', ');
      return args === '' ? error.errorId : `${error.errorId} (${args})`;
    });
    if (manifest.url === '') problems.push('the page links no manifest');
    for (const error of manifest.errors) problems.push(`manifest: ${error.message}`);
    return problems;
  } finally {
    await cdp.detach();
  }
}

/** The screen on show (ScreenSwitcher's `data-screen`), or null. */
async function screenOnShow(page: Page): Promise<string | null> {
  const screen: unknown = await page.evaluate(
    `document.querySelector('[data-screen]')?.getAttribute('data-screen') ?? null`,
  );
  return typeof screen === 'string' ? screen : null;
}

async function measure(url: string): Promise<{ result: FlowResult; install: string[] }> {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || chromium.executablePath(),
    headless: true,
    // Lighthouse sets the screen; Puppeteer's own 800×600 would only get in its way.
    defaultViewport: null,
    // As Playwright does on Linux: CI runners do not allow Chromium's sandbox.
    args: process.platform === 'linux' ? ['--no-sandbox'] : [],
  });
  try {
    const page = await browser.newPage();
    const flow = await startFlow(page, {
      name: 'RB Poker Coach',
      config: CONFIG,
      flags: { logLevel: 'error' },
    });

    await flow.navigate(url, { name: STEPS.first });
    const shown = await screenOnShow(page);
    if (shown !== 'welcome') throw new CannotMeasure(`a first visit shows ${shown}, not Welcome`);
    const install = await installProblems(page);

    // Play's one tap (§12.1), then the hero's first decision: the deal has been drawn.
    await page.locator(`::-p-aria([name="${en.welcome.play}"][role="button"])`).click();
    await page.waitForFunction(HERO_HAS_DECISION, { timeout: 60_000, polling: 200 });
    await flow.snapshot({ name: STEPS.table });

    await flow.navigate(url, { name: STEPS.later });
    const later = await screenOnShow(page);
    if (later !== 'home') throw new CannotMeasure(`a later visit shows ${later}, not Home`);

    return { result: await flow.createFlowResult(), install };
  } finally {
    await browser.close();
  }
}

type Lhr = FlowResult['steps'][number]['lhr'];

const percent = (score: number | null | undefined): string =>
  score === null || score === undefined ? '-' : String(Math.round(score * 100));

/** "1.2 s" for the metric audits that are times, as Lighthouse shows them. */
function metric(lhr: Lhr, id: string): string {
  return lhr.audits[id]?.displayValue ?? '-';
}

/** The audits of a category that lost it points, worst first: "color-contrast (0)". */
function shortfalls(lhr: Lhr, category: string): string[] {
  const refs = lhr.categories[category]?.auditRefs ?? [];
  return refs
    .filter((ref) => ref.weight > 0)
    .flatMap((ref) => {
      const audit = lhr.audits[ref.id];
      if (audit === undefined || audit.score === null || audit.score >= 0.9) return [];
      const shown = audit.displayValue === undefined ? '' : `, ${audit.displayValue}`;
      return [{ text: `${ref.id}: ${audit.title} (${percent(audit.score)}${shown})`, ref }];
    })
    .sort((a, b) => b.ref.weight - a.ref.weight)
    .map((row) => row.text);
}

/** The table, the notes and the misses (empty when everything passed). */
function judge(result: FlowResult, install: string[]): { lines: string[]; misses: string[] } {
  const lines: string[] = [];
  const misses: string[] = [];
  const first = result.steps[0]?.lhr;
  if (first !== undefined) {
    lines.push(
      `Lighthouse ${first.lighthouseVersion}, mobile (${first.configSettings.screenEmulation.width}×` +
        `${first.configSettings.screenEmulation.height}, slow 4G, CPU × ` +
        `${first.configSettings.throttling.cpuSlowdownMultiplier}, simulated)`,
      `Browser: ${first.environment.hostUserAgent}`,
      `Machine: load ${loadavg()
        .map((n) => n.toFixed(1))
        .join(' / ')} on ${availableParallelism()} cores; Lighthouse's CPU benchmark ` +
        `${Math.round(first.environment.benchmarkIndex)}`,
      ...first.runWarnings.map((warning) => `Warning: ${warning}`),
      '',
    );
  }
  lines.push(
    '| Step                           | Performance | Accessibility | Best practices | Result |',
    '| ------------------------------ | ----------: | ------------: | -------------: | ------ |',
  );
  for (const step of result.steps) {
    const { lhr } = step;
    // A snapshot has no load to score: Lighthouse gives its Performance 0 of 0 audits.
    const perf = lhr.gatherMode === 'navigation' ? lhr.categories.performance?.score : undefined;
    const a11y = lhr.categories.accessibility?.score;
    const missed: string[] = [];
    // The step itself failed (no paint, a crashed page): its scores are missing, and this says why.
    if (lhr.runtimeError !== undefined) {
      missed.push(`Lighthouse error: ${lhr.runtimeError.message}`);
    }
    if (lhr.gatherMode === 'navigation' && (perf ?? 0) < LIGHTHOUSE_BUDGETS.performance) {
      missed.push(`Performance ${percent(perf)} < ${LIGHTHOUSE_BUDGETS.performance * 100}`);
    }
    if ((a11y ?? 0) < LIGHTHOUSE_BUDGETS.accessibility) {
      missed.push(`Accessibility ${percent(a11y)} < ${LIGHTHOUSE_BUDGETS.accessibility * 100}`);
    }
    misses.push(...missed.map((m) => `${step.name}: ${m}`));
    lines.push(
      `| ${step.name.padEnd(30)} | ${percent(perf).padStart(11)} | ${percent(a11y).padStart(13)} | ` +
        `${percent(lhr.categories['best-practices']?.score).padStart(14)} | ` +
        `${(missed.length === 0 ? 'ok' : 'MISS').padEnd(6)} |`,
    );
  }
  lines.push('');
  if (install.length === 0) {
    lines.push('Installable: yes (Chrome reports no installability error; the manifest parses).');
  } else {
    lines.push(`Installable: NO\n  ${install.join('\n  ')}`);
    misses.push(`not installable: ${install.join('; ')}`);
  }
  for (const step of result.steps) {
    const { lhr } = step;
    if (lhr.gatherMode === 'navigation') {
      lines.push(
        `${step.name}: FCP ${metric(lhr, 'first-contentful-paint')} · LCP ` +
          `${metric(lhr, 'largest-contentful-paint')} · TBT ${metric(lhr, 'total-blocking-time')}` +
          ` · CLS ${metric(lhr, 'cumulative-layout-shift')} · Speed Index ${metric(lhr, 'speed-index')}`,
      );
    }
    for (const category of ['performance', 'accessibility', 'best-practices']) {
      const below = shortfalls(lhr, category);
      if (below.length > 0) lines.push(`  ${category} below 90: ${below.join('; ')}`);
    }
  }
  return { lines, misses };
}

async function main(): Promise<number> {
  const { port, out } = options();
  for (const file of [join(WEB, 'dist/index.html'), join(WEB, 'dist/sw.js'), SERVER_MAIN]) {
    if (!existsSync(file)) {
      throw new CannotMeasure(`${relative(REPO, file)} is missing: run \`npm run build\` first`);
    }
  }
  if (!(await portFree(port))) {
    throw new CannotMeasure(`port ${port} is in use: stop that server or pass --port <n>`);
  }
  const server = await startServer(port);
  let measured: { result: FlowResult; install: string[] };
  try {
    measured = await measure(`http://localhost:${port}/`);
  } finally {
    server.kill();
  }
  const { result, install } = measured;
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'flow.json'), `${JSON.stringify(result)}\n`);
  writeFileSync(join(out, 'flow.html'), generateReport(result, 'html'));

  const { lines, misses } = judge(result, install);
  console.log(lines.join('\n'));
  console.log(`\nReport: ${relative(process.cwd(), join(out, 'flow.html'))}`);
  if (misses.length === 0) {
    console.log('Lighthouse budgets (PLAN §15.3): all met.');
    return 0;
  }
  console.log(`Lighthouse budgets (PLAN §15.3) missed:\n  ${misses.join('\n  ')}`);
  return 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`lighthouse: ${error instanceof Error ? error.message : String(error)}`);
    if (!(error instanceof CannotMeasure) && error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(2);
  },
);
