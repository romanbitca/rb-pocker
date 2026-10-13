import type { Page } from '@playwright/test';
import { tableFrame } from '../../src/ui/layout/seats.ts';
import { expect, test } from './fixtures.ts';
import {
  ACCEPTANCE_SIZES,
  closeSummary,
  heroAct,
  newTable,
  nextFlowPoint,
  openApp,
  pcState,
  playHands,
  reloadAfterBust,
  seedFor,
  sizeOf,
  slot,
  tapNextHand,
} from './game.ts';

// PLAN §18 Stage 3, acceptance 2: for every player count 2–9 at the five acceptance viewports,
// the seat pods overlap neither each other, the board, the hero strip nor the Hands edge tab,
// and stay inside the viewport: measured with bounding boxes when the cards are dealt, at the
// hero's first decision once the coach has answered (on wide screens its advice fills the inline
// panel) and again at the hand's end (showdown cards are drawn inside the pods). Through all of
// it the table box keeps its size (§15.3: the pods are placed in the measured box, one render
// after it changes, so a box that moved with the coach's words put them over the hero strip in
// between). With the sizing tray open at 375×667, nothing needed for the decision is covered and
// the page does not scroll. At every hand end of a nine-player table (phones in portrait and the
// wide screen) the hand-end banner, the result lines and the "Review this hand" link, stays on the
// table: clear of the top bar, inside the viewport, with its first result line readable (chunk
// 6.3: on the 340 px tall wide table the banner used to reach up under the top bar).

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface TableBoxes {
  /** The table box the pods are placed in (`[data-table-box]`). */
  table: Box;
  pods: { seat: string; box: Box }[];
  board: Box;
  hero: Box[];
  tab: Box | null;
  vw: number;
  vh: number;
}

/** Boxes of the table's parts, in viewport pixels. A pod's box includes everything drawn in it. */
function measure(page: Page): Promise<TableBoxes> {
  return page.evaluate(() => {
    const rect = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    };
    const union = (el: Element): Box => {
      let { x, y, w, h } = rect(el);
      let right = x + w;
      let bottom = y + h;
      for (const child of el.querySelectorAll('*')) {
        const r = child.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        x = Math.min(x, r.left);
        y = Math.min(y, r.top);
        right = Math.max(right, r.right);
        bottom = Math.max(bottom, r.bottom);
      }
      w = right - x;
      h = bottom - y;
      return { x, y, w, h };
    };
    const pods = [...document.querySelectorAll('[data-seat]')].map((seat) => {
      const pod = seat.querySelector(':scope > [role="group"], :scope > button');
      if (pod === null) throw new Error(`seat ${seat.getAttribute('data-seat')} has no pod`);
      return { seat: seat.getAttribute('data-seat') ?? '?', box: union(pod) };
    });
    const table = document.querySelector('[data-table-box]');
    if (table === null) throw new Error('no table box');
    const board = document.querySelector('[role="group"][aria-label="Board"]');
    if (board === null) throw new Error('no board');
    const hero = [
      ...document.querySelectorAll('section[aria-label="Your hand"], [data-hero-cards]'),
    ]
      .map(rect)
      .filter((b) => b.w > 0 && b.h > 0);
    // The edge tab sits next to the table box (every layout but wide). §13.1: the tab is the
    // 28×88 face drawn in the 28 px gutter; "padding makes the hit area 44 px wide", so the
    // button reaches 16 px into the table on purpose. The face is what must stay clear.
    const tab = document.querySelector('[data-table-box] + div button > span');
    return {
      table: rect(table),
      pods,
      board: rect(board),
      hero,
      tab: tab === null ? null : rect(tab),
      vw: document.documentElement.clientWidth,
      vh: document.documentElement.clientHeight,
    };
  });
}

/** Overlap by more than half a pixel both ways (sub-pixel rounding is not an overlap). */
const overlaps = (a: Box, b: Box): boolean =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.5 &&
  Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.5;

const fmt = (b: Box): string =>
  `(${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}×${Math.round(b.h)})`;

/** Every problem with the pods' placement; empty when there is none. */
function podProblems(m: TableBoxes, when: string): string[] {
  const problems: string[] = [];
  const say = (text: string) => problems.push(`${when}: ${text}`);
  m.pods.forEach(({ seat, box }, i) => {
    const pod = `pod ${seat} ${fmt(box)}`;
    if (box.x < -0.5 || box.y < -0.5 || box.x + box.w > m.vw + 0.5 || box.y + box.h > m.vh + 0.5) {
      say(`${pod} leaves the ${m.vw}×${m.vh} viewport`);
    }
    for (const other of m.pods.slice(i + 1)) {
      if (overlaps(box, other.box)) say(`${pod} overlaps pod ${other.seat} ${fmt(other.box)}`);
    }
    if (overlaps(box, m.board)) say(`${pod} overlaps the board ${fmt(m.board)}`);
    for (const hero of m.hero) {
      if (overlaps(box, hero)) say(`${pod} overlaps the hero strip ${fmt(hero)}`);
    }
    if (m.tab !== null && overlaps(box, m.tab)) say(`${pod} overlaps the Hands tab ${fmt(m.tab)}`);
  });
  return problems;
}

