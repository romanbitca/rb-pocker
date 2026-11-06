import type { Page } from '@playwright/test';
import { tableFrame } from '../../src/ui/layout/seats.ts';
import { expect, test } from './fixtures.ts';
import { closeSummary, pageMetrics, pcState, sizeOf, slot } from './game.ts';
import { inputCount, nextPoint, pauseClock, playTo, scriptedTable, tapAct } from './scripted.ts';

// Chunk 9.1b (PLAN §12.1, §12.8 notes, §12.9, §12.12): Settings → Display → Text size "Large" on
// the narrowest phone of §17.5 (360×740), picked in the real Settings screen: the root font size
// is ×1.15, the words of the Table grow with it, and the Table stays usable: its rows keep their
// heights (the table box is still the one `tableFrame()` computes), Row A's words stay inside
// their buttons (no button overlaps another, nothing runs out of one), the hero strip and the
// coach strip end above Row A, the open sizing tray too, and the Table keeps ≤ 600 DOM nodes.
// Then the scripted hand (seed 46, `river-min-bet`: the hero's A♣3♣ makes the nut flush on the
// river) is the profile's first Flush: the collection moment's toast "New in your collection:
// Flush!" and, in the rankings drawer, the Flush row's ring and its one pulse (none under reduced
// motion: the system's choice or the setting; the ring stays), and its date is stored. Unit tests:
// tests/ui/screens/Settings*.test.tsx, tests/ui/App.test.tsx, tests/app/controller.collection.test.ts,
// tests/app/controller.displaySettings.test.ts, tests/ui/components/RankingsList.test.tsx.

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const fmt = (b: Box): string =>
  `(${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}×${Math.round(b.h)})`;

/**
 * In the page, at a hero decision: every problem with Row A (and the rows above it). Row A's
 * buttons stay inside the viewport and 56 px tall, overlap no other button, and every line of
 * their words lies inside the button (the coach's "Coach" badge sits on the top edge by design,
 * §12.7); the hero strip, the coach strip and the open tray end above Row A.
 */
function rowAProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const inside = (a: DOMRect, b: DOMRect) =>
      a.left >= b.left - 0.5 &&
      a.right <= b.right + 0.5 &&
      a.top >= b.top - 0.5 &&
      a.bottom <= b.bottom + 0.5;
    const buttons = [...document.querySelectorAll<HTMLElement>('[data-slot]')].filter(
      (b) => b.getBoundingClientRect().width > 0,
    );
    if (buttons.length === 0) problems.push('no Row A button');
    const rects = buttons.map((b) => b.getBoundingClientRect());
    buttons.forEach((b, i) => {
      const r = rects[i] as DOMRect;
      const name = `${b.dataset.slot ?? '?'} "${b.textContent ?? ''}"`;
      if (r.left < -0.5 || r.top < -0.5 || r.right > vw + 0.5 || r.bottom > vh + 0.5) {
        problems.push(`${name} leaves the ${vw}×${vh} viewport`);
      }
      if (Math.abs(r.height - 56) > 0.5) problems.push(`${name} is ${r.height} px tall, not 56`);
      const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
        if (n.parentElement?.closest('[class*="badge"]') != null) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const line of range.getClientRects()) {
          if (!inside(line, r)) problems.push(`${name}: "${n.textContent ?? ''}" runs out of it`);
        }
      }
      for (let j = i + 1; j < rects.length; j++) {
        const o = rects[j] as DOMRect;
        const x = Math.min(r.right, o.right) - Math.max(r.left, o.left);
        const y = Math.min(r.bottom, o.bottom) - Math.max(r.top, o.top);
        if (x > 0.5 && y > 0.5)
          problems.push(`${name} overlaps ${buttons[j]?.dataset.slot ?? '?'}`);
      }
    });
    // Nothing drawn in the rows above reaches down into Row A.
    const top = Math.min(...rects.map((r) => r.top));
    const trayId = document.querySelector('[data-slot="right"]')?.getAttribute('aria-controls');
    const above = [
      ['the hero strip', document.querySelector('section[aria-label="Your hand"]')],
      ['the coach strip', document.querySelector('[data-tip-anchor="coachStrip"]')],
      ['the sizing tray', trayId == null ? null : document.getElementById(trayId)],
    ] as const;
    for (const [what, el] of above) {
      if (el === null) continue;
      for (const child of [el, ...el.querySelectorAll('*')]) {
        const c = child.getBoundingClientRect();
        if (c.width === 0 || c.height === 0) continue;
        if (getComputedStyle(child).visibility === 'hidden') continue;
        if (c.bottom > top + 0.5 && !buttons.some((b) => b.contains(child))) {
          problems.push(
            `${what}: <${child.tagName.toLowerCase()}> reaches into Row A (bottom ${Math.round(c.bottom)} > ${Math.round(top)})`,
          );
          break;
        }
      }
    }
    return problems;
  });
}

