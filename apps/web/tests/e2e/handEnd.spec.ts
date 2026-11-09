import type { Page } from '@playwright/test';
import { tableFrame } from '../../src/ui/layout/seats.ts';
import { expect, test } from './fixtures.ts';
import {
  collectErrors,
  installLeakWatch,
  leakViolations,
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

// PLAN §12.7, §12.9 (1.3.99): the hand end, where every hand is tapped on. Row A is one big "Next
// hand ›" (no dead "Fold / Waiting… / Raise"), the result never covers the board at any phone size,
// and the links ("Hand summary", "Review this hand") have their own place, clear of everything.
// Wide screens: the result is in the panel under the hero; at Exam that panel is smaller and the
// table bigger, the same at every decision. After a fold, "Skip to result ›" ends the hand at once,
// this hand only, and shows nothing the normal flow would not have shown. The keys are in
// keyboard.spec.ts; the guard's details and the controller's in the unit tests.

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The sizes asked for, per project: the 390 px phone also at 664 px (`c390s`, a short phone). */
const SIZES: Readonly<Record<string, readonly (readonly [number, number])[]>> = {
  '360x740': [
    [360, 740],
    [360, 640], // compact mode (§12.3): no Undo row
  ],
  '390x844': [
    [390, 664],
    [390, 844],
  ],
  '844x390': [[844, 390]],
  '1280x800': [[1280, 800]],
};

interface EndBoxes {
  /** Row A's "Next hand ›", and the row it must fill (the bar's box without its padding). */
  next: Box;
  row: Box;
  /** Row A's three buttons, still on the page. */
  slots: number;
  result: Box;
  /** The first line is what a tap there would hit (nothing covers it). */
  firstLineShows: boolean;
  /** The wide screen's panel under the hero holds the result. */
  inPanel: boolean;
  /** The table box holds the result. */
  onTable: boolean;
  board: Box;
  heroCards: Box;
  topBar: Box;
  table: Box;
  /** "Hand summary" or "Exam result" (when the hand has one) and "Review this hand". */
  links: Box[];
  linksHit: boolean;
  /** The last decision's grade chip, while it shows (1.5 s). */
  chip: Box | null;
  vw: number;
  vh: number;
}

/** In the page, at a hand end. */
function measureEnd(page: Page): Promise<EndBoxes> {
  return page.evaluate(() => {
    const rect = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    };
    // The part of `el` a finger can see: the landscape column's middle scrolls under Row A.
    const seen = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      let [left, top, right, bottom] = [r.left, r.top, r.right, r.bottom];
      for (let a = el.parentElement; a !== null; a = a.parentElement) {
        const style = getComputedStyle(a);
        if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
        const b = a.getBoundingClientRect();
        [left, top] = [Math.max(left, b.left), Math.max(top, b.top)];
        [right, bottom] = [Math.min(right, b.right), Math.min(bottom, b.bottom)];
      }
      return { x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top) };
    };
    const need = (selector: string): Element => {
      const el = document.querySelector(selector);
      if (el === null) throw new Error(`hand end: no ${selector}`);
      return el;
    };
    const next = need('[data-hand-end]');
    const result = need('[data-hand-result]');
    const group = next.parentElement as HTMLElement;
    const style = getComputedStyle(group);
    const bar = rect(group);
    const [left, right] = [parseFloat(style.paddingLeft), parseFloat(style.paddingRight)];
    const first = result.firstElementChild as Element;
    const line = first.getBoundingClientRect();
    const onTop = document.elementFromPoint(line.left + line.width / 2, line.top + line.height / 2);
    const links = [...document.querySelectorAll('[data-hand-summary], [data-hand-review]')];
    const chip = document.querySelector('[data-grade-chip]');
    return {
      next: rect(next),
      row: { x: bar.x + left, y: bar.y, w: bar.w - left - right, h: bar.h },
      slots: document.querySelectorAll('[data-slot]').length,
      result: seen(result),
      firstLineShows: onTop !== null && result.contains(onTop),
      inPanel: document.querySelector('[data-hand-panel] [data-hand-result]') !== null,
      onTable: document.querySelector('[data-table-box] [data-hand-result]') !== null,
      board: rect(need('[role="group"][aria-label="Board"]')),
      heroCards: rect(need('[data-hero-cards]')),
      topBar: rect(need('main > header')),
      table: rect(need('[data-table-box]')),
      links: links.map(rect),
      linksHit: links.every((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return hit !== null && el.contains(hit);
      }),
      chip: chip === null ? null : rect(chip),
      vw: document.documentElement.clientWidth,
      vh: document.documentElement.clientHeight,
    };
  });
}

