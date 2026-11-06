import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { Page } from '@playwright/test';
import { en } from '../../src/i18n/en.ts';
import { expect, test as base, waitForServiceWorkerControl } from './fixtures.ts';
import {
  collectErrors,
  newTable,
  nextFlowPoint,
  openApp,
  pcState,
  playHands,
  seedFor,
  sizeOf,
  slot,
  tapNextHand,
  type FlowPoint,
} from './game.ts';
import { freePort, startOwnServer, type OwnServer } from './own-server.ts';

// PLAN §15.1, §18 Stage 9 acceptance 5 (chunk 9.5): a new version never reloads the page
// mid-hand. The test serves v1 (the E2E build in apps/web/dist) from its own server, plays, then
// "deploys" v2 mid-hand: the same sources built again with `VITE_PC_BUILD=v2` (only
// `window.__pc.build` reads it, so the entry chunk, every chunk that imports it, index.html and
// sw.js change, as a real push changes them), served by a restarted server on the same origin.
// The toast appears; the hand plays to its end in the old page; the reload comes as the next hand
// would be dealt, and v2 deals it at the Table; the old precache is gone. Also: an update found at
// launch with no hand running goes in at once, and /api/health stays the server's JSON for a
// browser with the service worker installed (navigateFallbackDenylist).
//
// One viewport per browser: the scenario is about versions, not layout. Chromium and WebKit both
// run service workers in Playwright here (the offline spec relies on it too).

interface DeployServer {
  readonly origin: string;
  /** Stops the server and starts it again on the same port, serving `webDist`: a deploy. */
  deploy(webDist: string): Promise<void>;
}

const test = base.extend<{ server: DeployServer }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixture's dependencies from this pattern
  server: async ({}, use) => {
    const port = await freePort();
    let current: OwnServer = await startOwnServer({ port });
    await use({
      origin: current.origin,
      async deploy(webDist) {
        await current.stop();
        current = await startOwnServer({ port, webDist });
      },
    });
    await current.stop();
  },
  // The page, the network guard and the service worker's scope all use this one origin.
  baseURL: async ({ server }, use) => {
    await use(server.origin);
  },
});

const WEB = fileURLToPath(new URL('../..', import.meta.url));
const V1 = join(WEB, 'dist');
const VITE = fileURLToPath(new URL('../../../../node_modules/vite/bin/vite.js', import.meta.url));

let v2: Promise<string> | null = null;

/** The same sources built as "v2" into a folder of its own (once per worker; ~10 s). */
function buildV2(): Promise<string> {
  v2 ??= (async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rb-poker-v2-'));
    await promisify(execFile)(
      process.execPath,
      [VITE, 'build', '--mode', 'e2e', '--outDir', dir, '--emptyOutDir', '--logLevel', 'warn'],
      { cwd: WEB, env: { ...process.env, VITE_PC_BUILD: 'v2' } },
    );
    const [one, two] = await Promise.all([
      readFile(join(V1, 'sw.js'), 'utf8'),
      readFile(join(dir, 'sw.js'), 'utf8'),
    ]);
    if (one === two) throw new Error('v2 built the same sw.js as v1: no new version to find');
    return dir;
  })();
  return v2;
}

test.afterAll(async () => {
  if (v2 !== null) await rm(await v2, { recursive: true, force: true });
});

/** The entry chunk named in a build's index.html (`assets/index-<hash>.js`). */
async function entryOf(dist: string): Promise<string> {
  const html = await readFile(join(dist, 'index.html'), 'utf8');
  const entry = /src="\.\/(assets\/index-[^"]+\.js)"/.exec(html)?.[1];
  if (entry === undefined) throw new Error(`no entry chunk in ${dist}/index.html`);
  return entry;
}

/** `window.__pc.build` (null in v1), or undefined while the page is (re)loading. */
const buildOf = (page: Page): Promise<string | null | undefined> =>
  page.evaluate(() => window.__pc?.build).catch(() => undefined);

/** A marker on this page's `window`: gone once the page has reloaded. */
const markPage = (page: Page): Promise<void> =>
  page.evaluate(() => {
    Object.assign(window, { __oldPage: true });
  });
const samePage = (page: Page): Promise<boolean> =>
  page.evaluate(() => '__oldPage' in window).catch(() => false);

/** The app comes back to the front (a phone resumes it): hidden, then visible again. */
async function backToFront(page: Page): Promise<void> {
  await page.evaluate(() => {
    const show = (state: DocumentVisibilityState): void => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    show('hidden');
    show('visible');
    Reflect.deleteProperty(document, 'visibilityState');
  });
}

/** Every URL path in the page's caches, and the caches' names. */
const cached = (page: Page): Promise<{ names: string[]; paths: string[] }> =>
  page.evaluate(async () => {
    const names = await caches.keys();
    const paths: string[] = [];
    for (const name of names) {
      for (const request of await (await caches.open(name)).keys()) {
        paths.push(new URL(request.url).pathname);
      }
    }
    return { names, paths };
  });

