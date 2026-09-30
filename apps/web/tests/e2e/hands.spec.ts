import { expect, test } from './fixtures.ts';
import {
  ACCEPTANCE_SIZES,
  collectErrors,
  installLeakWatch,
  installLongTaskObserver,
  leakViolations,
  longTasks,
  newTable,
  pageMetrics,
  playHands,
  prng,
  seedFor,
  sizeOf,
  startTable,
  type HandRecord,
} from './game.ts';

// PLAN §18 Stage 3, acceptance 1 and 7, and the §15.3 budgets: 50 full hands through the real
// buttons at each of the five acceptance viewports (both browsers), 25 with nine players and 25
// heads-up. No console error, no horizontal scroll, never a bot card face up or named before
// its reveal (checked after every DOM change), the Table under 600 DOM nodes, and (Chromium,
// the only engine with the Long Tasks API) no main-thread task over 50 ms during play.

/** The heads-up blinds rule (§3.3, acceptance 1): the button posts the SB and acts first preflop. */
function checkHeadsUp(record: HandRecord): void {
  const { hand } = record;
  const posts = hand.log.filter((e) => e.e === 'post');
  const sb = posts.find((e) => e.blind === 'sb');
  expect(sb?.seat, `hand ${hand.handSeq}: the button posts the small blind`).toBe(hand.button);
  expect(hand.sbSeat).toBe(hand.button);
  const first = hand.log.find((e) => e.e === 'act');
  // Only a button all-in from the post itself leaves it no preflop action.
  if (sb?.allIn !== true && first !== undefined && first.e === 'act') {
    expect(first.street).toBe('preflop');
    expect(first.seat, `hand ${hand.handSeq}: the button acts first preflop`).toBe(hand.button);
  }
}

test.describe('50 hands', () => {
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(
      !(ACCEPTANCE_SIZES as readonly string[]).includes(sizeOf(testInfo)),
      'acceptance 1: the five Stage 3 viewports',
    );
  });

  test('play 50 full hands with 9 players, then heads-up', async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    const errors = collectErrors(page);
    const seed = seedFor(testInfo);
    const random = prng(seed);
    await page.clock.install();
    await startTable(page, seed, { players: 9 });
    await installLeakWatch(page);
    const observing = await installLongTaskObserver(page);
    let maxNodes = 0;

    const onHandEnd = async (record: HandRecord): Promise<void> => {
      const metrics = await pageMetrics(page);
      maxNodes = Math.max(maxNodes, metrics.nodes);
      expect(metrics.scrollX, `hand ${record.handSeq}: no horizontal scroll`).toBeLessThanOrEqual(
        0,
      );
      expect(metrics.nodes, `hand ${record.handSeq}: DOM nodes (§15.3)`).toBeLessThanOrEqual(600);
    };

    const started = Date.now();
    const nine = await playHands(page, { hands: 25, random, fast: true, onHandEnd });
    const nineMs = Date.now() - started;
    expect(
      nine.some((r) => r.players === 9),
      'some hands dealt to 9 players',
    ).toBe(true);

    await newTable(page, { players: 2 });
    const two = await playHands(page, {
      hands: 25,
      fast: true,
      random,
      onHandEnd: async (record) => {
        expect(record.players).toBe(2);
        checkHeadsUp(record);
        await onHandEnd(record);
      },
    });
    testInfo.annotations.push({
      type: 'timing',
      description: `9 players: ${nineMs} ms for 25 hands; heads-up: ${Date.now() - started - nineMs} ms`,
    });
    expect(nine.length + two.length).toBe(50);

    expect(await leakViolations(page)).toEqual([]);
    if (observing) expect(await longTasks(page)).toEqual([]);
    expect(errors).toEqual([]);
    testInfo.annotations.push({ type: 'dom', description: `max ${maxNodes} nodes` });
  });
});
