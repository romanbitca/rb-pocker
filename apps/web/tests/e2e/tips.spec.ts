import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import {
  collectErrors,
  keepMove,
  openApp,
  pcState,
  reloadAfterBust,
  seedFor,
  sizeOf,
  tapNextHand,
} from './game.ts';
import { inputCount, tapAct } from './scripted.ts';

// PLAN §12.11 (chunk 9.3): the first-table tips in a real browser, at one size per layout
// (compact, portrait, landscape, wide), in both browsers. A first launch: Play reaches a dealt
// hand with no tip in between; then the hero strip's tip, the coach's (both at the first hero
// turn), Undo's (after the first action) and the Hands tab's (after the first flop), each once,
// one at a time, beside what it explains, inside the window, never over the tray and Row A; the
// Table stays within its 600 DOM nodes; while a tip shows nothing moves; after a reload none comes
// back. The bots check and call (`?script=passive`), so every hand sees a flop.

test.use({ firstTableTips: true });

const SIZES = ['375x667', '390x844', '844x390', '1280x800'];

/** Appendix F.10 / §12.11, word for word. */
const WORDS: Readonly<Record<string, string>> = {
  heroStrip: 'This is your hand. We show what you have and your chance to win.',
  coachStrip: 'Your coach. It tells you what to do, and why.',
  undo: 'Changed your mind? Undo takes back your last move.',
  handsTab: 'All poker hands, best to worst. Yours is highlighted.',
};

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface TipShot {
  tip: string | null;
  text: string | null;
  role: string | null;
  side: string | null;
  bubble: Box | null;
  anchor: Box | null;
  bar: Box | null;
  nodes: number;
  heroCards: number;
  viewport: { width: number; height: number };
}

/** The open tip, measured in the page. */
const shoot = (page: Page): Promise<TipShot> =>
  page.evaluate(() => {
    const box = (el: Element | null) => {
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    };
    const el = document.querySelector('[data-tip]');
    const tip = el?.getAttribute('data-tip') ?? null;
    return {
      tip,
      text: el?.textContent ?? null,
      role: el?.getAttribute('role') ?? null,
      side: el?.getAttribute('data-side') ?? null,
      bubble: box(el),
      anchor: tip === null ? null : box(document.querySelector(`[data-tip-anchor~="${tip}"]`)),
      bar: box(document.querySelector('[data-action-area]')),
      nodes: document.querySelectorAll('*').length,
      heroCards: document.querySelectorAll('[data-hero-cards] [role="img"]').length,
      viewport: { width: innerWidth, height: innerHeight },
    };
  });

const apart = (a: Box, b: Box): boolean =>
  a.left + a.width <= b.left + 0.5 ||
  b.left + b.width <= a.left + 0.5 ||
  a.top + a.height <= b.top + 0.5 ||
  b.top + b.height <= a.top + 0.5;

type Point = 'tip' | 'hero' | 'feedback' | 'end' | 'bust';

/**
 * In the page: what the game waits for. The hero acts like a reader who waits for the tips of a
 * hero turn (the hero strip's and the coach's) before tapping Row A.
 */
function readTipPoint(): Point | null {
  const s = window.__pc?.state();
  if (s === undefined) return null;
  if (s.ui.overlays.includes('tip') && document.querySelector('[data-tip]') !== null) return 'tip';
  if (s.ui.overlays.includes('outOfChips')) return 'bust';
  if (s.game.mode === 'feedback' && document.querySelector('[data-feedback-keep]') !== null) {
    return 'feedback';
  }
  if (s.game.mode === 'handEnd') {
    const summary = s.ui.overlays.includes('summary');
    return document.querySelector(summary ? '[data-summary-next]' : '[data-hand-end]') === null
      ? null
      : 'end';
  }
  if (s.game.mode === 'heroTurn') {
    const seen = s.data.tips ?? {};
    return seen['heroStrip'] === true && seen['coachStrip'] === true ? 'hero' : null;
  }
  return null;
}

async function nextTipPoint(page: Page): Promise<Point> {
  const handle = await page.waitForFunction(readTipPoint, undefined, {
    polling: 'raf',
    timeout: 20_000,
  });
  return (await handle.jsonValue()) as Point;
}