const overlaps = (a: Box, b: Box): boolean =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.5 &&
  Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.5;

const fmt = (b: Box): string =>
  `(${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}×${Math.round(b.h)})`;

/** Every problem with the hand end's places; empty when there is none. */
function endProblems(m: EndBoxes, when: string): string[] {
  const problems: string[] = [];
  const say = (text: string) => problems.push(`${when}: ${text}`);
  const inside = (b: Box): boolean =>
    b.x > -0.5 && b.y > -0.5 && b.x + b.w < m.vw + 0.5 && b.y + b.h < m.vh + 0.5;
  // Row A: the one button, at least 56 px, across the row, at the foot of the screen.
  if (m.slots !== 0) say(`Row A still has ${m.slots} of its buttons`);
  if (m.next.h < 56) say(`"Next hand" is ${m.next.h} px tall`);
  if (Math.abs(m.next.w - m.row.w) > 1)
    say(`"Next hand" ${fmt(m.next)} is not the row ${fmt(m.row)}`);
  if (!inside(m.next)) say(`"Next hand" ${fmt(m.next)} leaves the screen`);
  if (m.vh - (m.next.y + m.next.h) > 12) say(`"Next hand" ${fmt(m.next)} is not at the foot`);
  // The result: never over the board, the hero's cards, the button or the top bar.
  if (!inside(m.result)) say(`the result ${fmt(m.result)} leaves the screen`);
  if (!m.firstLineShows) say('something covers the first line of the result');
  if (overlaps(m.result, m.board))
    say(`the result ${fmt(m.result)} covers the board ${fmt(m.board)}`);
  if (overlaps(m.result, m.heroCards))
    say(`the result covers the hero's cards ${fmt(m.heroCards)}`);
  if (overlaps(m.result, m.next)) say(`the result ${fmt(m.result)} covers "Next hand"`);
  if (overlaps(m.result, m.topBar)) say(`the result ${fmt(m.result)} reaches the top bar`);
  // The links: there, 44 px to touch, on top, clear of everything.
  if (m.links.length === 0 && m.chip === null) say('no links');
  if (!m.linksHit) say('something covers a link');
  for (const link of m.links) {
    if (link.h < 44) say(`a link is ${link.h} px tall`);
    if (!inside(link)) say(`the link ${fmt(link)} leaves the screen`);
    for (const [name, box] of [
      ['Next hand', m.next],
      ['the result', m.result],
      ['the board', m.board],
      ["the hero's cards", m.heroCards],
      ...(m.chip === null ? [] : ([['the grade chip', m.chip]] as const)),
    ] as const) {
      if (overlaps(link, box)) say(`the link ${fmt(link)} covers ${name} ${fmt(box)}`);
    }
  }
  const [a, b] = m.links;
  if (a !== undefined && b !== undefined && overlaps(a, b)) say('the links overlap');
  return problems;
}

