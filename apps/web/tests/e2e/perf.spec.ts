import { expect, test } from './fixtures.ts';
import {
  collectErrors,
  installLongTaskObserver,
  longTasks,
  playHands,
  prng,
  seedFor,
  startTable,
} from './game.ts';

// PLAN §15.3: no main-thread long task (> 50 ms) during play, from a `longtask`
// PerformanceObserver (Chromium: WebKit has no Long Tasks API). A long task is wall time, so a
// busy machine makes them by itself: this spec runs in its own project, `chromium-perf-390x844`
// (playwright.config.ts), which waits for every other project to finish, so it plays alone.

test('no main-thread task over 50 ms during 25 hands with 6 players', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  const seed = seedFor(testInfo);
  await page.clock.install();
  await startTable(page, seed, { players: 6 });
  expect(await installLongTaskObserver(page), 'the Long Tasks API').toBe(true);

  const hands = await playHands(page, { hands: 25, random: prng(seed), fast: true });
  expect(hands).toHaveLength(25);
  expect(await longTasks(page)).toEqual([]);
  expect(errors).toEqual([]);
});
