import { createHash } from 'node:crypto';
import { expect, heading, test } from './fixtures.ts';
import {
  CARD_NAMES,
  collectErrors,
  heroAct,
  newTable,
  nextFlowPoint,
  openApp,
  pcState,
  prng,
  reloadAfterBust,
  seedFor,
  sizeOf,
  tapNextHand,
} from './game.ts';
import type { Page } from '@playwright/test';

// PLAN §16.3 (chunk 9.4), Stage 9 acceptance 4 ("… and the UI shows ✓"): on a real page (the
// browser's own crypto.subtle; http://localhost is a secure context) the game commits to each
// hand's shuffle before the deal, and Review's "Check the shuffle" says ✓ with the deck the hand
// was dealt from. Hand 2 is checked: its code was made while hand 1 was played.

/** A phone and a desktop, in both browsers. */
const SIZES = ['390x844', '1280x800'];

/** Plays the current hand to its end (the hero's moves from `random`). */
async function playToEnd(page: Page, random: () => number): Promise<void> {
  for (let point = await nextFlowPoint(page, true); point !== 'end';) {
    if (point === 'bust') throw new Error('out of chips: pick another seed');
    await heroAct(page, random);
    point = await nextFlowPoint(page, true);
  }
}

/** The controller's 'hand start' line of `handSeq` (`window.__pc.logs()`). */
function handStart(page: Page, handSeq: number): Promise<unknown> {
  return page.evaluate(
    (seq) =>
      window.__pc
        ?.logs()
        .events.find(
          (e) => e.what === 'hand start' && (e.detail as { handSeq: number }).handSeq === seq,
        )?.detail,
    handSeq,
  );
}

test('Check the shuffle: the hand just played shows ✓ and the deck it was dealt from', async ({
  page,
}, testInfo) => {
  test.skip(!SIZES.includes(sizeOf(testInfo)), 'a phone and a desktop in each browser');
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await page.clock.install();
  const seed = seedFor(testInfo);
  await openApp(page, seed);
  await newTable(page, { players: 4 });
  const random = prng(seed);

  await playToEnd(page, random);
  await tapNextHand(page);
  // Hand 2 is dealt, or the hero is out of chips and reloads (§3.1), which deals it.
  const next = async (): Promise<string> => {
    const s = await pcState(page);
    if (s.ui.overlays.includes('outOfChips')) return 'bust';
    return (s.game.hand?.phase ?? 'complete') === 'complete' ? 'waiting' : 'dealt';
  };
  await expect.poll(next).not.toBe('waiting');
  if ((await next()) === 'bust') await reloadAfterBust(page);
  await expect.poll(next).toBe('dealt');
  await playToEnd(page, random);

  // The hand that just ended: its code was ready when it was dealt, and it is SHA-256 of
  // seed:tableId:handSeq (node:crypto here, the page's crypto.subtle there).
  const state = await pcState(page);
  const hand = state.game.hand;
  const table = state.game.table;
  if (hand === null || table === null) throw new Error('no hand');
  expect(await handStart(page, hand.handSeq)).toMatchObject({ shuffleCode: 'ready' });
  const code = createHash('sha256')
    .update(`${hand.seed}:${table.tableId}:${hand.handSeq}`)
    .digest('hex');
  // Both hands Review keeps have their codes.
  const commits = await page.evaluate(() => {
    const s = window.__pc?.state() as unknown as {
      review: { hands: { record: { commit: string | null } }[] };
    };
    return s.review.hands.map((h) => h.record.commit);
  });
  expect(commits).toHaveLength(2);
  expect(commits).toContain(code);
  for (const commit of commits) expect(commit).toMatch(/^[0-9a-f]{64}$/);

  // Review: the shuffle code and the seed, under the replay.
  await page.getByRole('button', { name: 'Review this hand' }).click();
  await expect(heading(page)).toHaveText(/^Hand \d+$/);
  const row = page.getByRole('region', { name: 'Fair shuffle' });
  await row.scrollIntoViewIfNeeded();
  await expect(row.getByText(code, { exact: true })).toBeVisible();
  await expect(row.getByText(hand.seed, { exact: true })).toBeVisible();
  await expect(row.getByRole('list')).toHaveCount(0); // no deck before the check

  // ✓, and the deck in the order the hand was dealt from it.
  await row.getByRole('button', { name: 'Check the shuffle' }).click();
  await expect(
    row.getByText('The cards came from this shuffle. Nobody changed them.'),
  ).toBeVisible();
  const deck = row.getByRole('list', { name: 'Deck order, top card first' });
  await expect(deck.getByRole('img')).toHaveCount(52);
  const names = await deck
    .getByRole('img')
    .evaluateAll((cards) => cards.map((card) => card.getAttribute('aria-label')));
  expect(names).toEqual(hand.deck.map((card) => CARD_NAMES[card]));

  // A calm page: nothing scrolls sideways, the button is big enough to touch (§12.12).
  const metrics = await page.evaluate(() => {
    const button = [...document.querySelectorAll('[data-review] button')].find(
      (b) => b.textContent === 'Check the shuffle',
    );
    const r = button?.getBoundingClientRect();
    return {
      sideways: document.documentElement.scrollWidth - window.innerWidth,
      button: r === undefined ? null : { w: r.width, h: r.height },
    };
  });
  expect(metrics.sideways).toBeLessThanOrEqual(0);
  expect(metrics.button?.w).toBeGreaterThanOrEqual(44);
  expect(metrics.button?.h).toBeGreaterThanOrEqual(44);
  expect(errors).toEqual([]);
});
