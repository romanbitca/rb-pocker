import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { launchFragment, newTelegramUser, signInitData } from './telegram.ts';

/**
 * PLAN §19.11, Stage 10 acceptance 10: Telegram Web shows the Mini App in an iframe on its own
 * hosts, and no other page may frame the game. The outer page is routed (nothing reaches the
 * internet); the game in the iframe comes from the real server, with its real headers.
 */

/** §19.2: the hosts that show a Mini App in an iframe. */
const TELEGRAM_WEB = [
  'https://web.telegram.org',
  'https://webk.telegram.org',
  'https://weba.telegram.org',
];

/** Other origins, including the ones a loose host check would let through. */
const OTHER_ORIGINS = [
  'https://example.com',
  'https://telegram.org',
  'https://webz.telegram.org',
  'https://evil.web.telegram.org',
  'https://web.telegram.org.example.com',
];

/** Opens the routed `parent`, whose only content is an iframe with the game at `src`. */
async function openInFrame(
  context: BrowserContext,
  page: Page,
  parent: string,
  src: string,
  head = '',
): Promise<void> {
  // Chromium stops a public page from framing localhost until the user allows it. The real game
  // is not on a local address, and without this nothing would ever reach the frame-ancestors check.
  await context.grantPermissions(['local-network-access'], { origin: parent });
  await page.route(`${parent}/`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html>${head}<iframe id="game" title="game" src="${src}" style="width:100vw;height:100vh;border:0"></iframe>`,
    }),
  );
  await page.goto(`${parent}/`);
}

test.describe('the game in a frame', () => {
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-phone-390x844', 'Chromium at one size');
  });

  for (const parent of TELEGRAM_WEB) {
    test(`${parent} can show the game in an iframe`, async ({
      context,
      page,
      baseURL,
      forbiddenRequests,
    }) => {
      const problems: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') problems.push(`console: ${message.text()}`);
      });
      page.on('pageerror', (error) => problems.push(`uncaught: ${error.message}`));

      await openInFrame(context, page, parent, `${baseURL}/`);

      const game = page.frameLocator('#game');
      await expect(game.getByRole('heading', { level: 1 })).toHaveText('RB Poker Coach');
      await expect(game.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
      expect(problems).toEqual([]);

      // The outer page is the one request that leaves the origin: the game in it makes none.
      expect(forbiddenRequests).toEqual([`leaves the origin: GET ${parent}/`]);
      forbiddenRequests.length = 0;
    });
  }

  for (const parent of OTHER_ORIGINS) {
    test(`${parent} cannot`, async ({ context, page, baseURL, forbiddenRequests }) => {
      const refused = page.waitForEvent('console', {
        predicate: (message) =>
          message.type() === 'error' && message.text().includes('frame-ancestors'),
      });

      await openInFrame(context, page, parent, `${baseURL}/`);
      await refused;

      // The browser dropped the response, so the game never ran in the frame.
      await expect(page.frameLocator('#game').getByRole('heading', { level: 1 })).toHaveCount(0);
      const frame = page.frames().find((f) => f !== page.mainFrame());
      expect(frame?.url().startsWith(`${baseURL}`)).toBe(false);

      expect(forbiddenRequests).toEqual([`leaves the origin: GET ${parent}/`]);
      forbiddenRequests.length = 0;
    });
  }
});

test.describe('Play with friends in the frame of Telegram Web', () => {
  test.use({ multiplayer: true });

  test('the game speaks to its parent and opens its own socket under the real CSP', async ({
    context,
    page,
    baseURL,
    forbiddenRequests,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-phone-390x844', 'Chromium at one size');
    const parent = 'https://web.telegram.org';
    const src = `${baseURL}/${launchFragment(signInitData(newTelegramUser('Ann')))}`;
    const heard =
      "<script>window.heard=[];addEventListener('message',(e)=>heard.push(e.data));</script>";
    await openInFrame(context, page, parent, src, heard);

    const game = page.frameLocator('#game');
    await game.getByRole('button', { name: 'Play with friends', exact: true }).click();
    await expect(game.getByRole('heading', { level: 1 })).toHaveText('New table');
    await game.getByRole('button', { name: 'Create table', exact: true }).click();
    await expect(game.getByRole('heading', { level: 1 })).toHaveText(/^Table [2-9A-HJKMNP-Z]{8}$/);

    const said = await page.evaluate(() =>
      ((window as unknown as { heard: string[] }).heard ?? []).map(
        (m) => (JSON.parse(m) as { eventType: string }).eventType,
      ),
    );
    expect(said).toEqual(expect.arrayContaining(['iframe_ready', 'web_app_ready']));
    // The outer page is the one request that leaves the origin; the socket was the game's own.
    expect(forbiddenRequests).toEqual([`leaves the origin: GET ${parent}/`]);
    forbiddenRequests.length = 0;
  });
});
