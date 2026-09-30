import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import {
  heroAct,
  newTable,
  nextFlowPoint,
  openApp,
  pcState,
  seedFor,
  sizeOf,
  slot,
} from './game.ts';

// PLAN §18 Stage 3, acceptance 5 (a free check disables Fold, and a tap on it says why) and
// acceptance 6 (§12.12 touch targets: primary buttons ≥ 56 px tall, every other control
// ≥ 44×44 px), measured on every screen and sheet Stage 3 has, at all six viewports.

test('with checking free, Fold is disabled and a tap on it shows why', async ({
  page,
}, testInfo) => {
  test.skip(sizeOf(testInfo) !== '390x844', 'acceptance 5: one phone size per browser');
  await page.clock.install();
  await openApp(page, seedFor(testInfo));
  await newTable(page, { players: 6 });

  // Check or call until a decision where checking is free.
  const middle = slot(page, 'middle');
  for (let decisions = 0; ; decisions++) {
    expect(decisions, 'a free check comes up').toBeLessThan(60);
    const point = await nextFlowPoint(page, true);
    if (point === 'end') {
      await page.locator('[data-hand-end]').click();
      continue;
    }
    if ((await middle.getAttribute('aria-label')) === 'Check') break;
    await heroAct(page, () => 0.5);
  }

  const fold = slot(page, 'fold');
  await expect(fold).toHaveAttribute('aria-disabled', 'true');
  const tip = page.getByRole('group', { name: 'Your actions' }).getByRole('status');
  await expect(tip).toHaveText('');
  const before = await pcState(page);
  // A real tap; `force` only skips Playwright's own wait for an enabled button (aria-disabled).
  await fold.click({ force: true });
  await expect(tip).toHaveText('Checking is free. No need to fold.');
  await expect(tip).toBeVisible();
  const after = await pcState(page);
  expect(after.game.mode, 'still the hero to act').toBe('heroTurn');
  expect(after.game.hand?.log).toEqual(before.game.hand?.log);
  expect(after.game.hand?.seats[0]?.folded).toBe(false);
});

interface SmallTarget {
  name: string;
  width: number;
  height: number;
  need: string;
}

/**
 * Every visible control on the page that is smaller than §12.12 allows. A visually hidden
 * radio or checkbox is measured by its label (the label is what a finger taps).
 */
function smallTargets(page: Page, where: string): Promise<SmallTarget[]> {
  return page.evaluate((where) => {
    const CONTROLS =
      'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="slider"], [role="switch"], [role="tab"], [tabindex]:not([tabindex="-1"])';
    const small: SmallTarget[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(CONTROLS)) {
      if (el.closest('[inert]') !== null || !el.checkVisibility({ visibilityProperty: true })) {
        continue;
      }
      let target: Element = el;
      if (el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox')) {
        target = el.closest('label') ?? (el.labels?.[0] as Element | undefined) ?? el;
      }
      const r = target.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const primary = el.hasAttribute('data-slot') || /(^|[_\s])primary/.test(el.className);
      const name =
        el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 40) ?? el.tagName;
      const need = primary ? '56 px tall' : '44×44 px';
      const ok = primary
        ? r.height >= 55.5 && r.width >= 43.5
        : r.height >= 43.5 && r.width >= 43.5;
      if (!ok) {
        small.push({
          name: `${where}: ${el.tagName.toLowerCase()} "${name}"`,
          width: Math.round(r.width * 10) / 10,
          height: Math.round(r.height * 10) / 10,
          need,
        });
      }
    }
    return small;
  }, where);
}

test('every control is big enough to tap', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const small: SmallTarget[] = [];
  const measure = async (where: string) => small.push(...(await smallTargets(page, where)));
  const wide = sizeOf(testInfo) === '1280x800';

  // Welcome (a fresh profile), then Play.
  await page.clock.install();
  await page.goto(`/?seed=${seedFor(testInfo)}`);
  const play = page.getByRole('button', { name: 'Play', exact: true });
  await expect(play).toBeVisible();
  await measure('Welcome');
  await play.click();
  await expect(page.locator('[data-hero-cards] [role="img"]')).toHaveCount(2);
  await page.evaluate(() =>
    window.__pc?.dispatch({ type: 'settings', patch: { speed: 'instant', autoNext: false } }),
  );

  // The Table at the hero's decision, with the sizing tray open when a bet or raise is possible.
  const right = slot(page, 'right');
  for (let decisions = 0; ; decisions++) {
    expect(decisions, 'a decision with the tray').toBeLessThan(60);
    const point = await nextFlowPoint(page, true);
    if (point === 'end') {
      await page.locator('[data-hand-end]').click();
      continue;
    }
    if (point === 'bust') throw new Error('out of chips');
    if (
      (await right.count()) === 1 &&
      (await right.getAttribute('aria-disabled')) === null &&
      (await right.getAttribute('aria-expanded')) !== null
    ) {
      break;
    }
    await heroAct(page, () => 0.5);
  }
  await measure('Table');
  await right.click();
  await expect(page.getByRole('group', { name: /^Choose your/ })).toBeVisible();
  await measure('Table, sizing tray open');
  await page.goBack(); // Android Back closes the tray
  await expect(page.getByRole('group', { name: /^Choose your/ })).toHaveCount(0);

  // The rankings: the drawer, or the column on a wide screen (measured with the Table above).
  if (!wide) {
    await page.locator('[data-table-box] + div button').click();
    await expect(page.getByRole('dialog', { name: /Poker hands/ })).toBeVisible();
    await measure('Rankings drawer');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: /Poker hands/ })).toHaveCount(0);
  }

  // The Menu, Settings (from the Menu), Setup and its "new table?" question, then Home.
  const menuButton = page.getByRole('button', { name: 'Menu', exact: true });
  await menuButton.click();
  await expect(page.getByRole('button', { name: 'Leave table' })).toBeVisible();
  await measure('Menu');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await measure('Settings');
  await page.goBack();
  await expect(page.locator('main[data-layout]')).toBeVisible();

  await menuButton.click();
  await page.getByRole('button', { name: 'New table', exact: true }).click();
  const start = page.getByRole('button', { name: 'Start game', exact: true });
  await expect(start).toBeVisible();
  await measure('Setup');
  await start.click();
  const question = page.getByRole('dialog');
  if ((await question.count()) > 0) {
    await expect(question.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await measure('New table? dialog');
    await question.getByRole('button', { name: 'Cancel' }).click();
  }

  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await measure('Home');

  expect(small).toEqual([]);
});
