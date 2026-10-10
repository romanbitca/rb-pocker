import { expect, test } from './fixtures.ts';
import { collectErrors, pageMetrics, pcState, slot } from './game.ts';
import {
  actionBarDisabled,
  feedbackCard,
  gameMode,
  gradedAndKept,
  inputCount,
  pauseClock,
  playTo,
  runUntil,
  scriptedTable,
  TAP_GUARD_MS,
  toolbarUndo,
  trail,
} from './scripted.ts';

// PLAN §18 Stage 6, acceptance 2 and the E2E half of acceptance 3 (chunk 6.2; §11, §10.2, §12.6).
//
// The table: `?seed=46&script=river-min-bet`, 3 players (the shared helpers and the story of hand 1
// are in `scripted.ts`). The hero folds the nut flush to the small blind's minimum bet on the river:
// a Mistake or worse, so at Beginner the feedback card comes before anything moves. The clock is
// paused before the decision it watches (see `scripted.ts`).

test.describe('Stage 6 acceptance 2: a scripted blunder at Beginner', () => {
  test('folding the nut flush to a small bet: the card comes before anything moves; Undo takes it back, once', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await scriptedTable(page, 'beginner');
    await playTo(page, 'river');
    const before = await trail(page);
    expect(before.board).toHaveLength(5);

    await pauseClock(page);
    await slot(page, 'fold').click();
    const card = await feedbackCard(page);

    // Nothing was logged after the fold: no bot asked or acting, no card dealt (§11.1).
    const held = await trail(page);
    expect(held.inputs).toBe(before.inputs + 1);
    expect(held.last).toMatchObject({ e: 'act', seat: 0, action: { type: 'fold' } });
    expect(held.botRequests).toBe(before.botRequests);
    expect(held.board).toEqual(before.board);
    // Folding the nuts is at least a Mistake (6.1's grade: a Big mistake).
    expect(['mistake', 'blunder']).toContain(await card.getAttribute('data-feedback'));
    await expect(card.getByRole('heading', { level: 2 })).toHaveText(/mistake/i);
    await expect(card).toContainText("Coach's move:");
    await expect(card).toContainText('The first move still counts in your stats.');
    const undoInCard = card.getByRole('button', { name: 'Undo: try again' });
    await expect(undoInCard).toBeFocused();
    expect(await actionBarDisabled(page)).toBe(true);
    // Over the table, clear of the action bar, inside the screen; the Table stays under 600 nodes.
    const box = await card.boundingBox();
    const viewport = page.viewportSize();
    if (box === null || viewport === null) throw new Error('no card box');
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 0.5);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 0.5);
    for (const name of ['fold', 'middle', 'right'] as const) {
      const bar = await slot(page, name).boundingBox();
      if (bar === null) continue;
      const apart =
        box.x + box.width <= bar.x + 0.5 ||
        bar.x + bar.width <= box.x + 0.5 ||
        box.y + box.height <= bar.y + 0.5 ||
        bar.y + bar.height <= box.y + 0.5;
      expect(apart, `the card clears the ${name} button`).toBe(true);
    }
    expect((await pageMetrics(page)).nodes).toBeLessThanOrEqual(600);

    // Ten seconds of game time: still nothing moves while the card is open.
    await page.clock.runFor(10_000);
    expect(await trail(page)).toEqual(held);
    expect(await gameMode(page)).toBe('feedback');

    // Undo restores the decision: the hero to act again, facing the same bet, the same cards.
    await undoInCard.click();
    await expect(card).toHaveCount(0);
    await expect.poll(() => gameMode(page)).toBe('heroTurn');
    const back = await trail(page);
    expect(back.last).toMatchObject({ e: 'reshuffle' });
    expect(back.folded).toBe(false);
    expect(back.board).toEqual(before.board);
    expect(back.hole).toEqual(before.hole);
    expect(back.undoCount).toBe(1);
    await expect(
      page.getByText('Move taken back. The unseen cards were shuffled again.'),
    ).toBeVisible();
    await expect(slot(page, 'fold')).not.toHaveAttribute('aria-disabled', 'true');

    // A second Undo is disabled: the toolbar's button, its U key, and the card's after a repeat.
    await expect(toolbarUndo(page)).toBeVisible();
    await expect(toolbarUndo(page)).toHaveAttribute('data-undo', 'disabled');
    await expect(toolbarUndo(page)).toHaveAttribute('aria-disabled', 'true');
    await toolbarUndo(page).click({ force: true }); // a tap on the faded button does nothing
    await page.keyboard.press('u');
    expect((await trail(page)).undoCount).toBe(1);
    expect(await gameMode(page)).toBe('heroTurn');

    await page.clock.runFor(TAP_GUARD_MS + 50);
    await slot(page, 'fold').click();
    const again = await feedbackCard(page);
    const undoAgain = again.getByRole('button', { name: 'Undo: try again' });
    await expect(undoAgain).toHaveAttribute('aria-disabled', 'true');
    await expect(again.getByRole('button', { name: 'Keep my move' })).toBeFocused();
    await undoAgain.click({ force: true });
    await page.keyboard.press('u');
    expect(await gameMode(page)).toBe('feedback');
    expect((await trail(page)).undoCount).toBe(1);

    // Keep my move: the hand goes on to its end; the first fold stays in the record, undone.
    await again.getByRole('button', { name: 'Keep my move' }).click();
    await expect(again).toHaveCount(0);
    await page.clock.resume();
    await expect.poll(() => gameMode(page), { timeout: 20_000 }).toBe('handEnd');
    const decisions = (await pcState(page)).game.decisions.filter((d) => d.street === 'river');
    expect(decisions.map((d) => d.undone)).toEqual([true, false]);
    expect(decisions.every((d) => d.grade === decisions[0]?.grade)).toBe(true);
    expect(errors).toEqual([]);
  });
});

