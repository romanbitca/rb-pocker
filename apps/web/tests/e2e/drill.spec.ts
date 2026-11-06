import type { Locator, Page } from '@playwright/test';
import { expect, test as base, waitForServiceWorkerControl } from './fixtures.ts';
import { collectErrors, openApp, seedFor, sizeOf } from './game.ts';
import { startOwnServer, type OwnServer } from './own-server.ts';

// PLAN §13.5: the hand drill, a page of its own. From Home: play a few questions in two games
// (Name the hand, then Which wins), reload and find the stats kept (pc.v1.drill), then take the
// network away and play on: the page and its logic are precached chunks. Back closes a sheet
// first, then leaves the page. No Unicode suit is ever drawn (pitfall 31).
//
// The test runs on its own server so it can kill it for the offline part (as offline.spec.ts).
const test = base.extend<{ server: OwnServer }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixture's dependencies from this pattern
  server: async ({}, use) => {
    const server = await startOwnServer();
    await use(server);
    await server.stop();
  },
  baseURL: async ({ server }, use) => {
    await use(server.origin);
  },
});

const SUITS = /[♠-♧]/u;
const feedback = (page: Page): Locator => page.locator('[data-feedback]');
const question = (page: Page): Promise<string | null> =>
  page.locator('[data-question]').getAttribute('data-question');

/** Home, then its "Hand drill" button: the page with a question on show. */
async function openDrillFromHome(page: Page): Promise<void> {
  await page.evaluate(() => window.__pc?.dispatch({ type: 'go', screen: 'home' }));
  await page.getByRole('button', { name: 'Hand drill' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hand drill');
  await expect(page.locator('[data-question]')).toHaveCount(1);
}

/** Answers the question on show (any answer), then taps Next. */
async function answerOne(page: Page): Promise<void> {
  const options = page.locator('[data-option]');
  if ((await options.count()) > 0) {
    await options.first().click();
  } else {
    const names = page.locator('[data-name]');
    if ((await names.count()) > 0) await names.nth(3).click();
    const positions = page.locator('[data-position="5"]');
    if ((await positions.count()) > 0) await positions.click();
  }
  await expect(feedback(page)).toHaveAttribute('data-feedback', /^(right|wrong)$/);
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(feedback(page)).toHaveAttribute('data-feedback', '');
}

test('the hand drill: two games, stats kept over a reload, then offline', async ({
  page,
  context,
  server,
  browserName,
}, testInfo) => {
  test.skip(
    !['390x844', '1280x800'].includes(sizeOf(testInfo)),
    'one phone and one desktop size per browser',
  );
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await openApp(page, seedFor(testInfo));
  await openDrillFromHome(page);

  // Name the hand (the first game): three questions.
  expect(await question(page)).toBe('cards');
  for (let i = 0; i < 3; i++) await answerOne(page);
  await expect(page.locator('main')).toContainText('/3');

  // Which wins, from the game sheet; Back closes the sheet before it leaves the page.
  await page.locator('[data-drill-games]').click();
  const sheet = page.getByRole('dialog', { name: 'Choose a game' });
  await expect(sheet).toBeVisible();
  await page.evaluate(() => window.history.back());
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hand drill');
  await page.locator('[data-drill-games]').click();
  await page.locator('[data-game="versus"]').click();
  await expect(sheet).toHaveCount(0);
  expect(await question(page)).toBe('versus');
  for (let i = 0; i < 3; i++) await answerOne(page);
  await expect(page.locator('main')).toContainText('/6');
  expect(SUITS.exec(await page.content())?.[0], 'no Unicode suit').toBeUndefined();

  // Reload: the stats and the game are kept (pc.v1.drill).
  await page.reload();
  await page.waitForFunction(() => window.__pc?.state().game.mode !== 'booting');
  await openDrillFromHome(page);
  expect(await question(page)).toBe('versus');
  await page.locator('[data-drill-stats]').click();
  const stats = page.getByRole('dialog', { name: 'Your stats' });
  await expect(stats).toContainText('6 answered');
  await page.keyboard.press('Escape');
  await expect(stats).toHaveCount(0);

  // Offline: the page and its logic come from the service worker's precache.
  await waitForServiceWorkerControl(page);
  await server.stop();
  if (browserName === 'chromium') await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.__pc?.state().game.mode !== 'booting');
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await openDrillFromHome(page);
  await answerOne(page);
  await page.locator('[data-drill-stats]').click();
  await expect(page.getByRole('dialog', { name: 'Your stats' })).toContainText('7 answered');
  expect(errors).toEqual([]);
});
