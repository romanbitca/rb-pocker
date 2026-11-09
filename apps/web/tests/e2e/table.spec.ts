import { defaultProfile, type Settings } from '../../src/persist/schema.ts';
import { expect, test } from './fixtures.ts';
import { collectErrors, nextFlowPoint, pageMetrics, sizeOf, slot, tapNextHand } from './game.ts';

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

// §15.3: the Table, Setup, Settings, the Menu and the dialogs are a lazy chunk that the app asks
// for by itself once the first screen is painted. So when a person taps Play, the chunk is there
// and the Table comes at once, without the "Loading…" page a tap before it would show.
test('the Table loads after the first paint, without a tap, and Play never waits for it', async ({
  page,
}, testInfo) => {
  test.skip(sizeOf(testInfo) !== '390x844', 'one phone size per browser');
  const errors = collectErrors(page);
  await page.goto('/');
  const play = page.getByRole('button', { name: 'Play', exact: true });
  await expect(play).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        performance
          .getEntriesByType('resource')
          .some((entry) => /\/assets\/screensEntry-[\w-]+\.js$/.test(entry.name)),
      ),
    )
    .toBe(true);
  // A person reads the screen before tapping; then no "Loading…" may appear on the way.
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const flag = window as unknown as { __sawLoading: boolean };
    flag.__sawLoading = false;
    new MutationObserver(() => {
      if (document.body.textContent?.includes('Loading…') === true) flag.__sawLoading = true;
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await play.click();
  await expect(page.locator('[data-hero-cards] [role="img"]')).toHaveCount(2);
  await expect(page.getByRole('heading', { level: 1, name: 'Poker table' })).toBeAttached();
  const sawLoading = await page.evaluate(
    () => (window as unknown as { __sawLoading: boolean }).__sawLoading,
  );
  expect(sawLoading, 'no "Loading…" page between Play and the Table').toBe(false);
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
  const settings = await page.evaluate(() => window.__pc?.state().settings);
  expect(settings?.speed).toBe('normal');
  // 1.3.94 (§12.8; the owner: "it must not start automatically, i need to click next game"):
  // "Deal the next hand by itself" is off on a first launch, so the hand end waits for the tap.
  expect(settings?.autoNext).toBe(false);

  for (let point = await nextFlowPoint(page, true); point !== 'end';) {
    if (point === 'hero') await slot(page, 'middle').click();
    point = await nextFlowPoint(page, true);
  }
  const banner = page.locator('[data-hand-result]');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(/win|folded|split/);
  await expect(page.locator('[data-hand-end]')).toContainText('Next hand');
  // No next hand by itself: 10 s on (the old wait was 3 s), the same hand's banner is there.
  const ended = await page.evaluate(() => window.__pc?.state().game.hand?.handSeq);
  await page.clock.runFor(10_000);
  await expect(banner).toBeVisible();
  expect(
    await page.evaluate(() => {
      const game = window.__pc?.state().game;
      return { mode: game?.mode, handSeq: game?.hand?.handSeq };
    }),
  ).toEqual({ mode: 'handEnd', handSeq: ended });

  // A calm page: no scrolling, a small DOM (§15.3), no emoji suits.
  const metrics = await pageMetrics(page);
  expect(metrics.scrollX).toBeLessThanOrEqual(0);
  expect(metrics.scrollY).toBeLessThanOrEqual(0);
  expect(metrics.nodes).toBeLessThanOrEqual(600);
  const text = await page.evaluate(() => document.documentElement.outerHTML);
  expect(SUITS.test(text)).toBe(false);

  // Beginner's hand summary does not open by itself (§10.2, §12.9; 1.3.92): "Next hand ›"
  // moves on to the next hand.
  expect(await page.evaluate(() => window.__pc?.state().ui.overlays)).not.toContain('summary');
  await expect(page.locator('[data-summary]')).toHaveCount(0);
  await tapNextHand(page);
  await expect(banner).toHaveCount(0);
  expect(errors).toEqual([]);
});

// 1.3.94 (Appendix H.2 rule 6): a profile saved before it holds "Deal the next hand by itself" on,
// the old default. Its first launch turns it off once and saves that; a player who turns it on
// again keeps it.
test('a profile from before 1.3.94: the next hand waits for the tap; on again, it stays on', async ({
  page,
}, testInfo) => {
  test.skip(sizeOf(testInfo) !== '390x844', 'one phone size per browser');
  const errors = collectErrors(page);
  const old = defaultProfile(new Date('2026-11-01T10:00:00.000Z'));
  const settings: Settings = { ...old.settings, autoNext: true };
  delete settings.defaultsRev;
  await page.addInitScript(
    (text) => {
      if (localStorage.getItem('pc.v1.profile') === null)
        localStorage.setItem('pc.v1.profile', text);
    },
    JSON.stringify({ ...old, rev: 12, settings }),
  );
  const stored = () =>
    page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('pc.v1.profile') ?? '{}') as { settings?: Settings })
          .settings,
    );
  await page.goto('/');
  await page.waitForFunction(() => window.__pc?.state().ui.screen === 'home');
  expect(await page.evaluate(() => window.__pc?.state().settings.autoNext)).toBe(false);
  // Written back once the tab holds the writer lock (§14.7).
  await expect.poll(stored).toMatchObject({ autoNext: false, defaultsRev: 1 });

  const toggle = page.getByRole('switch', { name: 'Deal the next hand by itself' });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect.poll(async () => (await stored())?.autoNext).toBe(true); // saved 250 ms later

  await page.reload();
  await page.waitForFunction(() => window.__pc?.state().ui.screen === 'home');
  expect(await page.evaluate(() => window.__pc?.state().settings.autoNext)).toBe(true);
  expect(await stored()).toMatchObject({ autoNext: true, defaultsRev: 1 });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(toggle).toBeChecked();
  expect(errors).toEqual([]);
});
