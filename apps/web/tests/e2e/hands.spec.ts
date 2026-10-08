import { expect, test } from './fixtures.ts';
import {
  ACCEPTANCE_SIZES,
  CARD_NAMES,
  collectErrors,
  installLeakWatch,
  leakViolations,
  newTable,
  pageMetrics,
  playHands,
  prng,
  seedFor,
  sizeOf,
  startTable,
  type HandRecord,
} from './game.ts';

// PLAN §18 Stage 3, acceptance 1 and 7, and the §15.3 DOM budget: 50 full hands through the
// real buttons at each of the five acceptance viewports (both browsers), 25 with nine players and
// 25 heads-up. No console error, no horizontal scroll, never a bot card face up or named before
// its reveal (checked after every DOM change), the Table under 600 DOM nodes. The long-task
// budget has its own quiet run: perf.spec.ts.

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
    // The watch itself works: a card planted face up in a bot's pod and that bot's real card
    // named on the page are both caught. They go again before play starts.
    const planted = await page.evaluate((names) => {
      const hand = window.__pc?.state().game.hand;
      if (hand === null || hand === undefined) return 'no hand';
      const seat = hand.seats.findIndex(
        (s, i) => i > 0 && s.hole !== null && !hand.revealed.includes(i),
      );
      const hole = hand.seats[seat]?.hole;
      // A pod is a button (it opens the bot card, §9.3), or a labelled group where it cannot.
      const pod = document.querySelector(
        `[data-seat="${seat}"] > button, [data-seat="${seat}"] > [role="group"]`,
      );
      if (hole === null || hole === undefined || pod === null) return 'no hidden bot';
      const face = document.createElement('span');
      face.setAttribute('role', 'img');
      face.setAttribute('aria-label', 'Two of clubs');
      face.id = 'planted-face';
      const text = document.createElement('p');
      text.id = 'planted-text';
      text.textContent = names[hole[1]] ?? '';
      pod.append(face);
      document.body.append(text);
      return `seat ${seat}`;
    }, CARD_NAMES);
    expect(planted).toMatch(/^seat \d$/);
    const caught = await leakViolations(page);
    expect(caught.some((v) => v.includes('shows "Two of clubs" face up'))).toBe(true);
    expect(caught.some((v) => v.endsWith(' is named'))).toBe(true);
    await page.evaluate(() => {
      document.getElementById('planted-face')?.remove();
      document.getElementById('planted-text')?.remove();
      window.__leaks?.splice(0);
    });
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
    expect(errors).toEqual([]);
    testInfo.annotations.push({ type: 'dom', description: `max ${maxNodes} nodes` });
  });
});
