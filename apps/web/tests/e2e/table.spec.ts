import { expect, test } from './fixtures.ts';

// Chunk 3.4 smoke test (PLAN §12.1, §18 Stage 3): a fresh profile, one tap on Play, the hero's
// cards within 2 s, then one full hand through the real buttons. One phone size per browser here;
// chunk 3.8 runs the full acceptance suite at every viewport.

/** Unicode suit characters U+2660–U+2667 (pitfall 31). */
const SUITS = /[♠-♧]/u;

test.describe('the table', () => {
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(
      !testInfo.project.name.endsWith('-phone-390x844'),
      'smoke test: one phone size per browser (chunk 3.8 covers every size)',
    );
  });

  test('one tap on Play deals within 2 s; a full hand plays to its end', async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    page.on('pageerror', (error) => errors.push(`uncaught: ${error.message}`));

    await page.goto('/');
    const play = page.getByRole('button', { name: 'Play', exact: true });
    await expect(play).toBeVisible();
    await play.click();

    // Acceptance 9: a dealt hand, the hero's cards face up, within 2 s; nothing in between.
    const hole = page.locator('[data-hero-cards] [role="img"]');
    await expect(hole.first()).toBeVisible({ timeout: 2000 });
    await expect(hole).toHaveCount(2);
    await expect(hole.first()).not.toHaveAttribute('aria-label', 'Hidden card');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-hero-name]')).not.toBeEmpty();

    // Play it through: check or call whenever it is our turn, until the hand-end banner.
    const banner = page.locator('[data-hand-end]');
    const middle = page.locator('[data-slot="middle"]');
    for (let i = 0; i < 400 && (await banner.count()) === 0; i++) {
      if ((await middle.getAttribute('aria-disabled')) !== 'true') await middle.click();
      else await page.waitForTimeout(200);
    }
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/win|folded/);
    await expect(banner).toContainText('Next hand');

    // A calm page: no scrolling, a small DOM (§15.3), no emoji suits.
    const page_ = await page.evaluate(() => ({
      scrollX: document.documentElement.scrollWidth - window.innerWidth,
      scrollY: document.documentElement.scrollHeight - window.innerHeight,
      nodes: document.querySelectorAll('*').length,
      text: document.body.textContent,
    }));
    expect(page_.scrollX).toBeLessThanOrEqual(0);
    expect(page_.scrollY).toBeLessThanOrEqual(0);
    expect(page_.nodes).toBeLessThanOrEqual(600);
    expect(SUITS.test(page_.text)).toBe(false);

    // A tap on the banner moves on: the next hand (or, if we lost every chip, the reload dialog).
    await banner.click();
    await expect(banner).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
