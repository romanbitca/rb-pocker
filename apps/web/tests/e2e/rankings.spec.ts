import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { newTable, nextFlowPoint, openApp, pageMetrics, pcState, seedFor, sizeOf } from './game.ts';

// PLAN §18 Stage 3, acceptance 3 (§13.1): the hand rankings are a persistent column at 1280×800
// and 1024×768; at 390×844 and 844×390 a drawer that the edge tab, the top-bar button and the
// hand label open, and that the scrim, ✕, a drag to the right, Esc and Android Back close. An edge
// swipe never opens it, it never covers the action bar, no bot acts while it is open, and the DOM
// never holds a Unicode suit (U+2660–U+2667, pitfall 31: the SVG sprite draws the suits).

const SUITS = /[♠-♧]/u;

const drawer = (page: Page): Locator => page.getByRole('dialog', { name: /Poker hands/ });
const edgeTab = (page: Page): Locator => page.locator('[data-table-box] + div button');
const topBarButton = (page: Page): Locator =>
  page.locator('header').getByRole('button', { name: 'Show all poker hands' });
const handLabel = (page: Page): Locator => page.locator('[data-hero-label]');
const actionBar = (page: Page): Locator => page.getByRole('group', { name: 'Your actions' });

async function expectNoSuits(page: Page): Promise<void> {
  const html = await page.evaluate(() => document.documentElement.outerHTML);
  expect(SUITS.exec(html)?.[0], 'no Unicode suit in the DOM').toBeUndefined();
}

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box): boolean =>
  Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0.5 &&
  Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0.5;

/**
 * Every box the open drawer draws (its root, scrim and sheet) stays clear of the action bar,
 * once the sheet has slid in (mid-slide its box reaches past the root, which clips it).
 */
async function expectActionBarUncovered(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const root = document.querySelector('[role="dialog"][aria-modal="true"]')?.parentElement;
    return root?.getAnimations({ subtree: true }).length === 0;
  });
  const bar = await actionBar(page).boundingBox();
  expect(bar).not.toBeNull();
  const boxes = await page.evaluate(() => {
    const sheet = document.querySelector('[role="dialog"][aria-modal="true"]');
    const root = sheet?.parentElement;
    return [root, ...(root?.children ?? [])].flatMap((el) => {
      if (el === null || el === undefined) return [];
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0
        ? [{ x: r.x, y: r.y, width: r.width, height: r.height }]
        : [];
    });
  });
  expect(boxes.length).toBeGreaterThan(0);
  for (const box of boxes) expect(overlaps(box, bar as Box), JSON.stringify(box)).toBe(false);
  // And the bar's buttons are on top where they are drawn.
  const hits = await page.evaluate(() =>
    [...document.querySelectorAll('[data-slot]')].map((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return hit !== null && (hit === el || el.contains(hit));
    }),
  );
  expect(hits.length).toBeGreaterThan(0);
  expect(hits.every(Boolean), 'the action bar is not covered').toBe(true);
}

test.describe('rankings on a wide screen', () => {
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(sizeOf(testInfo) !== '1280x800', 'acceptance 3: the wide layout');
  });

  test('a persistent column at 1280×800 and at 1024×768', async ({ page }, testInfo) => {
    await openApp(page, seedFor(testInfo));
    await newTable(page, { players: 6 });
    for (const size of [
      { width: 1280, height: 800 },
      { width: 1024, height: 768 },
    ]) {
      await page.setViewportSize(size);
      await expect(page.locator('main[data-layout="wide"]')).toBeVisible();
      const column = page.getByRole('complementary', { name: /Poker hands/ });
      await expect(column).toBeVisible();
      await expect(column.locator('[data-category]')).toHaveCount(10);
      await expect(drawer(page)).toHaveCount(0);
      await expect(edgeTab(page)).toHaveCount(0);
      // The highlighted row is the hero's hand (aria-current), shown next to the table.
      await expect(column.locator('[aria-current="true"]')).toHaveCount(1);
      await expectNoSuits(page);
    }
  });
});

