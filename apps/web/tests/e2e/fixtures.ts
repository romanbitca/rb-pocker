import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { MP_WS_PATH } from '../../src/net/protocol.ts';
import {
  launchFragment,
  signInitData,
  telegramStandIn,
  toastWatch,
  type LaunchOptions,
  type TelegramEvent,
  type TelegramUser,
} from './telegram.ts';

/**
 * PLAN §15.2: the game makes no network requests at run time, not even to its own `/api`.
 *
 * Every spec imports `test` and `expect` from this file, never from '@playwright/test'. The
 * automatic `forbiddenRequests` fixture listens to the whole browser context (every page and the
 * service worker) and records each request that leaves the app's origin or goes to `/api`, and
 * every WebSocket. At the end of the test it fails the test if it recorded anything. A test that
 * makes such a request on purpose checks the list and then empties it.
 *
 * Stage 10: `test.use({ multiplayer: true })` also allows the game's own WebSocket to `MP_WS_PATH`
 * on its own origin (PLAN §19.10), and `telegram.open(user, …)` opens the app as a Telegram user, in
 * a browser context of its own with the same guard (`telegram.ts` signs a real `initData`).
 */

/**
 * Why a request to `url` is forbidden, or null when the app may make it. `multiplayer` (a spec of
 * Play with friends, PLAN §19.10): the game's own WebSocket to its own origin is allowed too.
 */
export function forbiddenReason(
  url: string,
  appOrigin: string,
  multiplayer = false,
): string | null {
  const target = new URL(url);
  if (target.protocol === 'ws:' || target.protocol === 'wss:') {
    const app = new URL(appOrigin);
    const own =
      target.host === app.host && target.protocol === (app.protocol === 'https:' ? 'wss:' : 'ws:');
    return multiplayer && own && target.pathname === MP_WS_PATH ? null : 'opens a WebSocket';
  }
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
  multiplayer: boolean;
  telegram: TelegramLauncher;
}>({
  firstTableTips: [false, { option: true }],
  offlineReadyToast: [false, { option: true }],
  multiplayer: [false, { option: true }],
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
    async ({ context, baseURL, multiplayer }, use) => {
      if (baseURL === undefined) throw new Error('playwright.config.ts must set use.baseURL');
      const found: string[] = [];
      // Auto fixtures are set up before `page`, so this also sees the test's own page.
      guardContext(context, new URL(baseURL).origin, multiplayer, found);

      await use(found);

      expect(found, 'PLAN §15.2: no request may leave the origin or go to /api').toEqual([]);
    },
    { auto: true },
  ],
  telegram: async (
    { browser, baseURL, multiplayer, firstTableTips, offlineReadyToast, forbiddenRequests },
    use,
  ) => {
    if (baseURL === undefined) throw new Error('playwright.config.ts must set use.baseURL');
    const contexts: BrowserContext[] = [];
    await use({
      async open(user, options = {}) {
        const origin = options.origin ?? new URL(baseURL).origin;
        // A context of its own: the options of the project (size, touch) come by themselves.
        const context = await browser.newContext({ baseURL: origin });
        contexts.push(context);
        guardContext(context, origin, multiplayer, forbiddenRequests);
        await options.prepare?.(context);
        await context.addInitScript(telegramStandIn);
        await context.addInitScript(toastWatch);
        if (!firstTableTips) {
          await context.addInitScript(() => {
            Object.defineProperty(window, '__pcNoTips', { value: true });
          });
        }
        if (!offlineReadyToast) {
          await context.addInitScript(() => {
            Object.defineProperty(window, '__pcNoOfflineToast', { value: true });
          });
        }
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('console', (message) => {
          if (message.type() === 'error') errors.push(`console: ${message.text()}`);
        });
        page.on('pageerror', (error) => errors.push(`uncaught: ${error.message}`));
        const sockets: string[] = [];
        const frames: WsFrame[] = [];
        page.on('websocket', (socket) => {
          sockets.push(socket.url());
          socket.on('framereceived', ({ payload }) => {
            frames.push({ to: 'client', text: String(payload) });
          });
          socket.on('framesent', ({ payload }) => {
            frames.push({ to: 'server', text: String(payload) });
          });
        });
        const launch = `/${launchFragment(signInitData(user, options))}`;
        await page.goto(launch);
        await page.waitForFunction(() => {
          const pc = window.__pc;
          return pc !== undefined && pc.state().game.mode !== 'booting';
        });
        return {
          context,
          page,
          user,
          errors,
          launch,
          sockets,
          frames,
          socketOrigin: origin.replace(/^http/, 'ws'),
          events: () => page.evaluate(() => window.__tgEvents ?? []),
        };
      },
    });
    await Promise.all(contexts.map((context) => context.close()));
  },
});

/** Records in `found` whatever `context` does that §15.2 forbids, in every page it opens. */
function guardContext(
  context: BrowserContext,
  appOrigin: string,
  multiplayer: boolean,
  found: string[],
): void {
  context.on('request', (request) => {
    const reason = forbiddenReason(request.url(), appOrigin);
    if (reason !== null) found.push(`${reason}: ${request.method()} ${request.url()}`);
  });
  context.on('page', (page) => {
    page.on('websocket', (socket) => {
      const reason = forbiddenReason(socket.url(), appOrigin, multiplayer);
      if (reason !== null) found.push(`${reason}: ${socket.url()}`);
    });
  });
}

/** One Telegram user in a browser context of their own (PLAN §19.10). */
export interface TelegramPlayer {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly user: TelegramUser;
  /** Console errors and uncaught exceptions so far. */
  readonly errors: string[];
  /** The URL (origin-relative) of this launch: `page.goto` it to open the app again. */
  readonly launch: string;
  /** Every WebSocket URL this page has opened, in order. */
  readonly sockets: string[];
  /** Every frame of those sockets, as it went over the wire (the leak spec reads them). */
  readonly frames: WsFrame[];
  /** `ws://…` of the player's origin. */
  readonly socketOrigin: string;
  /** What the app has said to the Telegram client (`telegramStandIn`). */
  events(): Promise<TelegramEvent[]>;
}

/** One WebSocket frame of the game, as it went over the wire. */
export interface WsFrame {
  readonly to: 'client' | 'server';
  readonly text: string;
}

export interface TelegramLauncher {
  /**
   * Opens the app as `user`, in a new browser context (the specs use at most three), and waits
   * until it has booted. `origin`: another server (default: the shared one of the config).
   */
  open(
    user: TelegramUser,
    options?: LaunchOptions & {
      origin?: string;
      /** Runs on the new context before anything loads (a fake clock, a held socket). */
      prepare?: (context: BrowserContext) => Promise<void>;
    },
  ): Promise<TelegramPlayer>;
}

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
