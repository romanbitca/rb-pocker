import type { Page } from '@playwright/test';
import { STALE_RELOAD_KEY } from '../../src/app/lifecycle.ts';
import { en } from '../../src/i18n/en.ts';
import { expect, test } from './fixtures.ts';
import {
  collectErrors,
  newTable,
  nextFlowPoint,
  openApp,
  pcState,
  reloadAfterBust,
  seedFor,
  sizeOf,
  slot,
  tapNextHand,
  type FlowPoint,
} from './game.ts';

// PLAN §15.1 "Redeploys" (chunk `feature/stage-9-follow-ups`): a redeploy takes the old hashed
// chunks away, and a page without a service worker (an insecure page, a first visit) that still
// runs the old version cannot load a lazy chunk it has not loaded yet. Vite fires
// `vite:preloadError`; the page reloads into the new version once, at a safe moment, never
// mid-hand (the same moments as a new version, chunk 9.5).
//
// Here the page has no service worker, as on a plain-http LAN address (§12.14: no
// `navigator.serviceWorker`), so nothing comes from a cache, and the server answers 404 for Learn's
// chunk, as after a redeploy. Mid-hand, the Menu's Learn cannot load: its page says so, but
// nothing reloads, and no toast says "Update ready" (a failed chunk proves no new version); the
// hand plays to its end in the same page; the tap that would deal the next hand reloads the page,
// and the reloaded page deals that hand at the Table. The reloaded page here is the same build, so Learn fails
// again: the note in sessionStorage stops a second reload (no loop).
//
// One phone size per browser: the scenario is about versions, not layout.

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'serviceWorker', {
      configurable: true,
      get: () => undefined,
    });
  });
});

/** A marker on this page's `window`: gone once the page has reloaded. */
const markPage = (page: Page): Promise<void> =>
  page.evaluate(() => {
    Object.assign(window, { __oldPage: true });
  });
const samePage = (page: Page): Promise<boolean> =>
  page.evaluate(() => '__oldPage' in window).catch(() => false);

/** sessionStorage's note of the chunk a reload was asked for (`watchStaleChunks`), or null. */
const note = (page: Page): Promise<{ chunk: string; at: number } | null> =>
  page.evaluate(
    (key) => JSON.parse(sessionStorage.getItem(key) ?? 'null') as { chunk: string; at: number },
    STALE_RELOAD_KEY,
  );

/** Menu → Learn at the Table: Learn's chunk is gone, so its page says so; Back to the hand. */
async function learnFails(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Learn', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Learn');
  await expect(page.getByText(en.screens.loadFailed)).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.locator('[data-hero-cards]')).toBeVisible();
}

/** The hero checks or calls to the hand's end, in the same page all along. */
async function playOutInSamePage(page: Page): Promise<FlowPoint> {
  let point: FlowPoint = await nextFlowPoint(page);
  while (point === 'hero') {
    expect(await samePage(page), 'never reloads mid-hand').toBe(true);
    await slot(page, 'middle').click();
    point = await nextFlowPoint(page);
  }
  return point;
}

/** The tap that deals the next hand: the banner (or the summary), or Reload after a bust. */
async function dealNext(page: Page, point: FlowPoint): Promise<void> {
  if (point === 'bust') await reloadAfterBust(page);
  else await tapNextHand(page);
}

test.describe('a lazy chunk gone after a redeploy (§15.1 "Redeploys")', () => {
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(sizeOf(testInfo) !== '390x844', 'one phone size per browser');
  });

  test('mid-hand: no reload; between hands: one reload, back at the Table; never a loop', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    await page.route('**/assets/Learn-*.js', (route) =>
      route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' }),
    );
    await openApp(page, seedFor(testInfo));
    expect(
      await page.evaluate(() => 'serviceWorker' in navigator && !!navigator.serviceWorker),
    ).toBe(false);
    await newTable(page, { players: 3, speed: 'instant', autoNext: false });
    expect(await nextFlowPoint(page)).toBe('hero');
    const handSeq = (await pcState(page)).game.hand?.handSeq as number;
    await markPage(page);

    // Mid-hand: Learn cannot load. No reload and no toast; the failed chunk is noted.
    await learnFails(page);
    expect((await pcState(page)).ui.toasts.map((t) => t.kind)).not.toContain('updateReady');
    await expect(page.getByText(en.toast.updateReady)).toHaveCount(0);
    expect(await samePage(page)).toBe(true);
    const first = await note(page);
    expect(first?.chunk).toMatch(/Learn-[\w-]+\.js|Importing a module script failed/);

    // The hand plays to its end in the same page; the result waits for its tap.
    const point = await playOutInSamePage(page);
    expect((await pcState(page)).game.hand?.handSeq).toBe(handSeq);
    await page.waitForTimeout(1500);
    expect(await samePage(page)).toBe(true);

    // The tap that would deal the next hand: the page reloads, and deals it at the Table.
    await dealNext(page, point);
    await expect.poll(() => samePage(page), { timeout: 30_000 }).toBe(false);
    await page.waitForFunction(
      (seq) => {
        const s = window.__pc?.state();
        return s?.ui.screen === 'table' && s.game.hand?.handSeq === seq;
      },
      handSeq + 1,
      { timeout: 30_000 },
    );
    expect((await note(page))?.chunk).toBe(first?.chunk);

    // The reloaded page still cannot load Learn (the same build here): no second reload.
    await markPage(page);
    expect(await nextFlowPoint(page)).toBe('hero');
    await learnFails(page);
    const again = await playOutInSamePage(page);
    await dealNext(page, again);
    await page.waitForFunction(
      (seq) => (window.__pc?.state().game.hand?.handSeq ?? 0) > seq,
      handSeq + 1,
      { timeout: 30_000 },
    );
    expect(await samePage(page), 'the next hand is dealt in the same page').toBe(true);
    expect(await note(page), 'the first note stands: no new reload was asked for').toEqual(first);

    // The browser logs each failed load of Learn's chunk; nothing else went wrong.
    expect(errors.filter((e) => !/Learn-|module script|404|Not Found/i.test(e))).toEqual([]);
  });
});
