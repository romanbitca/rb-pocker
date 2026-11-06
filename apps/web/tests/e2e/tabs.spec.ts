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

/**
 * The game this tab shows: its table, and the hand in play or, between hands (a hand just over,
 * or the out-of-chips dialog after a bust), the number the next hand will have. Play in another
 * tab continues exactly there.
 */
const gameOf = (page: Page) =>
  page.evaluate(() => {
    const game = window.__pc?.state().game;
    const hand = game?.hand ?? null;
    return {
      table: (game?.table ?? game?.next)?.tableId ?? null,
      hand:
        hand !== null && hand.phase !== 'complete'
          ? hand.handSeq
          : (game?.next?.nextHandSeq ?? null),
    };
  });

/**
 * Until the tab writes nothing more by itself: the hero is to act, a hand has ended (autoNext is
 * off, so the next one waits for a tap), or the out-of-chips dialog waits after a bust.
 */
const quiet = (page: Page) =>
  page.waitForFunction(() => {
    const s = window.__pc?.state();
    return (
      s !== undefined &&
      (s.game.mode === 'heroTurn' ||
        s.game.mode === 'handEnd' ||
        s.ui.overlays.includes('outOfChips'))
    );
  });

/**
 * Once `page` writes nothing more by itself (`quiet`): the stored profile counts every hand up to
 * the last one that ended, each once, none lost (§14.3), and that last hand is `played` or the one
 * after it. `playHands` taps "Next hand" after its last hand, and at Instant speed a hand that
 * everybody folds to the hero's big blind ends by itself in about 0.2 s: then that hand is over,
 * and counted, before the storage is read. The commit waits for the hand's last grade (§11.3 r5),
 * so the storage is polled.
 */
async function expectAllCounted(page: Page, played: number): Promise<void> {
  await quiet(page);
  const ended = await page.evaluate(() => {
    const hand = window.__pc?.state().game.hand ?? null;
    if (hand === null) return 0;
    return hand.phase === 'complete' ? hand.handSeq : hand.handSeq - 1;
  });
  expect([played, played + 1], 'the last hand that ended').toContain(ended);
  const ring = Array.from({ length: ended }, (_, i) => i + 1);
  await expect.poll(() => stored(page)).toEqual({ counted: ended, last: ended, ring });
}

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
    await expectAllCounted(page, 2);
    await expectBanner(other);

    // "Play here": the game moves to the second tab, at the very hand the first one dealt (or at
    // its out-of-chips dialog, should the hero have lost every chip).
    await quiet(page);
    const dealt = await gameOf(page);
    await other.getByRole('button', { name: 'Play here' }).click();
    await other.waitForFunction(() => window.__pc?.state().ui.screen === 'table');
    expect(await gameOf(other)).toEqual(dealt);
    expect(await tabMode(other)).toBe('writer');
    await expectBanner(page);

    const [taken] = await playHands(other, { hands: 1, random });
    expect(taken?.handSeq, 'the second tab played on at the hand it took').toBe(dealt.hand);
    await expectAllCounted(other, dealt.hand as number);
    expect(await page.evaluate(() => window.__pc?.snapshot().writer)).toBe(false);

    // Closing the tab that has the game hands it back (the banner: "Close it…").
    await other.close();
    await page.waitForFunction(() => window.__pc?.state().data.tab === 'writer');
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    const [back] = await playHands(page, { hands: 1, random });
    if (back === undefined) throw new Error('no hand played after the tab came back');
    await expectAllCounted(page, back.handSeq);
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

    // The second tab cannot know about the first until the first writes the game. So it opens
    // while the first one writes nothing (`quiet`), not while its bots still act: a bot's step
    // written during the second tab's boot would make it read-only at once.
    await quiet(page);
    const other = await secondTab(context, seed);
    expect(await tabMode(other)).toBe('writer');
    await expect(other.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await playHands(page, { hands: 1, random });
    await expectBanner(other);

    // "Play here": one profile write tells the first tab. Its bots may still save a step before it
    // hears that write; that must not take the game back (both tabs read-only, §14 notes of 8.3).
    await other.getByRole('button', { name: 'Play here' }).click();
    await other.waitForFunction(() => window.__pc?.state().ui.screen === 'table');
    await expectBanner(page);
    // It plays on at the first tab's third hand (or the next one, should the third have ended by
    // itself before "Play here"); every hand is counted once, by one tab or the other.
    const [taken] = await playHands(other, { hands: 1, random });
    if (taken === undefined) throw new Error('no hand played after "Play here"');
    expect([3, 4]).toContain(taken.handSeq);
    await expectAllCounted(other, taken.handSeq);
    expect(await page.evaluate(() => window.__pc?.snapshot().writer)).toBe(false);
  });
});