test('four tips, once each: never before the deal, beside their places, never over Row A', async ({
  page,
}, testInfo) => {
  test.skip(!SIZES.includes(sizeOf(testInfo)), 'one size per layout, in both browsers');
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await openApp(page, seedFor(testInfo), '&script=passive');
  expect((await pcState(page)).ui.screen).toBe('welcome'); // a first launch
  expect((await pcState(page)).data.tips).toEqual({});
  await page.evaluate(() => {
    window.__pc?.dispatch({
      type: 'settings',
      patch: { players: 3, seatLevels: [null, null, null] },
    });
  });

  // One tap on Play: the dealt hand, with no tip (and no other layer) in between (§12.1).
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('[data-hero-cards] [role="img"]')).toHaveCount(2);
  const dealt = await pcState(page);
  expect(dealt.ui.screen).toBe('table');
  expect(dealt.ui.overlays).toEqual([]);

  const shots: TipShot[] = [];
  let waited = false;
  for (let steps = 0; shots.length < 4 && steps < 300; steps++) {
    const point = await nextTipPoint(page);
    if (point === 'tip') {
      const shot = await shoot(page);
      shots.push(shot);
      // While a tip shows, nothing moves (its gate): checked once, away from the hero's turn.
      const s = await pcState(page);
      if (!waited && s.game.mode !== 'heroTurn') {
        const before = await inputCount(page);
        await page.waitForTimeout(1500);
        expect(await inputCount(page)).toBe(before);
        waited = true;
      }
      await page.locator('[data-tip]').click(); // a tap closes it
      await page.waitForFunction(() => window.__pc?.state().ui.overlays.includes('tip') !== true);
    } else if (point === 'feedback') {
      await keepMove(page);
    } else if (point === 'end') {
      await tapNextHand(page);
    } else if (point === 'bust') {
      await reloadAfterBust(page);
    } else {
      await tapAct(page, 'middle');
    }
  }

  expect(shots.map((s) => s.tip).slice(0, 2)).toEqual(['heroStrip', 'coachStrip']);
  expect(shots.map((s) => s.tip).sort()).toEqual(['coachStrip', 'handsTab', 'heroStrip', 'undo']);
  for (const shot of shots) {
    const what = `${shot.tip} at ${sizeOf(testInfo)}`;
    expect(shot.text, what).toBe(WORDS[shot.tip ?? '']);
    expect(shot.role, what).toBe('status');
    expect(shot.heroCards, `${what}: after the hero's cards`).toBe(2);
    expect(shot.nodes, `${what}: §15.3 DOM budget`).toBeLessThanOrEqual(600);
    const { bubble, anchor, bar, viewport } = shot;
    if (bubble === null || anchor === null || bar === null) throw new Error(`${what}: no box`);
    // Inside the window.
    expect(bubble.left, what).toBeGreaterThanOrEqual(0);
    expect(bubble.top, what).toBeGreaterThanOrEqual(0);
    expect(bubble.left + bubble.width, what).toBeLessThanOrEqual(viewport.width + 0.5);
    expect(bubble.top + bubble.height, what).toBeLessThanOrEqual(viewport.height + 0.5);
    // Never over the tray and Row A (§12.11).
    expect(apart(bubble, bar), `${what}: clear of Row A`).toBe(true);
    // Beside what it explains, its arrow on that side.
    expect(['above', 'below', 'left'], what).toContain(shot.side);
    if (shot.side === 'above')
      expect(bubble.top + bubble.height).toBeLessThanOrEqual(anchor.top + 0.5);
    if (shot.side === 'below')
      expect(bubble.top).toBeGreaterThanOrEqual(anchor.top + anchor.height - 0.5);
    if (shot.side === 'left')
      expect(bubble.left + bubble.width).toBeLessThanOrEqual(anchor.left + 0.5);
  }
  expect((await pcState(page)).data.tips).toEqual({
    heroStrip: true,
    coachStrip: true,
    undo: true,
    handsTab: true,
  });

  // Once each: after a reload (Home, then Play continues the game) no tip comes back.
  await page.reload();
  await page.waitForFunction(() => window.__pc?.state().game.mode !== 'booting');
  expect((await pcState(page)).data.tips).toEqual({
    heroStrip: true,
    coachStrip: true,
    undo: true,
    handsTab: true,
  });
  await page.evaluate(() => {
    const seen = { tips: 0 };
    Object.assign(window, { __tipsAfter: seen });
    new MutationObserver(() => {
      if (document.querySelector('[data-tip]') !== null) seen.tips++;
    }).observe(document.body, { subtree: true, childList: true });
  });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const hand = (await pcState(page)).game.hand?.handSeq ?? 0;
  for (let steps = 0; steps < 60; steps++) {
    const s = await pcState(page);
    if ((s.game.hand?.handSeq ?? 0) > hand) break;
    const point = await nextTipPoint(page);
    if (point === 'end') await tapNextHand(page);
    else if (point === 'feedback') await keepMove(page);
    else if (point === 'bust') await reloadAfterBust(page);
    else if (point === 'hero') await tapAct(page, 'middle');
    else throw new Error('a tip came back');
  }
  const after = await page.evaluate(
    () => (window as unknown as { __tipsAfter: { tips: number } }).__tipsAfter.tips,
  );
  expect(after, 'no tip after the reload').toBe(0);
  expect(errors).toEqual([]);
});
