import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { collectErrors, openApp, pcState, seedFor, sizeOf, slot } from './game.ts';
import { inputCount, nextPoint } from './scripted.ts';

// PLAN §18 Stage 9, acceptance 2, its last sentence: "A full hand is playable by keyboard only"
// (the §12.5 shortcuts, §12.12; chunk 9.3), with the script of its first sentence done by keys
// (chunk 9.6): start a table (Tab to Welcome's Play, Enter), play a hand, open the hint (H), undo
// (U), open the hands drawer (K), and after the hand S (the hand summary, when the banner offers
// one; 1.3.92). At the desktop size (K hides and shows the hands column) and at the tablet size
// (portrait: K opens the drawer, a dialog that has the keyboard, and K or Esc closes it), in both
// browsers. The bots check and call (`?script=passive`, a test-build hook), so
// the hand always reaches its end; the coach is at Intermediate, so H has a hint to show. The
// settings Play uses are set through `window.__pc` (as Setup would leave them); from then on the
// page gets keys only: a pointer watch proves no tap or click reached it.

/** The hero's last action in the hand's log. */
const lastHeroAct = (page: Page) =>
  page.evaluate(() => {
    const log = window.__pc?.state().game.hand?.log ?? [];
    for (let i = log.length - 1; i >= 0; i--) {
      const e = log[i];
      if (e?.e === 'act' && e.seat === 0) return e.action;
    }
    return null;
  });

const undoCount = (page: Page): Promise<number> =>
  page.evaluate(() => window.__pc?.snapshot().meta.undoCount ?? -1);

/**
 * A key that acts: pressed again while the controller has not taken it (a key within 250 ms of
 * the last action is ignored, as a tap is, §12.7).
 */
async function keyAct(page: Page, key: string): Promise<void> {
  const before = await inputCount(page);
  await expect(async () => {
    if ((await inputCount(page)) === before) await page.keyboard.press(key);
    expect(await inputCount(page)).toBeGreaterThan(before);
  }).toPass({ timeout: 10_000 });
}