/** The table box (`[data-table-box]`) and the action bar's row, in viewport pixels. */
function rows(page: Page): Promise<{ table: Box; actions: Box; vw: number; vh: number }> {
  return page.evaluate(() => {
    const box = (sel: string): Box => {
      const el = document.querySelector(sel);
      if (el === null) throw new Error(`no ${sel}`);
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    };
    return {
      table: box('[data-table-box]'),
      actions: box('[data-action-area]'),
      vw: document.documentElement.clientWidth,
      vh: document.documentElement.clientHeight,
    };
  });
}

/** The hero's decision with nothing over the Table: the layout checks of this spec. */
async function checkTable(page: Page, when: string): Promise<void> {
  const m = await rows(page);
  // §12.3: the rows around the table keep their heights at Large, so the table box is the one
  // the seat geometry was computed for (tests/e2e/layout.spec.ts checks the same at Normal).
  expect(fmt(m.table), `${when}: the table box`).toBe(fmt(tableFrame({ w: m.vw, h: m.vh }).box));
  expect(await rowAProblems(page), when).toEqual([]);
  const metrics = await pageMetrics(page);
  expect(metrics.nodes, `${when}: §15.3 DOM nodes`).toBeLessThanOrEqual(600);
  expect([metrics.scrollX, metrics.scrollY], `${when}: the page does not scroll`).toEqual([0, 0]);
}

/** The ::after of the rankings row of `category` (the collection moment's pulse) and its ring. */
const momentStyle = (page: Page, category: string) =>
  page.evaluate((category) => {
    const row = document.querySelector(`li[data-category="${category}"]`);
    if (row === null) return null;
    const after = getComputedStyle(row, '::after');
    return {
      collected: row.hasAttribute('data-collected'),
      ring: getComputedStyle(row).outlineStyle,
      // The CSS module's keyframes name is `_pulse_<hash>`.
      pulse: after.display !== 'none' && /pulse/.test(after.animationName),
    };
  }, category);

