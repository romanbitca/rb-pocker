import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import {
  collectErrors,
  newTable,
  nextFlowPoint,
  openApp,
  pcState,
  playHands,
  prng,
  reloadAfterBust,
  seedFor,
  sizeOf,
  slot,
  tapNextHand,
} from './game.ts';
import {
  feedbackCard,
  gameMode,
  pauseClock,
  playTo,
  scriptedTable,
  tapAct,
  TAP_GUARD_MS,
} from './scripted.ts';

// The phone QA findings of 1.3.86 (branch `fix/phone-qa-layout`; PLAN §12.3, §12.5, §12.6,
// §12.11, §12.12, §13.5, §14.4):
// 1. No screen pans sideways on a 360 or 390 px phone, at both text sizes: Stats' chart tables were
//    visually hidden by a 1 px box that a table ignores, and the page was 467 px wide.
// 2. Landscape (844×390): the coach row shows its head, both win numbers and "Why?" without
//    scrolling (the number the coach decides by was under the column's edge).
// 3. On the Table a toast sits over the top bar, clear of the seats, the board, the hero's hand,
//    the coach and Row A (it covered the only opponent for 4 s); and (item 4) a second mistake at a
//    decision taken back once says why its Undo is grey.
// 5. Setup's bot-level selects are 44 px tall in WebKit too (25 px).
// 6. The drill's game button never cuts a game's name ("Name the …" at Large text, 360 px).

interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const heading = (page: Page): Locator => page.getByRole('heading', { level: 1 });
const button = (page: Page, name: string | RegExp): Locator =>
  page.getByRole('button', { name, exact: typeof name === 'string' });

/** Text size Large or Normal (Settings → Display, §12.12), as the setting does it. */
async function textSize(page: Page, size: 'normal' | 'large'): Promise<void> {
  await page.evaluate((textSize) => {
    window.__pc?.dispatch({ type: 'settings', patch: { textSize } });
  }, size);
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize))
    .toBe(size === 'large' ? '18.4px' : '16px');
}

/**
 * Item 1: the page is no wider than the window, so it cannot be panned sideways (the QA swiped
 * Stats 107 px to the left at 360 px).
 */
async function noSidewaysPan(page: Page, where: string): Promise<void> {
  const m = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    vw: window.innerWidth,
  }));
  expect(
    m.doc,
    `${where}: the page is ${m.doc} px wide in a ${m.vw} px window`,
  ).toBeLessThanOrEqual(m.vw);
  expect(m.body, `${where}: the body is ${m.body} px wide`).toBeLessThanOrEqual(m.vw);
}

/** Opens a screen as its button or link would (the store's own navigation) and waits for it. */
async function go(page: Page, screen: string, title: string | RegExp): Promise<void> {
  await page.evaluate((screen) => {
    window.__pc?.dispatch({ type: 'go', screen });
  }, screen);
  await expect(heading(page)).toHaveText(title);
}