test.describe('the rankings drawer', () => {
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(
      !['390x844', '844x390'].includes(sizeOf(testInfo)),
      'acceptance 3: the drawer at 390×844 and 844×390',
    );
  });

  test('opens from the tab, the top bar and the hand label; closes five ways', async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    await openApp(page, seedFor(testInfo));
    // Normal speed: the bots think for a while, and a gate must hold them (checked below too).
    await newTable(page, { players: 6, speed: 'normal' });
    await expect(drawer(page)).toHaveCount(0);

    const openers: [string, Locator][] = [
      ['the edge tab', edgeTab(page)],
      ['the top-bar button', topBarButton(page)],
      ['the hand label', handLabel(page)],
    ];
    const closers: [string, () => Promise<void>][] = [
      [
        'the scrim',
        async () => {
          // A tap on the dimmed table, left of the sheet.
          const sheet = await drawer(page).boundingBox();
          if (sheet === null) throw new Error('no sheet');
          await page.mouse.click(Math.max(4, sheet.x / 2), sheet.y + sheet.height / 2);
        },
      ],
      ['✕', () => drawer(page).getByRole('button', { name: 'Close' }).click()],
      [
        'a drag to the right',
        async () => {
          const sheet = await drawer(page).boundingBox();
          if (sheet === null) throw new Error('no sheet');
          const y = sheet.y + sheet.height / 2;
          await page.mouse.move(sheet.x + 30, y);
          await page.mouse.down();
          await page.mouse.move(sheet.x + 30 + sheet.width * 0.6, y, { steps: 8 });
          await page.mouse.up();
        },
      ],
      ['Esc', () => page.keyboard.press('Escape')],
      ['Android Back', async () => void (await page.goBack())],
    ];

    let n = 0;
    for (const [how, close] of closers) {
      const [by, opener] = openers[n++ % openers.length] as [string, Locator];
      await opener.click();
      // At once, while the sheet still slides in, nothing has pushed the drawer sideways: the
      // scrim covers the table from the first frame. (WebKit bug found here: opening scrolled
      // the drawer's `overflow: hidden` root to reveal the sliding sheet, so the scrim sat
      // hundreds of pixels to the left and a quick tap on it hit the table instead.)
      const scrolled = await page.evaluate(() => {
        const root = document.querySelector('[role="dialog"][aria-modal="true"]')?.parentElement;
        return root === null || root === undefined ? null : [root.scrollLeft, root.scrollTop];
      });
      expect(scrolled, `opened by ${by}: the drawer is not scrolled`).toEqual([0, 0]);
      await expect(drawer(page), `opened by ${by}`).toBeVisible();
      await expect(drawer(page).locator('[data-category]')).toHaveCount(10);
      await expectActionBarUncovered(page);
      await expectNoSuits(page);
      await close();
      await expect(drawer(page), `closed by ${how}`).toHaveCount(0);
      const s = await pcState(page);
      expect(s.ui.screen, `${how} leaves the table on screen`).toBe('table');
      expect(s.ui.overlays).not.toContain('rankings');
    }
  });

  test('an edge swipe never opens it', async ({ page, browserName }, testInfo) => {
    await openApp(page, seedFor(testInfo));
    await newTable(page, { players: 6 });
    const { width, height } = page.viewportSize() ?? { width: 0, height: 0 };
    const tab = await edgeTab(page).boundingBox();
    if (tab === null) throw new Error('no edge tab');
    // Swipes from the right edge to the left: across the tab and below it.
    for (const y of [tab.y + tab.height / 2, height * 0.75]) {
      await page.mouse.move(width - 2, y);
      await page.mouse.down();
      await page.mouse.move(width - 200, y, { steps: 10 });
      await page.mouse.up();
      if (browserName === 'chromium') {
        // A real touch swipe as well (Chromium only: DevTools touch input).
        const cdp = await page.context().newCDPSession(page);
        const at = (x: number) => [{ x, y }];
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: at(width - 2),
        });
        for (let x = width - 20; x >= width - 200; x -= 20) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(x) });
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await cdp.detach();
      }
      await page.waitForTimeout(300);
      await expect(drawer(page)).toHaveCount(0);
    }
    expect((await pcState(page)).ui.overlays).not.toContain('rankings');
  });

  test('no bot acts while it is open', async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await page.clock.install();
    await openApp(page, seedFor(testInfo));
    await newTable(page, { players: 6, speed: 'normal' });

    // Open it while a bot is thinking (normal speed: most of a second).
    let opened = false;
    for (let tries = 0; tries < 20 && !opened; tries++) {
      await page.waitForFunction(() => {
        const mode = window.__pc?.state().game.mode;
        return mode === 'botTurn' || mode === 'heroTurn' || mode === 'handEnd';
      });
      const mode = (await pcState(page)).game.mode;
      if (mode === 'heroTurn') {
        await page.locator('[data-slot="middle"]').click();
        continue;
      }
      if (mode === 'handEnd') {
        await page.locator('[data-hand-end]').click();
        continue;
      }
      await edgeTab(page).click();
      await expect(drawer(page)).toBeVisible();
      opened = (await pcState(page)).game.mode === 'botTurn';
      if (!opened) await page.keyboard.press('Escape');
    }
    expect(opened, 'the drawer opened during a bot turn').toBe(true);

    const before = await page.evaluate(() => ({
      log: window.__pc?.state().game.hand?.log.length,
      events: window.__pc?.logs().events.filter((e) => e.what === 'input').length,
    }));
    expect((await pcState(page)).ui.gates).toContain('sheet');
    // Ten seconds of game time pass: bot think times, pauses, everything on a timer.
    await page.clock.runFor(10_000);
    const during = await page.evaluate(() => ({
      log: window.__pc?.state().game.hand?.log.length,
      events: window.__pc?.logs().events.filter((e) => e.what === 'input').length,
    }));
    expect(during, 'nothing happened while the drawer was open').toEqual(before);
    expect((await pcState(page)).game.mode).toBe('botTurn');

    await page.keyboard.press('Escape');
    await expect(drawer(page)).toHaveCount(0);
    await page.clock.runFor(10_000);
    const after = await page.evaluate(() => window.__pc?.state().game.hand?.log.length ?? 0);
    expect(after, 'the bots go on once it is closed').toBeGreaterThan(before.log ?? 0);
  });

  test('with nine players at a showdown it stays under the DOM budget', async ({
    page,
  }, testInfo) => {
    await page.clock.install();
    await openApp(page, seedFor(testInfo));
    await newTable(page, { players: 9 });
    // Check or call to the end: the most the table ever draws (shown cards, the result).
    for (let point = await nextFlowPoint(page, true); point !== 'end';) {
      if (point === 'hero') await page.locator('[data-slot="middle"]').click();
      point = await nextFlowPoint(page, true);
    }
    await edgeTab(page).click();
    await expect(drawer(page)).toBeVisible();
    expect((await pageMetrics(page)).nodes, '§15.3: ≤ 600 DOM nodes').toBeLessThanOrEqual(600);
    await expectNoSuits(page);
  });
});