test.describe('Settings complete (chunk 9.1b)', () => {
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(sizeOf(testInfo) !== '360x740', 'Large text on the narrowest phone of §17.5');
  });

  test('Large text keeps the Table usable at 360×740; a first Flush is a collection moment', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await scriptedTable(page, 'beginner');
    await playTo(page, 'preflop');
    await checkTable(page, 'Normal, preflop');

    // Settings from the Table's Menu: Display → Text size → Large.
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    const large = page
      .getByRole('group', { name: 'Text size' })
      .getByRole('radio', { name: 'Large' });
    await large.click();
    await expect(large).toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-text', 'large');
    // 16 px × 1.15 (WebKit rounds it to 18.399999 px).
    const rootPx = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
    expect(parseFloat(rootPx)).toBeCloseTo(18.4, 2);
    // Saved with the settings (250 ms later, §14.2), so a reload keeps it.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              JSON.parse(localStorage.getItem('pc.v1.profile') ?? '{}') as {
                settings?: { textSize?: string };
              }
            ).settings?.textSize,
        ),
      )
      .toBe('large');
    await page.getByRole('button', { name: 'Back' }).click();
    await expect.poll(() => pcState(page).then((s) => s.ui.screen)).toBe('table');

    // The Table's words grew (Row A: 17 px × 1.15), its layout did not.
    const rowA = await slot(page, 'middle').evaluate((b) => getComputedStyle(b).fontSize);
    expect(parseFloat(rowA)).toBeCloseTo(19.55, 2);
    await checkTable(page, 'Large, preflop');

    // On to the river, facing the small blind's minimum bet with the nut flush.
    await playTo(page, 'river');
    await checkTable(page, 'Large, river');
    // Raise ▲ opens the sizing tray above Row A; Row A then reads "Raise to …".
    // (A tap within 250 ms of the last action is ignored, §12.7: tapped again until it opens.)
    const right = slot(page, 'right');
    await expect(async () => {
      if ((await right.getAttribute('aria-expanded')) !== 'true') await right.click();
      await expect(right).toHaveAttribute('aria-expanded', 'true', { timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
    await expect(right).toContainText('Raise to');
    expect(await rowAProblems(page), 'Large, the tray open').toEqual([]);
    // Confirms the raise; the small blind calls, and the hand goes on to the showdown.
    const before = await inputCount(page);
    await right.click();
    await expect.poll(() => inputCount(page)).toBeGreaterThan(before);

    // The showdown: the nut flush wins, and Flush is new in the collection.
    const toast = page.getByRole('button', { name: 'New in your collection: Flush!' });
    for (let i = 0; i < 10 && (await toast.count()) === 0; i++) {
      const point = await nextPoint(page);
      if (point === 'feedback') await page.getByRole('button', { name: 'Keep my move' }).click();
      else if (point === 'hero') await tapAct(page, 'middle');
      else if (point === 'end') break;
    }
    await expect(toast).toBeVisible({ timeout: 15_000 });
    // Stop the clock: the toast (4 s) and the moment stay while the rows are checked.
    await pauseClock(page);
    await closeSummary(page);

    // The rankings drawer: the Flush row is ringed and pulses once.
    await page.getByRole('button', { name: 'Show all poker hands' }).first().click();
    await expect(page.locator('li[data-category="flush"][data-collected]')).toBeVisible();
    expect(await momentStyle(page, 'flush')).toEqual({
      collected: true,
      ring: 'solid',
      pulse: true,
    });
    expect(await page.locator('li[data-collected]').count()).toBe(1);
    // Reduced motion (the system's choice): the ring stays, no pulse.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await momentStyle(page, 'flush')).toEqual({
      collected: true,
      ring: 'solid',
      pulse: false,
    });
    // The setting "Off" wins over the system's choice, "On" wins without it (§12.8).
    await page.evaluate(() =>
      window.__pc?.dispatch({ type: 'settings', patch: { reduceMotion: 'off' } }),
    );
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'full');
    expect((await momentStyle(page, 'flush'))?.pulse).toBe(true);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() =>
      window.__pc?.dispatch({ type: 'settings', patch: { reduceMotion: 'on' } }),
    );
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
    expect(await momentStyle(page, 'flush')).toEqual({
      collected: true,
      ring: 'solid',
      pulse: false,
    });

    // The moment ends with its toast; the Flush is in the stored collection, so it never comes again.
    await page.clock.runFor(5_000);
    await expect(toast).toHaveCount(0);
    await expect(page.locator('li[data-collected]')).toHaveCount(0);
    const first = await page.evaluate(
      () =>
        (
          JSON.parse(localStorage.getItem('pc.v1.profile') ?? '{}') as {
            stats: { collection: Record<string, { count: number; first: string | null }> };
          }
        ).stats.collection.flush,
    );
    expect(first?.count).toBe(1);
    expect(first?.first ?? null).not.toBeNull();
  });
});
