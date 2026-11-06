import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { collectErrors, keepMove, pcState, sizeOf } from './game.ts';
import { nextPoint, playTo, scriptedTable, tapAct } from './scripted.ts';

// PLAN §6.1, §12.9 (1.3.97; the owner, 6 Nov 2026, playing on the phone: "sometimes cards look
// like with opacity, like they are not active"): on the Table no card is faded for being out of
// the best five, and all five carry one gold edge. The scripted table of `scripted.ts` (hand 1:
// the hero is the big blind with A♣3♣, the board runs 8♣5♥2♣, J♦, T♣):
// - at the hero's turn decision the best five is Ace-high, A♣ J♦ 8♣ 5♥ 3♣: the 2♣ is out of it;
// - the hero calls the small blind's minimum bet on the river and wins the showdown with the nut
//   flush, A♣ 3♣ 8♣ 2♣ T♣: the 5♥ and J♦ are out of it, and so are the losers' cards.
// Each time every board card and hole card is fully opaque (its own opacity times its parents'),
// and exactly five cards have the gold edge, the same 3 px edge on each. One phone size per
// browser: the rule is the cards' CSS, the same at every size.

// eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
test.beforeEach(({}, testInfo) => {
  test.skip(sizeOf(testInfo) !== '390x844', 'one phone size per browser');
});

interface CardShot {
  where: 'board' | 'hero' | 'seat';
  name: string;
  /** The card's opacity times every ancestor's: what the eye sees. */
  opacity: number;
  /** An outline in the accent colour (`--accent`, the gold). */
  gold: boolean;
  width: string;
}

/** Every card on the Table: the board, the hero's two, the bots' (backs or faces). */
const shootCards = (page: Page): Promise<CardShot[]> =>
  page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--accent)';
    document.body.append(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();
    const seen = (el: Element): number => {
      let opacity = 1;
      for (let e: Element | null = el; e !== null; e = e.parentElement) {
        opacity *= Number.parseFloat(getComputedStyle(e).opacity);
      }
      return opacity;
    };
    const groups = [
      ['board', '[role="group"][aria-label="Board"] [role="img"]'],
      ['hero', '[data-hero-cards] [role="img"]'],
      ['seat', '[data-seat] [role="img"]'],
    ] as const;
    return groups.flatMap(([where, selector]) =>
      [...document.querySelectorAll(selector)].map((el) => {
        const style = getComputedStyle(el);
        return {
          where,
          name: el.getAttribute('aria-label') ?? '',
          opacity: seen(el),
          gold: style.outlineStyle === 'solid' && style.outlineColor === accent,
          width: style.outlineWidth,
        };
      }),
    );
  });

/** The names of the gold-edged cards, sorted. */
const goldNames = (cards: readonly CardShot[]): string[] =>
  cards
    .filter((c) => c.gold)
    .map((c) => c.name)
    .sort();

test('no card is faded on the Table; the best five have the gold edge, at the turn and at the hand end', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await scriptedTable(page, 'beginner');

  // The hero's decision on the turn: Ace-high, the 2♣ out of the five.
  await playTo(page, 'turn');
  expect((await pcState(page)).game.hand?.board).toHaveLength(4);
  await expect
    .poll(async () => goldNames(await shootCards(page)))
    .toEqual([
      'Ace of clubs, part of your hand',
      'Eight of clubs, part of your hand',
      'Five of hearts, part of your hand',
      'Jack of diamonds, part of your hand',
      'Three of clubs, part of your hand',
    ]);
  const turn = await shootCards(page);
  expect(turn.filter((c) => c.where === 'board')).toHaveLength(4);
  expect(turn.filter((c) => c.where === 'hero')).toHaveLength(2);
  expect(turn.find((c) => c.name === 'Two of clubs')).toMatchObject({ gold: false, opacity: 1 });
  for (const c of turn) expect(c.opacity, `${c.where}: ${c.name}`).toBe(1);
  for (const c of turn.filter((x) => x.gold)) expect(c.width, c.name).toBe('3px');

  // The river: the small blind bets the minimum, the hero calls, the showdown follows.
  await playTo(page, 'river');
  await tapAct(page, 'middle');
  for (let points = 0; points < 20; points++) {
    const point = await nextPoint(page);
    if (point === 'end') break;
    if (point === 'feedback') await keepMove(page);
    else if (point === 'quiz') await page.locator('[data-quiz-skip]').click();
    else await tapAct(page, 'middle');
  }
  const result = (await pcState(page)).game.hand?.result;
  expect(result?.endedBy).toBe('showdown');
  expect(result?.potWinners).toEqual([[0]]);

  // The hand end: the winner's five (the hero's nut flush) with the gold edge, nothing faded.
  await expect
    .poll(async () => goldNames(await shootCards(page)))
    .toEqual([
      'Ace of clubs, part of the winning hand',
      'Eight of clubs, part of the winning hand',
      'Ten of clubs, part of the winning hand',
      'Three of clubs, part of the winning hand',
      'Two of clubs, part of the winning hand',
    ]);
  const end = await shootCards(page);
  expect(end.filter((c) => c.where === 'board')).toHaveLength(5);
  expect(end.filter((c) => c.where === 'hero')).toHaveLength(2);
  // Both bots called to the end: their cards are face up, plain, and fully opaque too.
  const bots = end.filter((c) => c.where === 'seat');
  expect(bots).toHaveLength(4);
  expect(bots.every((c) => c.name !== 'Hidden card' && !c.gold)).toBe(true);
  for (const name of ['Five of hearts', 'Jack of diamonds']) {
    expect(end.find((c) => c.name === name)).toMatchObject({ gold: false, opacity: 1 });
  }
  for (const c of end) expect(c.opacity, `${c.where}: ${c.name}`).toBe(1);
  for (const c of end.filter((x) => x.gold)) expect(c.width, c.name).toBe('3px');
  expect(errors).toEqual([]);
});
