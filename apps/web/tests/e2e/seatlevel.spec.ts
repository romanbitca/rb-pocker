import type { Locator, Page } from '@playwright/test';
import type { BotLevel, TableState } from '../../src/engine/types.ts';
import { en } from '../../src/i18n/en.ts';
import { expect, test } from './fixtures.ts';
import {
  collectErrors,
  nextFlowPoint,
  openApp,
  pageMetrics,
  pcState,
  reloadAfterBust,
  seedFor,
  sizeOf,
  slot,
} from './game.ts';

// PLAN §9.3, §12.2, Stage 7 acceptance 6 (chunk 7.2), in the real build: a bot's own level, picked
// on its card or in Setup's "More options", starts with the next hand and not before. The label of
// that seat hides from the next hand, not in the middle of this one; the other seats keep theirs;
// the seated bots stay who they are; and the pick survives a reload.

const pod = (page: Page, seat: number): Locator => page.locator(`[data-seat="${seat}"] > button`);
/** The personality badge on a pod (an icon from the sprite): there only where the level shows it. */
const badge = (page: Page, seat: number): Locator =>
  page.locator(`[data-seat="${seat}"] use[href^="#p-"]`);
const sheet = (page: Page): Locator => page.getByRole('dialog');

/** The levels a table was dealt at and the settings now name, as the store has them. */
interface Levels {
  hand: number;
  inForce: (BotLevel | null)[];
  settings: (BotLevel | null)[];
  who: string[];
}

async function levels(page: Page): Promise<Levels> {
  return page.evaluate(() => {
    const s = window.__pc?.state();
    const table = s?.game.table as TableState | null | undefined;
    return {
      hand: s?.game.hand?.handSeq ?? 0,
      inForce: table?.config.seatLevels ?? [],
      settings: (s?.settings.seatLevels ?? []) as (BotLevel | null)[],
      who: (table?.slots ?? []).map((x) => `${x.playerId}|${x.name}|${x.personality}`),
    };
  });
}

/** Plays on (bots at Instant speed) until it is the hero's turn; a hand that ends first is dealt again. */
async function toHeroTurn(page: Page): Promise<void> {
  for (let i = 0; i < 30; i++) {
    const point = await nextFlowPoint(page);
    if (point === 'hero') return;
    if (point === 'end') await page.locator('[data-hand-end]').click();
    else await reloadAfterBust(page);
  }
  throw new Error('no hero turn in 30 tries');
}

/**
 * Plays the hand to its end with the hero folding at the first chance (checking when folding is not
 * allowed, calling down a bet it cannot fold to), and waits for the hand-end banner.
 */
async function playOut(page: Page): Promise<void> {
  for (let i = 0; i < 30; i++) {
    const point = await nextFlowPoint(page);
    if (point === 'end') return;
    if (point === 'bust') throw new Error('the hero is out of chips');
    const fold = slot(page, 'fold');
    if ((await fold.getAttribute('aria-disabled')) === 'true') await slot(page, 'middle').click();
    else await fold.click();
  }
  throw new Error('the hand did not end');
}

/**
 * Starts a 4-player table at Instant speed (the next hand waits for a tap), with these overrides
 * (what Setup's Start game sends), and waits for its first hand.
 */
async function table4(
  page: Page,
  seed: string,
  seatLevels: (BotLevel | null)[] = [null, null, null, null],
): Promise<void> {
  await openApp(page, seed);
  await page.evaluate((seatLevels) => {
    const pc = window.__pc;
    if (pc === undefined) throw new Error('no window.__pc: is this the E2E build?');
    pc.dispatch({ type: 'settings', patch: { speed: 'instant', autoNext: false } });
    pc.dispatch({ type: 'newTable', setup: { players: 4, seatLevels }, confirmed: true });
  }, seatLevels);
  await page.waitForFunction(() => {
    const s = window.__pc?.state();
    return (
      s?.ui.screen === 'table' &&
      s.game.hand?.seats.length === 4 &&
      s.game.hand.phase !== 'complete'
    );
  });
}