test.describe('no screen pans sideways on a phone (item 1)', () => {
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(
      !['360x740', '390x844'].includes(sizeOf(testInfo)),
      'the narrow phones of the QA pass (WebKit 360 and 390, Chromium 360), both browsers',
    );
  });

  test('every screen, Stats with its charts, at both text sizes: scrollWidth ≤ innerWidth', async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    const errors = collectErrors(page);
    await page.clock.install();
    const seed = seedFor(testInfo, 'no-pan');
    await openApp(page, seed);
    // The first launch: Welcome.
    await expect(button(page, 'Play')).toBeVisible();
    await noSidewaysPan(page, 'Welcome');

    // Five hands (Stats' charts need five), with a look at the Table at the hero's turn.
    await newTable(page, { players: 6 });
    expect(await nextFlowPoint(page, true)).not.toBe('bust');
    await noSidewaysPan(page, 'Table');
    await playHands(page, { hands: 5, random: prng(seed), fast: true });
    // A fifth hand lost all-in leaves "You're out of chips" over the Table.
    if ((await pcState(page)).ui.overlays.includes('outOfChips')) await reloadAfterBust(page);

    // Leave table: Home with "This session: …" (the toast that was cut off on the right).
    await button(page, 'Menu').click();
    await button(page, 'Leave table').click();
    await expect(button(page, 'Play')).toBeVisible();
    await expect(page.getByText(/^This session: /)).toBeVisible();
    await noSidewaysPan(page, 'Home with the session toast');

    for (const size of ['normal', 'large'] as const) {
      await textSize(page, size);
      const at = (where: string) => `${where} (${size} text)`;
      await go(page, 'home', /./);
      await expect(button(page, 'Play')).toBeVisible();
      await noSidewaysPan(page, at('Home'));

      // Stats: its four pages; Progress has the two charts and their hidden tables.
      await button(page, 'Stats').click();
      await expect(heading(page)).toHaveText('Stats');
      await page.getByRole('radio', { name: 'Progress', exact: true }).click();
      await expect(page.locator('[data-chart="score"]')).toBeVisible();
      await expect(page.getByRole('table')).toHaveCount(2);
      for (const tab of ['Progress', 'Results', 'Hands', 'History']) {
        await page.getByRole('radio', { name: tab, exact: true }).click();
        await expect(page.getByRole('radio', { name: tab, exact: true })).toBeChecked();
        await noSidewaysPan(page, at(`Stats: ${tab}`));
      }
      // Review, from History.
      await page.locator('[data-history-hand]').first().click();
      await expect(page.locator('[data-review]')).toBeVisible();
      await noSidewaysPan(page, at('Review'));

      await go(page, 'settings', 'Settings');
      await noSidewaysPan(page, at('Settings'));
      await go(page, 'about', 'About');
      await noSidewaysPan(page, at('About'));
      await go(page, 'setup', 'Set up your table');
      await button(page, 'More options').click();
      await expect(page.getByRole('group', { name: "Set each bot's level" })).toBeVisible();
      await noSidewaysPan(page, at('Setup, More options open'));
      await go(page, 'learn', 'Learn');
      await noSidewaysPan(page, at('Learn'));
      await button(page, 'Lesson 4: Which hand wins').click();
      await expect(heading(page)).toHaveText('Which hand wins');
      await noSidewaysPan(page, at('Learn: a lesson'));
      await go(page, 'handRankings', 'Poker hands');
      await noSidewaysPan(page, at('Poker hands'));
      await go(page, 'glossary', 'Glossary');
      await noSidewaysPan(page, at('Glossary'));
      await go(page, 'drill', 'Hand drill');
      await expect(page.locator('[data-question]')).toHaveCount(1);
      await noSidewaysPan(page, at('Hand drill'));

      // The Table again (Home's Play resumes the saved hand).
      await go(page, 'home', /./);
      await button(page, 'Play').click();
      await expect(page.locator('main[data-layout]')).toBeVisible();
      await noSidewaysPan(page, at('Table'));
      await button(page, 'Menu').click();
      await button(page, 'Leave table').click();
      await expect(button(page, 'Play')).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
});

/**
 * Item 2: the boxes of the landscape coach row and of the column part that scrolls around it, at
 * the hero's turn with the advice on show.
 */
function readCoachRow(): {
  text: string;
  scroller: Box;
  scrollable: number;
  scrolled: number;
  parts: { name: string; box: Box }[];
} | null {
  const strip = document.querySelector('aside [data-coach-strip="advice"]');
  if (strip === null) return null;
  const box = (el: Element): Box => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  };
  let scroller = strip.parentElement;
  while (scroller !== null && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) {
    scroller = scroller.parentElement;
  }
  if (scroller === null) return null;
  const parts: { name: string; box: Box }[] = [];
  const advice = strip.querySelector('[data-coach-advice]');
  if (advice !== null) {
    parts.push({ name: 'the advice', box: box(advice) });
    const line = advice.lastElementChild;
    if (line !== null) parts.push({ name: 'the win numbers', box: box(line) });
  }
  const why = strip.querySelector(':scope > button:not([data-coach-advice])');
  if (why !== null) parts.push({ name: '"Why?"', box: box(why) });
  const undo = document.querySelector('aside [data-undo]');
  if (undo !== null) parts.push({ name: 'Undo', box: box(undo) });
  return {
    text: (strip as HTMLElement).innerText,
    scroller: box(scroller),
    scrollable: scroller.scrollHeight - scroller.clientHeight,
    scrolled: scroller.scrollTop,
    parts,
  };
}

