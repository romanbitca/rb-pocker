import type { Locator, Page } from '@playwright/test';
import { en } from '../../src/i18n/en.ts';
import { expect, test } from './fixtures.ts';
import {
  collectErrors,
  installLeakWatch,
  keepMove,
  leakViolations,
  newTable,
  openApp,
  pcState,
  seedFor,
  sizeOf,
} from './game.ts';

// PLAN §9.3, §10, §12.1, §12.2 (chunk 5.10), in the real build: a tap on a seat opens that bot's
// card (a lazy modal sheet) and Esc, ✕, the scrim and Android Back close it; no bot acts while it
// is open; the personality shows at Easy and Medium and is hidden at Hard and Expert; and the level
// cards in Setup and Settings are saved and come back after a reload.

const SIZES = ['375x667', '390x844', '844x390', '1280x800'];

const pod = (page: Page, seat: number): Locator => page.locator(`[data-seat="${seat}"] > button`);
const sheet = (page: Page): Locator => page.getByRole('dialog');

/** The card's lazy chunk (JS or CSS) among the files the page itself has fetched. */
const chunkFetches = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((url) => /\/BotCard-[^/]*\.(js|css)$/.test(url)),
  );

/** Waits until the sheet has finished sliding in, so its box is where it will stay. */
const settled = (page: Page): Promise<unknown> =>
  page.waitForFunction(() => {
    const layer = document.querySelector('[role="dialog"]')?.parentElement;
    return (
      layer !== null && layer !== undefined && layer.getAnimations({ subtree: true }).length === 0
    );
  });

/** Starts a table at `botLevel` (what Setup's Start game sends) and waits for the first hand. */
async function tableAt(page: Page, botLevel: string): Promise<void> {
  await page.evaluate((botLevel) => {
    window.__pc?.dispatch({
      type: 'newTable',
      setup: { players: 6, botLevel },
      confirmed: true,
    });
  }, botLevel);
  await page.waitForFunction((botLevel) => {
    const s = window.__pc?.state();
    return (
      s?.ui.screen === 'table' &&
      s.game.hand !== null &&
      s.game.table?.config.botLevel === botLevel &&
      s.game.hand.phase !== 'complete'
    );
  }, botLevel);
}

