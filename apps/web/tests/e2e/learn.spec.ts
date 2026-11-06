import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { collectErrors, openApp, seedFor, sizeOf } from './game.ts';

// PLAN §12.1 (chunk 9.2): Learn through the real build. Welcome's "1-minute guide" opens lesson 1;
// Home → Learn → a lesson → its "See all poker hands" → "Which hand wins?" → Back page by page
// (the in-app Back and the browser's back, which is Android Back) to Home. Each page: one heading,
// RB's cards (never a Unicode suit), no sideways scroll, every control at least 44×44 px laid out.

const SUITS = /[♠-♧]/u;

const heading = (page: Page): Locator => page.getByRole('heading', { level: 1 });
const button = (page: Page, name: string | RegExp): Locator =>
  page.getByRole('button', { name, exact: typeof name === 'string' });

/** The page as a learner sees it: no Unicode suit, no sideways scroll, tap targets ≥ 44 px. */
async function expectSoundPage(page: Page): Promise<void> {
  const html = await page.evaluate(() => document.documentElement.outerHTML);
  expect(SUITS.exec(html)?.[0], 'no Unicode suit in the DOM').toBeUndefined();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'no sideways scroll').toBeLessThanOrEqual(0);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('main button, main input')].flatMap((el) => {
      const r = el.getBoundingClientRect();
      const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40);
      return r.width >= 44 && r.height >= 44 ? [] : [`"${name}" ${r.width}×${r.height}`];
    }),
  );
  expect(small, 'every control at least 44×44 px (§12.12)').toEqual([]);
}

test.describe('learn', () => {
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(
      !['360x740', '390x844', '844x390', '1280x800'].includes(sizeOf(testInfo)),
      'the narrowest phone, a phone, landscape and a wide screen per browser',
    );
  });

  test('Home → Learn → a lesson → rankings → Which hand wins → back', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await openApp(page, seedFor(testInfo, 'learn'));

    // Welcome (the first launch): the 1-minute guide is lesson 1; Back returns to Welcome.
    await button(page, 'New to poker? 1-minute guide').click();
    await expect(heading(page)).toHaveText('The goal');
    await expect(page.getByText('Lesson 1 of 7')).toBeVisible();
    const picture = page.getByRole('figure');
    await expect(picture.locator('[data-suit]')).toHaveCount(7);
    await expect(picture.getByRole('img', { name: 'Five of clubs, does not count' })).toBeVisible();
    await expectSoundPage(page);
    await button(page, 'Back').click();
    await expect(button(page, 'Play')).toBeVisible();

    // Play once (the profile is stored), then a later launch: Home.
    await button(page, 'Play').click();
    await page.waitForFunction(() => window.__pc?.state().ui.screen === 'table');
    await page.waitForFunction(() => localStorage.getItem('pc.v1.profile') !== null);
    await page.goto('/');
    await page.waitForFunction(() => window.__pc?.state().ui.screen === 'home');

    // Home → Learn.
    await button(page, 'Learn').click();
    await expect(heading(page)).toHaveText('Learn');
    await expect(heading(page)).toBeFocused();
    await expect(page.getByRole('button', { name: /^Lesson \d: / })).toHaveCount(7);
    await expectSoundPage(page);

    // → lesson 4, its two hands, and Next.
    await button(page, 'Lesson 4: Which hand wins').click();
    await expect(heading(page)).toHaveText('Which hand wins');
    await expect(page.getByText('Lesson 4 of 7')).toBeVisible();
    await expect(page.getByRole('figure').locator('[data-suit]')).toHaveCount(10);
    await expect(button(page, 'Next: Position')).toBeVisible();
    await expectSoundPage(page);

    // → the full-page rankings: ten rows, a row's details on a tap.
    await button(page, 'See all poker hands').click();
    await expect(heading(page)).toHaveText('Poker hands');
    const rows = page.locator('li[data-category]');
    await expect(rows).toHaveCount(10);
    await rows.nth(3).getByRole('button').click();
    await expect(page.getByText('Kings full of Fours beats Queens full of Aces.')).toBeVisible();
    await expectSoundPage(page);

    // → "Which hand wins?": two hands, a tap, the answer and its rule, the next hands.
    await button(page, 'Which hand wins?').click();
    const quiz = page.getByRole('region', { name: 'Which hand wins?' });
    const hands = quiz.getByRole('button', { name: /^(First|Second) hand:/ });
    await expect(hands).toHaveCount(2);
    await hands.first().click();
    await expect(quiz.getByRole('status')).toHaveText(
      /^(Right!|Not this time\.) .+ beat|^(Right!|Not this time\.) Both are/,
    );
    await expect(quiz.getByText(/^[01] of 1 right$/)).toBeVisible();
    await quiz.getByRole('button', { name: 'Next hands' }).click();
    await expect(quiz.getByRole('status')).toHaveText('');
    await expectSoundPage(page);

    // Back, page by page: the browser's back (Android Back), the in-app Back, the browser's back.
    await page.goBack();
    await expect(heading(page)).toHaveText('Which hand wins');
    await button(page, 'Back').click();
    await expect(heading(page)).toHaveText('Learn');

    // The glossary on the way out: the search narrows it.
    await button(page, /^Glossary/).click();
    await expect(heading(page)).toHaveText('Glossary');
    await page.getByRole('searchbox', { name: 'Find a word' }).fill('kicker');
    await expect(page.locator('main dt')).toHaveText(['kicker']);
    await expect(page.locator('main').getByRole('status')).toHaveText('1 word');
    await expectSoundPage(page);
    await page.goBack();
    await expect(heading(page)).toHaveText('Learn');

    await page.goBack();
    await expect(button(page, 'Play')).toBeVisible();
    expect(await page.evaluate(() => window.__pc?.state().ui.screen)).toBe('home');
    expect(errors).toEqual([]);
  });
});
