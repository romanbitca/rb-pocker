import { expect, test } from './fixtures.ts';
import { collectErrors, openApp, seedFor, sizeOf } from './game.ts';

/**
 * The hidden `#bench` screen on a real build (PLAN §15.4; chunk 4.7): it runs in its own
 * `equity.worker` under the production CSP and shows every number; typing `#bench` into a running
 * game reloads into it, and Back returns to the game. The worker is the same at every size, so one
 * viewport per browser runs it.
 */
test.describe('#bench', () => {
  test('measures in the worker and shows every number with its target', async ({
    page,
  }, testInfo) => {
    test.skip(sizeOf(testInfo) !== '1280x800', 'one viewport per browser');
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    await page.goto('/#bench');
    await expect(page.locator('[data-bench="done"]')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Speed test');
    const rows = page.locator('[data-bench-row]');
    await expect(rows).toHaveCount(6);
    await expect(page.locator('[data-bench-row="evaluator"]')).toContainText(
      /\d+\.\d million hands per second/,
    );
    for (const id of ['eq8Preflop', 'eq8Flop', 'eq1Flop']) {
      await expect(page.locator(`[data-bench-row="${id}"]`)).toContainText(/\d+(\.\d)? ms/);
    }
    await expect(page.locator('[data-bench-row="hint"]')).toContainText('Coming in Stage 5');
    const text = await page.getByLabel('The results as text').inputValue();
    expect(text.split('\n')[0]).toBe('RB Poker Coach speed test');
    console.info(`#bench (${testInfo.project.name}):\n${text}`);
    // No game started on this page.
    expect(await page.evaluate(() => window.__pc === undefined)).toBe(true);
    expect(errors).toEqual([]);
  });

  test('typing #bench into a running game opens it; Back returns to the game', async ({
    page,
  }, testInfo) => {
    test.skip(sizeOf(testInfo) !== '1280x800', 'one viewport per browser');
    test.setTimeout(120_000);
    await openApp(page, seedFor(testInfo));
    await page.evaluate(() => {
      window.location.hash = '#bench';
    });
    await expect(page.locator('[data-bench]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-bench="done"]')).toBeVisible({ timeout: 90_000 });
    await page.getByRole('button', { name: 'Back to the game' }).click();
    await page.waitForFunction(() => window.__pc?.state().game.mode === 'idle');
    expect(page.url()).not.toContain('#bench');
  });
});
