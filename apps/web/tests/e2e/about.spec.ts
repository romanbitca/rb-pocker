import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, heading, test, waitForServiceWorkerControl } from './fixtures.ts';
import { collectErrors, seedFor, sizeOf } from './game.ts';

// PLAN §12.1, Appendix G.6 (chunk 9.2c): the About screen. From the Table's Menu: every section,
// the help lines as phone links, the licences and the build's version; Back returns to the Table.
// From Welcome's Privacy link: About at its Privacy section. Its page is a lazy chunk that the
// service worker precaches, so it also opens offline (checked in Chromium: WebKit's offline mode
// also fails every service-worker response, pitfall 46).

const VERSION = (
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

const SECTIONS = [
  'How this app works',
  'How the coach works',
  'Privacy',
  'Play money only',
  'Help with gambling',
  'Licences',
];

/** A phone, a phone on its side and a desktop. */
const SIZES = ['375x667', '844x390', '1280x800'];

/** The About page with every section, the help lines, the licences and the version line. */
async function expectAboutPage(page: Page): Promise<void> {
  await expect(heading(page)).toHaveText('About');
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(SECTIONS);
  for (const line of [
    "No-Limit Texas Hold'em against computer bots, with play chips only.",
    'only what you can see: your cards, the board, the pot and every bet.',
    'There is no account, and nothing is sent to us or anyone else.',
    'Success here does not mean you will win at real-money poker.',
    'If gambling is causing problems for you or someone you know',
    'This app is built with open-source software:',
  ]) {
    await expect(page.getByText(line), line).toBeVisible();
  }
  await expect(page.getByRole('link', { name: '0808 8020 133' })).toHaveAttribute(
    'href',
    'tel:+448088020133',
  );
  await expect(page.getByRole('link', { name: '1-800-MY-RESET (1-800-697-3738)' })).toHaveAttribute(
    'href',
    'tel:+18006973738',
  );
  await expect(page.getByRole('listitem').filter({ hasText: /^react 19\.3\.0 · MIT/ })).toHaveCount(
    1,
  );
  // The build's version and short commit (vite.config.ts), never asked from the server.
  const version = VERSION.replaceAll('.', '\\.');
  await expect(
    page.getByText(new RegExp(`^Version ${version}( \\([0-9a-f]{4,40}\\))?$`)),
  ).toBeVisible();
}

test('About from the Menu: every section and the version; Back returns to the Table', async ({
  page,
}, testInfo) => {
  test.skip(!SIZES.includes(sizeOf(testInfo)), 'three layouts: phone, phone on its side, desktop');
  const errors = collectErrors(page);
  await page.goto(`/?seed=${seedFor(testInfo)}`);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('[data-hero-cards] [role="img"]')).toHaveCount(2);

  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Menu' })
    .getByRole('button', { name: 'About', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expectAboutPage(page);
  await expect(heading(page)).toBeFocused();

  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.locator('[data-hero-cards] [role="img"]')).toHaveCount(2);
  expect(await page.evaluate(() => window.__pc?.state().ui.screen)).toBe('table');
  expect(errors).toEqual([]);
});

test("Welcome's Privacy link opens About at its Privacy section", async ({ page }, testInfo) => {
  test.skip(sizeOf(testInfo) !== '375x667', 'one phone per browser');
  const errors = collectErrors(page);
  await page.goto(`/?seed=${seedFor(testInfo)}`);
  await expect(heading(page)).toHaveText('RB Poker Coach');
  await page.getByRole('button', { name: 'Privacy', exact: true }).click();

  const privacy = page.getByRole('heading', { level: 2, name: 'Privacy' });
  await expect(privacy).toBeFocused();
  await expect(privacy).toBeInViewport();
  await expect(heading(page)).toHaveText('About');
  await expect(page.getByText('Settings → Reset stats', { exact: false })).toBeVisible();

  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(heading(page)).toHaveText('RB Poker Coach');
  expect(errors).toEqual([]);
});

test('About opens offline once the service worker controls the page', async ({
  page,
  context,
  browserName,
}, testInfo) => {
  test.skip(
    browserName !== 'chromium',
    'WebKit fails service-worker responses offline (pitfall 46)',
  );
  test.skip(sizeOf(testInfo) !== '390x844', 'one phone');
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await page.goto(`/?seed=${seedFor(testInfo)}`);
  await waitForServiceWorkerControl(page);
  // About's chunk has not been loaded yet: offline, only the service worker's precache has it.
  await context.setOffline(true);
  await page.evaluate(() => window.__pc?.dispatch({ type: 'go', screen: 'about' }));
  await expectAboutPage(page);
  await context.setOffline(false);
  expect(errors).toEqual([]);
});
