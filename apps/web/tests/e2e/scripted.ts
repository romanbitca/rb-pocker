import type { Locator, Page } from '@playwright/test';
import { expect } from './fixtures.ts';
import { newTable, openApp, pcState, slot } from './game.ts';

/**
 * The scripted table of the Stage 6 E2E specs (`undo.spec.ts`, `grading.spec.ts`, `levels.spec.ts`;
 * PLAN §18 Stage 6, §11.3 notes): `?seed=46&script=river-min-bet`, 3 players. The bots are scripted
 * (`app/botScripts.ts`: they check and call, and on the river the first one that can bets the
 * minimum); the coach is not: hints and grades come from the real brain.worker (chunk 6.1). In hand
 * 1 the hero is the big blind with A♣3♣ and the board runs 8♣5♥2♣, J♦, T♣: on the flop the hero has
 * a nut flush draw with a gutshot, on the river the nut flush, and the small blind bets the minimum
 * into it (tests/app/controller.grade.test.ts checks the same table without a browser).
 *
 * The game clock: `page.clock.install()` keeps it running in real time; it stops only at
 * `pauseAt` (the earlier flake lesson). The specs pause it just before the decision they watch, so
 * the 1,500 ms grade window cannot run out on a slow runner and nothing on a timer (bot think
 * times, the pause before a new card) moves until `runFor` says so. Brain replies are worker
 * messages, not timers: they still arrive. While paused, `performance.now()` stands still too, so
 * the action bar's 250 ms double-tap guard needs `runFor` before a second tap.
 */

export const SEED = '46';
export const SCRIPT = '&script=river-min-bet';
export const TAP_GUARD_MS = 250;
/**
 * How far a spec moves the paused clock per try while it waits for a lazy chunk to show (React's
 * Suspense reveal is throttled by a timer: 300 ms).
 */
export const REVEAL_STEP_MS = 300;

export type Level = 'beginner' | 'intermediate' | 'advanced' | 'exam';

export interface ScriptedOptions {
  /** Default 'instant' (§12.8): a hand takes a moment. */
  speed?: 'normal' | 'fast' | 'instant';
  /** Default 3 (the table the seed was found for). */
  players?: number;
}

/** Opens the scripted table at `level` and waits for the first hand (no auto-next). */
export async function scriptedTable(
  page: Page,
  level: Level,
  options: ScriptedOptions = {},
): Promise<void> {
  await page.clock.install();
  await openApp(page, SEED, SCRIPT);
  await page.evaluate((coachLevel) => {
    window.__pc?.dispatch({ type: 'settings', patch: { coachLevel } });
  }, level);
  await newTable(page, { players: options.players ?? 3, speed: options.speed ?? 'instant' });
}

export type Point = 'hero' | 'feedback' | 'quiz' | 'end';

/** In the page: the hero's turn with its hint in, the feedback card on show, or the hand end. */
export function readPoint(): Point | null {
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
    // Advanced: the quiz holds Row A until it is answered or skipped (§10.3).
    return document.querySelector('[data-quiz-skip]') !== null ? 'quiz' : 'hero';
  }
  if (s.game.mode === 'handEnd') return 'end';
  return null;
}

/** Waits (real time: the clock runs) for the next point. */
export async function nextPoint(page: Page): Promise<Point> {
  const handle = await page.waitForFunction(readPoint, undefined, {
    polling: 'raf',
    timeout: 20_000,
  });
  return (await handle.jsonValue()) as Point;
}

export const inputCount = (page: Page): Promise<number> =>
  page.evaluate(() => window.__pc?.snapshot().inputs.length ?? -1);

/**
 * A tap on Row A that the controller takes: tapped again while it has not (a tap within 250 ms of
 * the last action is ignored, §12.7). The clock must be running.
 */
export async function tapAct(page: Page, name: 'fold' | 'middle' | 'right'): Promise<void> {
  const before = await inputCount(page);
  await expect(async () => {
    if ((await inputCount(page)) === before) await slot(page, name).click();
    expect(await inputCount(page)).toBeGreaterThan(before);
  }).toPass({ timeout: 10_000 });
}

/** The hero's street and whether a bet is to be called, at the hero's turn. */
export async function heroSpot(page: Page): Promise<{ street: string; toCall: boolean }> {
  return page.evaluate(() => {
    const s = window.__pc?.state();
    return {
      street: s?.game.hand?.street ?? '',
      toCall: (s?.game.legal?.callAmount ?? 0) > 0,
    };
  });
}

/**
 * Plays hand 1 with check/call taps (Keep my move on any feedback card, Skip on a quiz) until the
 * hero's turn on `street` (on the river: facing the small blind's minimum bet), its hint in.
 * `street` 'preflop' is the hero's first decision.
 */
export async function playTo(
  page: Page,
  street: 'preflop' | 'flop' | 'turn' | 'river',
): Promise<void> {
  for (let points = 0; points < 30; points++) {
    const point = await nextPoint(page);
    if (point === 'end') throw new Error(`hand 1 ended before the hero's ${street} decision`);
    if (point === 'feedback') {
      await page.getByRole('button', { name: 'Keep my move' }).click();
      await expect(page.locator('[data-feedback]')).toHaveCount(0);
      continue;
    }
    if (point === 'quiz') {
      await page.locator('[data-quiz-skip]').click();
      continue;
    }
    const spot = await heroSpot(page);
    if (spot.street === street && (street !== 'river' || spot.toCall)) return;
    await tapAct(page, 'middle');
  }
  throw new Error(`no hero decision on the ${street}`);
}

/** Stops the game clock (see the header): nothing on a timer moves until `runFor`. */
export async function pauseClock(page: Page): Promise<void> {
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
}

export const gameMode = (page: Page): Promise<string> => pcState(page).then((s) => s.game.mode);

/** The feedback card, once the controller holds the game for it (the clock paused). */
export async function feedbackCard(page: Page): Promise<Locator> {
  await expect.poll(() => gameMode(page), { timeout: 15_000 }).toBe('feedback');
  const card = page.locator('[role="alertdialog"][data-feedback]');
  // Its code is a lazy chunk; a first showing waits for React's Suspense reveal, which is a timer
  // on the (paused) clock. The game is held, so moving the clock moves nothing else; small polls
  // and a step that clears the reveal's throttle keep it quick.
  await expect
    .poll(
      async () => {
        if ((await card.count()) === 0) await page.clock.runFor(REVEAL_STEP_MS);
        return card.count();
      },
      { timeout: 15_000, intervals: [20, 50, 100] },
    )
    .toBe(1);
  await expect(card).toBeVisible();
  return card;
}

/**
 * After a hero act (the clock paused): waits for its grade. A feedback card is answered with Keep
 * my move; then the toolbar Undo can be used (no reveal yet, the bots still to act).
 */
export async function gradedAndKept(page: Page): Promise<void> {
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
export async function runUntil(page: Page, done: () => boolean, what: string): Promise<void> {
  for (let steps = 0; steps < 200; steps++) {
    if (await page.evaluate(done)) return;
    await page.clock.runFor(100);
  }
  throw new Error(`never: ${what}`);
}

export const toolbarUndo = (page: Page): Locator => page.locator('[data-undo]');

/** What the controller logged: engine inputs and bot requests, and the hand's last event. */
export const trail = (page: Page) =>
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
export async function actionBarDisabled(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-slot]')].every(
      (b) => b.getAttribute('aria-disabled') === 'true',
    ),
  );
}
