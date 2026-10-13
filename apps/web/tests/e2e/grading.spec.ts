import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import {
  collectErrors,
  keepMove,
  nextFlowPoint,
  pcState,
  seedFor,
  sizeOf,
  slot,
  startTable,
  tapNextHand,
} from './game.ts';
import {
  feedbackCard,
  gameMode,
  pauseClock,
  playTo,
  tapAct,
  scriptedTable,
  TAP_GUARD_MS,
  toolbarUndo,
  trail,
} from './scripted.ts';

// PLAN §18 Stage 6, acceptance 4 (chunk 6.5; §11.3 r5, §12.14): a slow grade, a grade that fails and
// a brain.worker that dies, in a real browser with the real brain.worker.
//
// - The faults are the dev/E2E-only `window.__pc.faults` (app/testFaults.ts): a layer in front of
//   the worker that holds a reply back, answers `error` instead, makes the bots think long, or
//   kills the worker. The client, the controller and the worker are the app's own.
// - Acceptance 4's first three parts use the scripted table of undo.spec.ts (`scripted.ts`): the
//   hero folds the nut flush to the small blind's minimum bet on the river, a Mistake or worse, so
//   at Beginner the feedback card would come if the grade were on time.
// - The clock is paused before the decision and moved with `runFor`: 1,500 ms (the pause), 2,500 ms
//   (the late grade), 5,000 ms (a job's timeout) are exact, whatever the runner's speed. A reply of
//   the worker arrives in real time, so a spec waits until the layer holds it before it moves the
//   clock (otherwise the hold would start at the moved time).
// - The flows are the controller's and the worker's, the same at every size: one phone size per
//   browser (the layouts' own Undo slots and cards are undo.spec.ts and levels.spec.ts).

// eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
test.beforeEach(({}, testInfo) => {
  test.skip(sizeOf(testInfo) !== '390x844', 'one phone size per browser');
});

type Setup = {
  delayGrade?: number | null;
  delayBot?: number | null;
  failGrades?: number;
  think?: number | null;
  speed?: 'normal' | 'fast' | 'instant';
};

/** Switches faults on or off (and the game speed) in the page. */
async function setup(page: Page, s: Setup): Promise<void> {
  await page.evaluate((s) => {
    const pc = window.__pc;
    const faults = pc?.faults;
    if (pc === undefined || faults === null || faults === undefined) {
      throw new Error('no window.__pc.faults: is this the E2E build?');
    }
    if (s.delayGrade !== undefined) faults.delay('grade', s.delayGrade);
    if (s.delayBot !== undefined) faults.delay('botDecision', s.delayBot);
    if (s.failGrades !== undefined) faults.fail('grade', s.failGrades);
    if (s.think !== undefined) faults.think(s.think);
    if (s.speed !== undefined) pc.dispatch({ type: 'settings', patch: { speed: s.speed } });
  }, s);
}

const faultLog = (page: Page) => page.evaluate(() => window.__pc?.faults?.log() ?? []);

/** How many entries of `what` (and `kind`) the faults layer has logged. */
async function faultCount(page: Page, what: string, kind?: string): Promise<number> {
  const log = await faultLog(page);
  return log.filter((e) => e.what === what && (kind === undefined || e.kind === kind)).length;
}