test.describe('the bot card', () => {
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(!SIZES.includes(sizeOf(testInfo)), 'one phone, one landscape phone, one desktop');
  });

  test('opens from a seat, says who it is, and closes four ways', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await openApp(page, seedFor(testInfo));
    await newTable(page, { players: 6, speed: 'normal' });
    await installLeakWatch(page);
    // Nothing of it before the first tap: not in the page, and its chunk has not been fetched.
    await expect(sheet(page)).toHaveCount(0);
    expect(await chunkFetches(page)).toEqual([]);

    const closers: [string, (dialog: Locator) => Promise<void>][] = [
      ['Esc', async () => page.keyboard.press('Escape')],
      ['✕', (dialog) => dialog.getByRole('button', { name: 'Close' }).click()],
      // A tap on the dimmed table, above the sheet.
      ['the scrim', async () => page.mouse.click(5, 5)],
      ['Android Back', async () => void (await page.goBack())],
    ];
    for (const [i, [how, close]] of closers.entries()) {
      const seat = i + 1;
      const slot = (await pcState(page)).game.table?.slots[seat];
      if (slot === undefined || slot.personality === null) throw new Error('no bot');
      const text = en.personalityText[slot.personality];

      await pod(page, seat).click();
      const dialog = sheet(page);
      await expect(dialog, `seat ${seat} opens its card`).toBeVisible();
      await expect(dialog.getByRole('heading', { level: 2 })).toHaveText(slot.name);
      await expect(dialog).toContainText(en.personality[slot.personality]);
      await expect(dialog).toContainText(text.description);
      await expect(dialog).toContainText(en.botCard.howToBeat);
      await expect(dialog).toContainText(text.tip);
      await expect(dialog).toContainText('Stack: ');
      const open = await pcState(page);
      expect(open.ui.overlays).toEqual(['botCard']);
      expect(open.ui.gates).toContain('sheet');
      // It sits over the table, inside the screen.
      await settled(page);
      const box = await dialog.boundingBox();
      const view = page.viewportSize();
      expect(box).not.toBeNull();
      expect((box?.y ?? -1) + (box?.height ?? 0)).toBeLessThanOrEqual((view?.height ?? 0) + 1);
      expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);

      await close(dialog);
      await expect(sheet(page), `closed by ${how}`).toHaveCount(0);
      const after = await pcState(page);
      expect(after.ui.screen, `${how} leaves the table on screen`).toBe('table');
      expect(after.ui.overlays).toEqual([]);
      expect(after.ui.gates).not.toContain('sheet');
      await expect(pod(page, seat), `${how}: focus is back on the seat`).toBeFocused();
    }

    // Opened once, its chunk was fetched; and it never named a hidden card. The lazy chunk and its
    // stylesheet load under the page's CSP without a console error.
    expect((await chunkFetches(page)).length).toBeGreaterThan(0);
    expect(await leakViolations(page)).toEqual([]);
    expect(errors).toEqual([]);
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
        return (
          mode === 'botTurn' || mode === 'heroTurn' || mode === 'handEnd' || mode === 'feedback'
        );
      });
      const mode = (await pcState(page)).game.mode;
      if (mode === 'heroTurn') {
        await page.locator('[data-slot="middle"]').click();
        continue;
      }
      if (mode === 'feedback') {
        await keepMove(page); // a mistake's feedback card (Stage 6): the hand goes on
        continue;
      }
      if (mode === 'handEnd') {
        await page.locator('[data-hand-end]').click();
        continue;
      }
      await pod(page, 2).click();
      await expect(sheet(page)).toBeVisible();
      opened = (await pcState(page)).game.mode === 'botTurn';
      if (!opened) await page.keyboard.press('Escape');
    }
    expect(opened, 'the card opened during a bot turn').toBe(true);

    const read = () =>
      page.evaluate(() => ({
        log: window.__pc?.state().game.hand?.log.length,
        events: window.__pc?.logs().events.filter((e) => e.what === 'input').length,
      }));
    const before = await read();
    expect((await pcState(page)).ui.gates).toContain('sheet');
    // Ten seconds of game time pass: bot think times, pauses, everything on a timer.
    await page.clock.runFor(10_000);
    expect(await read(), 'nothing happened while the card was open').toEqual(before);
    expect((await pcState(page)).game.mode).toBe('botTurn');

    await page.keyboard.press('Escape');
    await expect(sheet(page)).toHaveCount(0);
    await page.clock.runFor(10_000);
    const after = await page.evaluate(() => window.__pc?.state().game.hand?.log.length ?? 0);
    expect(after, 'the bots go on once it is closed').toBeGreaterThan(before.log ?? 0);
  });

  test('the personality shows at Easy and Medium and is hidden at Hard and Expert', async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    await openApp(page, seedFor(testInfo));
    await newTable(page, { players: 6 });
    for (const [level, shown] of [
      ['easy', true],
      ['medium', true],
      ['hard', false],
      ['expert', false],
    ] as const) {
      await tableAt(page, level);
      await expect(page.locator('[data-seat] use[href^="#p-"]'), level).toHaveCount(shown ? 5 : 0);
      await pod(page, 3).click();
      const dialog = sheet(page);
      await expect(dialog).toBeVisible();
      if (shown) {
        await expect(dialog).toContainText(en.botCard.howToBeat);
        await expect(dialog).not.toContainText(en.botCard.unknownStyle);
      } else {
        await expect(dialog).toContainText(en.botCard.unknownStyle);
        await expect(dialog).not.toContainText(en.botCard.howToBeat);
        await expect(dialog.locator('use[href^="#p-"]')).toHaveCount(0);
      }
      await page.keyboard.press('Escape');
      await expect(sheet(page)).toHaveCount(0);
    }
  });
});

