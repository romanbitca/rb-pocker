import { expect, heading, test as base, waitForServiceWorkerControl } from './fixtures.ts';
import { collectErrors, playHands, seedFor, type HandRecord } from './game.ts';
import { startOwnServer, type OwnServer } from './own-server.ts';

// PLAN §15.1, §15.2, Stage 0 acceptance 4: once loaded, the game works with no network at all.
// From Stage 3 this test also plays a full hand offline.
//
// The test gets its own server, so it can take the network away for real: it kills the server.
// In Chromium it also switches the browser offline. Not in WebKit: there Playwright's offline
// mode also fails every response the service worker gives, and a route that aborts requests sees
// the navigation before the service worker does, so neither can model "no network".
const test = base.extend<{ server: OwnServer }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixture's dependencies from this pattern
  server: async ({}, use) => {
    const server = await startOwnServer();
    await use(server);
    await server.stop();
  },
  // The page, and the network guard, use this server's origin.
  baseURL: async ({ server }, use) => {
    await use(server.origin);
  },
});

test('offline once the service worker controls the page: the app loads and a hand plays', async ({
  page,
  context,
  server,
  browserName,
}, testInfo) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  // A fixed seed per project (as in every other spec), so a failing run can be repeated.
  await page.goto(`/?seed=${seedFor(testInfo)}`);
  await expect(heading(page)).toHaveText('RB Poker Coach');
  await waitForServiceWorkerControl(page);

  await server.stop();
  if (browserName === 'chromium') {
    await context.setOffline(true);
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  }
  // Without the service worker this reload fails ("connection refused"): nothing answers.
  await page.evaluate(() => Object.assign(window, { loadedBeforeOffline: true }));
  await page.reload();

  expect(await page.evaluate(() => 'loadedBeforeOffline' in window)).toBe(false); // a new page
  await expect(heading(page)).toHaveText('RB Poker Coach');
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  // §15.2 from Stage 3: still offline, one tap on Play and a full 6-player hand to a showdown
  // (the hero checks or calls; a hand that ends without one is followed by the next), then the
  // hand rankings. Stats and Learn do not exist before Stages 8 and 9.
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('[data-hero-cards] [role="img"]')).toHaveCount(2);
  await page.evaluate(() =>
    window.__pc?.dispatch({ type: 'settings', patch: { speed: 'instant', autoNext: false } }),
  );
  const played: HandRecord[] = [];
  while (played.length < 10 && !played.some((r) => r.hand.result?.endedBy === 'showdown')) {
    played.push(...(await playHands(page, { hands: 1, random: () => 0.5 }))); // check or call
  }
  const showdown = played.find((r) => r.hand.result?.endedBy === 'showdown');
  expect(showdown?.players, 'a 6-player hand reached the showdown').toBe(6);

  // The hero can lose every chip on that hand (check or call also calls an all-in). The tap that
  // ended `playHands` then opened "You're out of chips", which covers the table until the player
  // reloads, so reload as a player would.
  const reload = page.getByRole('alertdialog').getByRole('button', { name: /^Reload / });
  if (await reload.isVisible()) await reload.click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  if ((await page.locator('main[data-layout="wide"]').count()) === 0) {
    await page.locator('[data-table-box] + div button').click();
    await expect(page.getByRole('dialog', { name: /Poker hands/ })).toBeVisible();
  } else {
    await expect(page.getByRole('complementary', { name: /Poker hands/ })).toBeVisible();
  }
  await expect(page.locator('[data-category]')).toHaveCount(10);
  expect(errors).toEqual([]);
});
