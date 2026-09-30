import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { collectErrors, openApp, seedFor, sizeOf } from './game.ts';

/**
 * `equity.worker` in real browsers (chunk 4.5; PLAN §2.2, §15.3; Stage 4 acceptance 5): the
 * module worker loads under the production CSP, answers with a final win chance and the hand
 * analysis, and a hidden tab cancels every job, as the worker message log
 * (`window.__pc.logs().equity`) shows. The worker is the same at every size, so one viewport per
 * browser runs it (Chromium and WebKit).
 */

interface LogEntry {
  what: string;
  kind?: string;
  jobId?: number;
}

interface EquityView {
  status: string;
  result: { n: number; equity: number; final: boolean } | null;
  situation: { nOpp: number } | null;
  analysis: unknown;
}

const equityOf = (page: Page): Promise<EquityView> =>
  page.evaluate(() => (window.__pc?.state() as unknown as { equity: EquityView }).equity);

const equityLog = (page: Page): Promise<LogEntry[]> =>
  page.evaluate(() => (window.__pc?.logs() as unknown as { equity: LogEntry[] }).equity);

/** Deals a 6-player table at Normal speed; `hide` closes the tab's `hidden` gate in the same task. */
async function deal(page: Page, hide: boolean): Promise<void> {
  await page.evaluate((hide) => {
    const pc = window.__pc;
    if (pc === undefined) throw new Error('no window.__pc: is this the E2E build?');
    pc.dispatch({ type: 'settings', patch: { speed: 'normal', autoNext: false } });
    pc.dispatch({ type: 'newTable', setup: { players: 6 }, confirmed: true });
    if (hide) pc.dispatch({ type: 'visibility', hidden: true });
  }, hide);
}

const done = (page: Page): Promise<unknown> =>
  page.waitForFunction(() => {
    const e = (window.__pc?.state() as unknown as { equity: EquityView } | undefined)?.equity;
    return e?.status === 'done' && e.analysis !== null;
  });

test.describe('equity.worker', () => {
  test('answers with a final win chance and the hand analysis', async ({ page }, testInfo) => {
    test.skip(sizeOf(testInfo) !== '1280x800', 'one viewport per browser');
    const errors = collectErrors(page);
    await openApp(page, seedFor(testInfo));
    await deal(page, false);
    await done(page);
    const eq = await equityOf(page);
    expect(eq.result?.final).toBe(true);
    expect(eq.result?.equity).toBeGreaterThan(0);
    expect(eq.result?.equity).toBeLessThan(1);
    expect(eq.situation?.nOpp).toBeGreaterThanOrEqual(1);
    const log = await equityLog(page);
    expect(log.some((e) => e.what === 'in' && e.kind === 'equity')).toBe(true);
    expect(log.some((e) => ['timeout', 'crash', 'failed'].includes(e.what))).toBe(false);
    expect(errors).toEqual([]);
  });

  test('a hidden tab cancels every job (message log); visible again sends them again', async ({
    page,
  }, testInfo) => {
    test.skip(sizeOf(testInfo) !== '1280x800', 'one viewport per browser');
    await openApp(page, seedFor(testInfo));
    await deal(page, true);
    const log = await equityLog(page);
    const sent = log.filter((e) => e.what === 'out' && e.kind !== 'cancel').map((e) => e.jobId);
    const cancelled = log
      .filter((e) => e.what === 'out' && e.kind === 'cancel')
      .map((e) => e.jobId);
    expect(sent.length).toBeGreaterThanOrEqual(2); // the win chance and the hand analysis
    expect(cancelled).toEqual(sent);
    // While hidden nothing goes out and nothing is delivered.
    await page.waitForTimeout(500);
    const later = (await equityLog(page)).slice(log.length);
    expect(later.filter((e) => e.what === 'out' || e.what === 'in')).toEqual([]);
    expect((await equityOf(page)).status).toBe('computing');
    await page.evaluate(() => window.__pc?.dispatch({ type: 'visibility', hidden: false }));
    await done(page);
  });
});