test.describe('a bot’s own level starts with the next hand', () => {
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(sizeOf(testInfo) !== '390x844', 'one phone size per browser');
  });

  test('picked on a card in the middle of a hand: its label hides next hand, the others keep theirs', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await table4(page, seedFor(testInfo));
    await toHeroTurn(page);

    const first = await levels(page);
    expect(first.inForce).toEqual([null, null, null, null]);
    expect(first.settings).toEqual([null, null, null, null]);
    for (const seat of [1, 2, 3]) await expect(badge(page, seat), `seat ${seat}`).toHaveCount(1);

    // Open the card of seat 2 in the middle of the hand and pick Expert.
    await pod(page, 2).click();
    const dialog = sheet(page);
    await expect(dialog).toBeVisible();
    const picker = dialog.getByRole('group', { name: en.botCard.level.legend });
    await expect(picker.getByRole('radio')).toHaveCount(5);
    await expect(picker.getByRole('radio', { name: 'Same as table (Easy)' })).toBeChecked();
    await expect(dialog).toContainText(en.botCard.howToBeat);
    await picker.getByRole('radio', { name: 'Expert' }).check();
    await expect(picker.getByRole('radio', { name: 'Expert' })).toBeChecked();
    await expect(dialog.getByText(en.botCard.level.hint)).toBeVisible();
    // The Table with the card open stays inside the DOM budget (§15.3).
    expect((await pageMetrics(page)).nodes).toBeLessThanOrEqual(600);

    // Kept at once; the hand in play has not changed, and the card still describes it.
    const picked = await levels(page);
    expect(picked.settings).toEqual([null, null, 'expert', null]);
    expect(picked.inForce).toEqual([null, null, null, null]);
    expect(picked.hand).toBe(first.hand);
    await expect(dialog).toContainText(en.botCard.howToBeat);
    await expect(dialog).not.toContainText(en.botCard.unknownStyle);
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toHaveCount(0);
    for (const seat of [1, 2, 3]) {
      await expect(badge(page, seat), `still mid-hand, seat ${seat}`).toHaveCount(1);
    }

    // The hero folds and the hand ends: the pods still show the hand that was played.
    await playOut(page);
    const ended = await levels(page);
    expect(ended.hand).toBe(first.hand);
    expect(ended.inForce).toEqual([null, null, null, null]);
    for (const seat of [1, 2, 3]) {
      await expect(badge(page, seat), `hand over, seat ${seat}`).toHaveCount(1);
    }

    // The next hand is dealt at the new level: seat 2 hides its label, seats 1 and 3 keep theirs.
    await page.locator('[data-hand-end]').click();
    await page.waitForFunction(
      (hand) => window.__pc?.state().game.hand?.handSeq === hand + 1,
      first.hand,
    );
    const second = await levels(page);
    expect(second.inForce).toEqual([null, null, 'expert', null]);
    await expect(badge(page, 2)).toHaveCount(0);
    await expect(badge(page, 1)).toHaveCount(1);
    await expect(badge(page, 3)).toHaveCount(1);
    // The bots are the same people with the same styles (a bust would be a new bot, and none did).
    expect(second.who).toEqual(first.who);

    // Its card now says what the player has seen, and the picker still names Expert.
    await pod(page, 2).click();
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page)).toContainText(en.botCard.unknownStyle);
    await expect(sheet(page)).not.toContainText(en.botCard.howToBeat);
    await expect(sheet(page).getByRole('radio', { name: 'Expert' })).toBeChecked();
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toHaveCount(0);

    // Saved with the settings: a reload plays the same table again.
    await page.waitForFunction(() => {
      const raw = localStorage.getItem('pc.v1.profile');
      const saved =
        raw === null ? null : (JSON.parse(raw) as { settings: { seatLevels: unknown[] } });
      return saved?.settings.seatLevels[2] === 'expert';
    });
    await page.reload();
    await page.waitForFunction(() => window.__pc?.state().game.mode !== 'booting');
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForFunction(() => window.__pc?.state().ui.screen === 'table');
    expect((await levels(page)).inForce).toEqual([null, null, 'expert', null]);
    await expect(badge(page, 2)).toHaveCount(0);
    await expect(badge(page, 1)).toHaveCount(1);
    await expect(badge(page, 3)).toHaveCount(1);

    expect(errors).toEqual([]);
  });

  test('"Same as table" puts it back, again from the next hand', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await table4(page, seedFor(testInfo), [null, 'hard', null, null]);
    await expect(badge(page, 1)).toHaveCount(0);
    await expect(badge(page, 2)).toHaveCount(1);
    await toHeroTurn(page);

    await pod(page, 1).click();
    const picker = sheet(page).getByRole('group', { name: en.botCard.level.legend });
    await expect(picker.getByRole('radio', { name: 'Hard' })).toBeChecked();
    await picker.getByRole('radio', { name: 'Same as table (Easy)' }).check();
    await page.keyboard.press('Escape');
    await expect(badge(page, 1), 'this hand is still Hard').toHaveCount(0);

    await playOut(page);
    await expect(badge(page, 1), 'and so is the table at its end').toHaveCount(0);
    await page.locator('[data-hand-end]').click();
    await page.waitForFunction(
      () => window.__pc?.state().game.table?.config.seatLevels[1] === null,
    );
    await expect(badge(page, 1)).toHaveCount(1);
  });
});

