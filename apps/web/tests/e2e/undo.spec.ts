import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { collectErrors, newTable, openApp, pageMetrics, pcState, slot } from './game.ts';

// PLAN §18 Stage 6, acceptance 2 and the E2E half of acceptance 3 (chunk 6.2; §11, §10.2, §12.6).
//
// The table: `?seed=46&script=river-min-bet`, 3 players. The bots are scripted (`app/botScripts.ts`:
// they check and call, and on the river the first one that can bets the minimum); the coach is
// not: hints and grades come from the real brain.worker (chunk 6.1). In hand 1 the hero is the big
// blind with A♣3♣ and the board runs 8♣5♥2♣, J♦, T♣: on the river the hero holds the nut flush and
// the small blind bets the minimum into it (tests/app/controller.grade.test.ts checks the same
// table without a browser).
//
// The game clock: `page.clock.install()` keeps it running in real time; it stops only at
// `pauseAt` (the earlier flake lesson). The specs pause it just before the decision they watch, so
// the 1,500 ms grade window cannot run out on a slow runner and nothing on a timer (bot think
// times, the pause before a new card) moves until `runFor` says so. Brain replies are worker
// messages, not timers: they still arrive. While paused, `performance.now()` stands still too, so
// the action bar's 250 ms double-tap guard needs `runFor` before a second tap.

const SEED = '46';
const SCRIPT = '&script=river-min-bet';
const TAP_GUARD_MS = 250;

type Level = 'beginner' | 'intermediate' | 'advanced' | 'exam';

/** Opens the scripted table at `level` and waits for the first hand (instant speed, no auto-next). */
async function scriptedTable(page: Page, level: Level): Promise<void> {
  await page.clock.install();
  await openApp(page, SEED, SCRIPT);
  await page.evaluate((coachLevel) => {
    window.__pc?.dispatch({ type: 'settings', patch: { coachLevel } });
  }, level);
  await newTable(page, { players: 3 });
}

type Point = 'hero' | 'feedback' | 'end';

/** In the page: the hero's turn with its hint in, the feedback card on show, or the hand end. */
function readPoint(): Point | null {
  const s = window.__pc?.state();
  const hand = s?.game.hand;
  if (s === undefined || hand === null || hand === undefined) return null;
  if (s.game.mode === 'feedback' && document.querySelector('[data-feedback]') !== null) {
    return 'feedback';
  }
  if (
    s.game.mode === 'heroTurn' &&
    s.coach.status === 'ready' &&
    s.coach.key === `${hand.handSeq}:${hand.log.length}`
  ) {
    return 'hero';
  }
  if (s.game.mode === 'handEnd') return 'end';
  return null;
}

/** Waits (real time: the clock runs) for the next point. */
async function nextPoint(page: Page): Promise<Point> {
  const handle = await page.waitForFunction(readPoint, undefined, {
    polling: 'raf',
    timeout: 20_000,
  });
  return (await handle.jsonValue()) as Point;
}

const inputCount = (page: Page): Promise<number> =>
  page.evaluate(() => window.__pc?.snapshot().inputs.length ?? -1);

/**
 * A tap on Row A that the controller takes: tapped again while it has not (a tap within 250 ms of
 * the last action is ignored, §12.7). The clock must be running.
 */
async function tapAct(page: Page, name: 'fold' | 'middle' | 'right'): Promise<void> {
  const before = await inputCount(page);
  await expect(async () => {
    if ((await inputCount(page)) === before) await slot(page, name).click();
    expect(await inputCount(page)).toBeGreaterThan(before);
  }).toPass({ timeout: 10_000 });
}

/** The hero's street and whether a bet is to be called, at the hero's turn. */
async function heroSpot(page: Page): Promise<{ street: string; toCall: boolean }> {
  return page.evaluate(() => {
    const s = window.__pc?.state();
    return {
      street: s?.game.hand?.street ?? '',
      toCall: (s?.game.legal?.callAmount ?? 0) > 0,
    };
  });
}