test('a full hand by keyboard only, from Play, with every §12.5 shortcut', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(
    !['768x1024', '1280x800'].includes(sizeOf(testInfo)),
    'the tablet (the hands drawer) and the desktop size (the hands column), in both browsers',
  );
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await openApp(page, seedFor(testInfo), '&script=passive');
  // The settings Play uses (the last-used ones, §12.1), as Setup would leave them.
  await page.evaluate(() => {
    window.__pc?.dispatch({
      type: 'settings',
      patch: { coachLevel: 'intermediate', players: 3, speed: 'fast', autoNext: true },
    });
  });
  // From here on the page gets keys only.
  await page.evaluate(() => {
    const seen = { pointers: 0 };
    Object.assign(window, { __pointers: seen });
    document.addEventListener('pointerdown', () => seen.pointers++, true);
  });

  // Start a table: Welcome (the first launch), Tab to Play, Enter: a dealt hand (§12.1). Safari's
  // Tab skips buttons unless "Press Tab to highlight each item" is on; Option+Tab reaches them.
  const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  const play = page.getByRole('button', { name: 'Play', exact: true });
  const playFocused = () => play.evaluate((el) => el === document.activeElement);
  for (let tabs = 0; tabs < 10 && !(await playFocused()); tabs++) await page.keyboard.press(tab);
  await expect(play).toBeFocused();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => {
    const s = window.__pc?.state();
    return s?.ui.screen === 'table' && s.game.hand !== null && s.game.hand.seats.length === 3;
  });
  await expect(page.locator('[data-hero-cards] [role="img"]')).toHaveCount(2);
  const handSeq = (await pcState(page)).game.hand?.handSeq ?? 0;

  // The first decision (the coach's hint is in).
  expect(await nextPoint(page)).toBe('hero');
  const layout = (await pcState(page)).ui.layout;
  expect(layout).toBe(sizeOf(testInfo) === '1280x800' ? 'wide' : 'portrait');
  const wide = layout === 'wide';

  if (wide) {
    // K hides the hand-rankings column and shows it again (§13.1).
    const panel = () => pcState(page).then((s) => s.settings['handsPanel']);
    await page.keyboard.press('k');
    await expect.poll(panel).toBe('collapsed');
    await page.keyboard.press('K');
    await expect.poll(panel).toBe('open');
  } else {
    // K opens the hands drawer: a dialog that takes the focus (and the keys); K closes it again,
    // and so does Esc (§12.5 notes).
    const drawer = page.getByRole('dialog', { name: /Poker hands/ });
    const focusInside = () =>
      page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null);
    await page.keyboard.press('k');
    await expect(drawer).toBeVisible();
    await expect.poll(focusInside).toBe(true);
    await page.keyboard.press('k');
    await expect(drawer).toHaveCount(0);
    await page.keyboard.press('K');
    await expect(drawer).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
  }

  // ? lists the keys in a dialog; Esc closes it.
  await page.keyboard.press('?');
  const list = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(list).toBeVisible();
  await expect(list.locator('kbd')).toHaveCount(12);
  await expect(list).toContainText('Hand summary or exam result');
  await page.keyboard.press('Escape');
  await expect(list).toHaveCount(0);

  // H: the coach's hint (Intermediate waits for "Hint"), marked as opened.
  await page.keyboard.press('h');
  await expect
    .poll(() =>
      pcState(page).then((s) => s.coach.opened !== null && s.coach.opened === s.coach.key),
    )
    .toBe(true);
  await expect(page.locator('[data-coach-advice]')).toBeVisible();

  // B/R opens the sizing tray on its slider; 2 picks the second size, ↑ adds one step, Enter sends
  // exactly what the button shows.
  const before = await inputCount(page);
  await page.keyboard.press('r');
  await expect(slot(page, 'right')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('input[type="range"]')).toBeFocused();
  await page.keyboard.press('2');
  const atPreset = (await slot(page, 'right').textContent()) ?? '';
  await page.keyboard.press('ArrowUp');
  await expect(slot(page, 'right')).not.toHaveText(atPreset);
  const label = (await slot(page, 'right').textContent()) ?? '';
  const to = Number(label.replace(/\D/g, ''));
  await page.keyboard.press('Enter');
  await expect.poll(() => inputCount(page)).toBe(before + 1);
  const raised = await lastHeroAct(page);
  expect(raised?.type === 'raise' || raised?.type === 'bet').toBe(true);
  expect(raised).toMatchObject({ to });
  const legalBefore = await page.evaluate(() => window.__pc?.state().game.legal ?? null);
  expect(legalBefore).toBeNull(); // the decision is gone

  // U takes the raise back once its grade is in (the toolbar's U, or the card's on a mistake).
  await expect
    .poll(() => pcState(page).then((s) => s.game.mode === 'feedback' || s.game.canUndo))
    .toBe(true);
  await page.keyboard.press('u');
  await expect.poll(() => undoCount(page)).toBe(1);
  await expect(
    page.getByText('Move taken back. The unseen cards were shuffled again.'),
  ).toBeVisible();

  // C checks or calls this time. A second U at the same decision is refused (§11.5).
  expect(await nextPoint(page)).toBe('hero');
  await keyAct(page, 'c');
  await expect.poll(() => pcState(page).then((s) => s.game.mode !== 'grading')).toBe(true);
  await page.keyboard.press('u');
  expect(await undoCount(page)).toBe(1);
  if ((await pcState(page)).game.mode === 'feedback') await page.keyboard.press('Escape');

  // The rest of the hand: C at every decision; once, F with checking free: the bar says why and
  // nothing is sent. Esc keeps the move on a feedback card.
  let foldTried = false;
  for (let points = 0; points < 40; points++) {
    const point = await nextPoint(page);
    if (point === 'end') break;
    if (point === 'feedback') {
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-feedback]')).toHaveCount(0);
      continue;
    }
    expect(point).toBe('hero');
    const legal = (await pcState(page)).game.legal;
    if (legal?.canCheck === true && !foldTried) {
      const n = await inputCount(page);
      await page.keyboard.press('f');
      await expect(page.locator('p[role="status"]', { hasText: 'Checking is free' })).toBeVisible();
      expect(await inputCount(page)).toBe(n);
      foldTried = true;
    }
    await keyAct(page, 'c');
  }
  const end = await pcState(page);
  expect(end.game.mode).toBe('handEnd');
  expect(end.game.hand?.phase).toBe('complete');
  expect(end.game.hand?.handSeq).toBe(handSeq);
  expect(foldTried, 'F was tried with checking free').toBe(true);

  // The hand summary never opens by itself (1.3.92). S opens it when the banner offers one
  // (Intermediate: after an Inaccuracy or worse; pressed at once, before the 1.5 s wait ends), the
  // next hand waits while it is open, and Esc closes it; then the next hand comes by itself.
  expect(end.ui.overlays).not.toContain('summary');
  await page.keyboard.press('s');
  const pressed = await pcState(page);
  if (pressed.ui.overlays.includes('summary')) {
    expect(pressed.game.summary).not.toBeNull();
    await expect(page.locator('[data-summary-next]')).toBeVisible();
    expect((await pcState(page)).game.hand?.handSeq).toBe(handSeq);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-summary]')).toHaveCount(0);
  } else {
    // No summary to open (or the next hand had already come): S did nothing.
    expect(pressed.game.summary === null || pressed.game.hand?.handSeq !== handSeq).toBe(true);
  }
  await expect
    .poll(() => pcState(page).then((s) => s.game.hand?.handSeq), { timeout: 20_000 })
    .toBe(handSeq + 1);

  const pointers = await page.evaluate(
    () => (window as unknown as { __pointers: { pointers: number } }).__pointers.pointers,
  );
  expect(pointers, 'no tap or click: keys only').toBe(0);
  expect(errors).toEqual([]);
});
