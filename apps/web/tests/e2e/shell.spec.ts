import { META_CSP } from '../../scripts/csp.ts';
import { expect, heading, test, waitForServiceWorkerControl } from './fixtures.ts';

test.describe('app shell', () => {
  test('shows "RB Poker Coach" with the CSP header and the meta CSP', async ({ page }) => {
    const response = await page.goto('/');
    if (response === null) throw new Error('no response for /');
    expect(response.status()).toBe(200);

    // PLAN §15.2, §17.2: the header is the meta CSP plus frame-ancestors (ignored in a meta tag).
    const headers = await response.allHeaders();
    expect(headers['content-security-policy']).toBe(`${META_CSP};frame-ancestors 'none'`);
    await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute(
      'content',
      META_CSP,
    );

    await expect(heading(page)).toHaveText('RB Poker Coach');
  });

  test('logs no console errors, before and after the service worker takes over', async ({
    page,
  }) => {
    // A CSP violation (an inline script, pitfall 32) is reported here too.
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    page.on('pageerror', (error) => errors.push(`uncaught: ${error.message}`));

    await page.goto('/');
    await expect(heading(page)).toHaveText('RB Poker Coach');
    await waitForServiceWorkerControl(page);
    await page.reload();
    await expect(heading(page)).toHaveText('RB Poker Coach');

    expect(errors).toEqual([]);
  });
});
