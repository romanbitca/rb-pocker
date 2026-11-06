import { test as base, expect, type Page } from '@playwright/test';

/**
 * PLAN §15.2: the game makes no network requests at run time, not even to its own `/api`.
 *
 * Every spec imports `test` and `expect` from this file, never from '@playwright/test'. The
 * automatic `forbiddenRequests` fixture listens to the whole browser context (every page and the
 * service worker) and records each request that leaves the app's origin or goes to `/api`, and
 * every WebSocket. At the end of the test it fails the test if it recorded anything. A test that
 * makes such a request on purpose checks the list and then empties it.
 */

/** Why a request to `url` is forbidden, or null when the app may make it. */
export function forbiddenReason(url: string, appOrigin: string): string | null {
  const target = new URL(url);
  // data: images are allowed by the CSP (img-src 'self' data:) and never touch the network.
  if (target.protocol === 'data:') return null;
  // A blob: URL carries the origin that created it.
  if (target.origin !== appOrigin) return 'leaves the origin';
  // Express matches routes case-insensitively, so /API/health would reach the API too.
  const path = target.pathname.toLowerCase();
  if (path === '/api' || path.startsWith('/api/')) return 'goes to /api';
  return null;
}

/**
 * PLAN §12.11 (chunk 9.3): the first-table tips wait for a tap, and the specs' flows do not tap
 * them, so they are off in every spec (an init script sets `window.__pcNoTips` before the app
 * loads, `app/testHooks.ts`) unless a spec turns them on: `test.use({ firstTableTips: true })`.
 * The E2E build reads it; a production build has no hooks and always shows the tips.
 *
 * PLAN §12.11, §15.1 (chunk 9.5): "Ready to play offline." is off the same way
 * (`window.__pcNoOfflineToast`) unless a spec asks for it: `test.use({ offlineReadyToast: true })`.
 * Every spec starts in a fresh browser profile, so the first service worker installs during the
 * spec and the toast would show at the top of the screen at a moment the spec does not control,
 * over what it taps next (and for good on a paused clock).
 */
export const test = base.extend<{
  forbiddenRequests: string[];
  firstTableTips: boolean;
  tipsSwitch: void;
  offlineReadyToast: boolean;
  offlineToastSwitch: void;
}>({
  firstTableTips: [false, { option: true }],
  offlineReadyToast: [false, { option: true }],
  offlineToastSwitch: [
    async ({ context, offlineReadyToast }, use) => {
      if (!offlineReadyToast) {
        await context.addInitScript(() => {
          Object.defineProperty(window, '__pcNoOfflineToast', { value: true });
        });
      }
      await use();
    },
    { auto: true },
  ],
  tipsSwitch: [
    async ({ context, firstTableTips }, use) => {
      if (!firstTableTips) {
        await context.addInitScript(() => {
          Object.defineProperty(window, '__pcNoTips', { value: true });
        });
      }
      await use();
    },
    { auto: true },
  ],
  forbiddenRequests: [
    async ({ context, baseURL }, use) => {
      if (baseURL === undefined) throw new Error('playwright.config.ts must set use.baseURL');
      const appOrigin = new URL(baseURL).origin;
      const found: string[] = [];
      context.on('request', (request) => {
        const reason = forbiddenReason(request.url(), appOrigin);
        if (reason !== null) found.push(`${reason}: ${request.method()} ${request.url()}`);
      });
      // Auto fixtures are set up before `page`, so this also sees the test's own page.
      context.on('page', (page) => {
        page.on('websocket', (socket) => found.push(`opens a WebSocket: ${socket.url()}`));
      });

      await use(found);

      expect(found, 'PLAN §15.2: no request may leave the origin or go to /api').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** The shell's page heading (the only heading in Stage 0). */
export const heading = (page: Page) => page.getByRole('heading', { level: 1 });

/**
 * Waits until the service worker controls `page`, reloading once if needed. The worker registers
 * after the first load and precaches the build before it activates, but with `registerType:
 * 'prompt'` it does not claim open pages (no `clients.claim()`), so only a page loaded after it
 * activated is controlled (PLAN §15.1).
 */
export async function waitForServiceWorkerControl(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  const controlled = () => page.evaluate(() => navigator.serviceWorker.controller !== null);
  if (!(await controlled())) await page.reload();
  await expect.poll(controlled).toBe(true);
}