/** A problem when the table box is not the one measured at the deal (`dealt`). */
function tableProblems(m: TableBoxes, dealt: TableBoxes, when: string): string[] {
  return fmt(m.table) === fmt(dealt.table)
    ? []
    : [`${when}: the table box is ${fmt(m.table)}, it was ${fmt(dealt.table)} at the deal`];
}

/** The hand-end banner, the top bar and the table box, in viewport pixels. */
interface BannerBoxes {
  /** The result lines, "Next hand ›" and the "Review this hand" link. */
  banner: Box;
  topBar: Box;
  table: Box;
  /** Whether the middle of the first result line is what a tap there would hit. */
  resultReadable: boolean;
  vw: number;
  vh: number;
}

/** In the page, at a hand end: where the banner is. */
function measureBanner(page: Page): Promise<BannerBoxes> {
  return page.evaluate(() => {
    const rect = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    };
    const card = document.querySelector('[data-hand-end]');
    const link = document.querySelector('[data-hand-review]');
    const topBar = document.querySelector('main > header');
    const table = document.querySelector('[data-table-box]');
    const result = card?.querySelector('span');
    if (card === null || link === null || topBar === null || table === null || !result) {
      throw new Error('hand end: no banner, link, top bar or table box');
    }
    const [a, b] = [rect(card), rect(link)];
    const [x, y] = [Math.min(a.x, b.x), Math.min(a.y, b.y)];
    const [right, bottom] = [Math.max(a.x + a.w, b.x + b.w), Math.max(a.y + a.h, b.y + b.h)];
    const r = result.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      banner: { x, y, w: right - x, h: bottom - y },
      topBar: rect(topBar),
      table: rect(table),
      resultReadable: hit !== null && card.contains(hit),
      vw: document.documentElement.clientWidth,
      vh: document.documentElement.clientHeight,
    };
  });
}

/** Every problem with the banner's place; empty when there is none. */
function bannerProblems(m: BannerBoxes, when: string): string[] {
  const problems: string[] = [];
  const say = (text: string) => problems.push(`${when}: ${text} (banner ${fmt(m.banner)})`);
  const { banner: b } = m;
  if (overlaps(b, m.topBar)) say(`the banner reaches under the top bar ${fmt(m.topBar)}`);
  if (b.x < -0.5 || b.y < -0.5 || b.x + b.w > m.vw + 0.5 || b.y + b.h > m.vh + 0.5) {
    say(`the banner leaves the ${m.vw}×${m.vh} viewport`);
  }
  if (b.y < m.table.y - 0.5) say(`the banner starts above the table box ${fmt(m.table)}`);
  if (!m.resultReadable) say('something covers the first result line');
  return problems;
}

/**
 * Plays on to the hero's first decision and waits until the coach has answered it (§12.6: the
 * advice, or "Coach is not available"; on wide screens the answer fills the inline panel). False
 * when the hand ends first (everyone folds to the hero's big blind) or the hero is out of chips.
 */
async function firstDecision(page: Page): Promise<boolean> {
  if ((await nextFlowPoint(page, true)) !== 'hero') return false;
  await page.waitForFunction(
    () => {
      const s = window.__pc?.state();
      const hand = s?.game.hand;
      if (s === undefined || hand === null || hand === undefined) return false;
      // The decision's key: coachKeyOf(hand) in app/coachViews.ts.
      return s.coach.key === `${hand.handSeq}:${hand.log.length}` && s.coach.status !== 'idle';
    },
    undefined,
    { timeout: 10_000 },
  );
  return true;
}

