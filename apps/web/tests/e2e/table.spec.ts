import { expect, test } from './fixtures.ts';
import { collectErrors, nextFlowPoint, pageMetrics, sizeOf, slot } from './game.ts';

// PLAN §18 Stage 3, acceptance 9 (§12.1 "one tap to play"): with a fresh profile, open the app
// and tap Play: a dealt hand with the hero's cards face up within 2 s, and no other screen,
// dialog or tip in between. At every viewport. Then, at one phone size, a full hand at the
// default Normal speed (every other spec plays at Instant speed).

/** Unicode suit characters U+2660–U+2667 (pitfall 31). */
const SUITS = /[♠-♧]/u;

test('one tap on Play deals a hand within 2 s, with nothing in between', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  const play = page.getByRole('button', { name: 'Play', exact: true });
  await expect(play).toBeVisible();

  // Record every screen and overlay the page shows from now on, and any dialog or tip.
  await page.waitForFunction(() => window.__pc?.state().game.mode !== 'booting');
  await page.evaluate(() => {
    const seen: string[] = [];
    Object.assign(window, { __seen: seen });
    const note = () => {
      const s = window.__pc?.state();
      const what = [
        `screen ${s?.ui.screen ?? '?'}`,
        ...(s?.ui.overlays ?? []).map((o) => `overlay ${o}`),
        ...[...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].map(
          (d) => `dialog ${d.getAttribute('aria-label') ?? d.textContent?.slice(0, 30) ?? ''}`,
        ),
      ].join(', ');
      if (seen.at(-1) !== what) seen.push(what);
    };
    new MutationObserver(note).observe(document.body, { subtree: true, childList: true });
    note();
  });

  const tapped = Date.now();
  await play.click();
  const hole = page.locator('[data-hero-cards] [role="img"]');
  await expect(hole.first()).toBeVisible({ timeout: 2000 });
  await expect(hole).toHaveCount(2);
  await expect(hole.first()).not.toHaveAttribute('aria-label', 'Hidden card', { timeout: 100 });
  await expect(hole.last()).not.toHaveAttribute('aria-label', 'Hidden card', { timeout: 100 });
  expect(Date.now() - tapped, 'dealt within 2 s of the tap').toBeLessThan(2000);
  await expect(page.locator('[data-hero-name]')).not.toBeEmpty();

  const seen = await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen);
  expect(seen, 'Welcome, then the Table: nothing in between').toEqual([
    'screen welcome',
    'screen table',
  ]);
  const state = await page.evaluate(() => window.__pc?.state());
  expect(state?.game.hand?.seats, 'the first-launch table: you + 5 bots').toHaveLength(6);
  expect(errors).toEqual([]);
});

test('a full hand at Normal speed plays to its end', async ({ page }, testInfo) => {
  test.skip(sizeOf(testInfo) !== '390x844', 'one phone size per browser');
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  // Normal speed keeps its pauses and animations; the fake clock only skips the waiting.
  await page.clock.install();
  await page.goto('/');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('[data-hero-cards] [role="img"]')).toHaveCount(2);
  expect(await page.evaluate(() => window.__pc?.state().settings.speed)).toBe('normal');

  for (let point = await nextFlowPoint(page, true); point !== 'end';) {
    if (point === 'hero') await slot(page, 'middle').click();
    point = await nextFlowPoint(page, true);
  }
  const banner = page.locator('[data-hand-end]');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(/win|folded|split/);
  await expect(banner).toContainText('Next hand');

  // A calm page: no scrolling, a small DOM (§15.3), no emoji suits.
  const metrics = await pageMetrics(page);
  expect(metrics.scrollX).toBeLessThanOrEqual(0);
  expect(metrics.scrollY).toBeLessThanOrEqual(0);
  expect(metrics.nodes).toBeLessThanOrEqual(600);
  const text = await page.evaluate(() => document.documentElement.outerHTML);
  expect(SUITS.test(text)).toBe(false);

  // A tap on the banner moves on: the next hand.
  await banner.click();
  await expect(banner).toHaveCount(0);
  expect(errors).toEqual([]);
});