test.describe('the bot card offline', () => {
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(sizeOf(testInfo) !== '390x844', 'one phone size per browser');
  });

  // The card's code is a lazy chunk, so a browser that went offline must already have it: the
  // service worker precaches every built file (§15.1), the lazy chunk and its CSS included.
  test('its chunk and its CSS are in the offline cache', async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await openApp(page, seedFor(testInfo));
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    const cached = async (): Promise<string[]> => {
      const urls = await page.evaluate(async () => {
        const all: string[] = [];
        for (const name of await caches.keys()) {
          const cache = await caches.open(name);
          for (const request of await cache.keys()) all.push(request.url);
        }
        return all;
      });
      return urls.filter((url) => /\/BotCard-[^/?]*\.(js|css)(\?.*)?$/.test(url));
    };
    // The worker fills its cache while it installs: a moment after it is ready.
    await expect
      .poll(async () => (await cached()).map((url) => /\.(js|css)/.exec(url)?.[1]).sort(), {
        timeout: 30_000,
      })
      .toEqual(['css', 'js']);
  });
});

test.describe('the level cards', () => {
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(sizeOf(testInfo) !== '390x844', 'one phone size per browser');
  });

  const cards = (page: Page, group: string): Locator =>
    page.getByRole('group', { name: group }).getByRole('radio');
  // A card is picked by tapping its face (the radio lies under it, invisible).
  const pick = (page: Page, group: string, index: number): Promise<void> =>
    page.getByRole('group', { name: group }).locator('label').nth(index).click();

  test('Setup starts a Medium table; Settings saves a level and a reload brings it back', async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    await openApp(page, seedFor(testInfo));
    await page.getByRole('button', { name: 'Choose players, chips and levels' }).click();

    // Setup: Easy and Beginner by default; Medium and Intermediate can be picked, the others not.
    const bots = 'How good are the bots?';
    const coach = 'How much help do you want?';
    await expect(cards(page, bots).nth(0)).toBeChecked();
    await expect(cards(page, coach).nth(0)).toBeChecked();
    for (const [group, open] of [
      [bots, [true, true, false, false]],
      [coach, [true, true, false, false]],
    ] as const) {
      for (const [i, enabled] of open.entries()) {
        await expect(cards(page, group).nth(i)).toBeEnabled({ enabled });
      }
    }
    await expect(page.getByText('Coming soon')).toHaveCount(4);
    await pick(page, bots, 1);
    await pick(page, coach, 1);
    await page.getByRole('button', { name: 'Start game', exact: true }).click();

    await page.waitForFunction(() => window.__pc?.state().game.hand !== null);
    const started = await pcState(page);
    expect(started.game.table?.config.botLevel).toBe('medium');
    expect(started.settings.botLevel).toBe('medium');
    expect(started.settings.coachLevel).toBe('intermediate');

    // Settings, from the Menu: the same two cards, set as they were chosen.
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(cards(page, 'Bot level').nth(1)).toBeChecked();
    await expect(cards(page, 'Coach level').nth(1)).toBeChecked();
    await expect(cards(page, 'Bot level').nth(2)).toBeDisabled();
    await expect(cards(page, 'Coach level').nth(3)).toBeDisabled();

    // A new bot level is saved at once, and the hand in play keeps its table (§10).
    await pick(page, 'Bot level', 0);
    await pick(page, 'Coach level', 0);
    const changed = await pcState(page);
    expect(changed.settings.botLevel).toBe('easy');
    expect(changed.settings.coachLevel).toBe('beginner');
    expect(changed.game.table?.config.botLevel).toBe('medium');

    // Saved 250 ms after the change; a reload reads it back.
    await page.waitForFunction(() => {
      const raw = localStorage.getItem('pc.v1.profile');
      const settings =
        raw === null ? null : (JSON.parse(raw) as { settings: { botLevel: string } });
      return settings?.settings.botLevel === 'easy';
    });
    await page.reload();
    await page.waitForFunction(() => window.__pc?.state().game.mode !== 'booting');
    const again = await pcState(page);
    expect(again.settings.botLevel).toBe('easy');
    expect(again.settings.coachLevel).toBe('beginner');
    expect(again.ui.screen).toBe('home');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(cards(page, 'Bot level').nth(0)).toBeChecked();
    await expect(cards(page, 'Coach level').nth(0)).toBeChecked();
  });
});
