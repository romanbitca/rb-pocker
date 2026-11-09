import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { collectErrors, pcState } from './game.ts';
import { startOwnServer, type OwnServer } from './own-server.ts';
import { newTelegramUser } from './telegram.ts';

/**
 * PLAN §18 Stage 10, acceptance 3 and 14, §19.6: outside Telegram, or for a player who only plays
 * alone inside it, Play with friends makes no connection. These specs run with the network guard
 * of `fixtures.ts` as every other spec has it (no `multiplayer` option): one WebSocket, or one
 * request to `/api`, fails the test.
 */

// eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
test.beforeEach(({}, testInfo) => {
  test.skip(!testInfo.project.name.endsWith('phone-390x844'), 'one phone size per browser');
});

const friends = (page: Page) =>
  page.getByRole('button', { name: 'Play with friends', exact: true });

test('outside Telegram there is no "Play with friends" and no WebSocket', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await page.goto('/');
  // Welcome: the first launch.
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await expect(friends(page)).toHaveCount(0);
  expect((await pcState(page)).ui.screen).toBe('welcome');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(() => window.__pc?.state().ui.screen === 'table');
  // Home: a later launch.
  await page.goto('/');
  await page.waitForFunction(() => window.__pc?.state().ui.screen === 'home');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await expect(friends(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test.describe('a server without a bot token', () => {
  const off = test.extend<{ server: OwnServer }>({
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

  off(
    'is the same game: no button, no socket, and the endpoints are off',
    async ({ page, server }, testInfo) => {
      test.skip(!testInfo.project.name.endsWith('phone-390x844'), 'one phone size per browser');
      const errors = collectErrors(page);
      await page.goto('/');
      await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
      await expect(friends(page)).toHaveCount(0);
      expect(errors).toEqual([]);
      // From this test, not from the page (the guard would fail it): the endpoints are not there.
      const webhook = await fetch(`${server.origin}/api/telegram/webhook`, { method: 'POST' });
      expect(webhook.status).toBe(404);
      const upgrade = await fetch(`${server.origin}/api/mp/ws`, {
        headers: { connection: 'upgrade', upgrade: 'websocket' },
      }).catch(() => null);
      expect(upgrade === null || upgrade.status === 404).toBe(true);
    },
  );
});

test('inside Telegram, a player who only plays alone makes no connection at all', async ({
  telegram,
}) => {
  test.setTimeout(90_000);
  const solo = await telegram.open(newTelegramUser('Ann'));
  const { page } = solo;
  // The app knows it is in Telegram: it has said so, and it offers the friends' table.
  await expect(friends(page)).toBeVisible();
  await expect
    .poll(async () => (await solo.events()).map((e) => e.type))
    .toEqual(expect.arrayContaining(['web_app_ready', 'web_app_expand']));

  // A real local game: the table's first hand is dealt, and the socket still stays shut.
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(() => {
    const s = window.__pc?.state();
    return s?.ui.screen === 'table' && s.game.hand !== null;
  });
  await expect(page.locator('[data-hero-cards] [role="img"]')).toHaveCount(2);

  // Back Home and a new launch: Telegram's parameters come from sessionStorage (§19.7).
  await page.goto('/');
  await page.waitForFunction(() => window.__pc?.state().ui.screen === 'home');
  expect((await pcState(page)).mp.active).toBe(false);
  await expect(friends(page)).toBeVisible();

  expect(solo.sockets).toEqual([]);
  expect(solo.errors).toEqual([]);
});