test.describe('table layout', () => {
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(
      !(ACCEPTANCE_SIZES as readonly string[]).includes(sizeOf(testInfo)),
      'acceptance 2: the five Stage 3 viewports',
    );
  });

  test('pods never overlap the board, the hero, the tab or each other, for 2–9 players', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await page.clock.install();
    await openApp(page, seedFor(testInfo));
    const problems: string[] = [];
    for (let players = 2; players <= 9; players++) {
      await newTable(page, { players });
      const dealt = await measure(page);
      expect(dealt.pods).toHaveLength(players - 1);
      if (sizeOf(testInfo) !== '1280x800') expect(dealt.tab, 'the Hands edge tab').not.toBeNull();
      // The box the geometry's unit tests assume (layout/seats.ts) is the one on screen.
      const frame = tableFrame({ w: dealt.vw, h: dealt.vh }).box;
      expect(fmt(dealt.table), 'the table box, as tableFrame() has it').toBe(fmt(frame));
      problems.push(...podProblems(dealt, `${players} players, deal`));

      if (await firstDecision(page)) {
        const m = await measure(page);
        const when = `${players} players, first decision`;
        problems.push(...podProblems(m, when), ...tableProblems(m, dealt, when));
      }

      // Check or call to the end of the hand; measure again with the result on show.
      await playHands(page, {
        hands: 1,
        random: () => 0.5, // check or call
        fast: true,
        onHandEnd: async () => {
          const m = await measure(page);
          const when = `${players} players, hand end`;
          problems.push(...podProblems(m, when), ...tableProblems(m, dealt, when));
        },
      });
    }
    expect(problems).toEqual([]);
  });

  test('with nine players the hand-end banner stays on the table, clear of the top bar', async ({
    page,
  }, testInfo) => {
    // Landscape phones put the banner in the right column (§12.5): it scrolls there.
    test.skip(sizeOf(testInfo) === '844x390', 'the banner is in the right column in landscape');
    test.setTimeout(120_000);
    await page.clock.install();
    await openApp(page, seedFor(testInfo));
    await newTable(page, { players: 9 });
    const problems: string[] = [];
    let ends = 0;
    // Check or call to the end of six hands: results of different lengths (a win by folds, a
    // showdown with one or two beaten hands, a split pot).
    await playHands(page, {
      hands: 6,
      random: () => 0.5,
      fast: true,
      onHandEnd: async () => {
        ends++;
        // The hand summary (Beginner, §12.9) covers the table: closed, the banner is measured.
        await closeSummary(page);
        problems.push(...bannerProblems(await measureBanner(page), `hand end ${ends}`));
      },
    });
    expect(ends, 'hand ends measured').toBe(6);
    expect(problems).toEqual([]);
  });

  test('with the sizing tray open at 375×667 the decision stays in view', async ({
    page,
  }, testInfo) => {
    test.skip(sizeOf(testInfo) !== '375x667', 'acceptance 2: the tray check is at 375×667');
    test.setTimeout(120_000);
    await page.clock.install();
    await openApp(page, seedFor(testInfo));
    await newTable(page, { players: 6 });

    // Play on (check or call) to a decision after the flop where Bet/Raise opens the tray.
    const right = slot(page, 'right');
    for (let decisions = 0; ; decisions++) {
      expect(decisions, 'a postflop decision with a bet or raise').toBeLessThan(60);
      const point = await nextFlowPoint(page, true);
      if (point === 'end') {
        await tapNextHand(page);
        continue;
      }
      if (point === 'bust') {
        await reloadAfterBust(page);
        continue;
      }
      const state = await pcState(page);
      const opensTray =
        (await right.count()) === 1 &&
        (await right.getAttribute('aria-disabled')) === null &&
        (await right.getAttribute('aria-expanded')) !== null;
      if (state.game.hand?.street !== 'preflop' && opensTray) break;
      await heroAct(page, () => 0.5); // check or call
    }

    await right.click();
    const trayId = await right.getAttribute('aria-controls');
    expect(trayId, 'the tray is open').not.toBeNull();
    const tray = page.locator(`[id="${trayId ?? ''}"]`);
    await expect(tray).toBeVisible();

    // Every part the decision needs is visible and on top where it is drawn.
    const covered = await page.evaluate((trayId) => {
      const targets: [string, Element | null][] = [
        // The two hole cards overlap each other by design: they are checked as one.
        ['the hole cards', document.querySelector('[data-hero-cards]')],
        ...[...document.querySelectorAll('[role="group"][aria-label="Board"] [role="img"]')].map(
          (el, i): [string, Element] => [`board card ${i + 1}`, el],
        ),
        ['the tray', document.getElementById(trayId)],
        ...[...document.querySelectorAll('[data-slot]')].map((el): [string, Element] => [
          `Row A ${el.getAttribute('aria-label') ?? ''}`,
          el,
        ]),
      ];
      const problems: string[] = [];
      for (const [name, el] of targets) {
        if (el === null) {
          problems.push(`${name} is missing`);
          continue;
        }
        const r = el.getBoundingClientRect();
        if (r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) {
          problems.push(`${name} is outside the viewport`);
        }
        // The centre and a point a quarter in from each edge must hit the element itself (not
        // the corners: hit testing follows rounded corners).
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const points = [
          [cx, cy],
          [r.left + r.width / 4, cy],
          [r.right - r.width / 4, cy],
          [cx, r.top + r.height / 4],
          [cx, r.bottom - r.height / 4],
        ];
        for (const [x = 0, y = 0] of points) {
          const hit = document.elementFromPoint(x, y);
          if (hit === null || !(hit === el || el.contains(hit))) {
            const by = hit === null ? 'nothing' : `${hit.tagName}.${hit.className}`;
            problems.push(`${name} is covered at (${Math.round(x)},${Math.round(y)}) by ${by}`);
          }
        }
      }
      return problems;
    }, trayId ?? '');
    expect(covered).toEqual([]);
    expect(await page.locator('[data-hero-cards] [role="img"]').count()).toBe(2);
    expect(
      await page.locator('[role="group"][aria-label="Board"] [role="img"]').count(),
    ).toBeGreaterThanOrEqual(3);

    const scroll = await page.evaluate(() => ({
      x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      y: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    }));
    expect(scroll, 'the page does not scroll').toEqual({ x: 0, y: 0 });
  });
});
