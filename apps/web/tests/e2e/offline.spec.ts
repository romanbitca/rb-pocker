import { expect, heading, test as base, waitForServiceWorkerControl } from './fixtures.ts';
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

test('the shell still loads offline once the service worker controls the page', async ({
  page,
  context,
  server,
  browserName,
}) => {
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
});