test.describe('Setup’s More options', () => {
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(sizeOf(testInfo) !== '390x844', 'one phone size per browser');
  });

  /** The files of the lazy "More options" chunk that the page itself has fetched. */
  const chunkFetches = (page: Page): Promise<string[]> =>
    page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((url) => /\/MoreOptions-[^/]*\.(js|css)$/.test(url)),
    );

  test('sets a level for each bot, and the table starts with them from the first hand', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await openApp(page, seedFor(testInfo));
    await page.getByRole('button', { name: 'Choose players, chips and levels' }).click();
    await page.getByRole('button', { name: 'Fewer players' }).click();
    await page.getByRole('button', { name: 'Fewer players' }).click();

    // Closed: its code has not been fetched and none of its controls is in the page.
    const more = page.getByRole('button', { name: en.setup.more.title });
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('group', { name: en.setup.more.bots.legend })).toHaveCount(0);
    expect(await chunkFetches(page)).toEqual([]);

    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    const list = page.getByRole('group', { name: en.setup.more.bots.legend });
    await expect(list).toBeVisible();
    expect((await chunkFetches(page)).length).toBeGreaterThan(0);
    await expect(list.getByRole('combobox')).toHaveCount(3);
    await list.getByLabel('Bot 2').selectOption('expert');
    await list.getByLabel('Bot 3').selectOption('hard');
    await page.getByRole('group', { name: 'Speed' }).getByRole('radio', { name: 'Fast' }).check();
    await page.getByRole('switch', { name: en.setup.more.fourColour.label }).uncheck();

    await page.getByRole('button', { name: 'Start game', exact: true }).click();
    await page.waitForFunction(() => window.__pc?.state().game.hand !== null);
    const started = await pcState(page);
    expect(started.game.table?.config.seatLevels).toEqual([null, null, 'expert', 'hard']);
    expect(started.settings.seatLevels).toEqual([null, null, 'expert', 'hard']);
    expect(started.settings.speed).toBe('fast');
    expect(started.settings.fourColour).toBe(false);
    await expect(page.locator('html')).toHaveAttribute('data-deck', 'two');
    // From the first hand: Bot 1 shows its style, Bots 2 and 3 do not.
    await expect(badge(page, 1)).toHaveCount(1);
    await expect(badge(page, 2)).toHaveCount(0);
    await expect(badge(page, 3)).toHaveCount(0);

    // The next Setup opens with them, and says so while More options is closed.
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('button', { name: en.menu.newTable }).click();
    await expect(page.getByText(en.setup.more.ownLevels(2))).toBeVisible();
    await page.getByRole('button', { name: en.setup.more.title }).click();
    await expect(page.getByLabel('Bot 2')).toHaveValue('expert');
    await expect(page.getByLabel('Bot 3')).toHaveValue('hard');
    expect(errors).toEqual([]);
  });

  test('its chunk is in the offline cache', async ({ page }, testInfo) => {
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
      return urls.filter((url) => /\/MoreOptions-[^/?]*\.(js|css)(\?.*)?$/.test(url));
    };
    await expect
      .poll(async () => (await cached()).map((url) => /\.(js|css)/.exec(url)?.[0]).sort(), {
        timeout: 30_000,
      })
      .toEqual(['.css', '.js']);
  });
});