/** Waits until the layer holds a reply of `kind` back (its worker answered, in real time). */
async function waitHeld(page: Page, kind: string, count = 1): Promise<void> {
  await expect
    .poll(() => faultCount(page, 'delay', kind), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(count);
}

/** The controller's brain log lines about grading (`grade request`, `grade failed`, `grade`, …). */
async function gradeLog(page: Page): Promise<{ what: string; detail: Record<string, unknown> }[]> {
  return page.evaluate(() =>
    (window.__pc?.logs().brain ?? [])
      .filter((e) => e.what.startsWith('grade'))
      .map((e) => ({ what: e.what, detail: (e.detail ?? {}) as Record<string, unknown> })),
  );
}

const decisions = (page: Page) => pcState(page).then((s) => s.game.decisions);

/** The controller's event names so far ('grade late', 'feedback', 'undo', …). */
const eventNames = (page: Page): Promise<string[]> =>
  page.evaluate(() => window.__pc?.logs().events.map((e) => e.what) ?? []);

test.describe('Stage 6 acceptance 4: a grade later than 1,500 ms', () => {
  test('does not block the game; the toolbar Undo waits for it, then works', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await scriptedTable(page, 'beginner');
    await playTo(page, 'river');
    const before = await trail(page);
    const decided = (await decisions(page)).length;

    // From here: Normal speed, bots that think for a long time (the hero's Undo window stays
    // open), and a grade that comes 2,500 ms late.
    await setup(page, { speed: 'normal', think: 20_000, delayGrade: 2_500 });
    await pauseClock(page);
    await slot(page, 'fold').click();
    await expect.poll(() => gameMode(page)).toBe('grading');
    await waitHeld(page, 'grade');
    await expect(toolbarUndo(page)).toHaveAttribute('data-undo', 'disabled');
    expect(await trail(page)).toMatchObject({ botRequests: before.botRequests });

    // The hand waits for the grade for 1,500 ms and not a millisecond more...
    await page.clock.runFor(1_499);
    expect(await gameMode(page)).toBe('grading');
    await page.clock.runFor(1);
    await expect.poll(() => gameMode(page)).toBe('botTurn');
    expect(await eventNames(page)).toContain('grade late');
    // ...then the game goes on without it: the next bot is asked, no card, no new card dealt.
    expect((await trail(page)).botRequests).toBe(before.botRequests + 1);
    await expect(page.locator('[data-feedback]')).toHaveCount(0);

    // The toolbar Undo stays disabled until the grade has arrived.
    await page.clock.runFor(900); // 2,400 ms
    expect((await decisions(page)).length).toBe(decided);
    await expect(toolbarUndo(page)).toHaveAttribute('data-undo', 'disabled');
    expect((await pcState(page)).game.canUndo).toBe(false);
    await page.clock.runFor(100); // 2,500 ms: the grade arrives
    await expect.poll(async () => (await decisions(page)).length).toBe(decided + 1);
    const late = (await decisions(page)).at(-1);
    expect(late).toMatchObject({ street: 'river', undone: false });
    expect(['mistake', 'blunder']).toContain(late?.grade); // folding the nuts: at least a Mistake
    // A late grade never pauses the game, even for a card-worthy mistake at Beginner...
    expect(await gameMode(page)).toBe('botTurn');
    await expect(page.locator('[data-feedback]')).toHaveCount(0);
    // ...and shows its chip (§11.3 r5), and the toolbar Undo works now.
    await expect(page.locator('[data-grade-chip]')).toHaveCount(1);
    await expect(toolbarUndo(page)).toHaveAttribute('data-undo', 'enabled');
    expect((await pcState(page)).game.canUndo).toBe(true);

    await toolbarUndo(page).click();
    await expect.poll(() => gameMode(page)).toBe('heroTurn');
    const back = await trail(page);
    expect(back).toMatchObject({ folded: false, undoCount: 1 });
    expect(back.board).toEqual(before.board);
    expect((await decisions(page)).at(-1)).toMatchObject({ street: 'river', undone: true });

    // The same fold with its grade on time: the card comes, as acceptance 2 says (a second Undo
    // of this decision is refused).
    await setup(page, { delayGrade: null, think: null });
    await page.clock.runFor(TAP_GUARD_MS + 50);
    await slot(page, 'fold').click();
    const card = await feedbackCard(page);
    await expect(card.getByRole('button', { name: 'Undo: try again' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await keepMove(page);

    // The hand goes on to its end.
    await page.clock.resume();
    await expect.poll(() => gameMode(page), { timeout: 30_000 }).toBe('handEnd');
    expect((await pcState(page)).game.diag).toEqual({
      engineErrors: 0,
      botFallbacks: 0,
      voidedHands: 0,
    });
    expect(errors).toEqual([]);
  });
});

test.describe('Stage 6 acceptance 4: a grade job that fails', () => {
  test('errors twice: grade null, no card, the hand is not held; Undo is there', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await scriptedTable(page, 'beginner');
    await playTo(page, 'river');
    const decided = (await decisions(page)).length;

    await setup(page, { failGrades: 2, think: 20_000, speed: 'normal' });
    await pauseClock(page);
    await slot(page, 'fold').click();

    // Both tries answer `error` at once: the decision is recorded, ungraded and never counted.
    await expect.poll(async () => (await decisions(page)).length).toBe(decided + 1);
    expect((await decisions(page)).at(-1)).toMatchObject({
      street: 'river',
      grade: null,
      undone: false,
    });
    expect(await faultCount(page, 'fail', 'grade')).toBe(2);
    const log = await gradeLog(page);
    expect(log.map((e) => e.what)).toEqual([
      ...log.slice(0, -4).map((e) => e.what), // the earlier decisions' lines
      'grade request',
      'grade failed',
      'grade request',
      'grade failed',
    ]);
    const [first, retry] = log.filter((e) => e.what === 'grade request').slice(-2);
    expect(first?.detail).toMatchObject({ attempt: 1 });
    expect(retry?.detail).toMatchObject({ attempt: 2, decisionId: first?.detail['decisionId'] });
    expect(log.filter((e) => e.what === 'grade failed').at(-1)?.detail).toMatchObject({
      reason: 'injected fault',
    });

    // No pause, no card, no chip: the hand was never held for it.
    expect(await gameMode(page)).not.toBe('grading');
    expect(await gameMode(page)).not.toBe('feedback');
    await expect(page.locator('[data-feedback]')).toHaveCount(0);
    await expect(page.locator('[data-grade-chip]')).toHaveCount(0);
    // Undo is available (§11.3 r5); it takes the fold back and the record stays, ungraded.
    await expect(toolbarUndo(page)).toHaveAttribute('data-undo', 'enabled');
    await toolbarUndo(page).click();
    await expect.poll(() => gameMode(page)).toBe('heroTurn');
    expect((await decisions(page)).at(-1)).toMatchObject({
      street: 'river',
      grade: null,
      undone: true,
    });
    expect((await trail(page)).undoCount).toBe(1);

    // The faults are used up: the same fold is graded now, and its card comes.
    await setup(page, { think: null });
    await page.clock.runFor(TAP_GUARD_MS + 50);
    await slot(page, 'fold').click();
    await feedbackCard(page);
    await keepMove(page);
    await page.clock.resume();
    await expect.poll(() => gameMode(page), { timeout: 30_000 }).toBe('handEnd');
    expect(errors).toEqual([]);
  });

  test('errors twice and the move is kept: the summary says "No grade"', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await scriptedTable(page, 'beginner');
    await playTo(page, 'river');
    await setup(page, { failGrades: 2 });
    await tapAct(page, 'fold');
    await expect.poll(() => gameMode(page), { timeout: 30_000 }).toBe('handEnd');
    const last = (await decisions(page)).at(-1);
    expect(last).toMatchObject({ street: 'river', grade: null });
    // Beginner shows a summary after every hand (§10.2): the river row has no grade.
    const row = page.locator('[data-summary-row="none"]');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('No grade');
    expect(errors).toEqual([]);
  });

  test('no reply for 5 s: tried once more, then grade null and Undo', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await scriptedTable(page, 'beginner');
    await playTo(page, 'river');
    const decided = (await decisions(page)).length;

    // The worker answers, but 10 minutes late: a job's own timeout (5 s) comes first.
    await setup(page, { delayGrade: 600_000, think: 600_000, speed: 'normal' });
    await pauseClock(page);
    await slot(page, 'fold').click();
    await waitHeld(page, 'grade');
    await page.clock.runFor(1_500);
    await expect.poll(() => gameMode(page)).toBe('botTurn'); // not held for it
    expect((await gradeLog(page)).filter((e) => e.what === 'grade request')).toHaveLength(
      (decided === 0 ? 0 : decided) + 1,
    );

    await page.clock.runFor(3_500); // 5,000 ms: the first try timed out
    await expect
      .poll(async () => (await gradeLog(page)).filter((e) => e.what === 'grade failed').length)
      .toBe(1);
    expect((await gradeLog(page)).findLast((e) => e.what === 'grade failed')?.detail).toMatchObject(
      { reason: 'grade timeout', attempt: 1 },
    );
    await waitHeld(page, 'grade', 2); // the retry went out (and its reply is late too)
    expect((await decisions(page)).length).toBe(decided);
    await expect(toolbarUndo(page)).toHaveAttribute('data-undo', 'disabled');

    await page.clock.runFor(5_000); // 10,000 ms: the retry timed out too
    await expect.poll(async () => (await decisions(page)).length).toBe(decided + 1);
    expect((await decisions(page)).at(-1)).toMatchObject({ street: 'river', grade: null });
    await expect(toolbarUndo(page)).toHaveAttribute('data-undo', 'enabled');
    await expect(page.locator('[data-feedback]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Killing brain.worker (§12.14). Real bots decide in the real worker here (no `?script=`), so a
// dead worker is a dead bot brain too. Real time at Instant speed (a bot takes 80 ms): the layer
// holds a bot's reply back, so that its job is still pending when the worker dies.

type Here = 'held' | 'card' | 'hero' | 'end';

/**
 * Waits until something needs the spec: `held` bot replies are held back by the layer, a feedback
 * card is up (its Keep my move is on the page), the hero is to act, or the hand has ended.
 */
async function whereAmI(page: Page, held: number): Promise<Here> {
  const handle = await page.waitForFunction(
    (held) => {
      const pc = window.__pc;
      const s = pc?.state();
      if (s === undefined) return null;
      const stuck = pc?.faults?.log().filter((e) => e.what === 'delay' && e.kind === 'botDecision');
      if ((stuck?.length ?? 0) >= held) return 'held';
      if (s.game.mode === 'feedback') {
        return document.querySelector('[data-feedback-keep]') !== null ? 'card' : null;
      }
      if (s.game.mode === 'heroTurn') return 'hero';
      if (s.game.mode === 'handEnd') return 'end';
      return null;
    },
    held,
    { polling: 'raf', timeout: 20_000 },
  );
  return (await handle.jsonValue()) as Here;
}

/**
 * Plays on (check or call, Keep my move, the next hand) until the layer holds back `held` bot
 * replies in all: a bot's decision is then on its way.
 */
async function playUntilHeld(page: Page, held: number): Promise<void> {
  for (let i = 0; i < 80; i++) {
    const here = await whereAmI(page, held);
    if (here === 'held') return;
    if (here === 'card') await keepMove(page);
    else if (here === 'hero') await tapAct(page, 'middle');
    else await tapNextHand(page);
  }
  throw new Error('no bot decision was held back');
}

/** Real-time play to the hero's next turn (a hand that ends first is followed by the next). */
async function toHeroTurn(page: Page): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const point = await nextFlowPoint(page);
    if (point === 'hero') return;
    if (point === 'bust') throw new Error('out of chips');
    await tapNextHand(page);
  }
  throw new Error('no hero turn in 20 hands');
}

/** Plays the rest of the hand with check/call taps; returns when it has ended. */
async function finishHand(page: Page): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const point = await nextFlowPoint(page);
    if (point === 'end') return;
    if (point === 'bust') throw new Error('out of chips');
    await tapAct(page, 'middle');
  }
  throw new Error('the hand does not end');
}

/**
 * Kills the worker. With `botsOnTime` the held-back bot replies are released in the same breath,
 * so that the worker that replaces it answers the next bot at once.
 */
const killWorker = (page: Page, botsOnTime = false): Promise<boolean> =>
  page.evaluate((botsOnTime) => {
    const faults = window.__pc?.faults;
    const killed = faults?.kill() ?? false;
    if (botsOnTime) faults?.delay('botDecision', null);
    return killed;
  }, botsOnTime);

const workerLog = (page: Page) => page.evaluate(() => window.__pc?.logs().brainWorker ?? []);

const botFallbacks = (page: Page): Promise<number> =>
  pcState(page).then((s) => s.game.diag.botFallbacks);

test.describe('Stage 6 acceptance 4: killing brain.worker mid-hand (§12.14)', () => {
  test('killed once: the pending bot takes the safest action, a new worker serves the rest', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await startTable(page, seedFor(testInfo), { players: 3 });
    await toHeroTurn(page);
    await setup(page, { delayBot: 600_000 });
    await playUntilHeld(page, 1); // a bot's decision is on its way...
    const handSeq = (await pcState(page)).game.hand?.handSeq;
    const fallbacks = await botFallbacks(page);

    expect(await killWorker(page, true)).toBe(true); // ...when the worker dies
    const log = (await workerLog(page)).map((e) => e.what);
    expect(log).toEqual(expect.arrayContaining(['crash', 'restart']));
    expect(log).not.toContain('failed'); // recreated once (§12.14)

    // The bot whose job died takes the safest legal action; a new worker serves the rest.
    await expect.poll(() => botFallbacks(page)).toBeGreaterThan(fallbacks);
    await finishHand(page);
    const end = await pcState(page);
    expect(end.game.hand).toMatchObject({ handSeq, phase: 'complete' });
    expect(end.game.diag).toMatchObject({ engineErrors: 0, voidedHands: 0 });
    expect((await workerLog(page)).map((e) => e.what)).not.toContain('failed');

    // The next hand: the new worker gives the coach's hint and the grade of the hero's move.
    await tapNextHand(page);
    await toHeroTurn(page);
    await expect.poll(() => pcState(page).then((s) => s.coach.status)).toBe('ready');
    const graded = (await decisions(page)).length;
    await tapAct(page, 'middle');
    await expect
      .poll(async () => {
        const now = await decisions(page);
        return now.length > graded ? (now.at(-1)?.grade ?? null) : null;
      })
      .not.toBeNull();
    const after = await workerLog(page);
    const restarted = after.findIndex((e) => e.what === 'restart');
    for (const kind of ['hint', 'grade']) {
      expect(after.slice(restarted).some((e) => e.what === 'in' && e.kind === kind)).toBe(true);
    }
    expect(errors).toEqual([]);
  });

  test('killed twice: no worker is left, the bots check or fold and the hand finishes; Try again brings the coach back', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    await startTable(page, seedFor(testInfo), { players: 3 });
    await toHeroTurn(page);
    await setup(page, { delayBot: 600_000 });
    await playUntilHeld(page, 1);
    expect(await killWorker(page)).toBe(true);
    // The new worker gets a bot's decision too, and is killed with it: the client has failed.
    await playUntilHeld(page, 2);
    const hand = (await pcState(page)).game.hand;
    const [handSeq, killedAt] = [hand?.handSeq, hand?.log.length ?? 0];
    const decided = (await decisions(page)).length;
    expect(await killWorker(page)).toBe(true);
    await setup(page, { delayBot: null });
    const log = (await workerLog(page)).map((e) => e.what);
    expect(log.filter((what) => what === 'crash')).toHaveLength(2);
    expect(log).toContain('failed');
    expect(await killWorker(page)).toBe(false); // nothing left to kill

    // The hand finishes: from the kill on every bot takes the safest legal action (check, else
    // fold), the hero's grades are none, and the coach strip says it has no worker (§12.11).
    const failedStrip = page.getByRole('button', {
      name: 'Coach is not available. Tap to try again.',
    });
    for (
      let point = await nextFlowPoint(page);
      point !== 'end';
      point = await nextFlowPoint(page)
    ) {
      if (point === 'bust') throw new Error('out of chips');
      await expect(failedStrip).toBeVisible();
      await tapAct(page, 'middle');
    }
    const end = await pcState(page);
    expect(end.game.hand).toMatchObject({ handSeq, phase: 'complete' });
    const botActs = (end.game.hand?.log.slice(killedAt) ?? []).flatMap((e) =>
      e.e === 'act' && e.seat !== 0 ? [e.action.type] : [],
    );
    expect(botActs.length).toBeGreaterThan(0);
    for (const type of botActs) expect(['check', 'fold']).toContain(type);
    expect(end.game.decisions.slice(decided).every((d) => d.grade === null)).toBe(true);
    expect(end.game.diag.botFallbacks).toBeGreaterThanOrEqual(2);
    expect(end.game.diag).toMatchObject({ engineErrors: 0, voidedHands: 0 });

    // The next hand: [Try again] recreates the worker (§12.14); the hint, the bots and the grades
    // come back.
    await tapNextHand(page);
    await toHeroTurn(page);
    await expect(failedStrip).toBeVisible();
    expect((await pcState(page)).coach.status).toBe('failed');
    await failedStrip.click();
    await expect.poll(() => pcState(page).then((s) => s.coach.status)).toBe('ready');
    await expect(failedStrip).toHaveCount(0);
    expect((await workerLog(page)).map((e) => e.what)).toContain('restart');
    await finishHand(page);
    const last = await pcState(page);
    expect(last.game.hand?.phase).toBe('complete');
    expect(last.game.decisions.some((d) => d.grade !== null)).toBe(true);
    expect(last.game.diag).toMatchObject({ engineErrors: 0, voidedHands: 0 });
    expect(errors).toEqual([]);
  });
});
