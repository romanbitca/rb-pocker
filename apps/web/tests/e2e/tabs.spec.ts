import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { newTable, openApp, playHands, prng, seedFor, sizeOf } from './game.ts';

// PLAN §14.9 "Two tabs (Playwright, two pages) → the second is read-only; no lost update", §14.7,
// Stage 8 acceptance 1 (chunk 8.3). Two pages of one context are two tabs of the game: they share
// localStorage, the storage events and (in a secure context: localhost) Web Locks. The unit tests
// with fake locks are tests/app/controller.tabs.test.ts.

const BANNER = 'The game is open in another tab. Close it, or tap here to play here instead.';

/** What the stored profile has counted, and the hand records' numbers. */
async function stored(page: Page): Promise<{ counted: number; last: number; ring: number[] }> {
  return page.evaluate(() => {
    const profile = JSON.parse(localStorage.getItem('pc.v1.profile') ?? '{}') as {
      lastCommittedHandSeq: number;
      stats: { results: { clean: { hands: number }; practice: { hands: number } } };
    };
    const ring = JSON.parse(localStorage.getItem('pc.v1.hands') ?? '{"hands":[]}') as {
      hands: { handSeq: number }[];
    };
    const { clean, practice } = profile.stats.results;
    return {
      counted: clean.hands + practice.hands,
      last: profile.lastCommittedHandSeq,
      ring: ring.hands.map((r) => r.handSeq),
    };
  });
}

const tabMode = (page: Page): Promise<string | undefined> =>
  page.evaluate(() => window.__pc?.state().data.tab);

/** A second tab of the same game. */
async function secondTab(context: BrowserContext, seed: string): Promise<Page> {
  const page = await context.newPage();
  await openApp(page, seed);
  return page;
}

/** The read-only tab: Home with the banner and "Play here", no Play. */
async function expectBanner(page: Page): Promise<void> {
  await expect(page.getByRole('alert')).toHaveText(BANNER);
  await expect(page.getByRole('button', { name: 'Play here' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toHaveCount(0);
  expect(await tabMode(page)).toBe('readOnly');
}

test.describe('two tabs', () => {
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(!['390x844', '1280x800'].includes(sizeOf(testInfo)), 'a phone and a wide screen');
  });

  test('with Web Locks: the second tab is read-only until "Play here"; no hand is lost', async ({
    page,
    context,
  }, testInfo) => {
    test.setTimeout(90_000);
    const seed = seedFor(testInfo);
    const random = prng(seed);
    await openApp(page, seed);
    expect(await page.evaluate(() => 'locks' in navigator)).toBe(true);
    await newTable(page, { players: 3 });
    await playHands(page, { hands: 1, random });

    const other = await secondTab(context, seed);
    await expectBanner(other);
    expect(await tabMode(page)).toBe('writer');

    // The first tab plays on; the read-only one writes nothing.
    await playHands(page, { hands: 1, random });
    expect(await stored(page)).toMatchObject({ counted: 2, ring: [1, 2] });
    await expectBanner(other);

    // "Play here": the game moves to the second tab, at the very hand the first one dealt.
    const dealt = await page.evaluate(() => window.__pc?.state().game.hand?.handSeq);
    await other.getByRole('button', { name: 'Play here' }).click();
    await other.waitForFunction(() => window.__pc?.state().ui.screen === 'table');
    expect(await other.evaluate(() => window.__pc?.state().game.hand?.handSeq)).toBe(dealt);
    expect(await tabMode(other)).toBe('writer');
    await expectBanner(page);

    await playHands(other, { hands: 1, random });
    expect(await stored(other)).toEqual({ counted: 3, last: 3, ring: [1, 2, 3] });
    expect(await page.evaluate(() => window.__pc?.snapshot().writer)).toBe(false);

    // Closing the tab that has the game hands it back (the banner: "Close it…").
    await other.close();
    await page.waitForFunction(() => window.__pc?.state().data.tab === 'writer');
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await playHands(page, { hands: 1, random });
    expect(await stored(page)).toEqual({ counted: 4, last: 4, ring: [1, 2, 3, 4] });
  });

  test('without Web Locks (plain-http LAN): the storage event and the rev check decide', async ({
    page,
    context,
  }, testInfo) => {
    test.setTimeout(90_000);
    // What a plain-http LAN address looks like to the game (§12.14): no navigator.locks.
    await context.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'locks', {
        configurable: true,
        get: () => undefined,
      });
    });
    const seed = seedFor(testInfo);
    const random = prng(seed);
    await openApp(page, seed);
    expect(await page.evaluate(() => navigator.locks)).toBeUndefined();
    await newTable(page, { players: 3 });
    await playHands(page, { hands: 1, random });

    // The second tab cannot know about the first until the first writes the game.
    const other = await secondTab(context, seed);
    expect(await tabMode(other)).toBe('writer');
    await expect(other.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await playHands(page, { hands: 1, random });
    await expectBanner(other);

    // "Play here": one profile write tells the first tab.
    await other.getByRole('button', { name: 'Play here' }).click();
    await other.waitForFunction(() => window.__pc?.state().ui.screen === 'table');
    await expectBanner(page);
    await playHands(other, { hands: 1, random });
    expect(await stored(other)).toEqual({ counted: 3, last: 3, ring: [1, 2, 3] });
    expect(await page.evaluate(() => window.__pc?.snapshot().writer)).toBe(false);
  });
});