test.describe('landscape: the coach row (item 2)', () => {
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(sizeOf(testInfo) !== '844x390', 'the landscape phone of §17.5');
  });

  test('Intermediate, Hard bots, 6 players: after "Hint" the head, both numbers and "Why?" show without scrolling', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    // The QA's table: hand 1's flop is the labelled pair "Any cards: 29%. Their likely hands:
    // about 10%." beside a price chip and a draw chip, the fullest column there is.
    await openApp(page, '1a7d0002');
    await page.evaluate(() => {
      window.__pc?.dispatch({
        type: 'settings',
        patch: { speed: 'instant', autoNext: false, coachLevel: 'intermediate', botLevel: 'hard' },
      });
      window.__pc?.dispatch({
        type: 'newTable',
        setup: { players: 6, coachLevel: 'intermediate', botLevel: 'hard' },
        confirmed: true,
      });
    });
    let checked = 0;
    let pairs = 0;
    for (let points = 0; points < 60 && (checked < 6 || pairs === 0); points++) {
      const point = await nextFlowPoint(page);
      if (point === 'bust') {
        await reloadAfterBust(page);
        continue;
      }
      if (point === 'end') {
        await tapNextHand(page);
        continue;
      }
      // The hero's turn: "Hint" once it is ready (unless this decision's advice shows already),
      // then the advice.
      const advice = page.locator('aside [data-coach-strip="advice"]');
      if ((await advice.count()) === 0) {
        const hint = page.locator('aside [data-coach-hint]:not([aria-disabled="true"])');
        await expect(hint).toBeVisible({ timeout: 15_000 });
        await hint.click();
      }
      await expect(advice).toBeVisible();
      const row = await page.evaluate(readCoachRow);
      if (row === null) throw new Error('no coach row in the column');
      const where = `"${row.text.replace(/\n+/g, ' / ')}"`;
      expect(row.scrolled, `${where}: the column has not been scrolled`).toBe(0);
      expect(row.scrollable, `${where}: nothing to scroll to`).toBeLessThanOrEqual(1);
      for (const { name, box } of row.parts) {
        expect(box.top, `${where}: ${name} starts in sight`).toBeGreaterThanOrEqual(
          row.scroller.top - 0.5,
        );
        expect(box.bottom, `${where}: ${name} ends in sight`).toBeLessThanOrEqual(
          row.scroller.bottom + 0.5,
        );
      }
      checked++;
      if (/likely hands|alone/.test(row.text)) pairs++;
      // Call or check (again if the bar's 250 ms guard dropped the tap), and on.
      await tapAct(page, 'middle');
    }
    expect(checked).toBeGreaterThanOrEqual(6);
    expect(pairs, 'a decision with the labelled pair of win numbers was checked').toBeGreaterThan(
      0,
    );
    expect(errors).toEqual([]);
  });
});