test.describe('Stage 6 acceptance 3: where Undo stops', () => {
  test('after a run-out reveal the toolbar Undo is disabled', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await scriptedTable(page, 'beginner');
    await playTo(page, 'flop');

    // The hero moves all-in on the flop through the sizing tray; the scripted bots will call.
    await pauseClock(page);
    await slot(page, 'right').click();
    const trayId = await slot(page, 'right').getAttribute('aria-controls');
    expect(trayId, 'the Bet button opens the sizing tray').not.toBeNull();
    await page
      .locator(`[id="${trayId}"]`)
      .getByRole('button', { name: /^All your chips/ })
      .click();
    const before = await inputCount(page);
    await slot(page, 'right').click();
    await expect.poll(() => inputCount(page)).toBe(before + 1);
    expect((await pcState(page)).game.hand?.street).toBe('flop');

    // Its grade in, the toolbar Undo works while the bots think...
    await gradedAndKept(page);
    await expect(toolbarUndo(page)).toHaveAttribute('data-undo', 'enabled');

    // ...and not once the cards are turned up for the run-out (§11.3 r2).
    await runUntil(
      page,
      () => (window.__pc?.state().game.hand?.revealed.length ?? 0) > 0,
      'the run-out reveal',
    );
    await expect(toolbarUndo(page)).toHaveAttribute('data-undo', 'disabled');
    expect((await pcState(page)).game.canUndo).toBe(false);
    await page.keyboard.press('u');
    expect((await trail(page)).undoCount).toBe(0);

    await page.clock.resume();
    await expect.poll(() => gameMode(page), { timeout: 20_000 }).toBe('handEnd');
    expect((await pcState(page)).game.canUndo).toBe(false);
    expect((await trail(page)).undoCount).toBe(0);
    expect(errors).toEqual([]);
  });

  test('at showdown the toolbar Undo is disabled', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await scriptedTable(page, 'beginner');
    await playTo(page, 'river');

    // The hero calls the river bet (the coach raises: a feedback card at Beginner; Keep my move).
    await pauseClock(page);
    const before = await inputCount(page);
    await slot(page, 'middle').click();
    await expect.poll(() => inputCount(page)).toBe(before + 1);
    await gradedAndKept(page);

    // The last bot still to act: the toolbar Undo works until the showdown turns the cards up.
    await expect(toolbarUndo(page)).toHaveAttribute('data-undo', 'enabled');
    await runUntil(
      page,
      () => (window.__pc?.state().game.hand?.revealed.length ?? 0) > 0,
      'the showdown',
    );
    const hand = (await pcState(page)).game.hand;
    expect(hand?.board).toHaveLength(5);
    await expect(toolbarUndo(page)).toHaveAttribute('data-undo', 'disabled');
    expect((await pcState(page)).game.canUndo).toBe(false);
    await page.keyboard.press('u');
    expect((await trail(page)).undoCount).toBe(0);

    await page.clock.resume();
    await expect.poll(() => gameMode(page), { timeout: 20_000 }).toBe('handEnd');
    expect((await pcState(page)).game.canUndo).toBe(false);
    expect(errors).toEqual([]);
  });

  // Advanced and Exam: the settings set them as Setup and Settings would (chunk 6.4 offers
  // them there); a quiz on the way is skipped (`readPoint`).
  test('Advanced: no toolbar Undo; the feedback card still offers it', async ({ page }) => {
    test.setTimeout(90_000);
    await scriptedTable(page, 'advanced');
    await playTo(page, 'river');
    await expect(toolbarUndo(page)).toHaveCount(0);
    await pauseClock(page);
    await slot(page, 'fold').click();
    const card = await feedbackCard(page);
    await card.getByRole('button', { name: 'Undo: try again' }).click();
    await expect(card).toHaveCount(0);
    await expect.poll(() => gameMode(page)).toBe('heroTurn');
    expect((await trail(page)).undoCount).toBe(1);
    await expect(toolbarUndo(page)).toHaveCount(0);
  });

  test('Exam: no Undo at all, and no feedback card', async ({ page }) => {
    test.setTimeout(90_000);
    await scriptedTable(page, 'exam');
    await playTo(page, 'river');
    await expect(toolbarUndo(page)).toHaveCount(0);
    await pauseClock(page);
    await slot(page, 'fold').click();
    // The grade comes in and is recorded, and the hand is not held for it.
    await expect
      .poll(() => pcState(page).then((s) => s.game.decisions.at(-1)?.street))
      .toBe('river');
    expect(await gameMode(page)).not.toBe('feedback');
    expect(await gameMode(page)).not.toBe('grading');
    await expect(page.locator('[data-feedback]')).toHaveCount(0);
    await page.keyboard.press('u');
    expect((await trail(page)).undoCount).toBe(0);
    await expect(toolbarUndo(page)).toHaveCount(0);
  });
});