/**
 * Plays hand 1 with check/call taps (Keep my move on any feedback card) until the hero's turn on
 * `street` (on the river: facing the small blind's minimum bet), its hint in.
 */
async function playTo(page: Page, street: 'flop' | 'river'): Promise<void> {
  for (let points = 0; points < 30; points++) {
    const point = await nextPoint(page);
    if (point === 'end') throw new Error(`hand 1 ended before the hero's ${street} decision`);
    if (point === 'feedback') {
      await page.getByRole('button', { name: 'Keep my move' }).click();
      await expect(page.locator('[data-feedback]')).toHaveCount(0);
      continue;
    }
    const spot = await heroSpot(page);
    if (spot.street === street && (street !== 'river' || spot.toCall)) return;
    await tapAct(page, 'middle');
  }
  throw new Error(`no hero decision on the ${street}`);
}

/** Stops the game clock (see the header): nothing on a timer moves until `runFor`. */
async function pauseClock(page: Page): Promise<void> {
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
}

const gameMode = (page: Page): Promise<string> => pcState(page).then((s) => s.game.mode);

/** The feedback card, once the controller holds the game for it (the clock paused). */
async function feedbackCard(page: Page): Promise<Locator> {
  await expect.poll(() => gameMode(page), { timeout: 15_000 }).toBe('feedback');
  const card = page.locator('[role="alertdialog"][data-feedback]');
  // Its code is a lazy chunk; a first showing may wait for React on the (paused) clock. The game
  // is held, so moving the clock moves nothing else.
  await expect
    .poll(
      async () => {
        if ((await card.count()) === 0) await page.clock.runFor(50);
        return card.count();
      },
      { timeout: 15_000 },
    )
    .toBe(1);
  await expect(card).toBeVisible();
  return card;
}

/**
 * After a hero act (the clock paused): waits for its grade. A feedback card is answered with Keep
 * my move; then the toolbar Undo can be used (no reveal yet, the bots still to act).
 */
async function gradedAndKept(page: Page): Promise<void> {
  await expect.poll(() => gameMode(page), { timeout: 15_000 }).not.toBe('grading');
  if ((await gameMode(page)) === 'feedback') {
    const card = await feedbackCard(page);
    // The reveal has not happened: the card's Undo works too.
    await expect(card.getByRole('button', { name: 'Undo: try again' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await card.getByRole('button', { name: 'Keep my move' }).click();
    await expect(card).toHaveCount(0);
  }
  await expect.poll(() => pcState(page).then((s) => s.game.canUndo)).toBe(true);
}

/** Moves the paused clock on until `done` holds in the page (bot think times, pauses, cards). */
async function runUntil(page: Page, done: () => boolean, what: string): Promise<void> {
  for (let steps = 0; steps < 200; steps++) {
    if (await page.evaluate(done)) return;
    await page.clock.runFor(100);
  }
  throw new Error(`never: ${what}`);
}

const toolbarUndo = (page: Page): Locator => page.locator('[data-undo]');

/** What the controller logged: engine inputs and bot requests, and the hand's last event. */
const trail = (page: Page) =>
  page.evaluate(() => {
    const pc = window.__pc;
    const hand = pc?.state().game.hand;
    return {
      inputs: pc?.snapshot().inputs.length ?? -1,
      botRequests: pc?.logs().brain.filter((e) => e.what === 'request').length ?? -1,
      last: hand?.log.at(-1) ?? null,
      board: hand?.board ?? [],
      hole: hand?.seats[0]?.hole ?? null,
      folded: hand?.seats[0]?.folded ?? null,
      undoCount: pc?.snapshot().meta.undoCount ?? -1,
    };
  });

/** Every Row A button is disabled (the action bar waits). */
async function actionBarDisabled(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-slot]')].every(
      (b) => b.getAttribute('aria-disabled') === 'true',
    ),
  );
}

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

  // Advanced and Exam are not offered by Setup or Settings until chunk 6.4; the settings take
  // them (the store's `coachLevel`), so the Undo rules of §10.2 are checked here already.
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