test.describe('toasts on the Table; a grey Undo says why (items 3 and 4)', () => {
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(
      !['360x740', '844x390'].includes(sizeOf(testInfo)),
      'the QA phone and the landscape phone',
    );
  });

  test('"Move taken back…" sits over the top bar: no seat, board, hand, coach or Row A under it', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    // The scripted table (scripted.ts): the hero folds the nut flush on the river, a Big mistake.
    await scriptedTable(page, 'beginner');
    await playTo(page, 'river');
    await pauseClock(page);
    await slot(page, 'fold').click();
    const card = await feedbackCard(page);
    await card.getByRole('button', { name: 'Undo: try again' }).click();
    await expect.poll(() => gameMode(page)).toBe('heroTurn');

    // The clock is paused: the toast stays while it is measured.
    const toast = button(page, 'Move taken back. The unseen cards were shuffled again.');
    await expect(toast).toBeVisible();
    const m = await page.evaluate(() => {
      const box = (el: Element) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      };
      const all = (selector: string) => [...document.querySelectorAll(selector)].map(box);
      const toast = [...document.querySelectorAll('[role="status"] button')].find((b) =>
        b.textContent?.startsWith('Move taken back'),
      );
      const bar = document.querySelector('main header');
      return {
        toasts: document.querySelectorAll('[role="status"] button').length,
        toast: toast === undefined ? null : box(toast),
        bar: bar === null ? null : box(bar),
        parts: {
          seats: [...document.querySelectorAll('[data-seat]')].flatMap((seat) =>
            [...seat.querySelectorAll('*')].map(box).filter((b) => b.bottom > b.top),
          ),
          board: all('[role="group"][aria-label="Board"]'),
          hand: all('[data-hero-cards]'),
          coach: all('[data-coach-strip]'),
          'Row A': all('[data-slot]'),
        },
      };
    });
    if (m.toast === null || m.bar === null) throw new Error('no toast or no top bar');
    const t = m.toast;
    expect(m.toasts, 'one toast at a time on the Table').toBe(1);
    // Over the top bar: from its top to its foot (36 px in landscape; 44 px in portrait).
    expect(t.top).toBeGreaterThanOrEqual(m.bar.top - 0.5);
    expect(t.bottom).toBeLessThanOrEqual(m.bar.bottom + 0.5);
    for (const [name, boxes] of Object.entries(m.parts)) {
      expect(boxes.length, `${name} on the page`).toBeGreaterThan(0);
      for (const b of boxes) {
        const apart =
          t.bottom <= b.top + 0.5 ||
          b.bottom <= t.top + 0.5 ||
          t.right <= b.left + 0.5 ||
          b.right <= t.left + 0.5;
        expect(apart, `the toast ${JSON.stringify(t)} clears ${name} ${JSON.stringify(b)}`).toBe(
          true,
        );
      }
    }

    // Item 4: the same mistake again; the card's Undo is grey, and its small print says why.
    await page.clock.runFor(TAP_GUARD_MS + 50);
    await slot(page, 'fold').click();
    const again = await feedbackCard(page);
    const undo = again.getByRole('button', { name: 'Undo: try again' });
    await expect(undo).toHaveAttribute('aria-disabled', 'true');
    const small = again.locator('[data-feedback-small]');
    await expect(small).toHaveText('You used Undo here already. Undo works once per decision.');
    await expect(again).not.toContainText('Undo lets you try again');
    await expect(undo).toHaveAttribute('aria-describedby', (await small.getAttribute('id')) ?? '');
    expect((await pcState(page)).game.feedback?.canUndo).toBe(false);
    expect(errors).toEqual([]);
  });
});

test.describe('Setup and the drill on a 360 px phone (items 5 and 6)', () => {
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(sizeOf(testInfo) !== '360x740', 'the QA phone, both browsers');
  });

  test('the bot-level selects are 44 px tall; every game name shows whole on the drill button', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    await openApp(page, seedFor(testInfo, 'setup-drill'));
    for (const size of ['normal', 'large'] as const) {
      await textSize(page, size);

      // Item 5 (§12.12): every control at least 44×44 px; WebKit drew its own 25 px menu list.
      await go(page, 'setup', 'Set up your table');
      const more = button(page, 'More options');
      if ((await more.getAttribute('aria-expanded')) !== 'true') await more.click();
      const selects = page.getByRole('group', { name: "Set each bot's level" }).locator('select');
      await expect(selects.first()).toBeVisible();
      expect(await selects.count()).toBeGreaterThan(0);
      for (const box of await selects.evaluateAll((els) =>
        els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect),
      )) {
        expect(box.height, `a bot-level select (${size} text)`).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.right).toBeLessThanOrEqual(360);
      }

      // Item 6 (§13.5): the game button shows each game's name whole (two lines where needed).
      await go(page, 'drill', 'Hand drill');
      for (const game of [
        'mixed',
        'cards',
        'holdem',
        'showdown',
        'versus',
        'order',
        'pos2name',
        'name2pos',
      ]) {
        await page.locator('[data-drill-games]').click();
        await page.locator(`[data-game="${game}"]`).click();
        await expect(page.getByRole('dialog', { name: 'Choose a game' })).toHaveCount(0);
        const name = page.locator('[data-drill-games] [data-drill-game-name]');
        const fit = await name.evaluate((el) => ({
          text: el.textContent,
          w: el.scrollWidth - el.clientWidth,
          h: el.scrollHeight - el.clientHeight,
          right: el.closest('button')?.getBoundingClientRect().right ?? 0,
        }));
        expect(fit.w, `"${fit.text}" fits its width (${size} text)`).toBeLessThanOrEqual(1);
        expect(fit.h, `"${fit.text}" fits its lines (${size} text)`).toBeLessThanOrEqual(1);
        expect(fit.right).toBeLessThanOrEqual(360);
      }
    }
    expect(errors).toEqual([]);
  });
});
