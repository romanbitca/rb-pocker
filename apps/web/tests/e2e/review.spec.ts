import type { Page } from '@playwright/test';
import { expect, heading, test } from './fixtures.ts';
import {
  CARD_NAMES,
  closeSummary,
  collectErrors,
  heroAct,
  newTable,
  nextFlowPoint,
  openApp,
  pcState,
  prng,
  seedFor,
  sizeOf,
} from './game.ts';

// PLAN §12.10 (chunk 6.3): Review, the read-only replay of a finished hand. From the hand-end
// banner to the replay, stepping with the keyboard and with auto-play, the list of recent hands,
// and the non-cheating rule (§3.9, §4.8) on the real page: a bot's cards that were not shown in the
// real hand are never named on the page, at any step.

/** A phone, a phone on its side and a desktop: the three layouts of the screen. */
const SIZES = ['375x667', '844x390', '1280x800'];

/**
 * In the page: bot cards that the real hand never showed (the bot folded, or its hand was not
 * turned face up) and that the page names anywhere (text or any `aria-label`). `all` also counts
 * the bots that showed their hands at the end: at the deal nothing may be face up yet.
 */
function namedHiddenCards(page: Page, all: boolean): Promise<string[]> {
  return page.evaluate(
    ({ names, all }) => {
      const hand = window.__pc?.state().game.hand;
      if (hand === null || hand === undefined) return ['no hand'];
      const html = document.body.innerHTML;
      const found: string[] = [];
      hand.seats.forEach((seat, i) => {
        if (i === 0 || seat.hole === null) return;
        if (!all && !seat.folded && hand.revealed.includes(i)) return;
        for (const card of seat.hole) {
          const name = names[card] ?? '?';
          if (html.includes(name)) found.push(`seat ${i}: ${name}`);
        }
      });
      return found;
    },
    { names: [...CARD_NAMES], all },
  );
}

test('Review replays the hand that just ended, step by step, and hides what the hand hid', async ({
  page,
}, testInfo) => {
  test.skip(!SIZES.includes(sizeOf(testInfo)), 'three layouts: phone, phone on its side, desktop');
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await page.clock.install();
  const seed = seedFor(testInfo);
  await openApp(page, seed);
  await newTable(page, { players: 6 });
  const random = prng(seed);

  // Play the first hand to its end.
  for (let point = await nextFlowPoint(page, true); point !== 'end';) {
    if (point === 'bust') throw new Error('out of chips while playing one hand');
    await heroAct(page, random);
    point = await nextFlowPoint(page, true);
  }
  const banner = page.locator('[data-hand-end]');
  await expect(banner).toBeVisible();
  const result = (await banner.locator('span').first().textContent()) ?? '';
  expect(result).not.toBe('');
  const handSeq = (await pcState(page)).game.hand?.handSeq;

  // The link under the banner opens Review on this hand; the URL stays "/". (At Beginner the
  // hand summary is open over the banner first, §12.9: closed, the banner is there.)
  await closeSummary(page);
  const link = page.getByRole('button', { name: 'Review this hand' });
  await expect(link).toBeVisible();
  await link.click();
  await expect(heading(page)).toHaveText(/^Hand \d+$/);
  expect(new URL(page.url()).pathname).toBe('/');
  const slider = page.getByRole('slider', { name: 'Step' });
  await expect(slider).toBeVisible();
  const last = Number(await slider.getAttribute('max'));
  expect(last).toBeGreaterThan(2);
  await expect(slider).toHaveValue('0');
  await expect(page.getByRole('group', { name: /^Hand \d+$/ })).toBeVisible();

  // The deal: your two cards, and not one bot card is face up or named.
  await expect(page.locator('[data-review] [data-hero-cards] [role="img"]')).toHaveCount(2);
  expect(await namedHiddenCards(page, true)).toEqual([]);

  // Forward with the arrow key, one step at a time: the line under the table changes, and no
  // card the real hand never showed is ever named.
  const story = page.locator('[data-review] [role="status"][aria-atomic="true"]');
  let previous = await story.textContent();
  for (let i = 1; i <= last; i++) {
    await page.keyboard.press('ArrowRight');
    await expect(slider).toHaveValue(String(i));
    expect(await namedHiddenCards(page, false), `step ${i}`).toEqual([]);
    const now = await story.textContent();
    expect(now, `step ${i} says something`).not.toBe(previous);
    previous = now;
  }
  // The last step is the result the banner showed.
  await expect(story).toContainText(result);

  // Back, Home and End.
  await page.keyboard.press('ArrowLeft');
  await expect(slider).toHaveValue(String(last - 1));
  await page.keyboard.press('Home');
  await expect(slider).toHaveValue('0');
  await page.keyboard.press('End');
  await expect(slider).toHaveValue(String(last));
  await page.keyboard.press('Home');

  // Auto-play moves on by itself, and Pause stops it.
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await page.clock.runFor(1600);
  await expect(slider).toHaveValue('1');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.clock.runFor(5000);
  await expect(slider).toHaveValue('1');

  // A calm page: nothing scrolls sideways, every control is big enough to touch (§12.12).
  const metrics = await page.evaluate(() => ({
    sideways: document.documentElement.scrollWidth - window.innerWidth,
    small: [...document.querySelectorAll<HTMLElement>('[data-review] button, [data-review] input')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width < 44 || r.height < 44;
      })
      .map((el) => el.getAttribute('aria-label') ?? el.textContent ?? el.tagName),
  }));
  expect(metrics.sideways).toBeLessThanOrEqual(0);
  expect(metrics.small).toEqual([]);

  // The list of recent hands: beside the replay on a desktop, behind "All hands" on a phone.
  if (sizeOf(testInfo) === '1280x800') {
    await expect(page.getByRole('heading', { level: 2, name: 'Recent hands' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'All hands' })).toHaveCount(0);
  } else {
    await page.getByRole('button', { name: 'All hands' }).click();
    await expect(heading(page)).toHaveText('Recent hands');
    await page
      .getByRole('button', { name: /^.*Hand \d+/ })
      .first()
      .click();
    await expect(heading(page)).toHaveText(/^Hand \d+$/);
  }

  // The game waited, and Back returns to the banner.
  await page.clock.runFor(10_000);
  expect((await pcState(page)).game.hand?.handSeq).toBe(handSeq);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(banner).toBeVisible();
  expect((await pcState(page)).ui.screen).toBe('table');

  // The Menu lists the hand too.
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Recent hands' }).click();
  await expect(page.locator('[data-review]')).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();

  // The next hand deals as usual.
  await banner.click();
  await expect(banner).toHaveCount(0);
  expect(errors).toEqual([]);
});