test.describe('the hand end (§12.7, §12.9)', () => {
  test('at every hand end: one "Next hand ›" at the thumb, the board in sight, the links clear', async ({
    page,
  }, testInfo) => {
    const sizes = SIZES[sizeOf(testInfo)];
    test.skip(sizes === undefined, 'the four sizes of the plan');
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    await page.clock.install();
    await openApp(page, seedFor(testInfo));
    const problems: string[] = [];
    for (const [width, height] of sizes ?? []) {
      await page.setViewportSize({ width, height });
      // Nine players: the most pods around the result; hands of different lengths and endings.
      await newTable(page, { players: 9 });
      const wide = (await pcState(page)).ui.layout === 'wide';
      const felt = width < height;
      const frame = tableFrame({ w: width, h: height }).box;
      let ends = 0;
      await playHands(page, {
        hands: 6,
        random: () => 0.5,
        fast: true,
        onHandEnd: async () => {
          ends++;
          const when = `${width}×${height}, hand end ${ends}`;
          // With the last decision's grade chip, while it shows.
          problems.push(...endProblems(await measureEnd(page), `${when}, at once`));
          // Landscape and compact: the links come when the chip has gone (1.5 s).
          await page.clock.runFor(1_600);
          const m = await measureEnd(page);
          problems.push(...endProblems(m, when));
          if (wide !== m.inPanel)
            problems.push(`${when}: the panel holds the result: ${m.inPanel}`);
          if (felt !== m.onTable) problems.push(`${when}: the felt holds the result: ${m.onTable}`);
          // Nothing jumped: the table box is the §12.3 shell's, with the buttons changed.
          if (fmt(m.table) !== fmt(frame)) {
            problems.push(`${when}: the table box ${fmt(m.table)}, not ${fmt(frame)}`);
          }
        },
      });
      expect(ends).toBe(6);
    }
    expect(problems).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('at Large text too', async ({ page }, testInfo) => {
    test.skip(
      !['360x740', '844x390', '1280x800'].includes(sizeOf(testInfo)),
      'a phone, a phone on its side and the wide screen',
    );
    test.setTimeout(120_000);
    await page.clock.install();
    await openApp(page, seedFor(testInfo));
    await page.evaluate(() => {
      window.__pc?.dispatch({ type: 'settings', patch: { textSize: 'large' } });
    });
    await newTable(page, { players: 6 });
    const problems: string[] = [];
    let ends = 0;
    await playHands(page, {
      hands: 3,
      random: () => 0.5,
      fast: true,
      onHandEnd: async () => {
        ends++;
        await page.clock.runFor(1_600);
        problems.push(...endProblems(await measureEnd(page), `Large text, hand end ${ends}`));
      },
    });
    expect(ends).toBe(3);
    expect(problems).toEqual([]);
  });

  test("the hero's own result, in the words of the plan", async ({ page }, testInfo) => {
    test.skip(sizeOf(testInfo) !== '390x844', 'one phone size per browser');
    test.setTimeout(120_000);
    await page.clock.install();
    await openApp(page, seedFor(testInfo));
    await newTable(page, { players: 4 });
    const seen = new Set<string>();
    await playHands(page, {
      hands: 8,
      random: () => 0.5,
      fast: true,
      onHandEnd: async ({ hand }) => {
        const net = hand.result?.net[0] ?? 0;
        const words = await page.locator('[data-hand-result]').textContent();
        if (net > 0) expect(words).toContain(`You won ${net.toLocaleString('en-US')}`);
        if (net < 0) expect(words).toContain(`You lost ${(-net).toLocaleString('en-US')}`);
        if (net === 0) expect(words).not.toMatch(/You (won|lost)/);
        seen.add(net > 0 ? 'won' : net < 0 ? 'lost' : 'even');
      },
    });
    expect(seen.has('lost') || seen.has('won')).toBe(true);
  });

  test('with "Deal the next hand by itself" on, the button shows and its tap deals at once', async ({
    page,
  }, testInfo) => {
    test.skip(sizeOf(testInfo) !== '360x740', 'one phone size per browser');
    test.setTimeout(60_000);
    await page.clock.install();
    await openApp(page, seedFor(testInfo));
    await newTable(page, { players: 3, autoNext: true, speed: 'normal' });
    for (let point = await nextFlowPoint(page, true); point !== 'end';) {
      if (point === 'hero') await slot(page, 'middle').click();
      point = await nextFlowPoint(page, true);
    }
    const handSeq = (await pcState(page)).game.hand?.handSeq ?? 0;
    await expect(page.locator('[data-hand-end]')).toBeVisible();
    await tapNextHand(page);
    expect((await pcState(page)).game.hand?.handSeq).toBe(handSeq + 1);
  });

  test('a double tap on "Next hand ›" deals one hand', async ({ page }, testInfo) => {
    test.skip(sizeOf(testInfo) !== '390x844', 'one phone size per browser');
    test.setTimeout(60_000);
    await openApp(page, seedFor(testInfo));
    await newTable(page, { players: 6 });
    // The hero folds or checks: the hand ends, and never with the hero out of chips.
    for (let point = await nextFlowPoint(page); point !== 'end';) {
      const fold = slot(page, 'fold');
      const folds = (await fold.getAttribute('aria-disabled')) === null;
      await (folds ? fold : slot(page, 'middle')).click();
      point = await nextFlowPoint(page);
    }
    const before = (await pcState(page)).game.hand?.handSeq ?? 0;
    const next = page.locator('[data-hand-end]');
    const box = await next.boundingBox();
    if (box === null) throw new Error('no "Next hand"');
    // Its first 250 ms are guarded too, so wait them out: this is the button's own double tap.
    await page.waitForTimeout(350);
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(() => pcState(page).then((s) => s.game.hand?.handSeq)).toBe(before + 1);
    const s = await pcState(page);
    expect(s.game.hand?.log.some((e) => e.e === 'act' && e.seat === 0)).toBe(false);
  });
});

test.describe('wide screens at Exam (§12.5, 1.3.99)', () => {
  test('a smaller panel, a bigger table, the same at every decision and at the hand end', async ({
    page,
  }, testInfo) => {
    test.skip(sizeOf(testInfo) !== '1280x800', 'the wide layout');
    test.setTimeout(120_000);
    await page.clock.install();
    await openApp(page, seedFor(testInfo));
    await page.evaluate(() => {
      window.__pc?.dispatch({ type: 'settings', patch: { coachLevel: 'exam' } });
    });
    await newTable(page, { players: 6 });
    const tableBox = (): Promise<Box> =>
      page.locator('[data-table-box]').evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      });
    const frame = tableFrame({ w: 1280, h: 800 }, { exam: true }).box;
    expect(frame.h, 'bigger than the 340 px of the other levels').toBeGreaterThan(340);
    expect(fmt(await tableBox()), 'the table box at the deal').toBe(fmt(frame));
    let decisions = 0;
    for (let point = await nextFlowPoint(page, true); point !== 'end' && decisions < 40;) {
      if (point === 'bust') throw new Error('out of chips in one hand');
      decisions++;
      expect(fmt(await tableBox()), `the table box at decision ${decisions}`).toBe(fmt(frame));
      // The tray takes the panel's room, not the table's (R14).
      const right = slot(page, 'right');
      if (
        decisions === 1 &&
        (await right.getAttribute('aria-disabled')) === null &&
        (await right.getAttribute('aria-expanded')) !== null
      ) {
        await expect(async () => {
          if ((await right.getAttribute('aria-expanded')) !== 'true') await right.click();
          await expect(right).toHaveAttribute('aria-expanded', 'true', { timeout: 1_000 });
        }).toPass({ timeout: 10_000 });
        expect(fmt(await tableBox()), 'the table box with the tray open').toBe(fmt(frame));
        await page.keyboard.press('Escape');
        await expect(right).toHaveAttribute('aria-expanded', 'false');
      }
      await expect(async () => {
        const before = (await pcState(page)).game.hand?.log.length ?? 0;
        await slot(page, 'middle').click({ timeout: 2_000 });
        expect((await pcState(page)).game.hand?.log.length).toBeGreaterThan(before);
      }).toPass({ timeout: 10_000 });
      point = await nextFlowPoint(page, true);
    }
    expect(decisions).toBeLessThan(40);
    // The hand end: the result and "Exam result" are in the panel; the table has not moved.
    const m = await measureEnd(page);
    expect(fmt(m.table), 'the table box at the hand end').toBe(fmt(frame));
    expect(m.inPanel).toBe(true);
    expect(endProblems(m, 'Exam')).toEqual([]);
    const words = page.locator('[data-hand-panel]');
    await expect(words.getByRole('button', { name: 'Exam result' })).toBeVisible();
    // Nothing to scroll: the panel holds the result and its links.
    const scrolls = await words.evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(scrolls).toBeLessThanOrEqual(0);
  });
});

