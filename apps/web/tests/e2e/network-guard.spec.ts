import { expect, forbiddenReason, test } from './fixtures.ts';

// The fixture in fixtures.ts must catch what PLAN §15.2 forbids. These tests break the rule on
// purpose, check that it was recorded, then empty the list so the end-of-test check passes.

test.describe('the network guard', () => {
  test('records a request to /api', async ({ page, forbiddenRequests }) => {
    await page.goto('/');
    await page.evaluate(async () => {
      await fetch('api/health');
    });

    expect(forbiddenRequests).toEqual([
      expect.stringMatching(/^goes to \/api: GET .*\/api\/health$/),
    ]);
    forbiddenRequests.length = 0;
  });

  test('records a request that leaves the origin', async ({ page, baseURL, forbiddenRequests }) => {
    // Another origin that needs no internet: the same server under its IP address. The CSP would
    // block a fetch there, but not a navigation.
    const other = new URL('/api/health', baseURL);
    other.hostname = '127.0.0.1';
    await page.goto(other.href);
    await page.close(); // nothing more can load from it (a favicon, say) after the list is emptied

    expect(forbiddenRequests).toContain(`leaves the origin: GET ${other.href}`);
    expect(forbiddenRequests.every((entry) => entry.startsWith('leaves the origin: '))).toBe(true);
    forbiddenRequests.length = 0;
  });

  test('classifies URLs', () => {
    const app = 'http://localhost:3000';
    expect(forbiddenReason(`${app}/`, app)).toBeNull();
    expect(forbiddenReason(`${app}/assets/index-abc.js`, app)).toBeNull();
    expect(forbiddenReason(`${app}/apiary.png`, app)).toBeNull();
    expect(forbiddenReason('data:image/png;base64,AAAA', app)).toBeNull();
    expect(forbiddenReason(`blob:${app}/0b5c7a4e-7a4e-4b5c-9a4e-0b5c7a4e7a4e`, app)).toBeNull();

    expect(forbiddenReason(`${app}/api`, app)).toBe('goes to /api');
    expect(forbiddenReason(`${app}/api/health?x=1`, app)).toBe('goes to /api');
    expect(forbiddenReason(`${app}/API/health`, app)).toBe('goes to /api');
    expect(forbiddenReason('http://127.0.0.1:3000/', app)).toBe('leaves the origin');
    expect(forbiddenReason('https://localhost:3000/', app)).toBe('leaves the origin');
    expect(forbiddenReason('https://fonts.googleapis.com/css', app)).toBe('leaves the origin');
    expect(forbiddenReason('blob:https://example.com/0b5c7a4e', app)).toBe('leaves the origin');
  });
});
