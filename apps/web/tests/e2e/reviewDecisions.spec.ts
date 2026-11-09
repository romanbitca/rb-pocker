import type { Page } from '@playwright/test';
import { expect, heading, test } from './fixtures.ts';
import { collectErrors, newTable, openApp, pcState, seedFor, sizeOf } from './game.ts';
import { nextPoint, playTo, scriptedTable, tapAct } from './scripted.ts';

// PLAN §12.10, §12.1, §14.4, §13.5 (1.3.101): what the product review of 8 Nov 2026 asked for.
//
// - Review of a hand with a mistake opens at it, says what you did and what the coach would have
//   done, and "Next decision" / "Previous decision" jump between your decisions. The hand is the
//   scripted table of undo.spec.ts: you fold the nut flush to a minimum bet on the river.
// - Home's "Work on" line appears only with enough hands, opens its lesson and leaves Play alone.
// - The hand drill fits one phone screen: every game, normal text, no vertical scroll while a
//   question is on show (the case that made you scroll on every question).

/** The two phones of the review, in both browsers. */
const PHONES = ['360x740', '390x844'];

// eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
test.beforeEach(({}, testInfo) => {
  test.skip(!PHONES.includes(sizeOf(testInfo)), 'the two phone sizes of the review');
});

const STREET: Readonly<Record<string, string>> = {
  preflop: 'Before the flop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
};

test('a hand with a mistake opens Review at it; the decision buttons jump', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await scriptedTable(page, 'beginner');
  await playTo(page, 'river');
  await tapAct(page, 'fold'); // the nut flush, to a minimum bet
  for (let point = await nextPoint(page); point !== 'end'; point = await nextPoint(page)) {
    if (point === 'feedback') await page.getByRole('button', { name: 'Keep my move' }).click();
  }
  const decisions = (await pcState(page)).game.decisions;
  const firstMistake = decisions.findIndex((d) => d.grade === 'mistake' || d.grade === 'blunder');
  expect(firstMistake).toBeGreaterThanOrEqual(0);

  await page.getByRole('button', { name: 'Review this hand' }).click();
  await expect(heading(page)).toHaveText(/^Hand \d+$/);
  const slider = page.getByRole('slider', { name: 'Step' });
  const row = page.locator('[data-review-decision]');
  const next = page.getByRole('button', { name: 'Next decision' });
  const previous = page.getByRole('button', { name: 'Previous decision' });

  // It opens at the mistake: past the deal, with the row of the Hand summary on that step.
  await expect(row).toHaveAttribute(
    'data-review-decision',
    decisions[firstMistake]?.grade as string,
  );
  await expect(row).toContainText(STREET[decisions[firstMistake]?.street as string] as string);
  await expect(row.locator('[data-grade-chip]')).toBeVisible();
  const opened = Number(await slider.inputValue());
  expect(opened).toBeGreaterThan(0);

  // The whole row and the two buttons are on the phone's screen, and big enough to touch.
  for (const control of [row, next, previous]) {
    const box = await control.boundingBox();
    const bottom = (box?.y ?? 0) + (box?.height ?? 0);
    expect(bottom).toBeLessThanOrEqual(page.viewportSize()?.height ?? 0);
  }
  for (const button of [next, previous]) {
    const box = await button.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }

  // From the deal, "Next decision" steps through every decision, in order, ending on the fold.
  await page.keyboard.press('Home');
  await expect(slider).toHaveValue('0');
  await expect(row).toHaveCount(0);
  await expect(previous).toHaveAttribute('aria-disabled', 'true');
  const seen: number[] = [];
  for (const decision of decisions) {
    await next.click();
    await expect(row).toHaveAttribute('data-review-decision', decision.grade ?? 'none');
    await expect(row).toContainText(STREET[decision.street] as string);
    seen.push(Number(await slider.inputValue()));
  }
  expect(seen).toEqual([...new Set(seen)].sort((a, b) => a - b));
  expect(seen[firstMistake]).toBe(opened);
  await expect(next).toHaveAttribute('aria-disabled', 'true');
  await expect(row).toContainText('You folded');

  // And back.
  await previous.click();
  await expect(slider).toHaveValue(String(seen[seen.length - 2]));
  await next.click();
  await expect(slider).toHaveValue(String(seen[seen.length - 1]));

  // Other steps still say what happened, in their own line.
  await page.keyboard.press('ArrowRight');
  await expect(row).toHaveCount(0);
  expect(errors).toEqual([]);
});

