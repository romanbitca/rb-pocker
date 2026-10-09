import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import {
  heroAct,
  newTable,
  nextFlowPoint,
  openApp,
  pcState,
  prng,
  reloadAfterBust,
  seedFor,
  sizeOf,
  slot,
} from './game.ts';

// PLAN §18 Stage 3, acceptance 8: close the tab in the middle of a hand, open the app again, and
// Home's Play brings back a deep-equal game (the session is saved after every step, §14.2).
// Android Back with the sizing tray open closes the tray, not the table. Acceptance 9's other
// half: without a saved session, Home's Play starts a new table with the last-used settings.

/** The game the controller holds: the table, the hand and the hand's inputs (for replay). */
const game = (page: Page) =>
  page.evaluate(() => {
    const snap = window.__pc?.snapshot();
    if (snap === undefined) throw new Error('no window.__pc');
    return { mode: snap.mode, table: snap.table, hand: snap.hand, inputs: snap.inputs };
  });

test.describe('resume', () => {
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(
      !['390x844', '844x390', '1280x800'].includes(sizeOf(testInfo)),
      'a phone, landscape and a wide screen per browser',
    );
  });

  test('closing the tab mid-hand and opening it again: Play restores the same game', async ({
    page,
    context,
  }, testInfo) => {
    test.setTimeout(60_000);
    await page.clock.install();
    const seed = seedFor(testInfo);
    await openApp(page, seed);
    await newTable(page, { players: 6 });

    // Play on to a decision after the flop (the hero checks or calls).
    const random = prng(seed);
    for (let decisions = 0; ; decisions++) {
      expect(decisions, 'a decision after the flop').toBeLessThan(60);
      const point = await nextFlowPoint(page, true);
      if (point === 'end') {
        await page.locator('[data-hand-end]').click();
        continue;
      }
      if (point === 'bust') {
        await reloadAfterBust(page);
        continue;
      }
      if ((await pcState(page)).game.hand?.street !== 'preflop') break;
      await heroAct(page, () => 0.3 + random() * 0.4); // check or call
    }
    const saved = await game(page);
    expect(saved.mode).toBe('heroTurn');
    expect(saved.inputs.length).toBeGreaterThan(0);

    await page.close({ runBeforeUnload: true });
    const again = await context.newPage();
    await again.goto('/');
    const play = again.getByRole('button', { name: 'Play', exact: true });
    await expect(play).toBeVisible();
    // Home says which game Play continues.
    await expect(play).toHaveAccessibleDescription(/Hand \d+ · 6 players/);
    await play.click();
    await again.waitForFunction(() => window.__pc?.state().game.mode === 'heroTurn');
    await expect(again.locator('[data-hero-cards] [role="img"]')).toHaveCount(2);

    const restored = await game(again);
    expect(restored).toEqual(saved);
    expect((await pcState(again)).ui.screen).toBe('table');
  });

  test('without a saved game, Play starts a new table with the last-used settings', async ({
    page,
  }, testInfo) => {
    // An installed clock still runs in real time (Playwright pauses it only on `pauseAt`).
    await page.clock.install();
    await openApp(page, seedFor(testInfo));
    await newTable(page, { players: 4 });
    const old = (await pcState(page)).game.table?.tableId;
    // Drop the saved session (the profile with the settings stays), as after "Change table". The
    // old page plays on until it unloads and saves the session after every step (the real bots
    // can even finish the hand), so the session goes as the new page loads, before the app.
    await page.addInitScript(() => localStorage.removeItem('pc.v1.session'));
    await page.goto('/');
    const play = page.getByRole('button', { name: 'Play', exact: true });
    await expect(play).toBeVisible();
    // Paused, no bot acts: the first hand cannot end (a walk) before the test reads it. Play
    // deals at once (the click runs the controller); no timer has to run for it.
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
    await play.click();
    await expect.poll(async () => (await pcState(page)).game.hand?.phase).toBe('betting');
    const s = await pcState(page);
    expect(s.ui.screen).toBe('table');
    expect(s.game.table?.tableId, 'a new table').not.toBe(old);
    expect(s.game.hand?.seats).toHaveLength(4);
    expect(s.game.table?.handsDealt, 'its first hand').toBe(0);
    expect(s.settings.players).toBe(4);
  });

  test('Android Back with the sizing tray open closes the tray, not the table', async ({
    page,
  }, testInfo) => {
    await page.clock.install();
    await openApp(page, seedFor(testInfo));
    await newTable(page, { players: 6 });

    const right = slot(page, 'right');
    for (let decisions = 0; ; decisions++) {
      expect(decisions, 'a decision with the tray').toBeLessThan(60);
      const point = await nextFlowPoint(page, true);
      if (point === 'end') {
        await page.locator('[data-hand-end]').click();
        continue;
      }
      if (
        (await right.getAttribute('aria-disabled')) === null &&
        (await right.getAttribute('aria-expanded')) !== null
      ) {
        break;
      }
      await heroAct(page, () => 0.5);
    }
    await right.click();
    const tray = page.getByRole('group', { name: /^Choose your/ });
    await expect(tray).toBeVisible();

    await page.goBack();
    await expect(tray).toHaveCount(0);
    const s = await pcState(page);
    expect(s.ui.screen).toBe('table');
    expect(s.ui.overlays).not.toContain('tray');
    expect(s.game.mode, 'still the hero to act').toBe('heroTurn');
    await expect(page.locator('main[data-layout]')).toBeVisible();
  });
});