test.describe('after folding: "Skip to result ›" (§12.7, 1.3.99)', () => {
  test('ends the hand at once, for this hand only, and shows nothing early', async ({
    page,
  }, testInfo) => {
    test.skip(
      !['360x740', '390x844', '844x390', '1280x800'].includes(sizeOf(testInfo)),
      'the sizes of the plan',
    );
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    await openApp(page, seedFor(testInfo));
    // Exam: no feedback card holds the fold (§10.2); Normal, where a hand takes longest.
    await page.evaluate(() => {
      window.__pc?.dispatch({ type: 'settings', patch: { coachLevel: 'exam' } });
    });
    await newTable(page, { players: 6, speed: 'normal' });

    // To a hand where the hero can fold, with bots still to act behind them.
    for (let points = 0; ; points++) {
      expect(points, 'a decision that can fold').toBeLessThan(60);
      const point = await nextFlowPoint(page);
      if (point === 'bust') {
        await reloadAfterBust(page);
        continue;
      }
      if (point === 'end') {
        await tapNextHand(page);
        continue;
      }
      const hand = (await pcState(page)).game.hand;
      const live = hand?.seats.filter((seat) => seat.dealtIn && !seat.folded).length ?? 0;
      if ((await slot(page, 'fold').getAttribute('aria-disabled')) === null && live >= 3) break;
      await slot(page, 'middle').click();
      await page.waitForTimeout(300); // the tap guard
    }
    await installLeakWatch(page);
    // Every bot would now think for a minute (half of it at Fast, after the fold): the hand can
    // only end soon if the skip works.
    await page.evaluate(() => window.__pc?.faults?.think(60_000));
    const settings = (await pcState(page)).settings;

    await slot(page, 'fold').click();
    const skip = slot(page, 'middle');
    await expect(skip).toHaveText('Skip to result');
    await expect(skip).not.toHaveAttribute('aria-disabled', 'true');
    await expect(async () => {
      if (!(await pcState(page)).game.skipping) await skip.click({ timeout: 2_000 });
      expect((await pcState(page)).game.skipping).toBe(true);
    }).toPass({ timeout: 10_000 });
    await expect(page.locator('[data-hand-end]')).toBeVisible({ timeout: 15_000 });
    expect(await leakViolations(page)).toEqual([]);
    const ended = await pcState(page);
    expect(ended.game.mode).toBe('handEnd');
    expect(ended.settings, 'no setting changed').toEqual(settings);
    expect(ended.settings.speed).toBe('normal');

    // This hand only: the next one is at the player's speed again.
    await page.evaluate(() => window.__pc?.faults?.think(null));
    await tapNextHand(page);
    const next = await pcState(page);
    expect(next.game.skipping).toBe(false);
    expect(next.settings.speed).toBe('normal');
    expect(
      await page.evaluate(() => document.documentElement.style.getPropertyValue('--speed')),
    ).toBe('1');
    expect(errors).toEqual([]);
  });
});