/** Stores a counted profile with these hands and leaks, then boots again: Home. */
async function homeWith(
  page: Page,
  seed: string,
  hands: number,
  leaks: Record<string, { count: number; lossMilliBB: number }>,
): Promise<void> {
  await page.evaluate(
    ({ hands, leaks }) => {
      const profile = JSON.parse(localStorage.getItem('pc.v1.profile') as string) as {
        stats: { results: { clean: { hands: number } }; leaks: unknown };
      };
      profile.stats.results.clean.hands = hands;
      profile.stats.leaks = leaks;
      localStorage.setItem('pc.v1.profile', JSON.stringify(profile));
    },
    { hands, leaks },
  );
  await openApp(page, seed);
}

/** Settings and back: the screens chunk is there, so a line that is absent will stay absent. */
async function screensLoaded(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(heading(page)).toHaveText('Settings');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
}

test('Home names the biggest leak under Play, only with enough hands', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  const seed = seedFor(testInfo, 'work-on');
  await openApp(page, seed);
  await newTable(page, { players: 3 }); // writes the profile
  const line = page.locator('[data-work-on]');
  const leak = { overfold: { count: 5, lossMilliBB: 9000 } };

  // Too few hands for Stats to show it, then a leak seen too few times.
  await homeWith(page, seed, 4, leak);
  await screensLoaded(page);
  await expect(line).toHaveCount(0);
  await homeWith(page, seed, 12, { overfold: { count: 2, lossMilliBB: 9000 } });
  await screensLoaded(page);
  await expect(line).toHaveCount(0);

  // Enough of both: one line under Play, a tap target.
  await homeWith(page, seed, 12, leak);
  await expect(line).toHaveText('Work on: Pot odds');
  const play = await page.getByRole('button', { name: 'Play', exact: true }).boundingBox();
  const box = await line.boundingBox();
  expect(box?.y ?? 0).toBeGreaterThan((play?.y ?? 0) + (play?.height ?? 0));
  expect(box?.height).toBeGreaterThanOrEqual(44);
  expect(box?.width).toBeGreaterThanOrEqual(44);

  // It opens that lesson, Back comes Home; Play is still one tap to a dealt hand.
  await line.click();
  await expect(heading(page)).toHaveText('Pot odds');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => pcState(page).then((s) => s.ui.screen)).toBe('table');
  expect((await pcState(page)).game.hand).not.toBeNull();
  expect(errors).toEqual([]);
});

/** Every game of the drill (`GAME_IDS` without Mixed, which is these shuffled). */
const GAMES = ['cards', 'holdem', 'showdown', 'versus', 'order', 'pos2name', 'name2pos'];

test('the hand drill fits one phone screen, in every game', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await openApp(page, seedFor(testInfo, 'drill-fit'));
  await page.evaluate(() => window.__pc?.dispatch({ type: 'go', screen: 'home' }));
  await page.getByRole('button', { name: 'Hand drill' }).click();
  await expect(page.locator('[data-question]')).toHaveCount(1);
  const feedback = page.locator('[data-feedback]');
  const height = page.viewportSize()?.height ?? 0;

  for (const game of GAMES) {
    await page.locator('[data-drill-games]').click();
    await page.locator(`[data-game="${game}"]`).click();
    for (let round = 0; round < 3; round++) {
      await expect(feedback).toHaveAttribute('data-feedback', '');
      // No vertical scroll, and the last control is on the screen.
      const fit = await page.evaluate(() => {
        const controls = [...document.querySelectorAll('[data-screen="drill"] button')];
        return {
          scroll: document.documentElement.scrollHeight,
          inner: window.innerHeight,
          sideways: document.documentElement.scrollWidth - window.innerWidth,
          bottom: Math.max(...controls.map((c) => c.getBoundingClientRect().bottom)),
          small: controls
            .filter((c) => {
              const r = c.getBoundingClientRect();
              return r.width < 44 || r.height < 44;
            })
            .map((c) => c.textContent),
        };
      });
      expect(fit.scroll, `${game}: scrolls`).toBeLessThanOrEqual(fit.inner);
      expect(fit.sideways, `${game}: pans sideways`).toBeLessThanOrEqual(0);
      expect(fit.bottom, `${game}: the last control`).toBeLessThanOrEqual(height);
      expect(fit.small).toEqual([]);

      // Answer, then Next: it is on the screen without a scroll by hand.
      const options = page.locator('[data-option]');
      if ((await options.count()) > 0) await options.first().click();
      else {
        const names = page.locator('[data-name]');
        if ((await names.count()) > 0) await names.nth(3).click();
        const positions = page.locator('[data-position="5"]');
        if ((await positions.count()) > 0) await positions.click();
      }
      await expect(feedback).toHaveAttribute('data-feedback', /^(right|wrong)$/);
      const next = page.getByRole('button', { name: 'Next', exact: true });
      await expect(next).toBeInViewport();
      await next.click();
    }
  }
  expect(errors).toEqual([]);
});
