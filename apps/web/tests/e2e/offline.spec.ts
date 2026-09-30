import { expect, heading, test as base, waitForServiceWorkerControl } from './fixtures.ts';
import type { HandState } from '../../src/engine/types.ts';
import { collectErrors, nextFlowPoint, pcState, slot } from './game.ts';
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
}) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await page.goto('/');
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
  let hand: HandState | null = null;
  for (let hands = 0; hands < 10 && hand?.result?.endedBy !== 'showdown'; hands++) {
    if (hand !== null) await page.locator('[data-hand-end]').click();
    for (let point = await nextFlowPoint(page); point !== 'end';) {
      if (point === 'hero') await slot(page, 'middle').click();
      point = await nextFlowPoint(page);
    }
    hand = (await pcState(page)).game.hand;
  }
  expect(
    hand?.seats.filter((s) => s.dealtIn),
    'six players',
  ).toHaveLength(6);
  expect(hand?.result?.endedBy, 'a hand reached the showdown').toBe('showdown');
  await expect(page.locator('[data-hand-end]')).toBeVisible();

  if ((await page.locator('main[data-layout="wide"]').count()) === 0) {
    await page.locator('[data-table-box] + div button').click();
    await expect(page.getByRole('dialog', { name: /Poker hands/ })).toBeVisible();
  } else {
    await expect(page.getByRole('complementary', { name: /Poker hands/ })).toBeVisible();
  }
  await expect(page.locator('[data-category]')).toHaveCount(10);
  expect(errors).toEqual([]);
});