test.describe('a new version between hands (§15.1, Stage 9 acceptance 5)', () => {
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(sizeOf(testInfo) !== '390x844', 'one phone size per browser');
  });

  test('found mid-hand: the toast; no reload until the hand ends; v2 deals the next hand', async ({
    page,
    server,
  }, testInfo) => {
    test.setTimeout(240_000);
    const errors = collectErrors(page);
    const v2Dir = await buildV2();
    const [v1Entry, v2Entry] = await Promise.all([entryOf(V1), entryOf(v2Dir)]);

    // v1, with its service worker in control.
    await openApp(page, seedFor(testInfo));
    await waitForServiceWorkerControl(page);
    await openApp(page, seedFor(testInfo)); // `waitFor…` may have reloaded: boot again for sure
    expect(await buildOf(page)).toBeNull();
    await newTable(page, { players: 3, speed: 'instant', autoNext: false });
    expect(await nextFlowPoint(page)).toBe('hero');
    const handSeq = (await pcState(page)).game.hand?.handSeq as number;
    await markPage(page);

    // Mid-hand: v2 is deployed, and the app comes back to the front, so it asks for a new version.
    await server.deploy(v2Dir);
    await backToFront(page);
    await expect
      .poll(() => page.evaluate(() => window.__pc?.logs().events.map((e) => e.detail)), {
        timeout: 60_000,
      })
      .toContain('updateReady');
    await expect(page.getByText(en.toast.updateReady)).toBeVisible();

    // The hand plays on to its end in the same page (the hero checks or calls).
    let point: FlowPoint = 'hero';
    while (point === 'hero') {
      expect(await samePage(page), 'never reloads mid-hand').toBe(true);
      await slot(page, 'middle').click();
      point = await nextFlowPoint(page);
    }
    expect(await samePage(page)).toBe(true);
    const ended = await pcState(page);
    expect(ended.game.hand?.handSeq).toBe(handSeq);
    expect(ended.game.hand?.phase).toBe('complete');
    await page.waitForTimeout(1500); // the banner (or the bust dialog) waits for its tap
    expect(await samePage(page)).toBe(true);
    expect(await buildOf(page)).toBeNull();

    // The tap that would deal the next hand: the page reloads into v2, which deals it at the Table.
    if (point === 'bust') {
      await page
        .getByRole('alertdialog')
        .getByRole('button', { name: /^Reload / })
        .click();
    } else {
      await tapNextHand(page);
    }
    await expect.poll(() => buildOf(page), { timeout: 60_000 }).toBe('v2');
    expect(await samePage(page)).toBe(false);
    await page.waitForFunction((seq) => {
      const s = window.__pc?.state();
      return s?.ui.screen === 'table' && s.game.hand?.handSeq === seq;
    }, handSeq + 1);
    await expect(page.locator('[data-hero-cards] [role="img"]')).toHaveCount(2);
    // The hand of v1 was counted (§14.3) before the reload.
    const counted = await page.evaluate(
      () =>
        (
          JSON.parse(localStorage.getItem('pc.v1.profile') ?? '{}') as {
            lastCommittedHandSeq?: number;
          }
        ).lastCommittedHandSeq,
    );
    expect(counted).toBe(handSeq);

    // Play resumes: a whole hand in v2.
    const played = await playHands(page, { hands: 1, random: () => 0.5 });
    expect(played[0]?.handSeq).toBe(handSeq + 1);

    // The old precache is cleaned up: v2's files only, in one precache.
    const { names, paths } = await cached(page);
    expect(names.filter((name) => name.includes('precache'))).toHaveLength(1);
    expect(paths.some((path) => path.endsWith(`/${v2Entry}`))).toBe(true);
    expect(paths.some((path) => path.endsWith(`/${v1Entry}`))).toBe(false);
    expect(errors).toEqual([]);
  });

  test('found at launch with no hand running: it goes in at once, without a toast', async ({
    page,
    server,
  }, testInfo) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    const v2Dir = await buildV2();
    await openApp(page, seedFor(testInfo));
    await waitForServiceWorkerControl(page);
    await server.deploy(v2Dir);

    // A new launch: v1 starts from its cache, the browser finds v2, and v1 lets it in at once.
    await page.reload();
    await expect.poll(() => buildOf(page), { timeout: 60_000 }).toBe('v2');
    const s = await pcState(page);
    expect(['welcome', 'home']).toContain(s.ui.screen);
    expect(s.game.hand).toBeNull();
    expect(s.ui.toasts.map((t) => t.kind)).not.toContain('updateReady');
    expect(errors).toEqual([]);
  });

  test('/api/health is the server JSON with the service worker in control', async ({
    page,
    server,
    forbiddenRequests,
  }) => {
    test.setTimeout(60_000);
    await page.goto('/');
    await waitForServiceWorkerControl(page);
    const response = await page.goto('/api/health');
    expect(response?.status()).toBe(200);
    expect(response?.headers()['content-type']).toContain('application/json');
    expect(((await response?.json()) as { status?: string }).status).toBe('ok');
    // This navigation goes to /api on purpose (the network guard of tests/e2e/fixtures.ts).
    expect(forbiddenRequests).toEqual([`goes to /api: GET ${server.origin}/api/health`]);
    forbiddenRequests.length = 0;
  });
});
