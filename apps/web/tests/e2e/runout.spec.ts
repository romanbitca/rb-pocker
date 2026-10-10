import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import {
  collectErrors,
  installLeakWatch,
  keepMove,
  leakViolations,
  nextFlowPoint,
  seedFor,
  sizeOf,
  slot,
  startTable,
  tapNextHand,
} from './game.ts';

/**
 * All-in TV mode on a real build (PLAN §7.6, §12.9; chunk 4.7): the hero moves all in before the
 * flop until a bot calls. Then every face-up hand gets an equity bar (and no hidden seat does),
 * inside the viewport; at the hand end the bars go and the banner has the luck line exactly when
 * §7.6 says so. Screenshots of both moments are attached. A phone and a desktop size.
 */

interface Snapshot {
  handSeq: number;
  runout: boolean;
  /** Live seats in `hand.revealed`. */
  faceUp: number[];
  allIn: { handSeq: number; seats: number[]; perPlayer: number[]; final: boolean } | null;
  heroPayout: number;
  mainWinners: number[];
}

const snapshot = (page: Page): Promise<Snapshot> =>
  page.evaluate(() => {
    const s = window.__pc?.state() as unknown as {
      game: {
        hand: {
          handSeq: number;
          runout: boolean;
          revealed: number[];
          seats: { folded: boolean; dealtIn: boolean }[];
          result: { payouts: number[]; potWinners: number[][] } | null;
        };
      };
      equity: { allIn: Snapshot['allIn'] };
    };
    const h = s.game.hand;
    return {
      handSeq: h.handSeq,
      runout: h.runout,
      faceUp: h.runout
        ? h.revealed.filter((i) => h.seats[i]?.dealtIn === true && h.seats[i]?.folded === false)
        : [],
      allIn: s.equity.allIn,
      heroPayout: h.result?.payouts[0] ?? 0,
      mainWinners: h.result?.potWinners[0] ?? [],
    };
  });

const setSpeed = (page: Page, speed: 'normal' | 'instant') =>
  page.evaluate((speed) => window.__pc?.dispatch({ type: 'settings', patch: { speed } }), speed);

/** All in through the visible buttons: the right button, the "All-in" chip, then confirm. */
async function shove(page: Page): Promise<void> {
  const right = slot(page, 'right');
  await right.click();
  const trayId = await right.getAttribute('aria-controls');
  if (trayId === null) return; // a one-tap "All-in 1,980" button: done
  await page.locator(`[id="${trayId}"] button[aria-label^="All your chips"]`).click();
  await right.click();
}

/** Taps the banner (or Reload when out of chips) at Instant speed: on to the next hand. */
async function nextHand(page: Page, point: string): Promise<void> {
  await setSpeed(page, 'instant');
  if (point === 'bust') {
    await page
      .locator('[role="dialog"] button, [role="alertdialog"] button', { hasText: /^Reload/ })
      .click();
  } else {
    await tapNextHand(page);
  }
}

/** §7.6: the start of the luck line the banner should show for this hand, or null. */
function expectedLuck(s: Snapshot): string | null {
  const a = s.allIn;
  if (a === null || a.handSeq !== s.handSeq || !a.final) return null;
  const i = a.seats.indexOf(0);
  if (i < 0) return null;
  const pct = Math.round((a.perPlayer[i] ?? 0) * 100);
  if (s.heroPayout === 0 && pct >= 60) return `You had ${pct}% when the chips went in.`;
  if (s.mainWinners.length === 1 && s.mainWinners[0] === 0 && pct <= 35) {
    return `You got lucky. You had ${pct}%.`;
  }
  return null;
}

async function attach(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

test('all-in TV mode: a bar for every face-up hand, then the luck line rule', async ({
  page,
}, testInfo) => {
  test.skip(!['375x667', '1280x800'].includes(sizeOf(testInfo)), 'a phone and a desktop');
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await startTable(page, seedFor(testInfo), { players: 6, speed: 'instant' });
  await installLeakWatch(page);

  let seen = false;
  for (let hands = 0; hands < 30 && !seen; hands++) {
    // Instant play up to the hero's first turn, then Normal speed so the run-out takes its time.
    const point = await nextFlowPoint(page);
    if (point !== 'hero') {
      await nextHand(page, point);
      continue;
    }
    await setSpeed(page, 'normal');
    await shove(page);
    const outcome = async (): Promise<string> =>
      (
        await page.waitForFunction(
          () => {
            const g = (
              window.__pc?.state() as unknown as {
                game: { mode: string; hand: { runout: boolean; revealed: number[] } };
              }
            ).game;
            if (g.mode === 'handEnd' || g.mode === 'heroTurn') return 'stop';
            // A mistake's feedback card (Stage 6) holds the hand until Keep my move.
            if (g.mode === 'feedback') return 'feedback';
            return g.hand.runout && g.hand.revealed.includes(0) ? 'runout' : null;
          },
          undefined,
          { timeout: 60_000 },
        )
      ).jsonValue() as Promise<string>;
    let result = await outcome();
    for (let cards = 0; result === 'feedback' && cards < 5; cards++) {
      await keepMove(page);
      result = await outcome();
    }
    if (result !== 'runout') {
      await nextHand(page, await nextFlowPoint(page));
      continue;
    }
    seen = true;
    const s = await snapshot(page);
    // Every face-up hand gets its bar, and no other seat.
    const bars = page.locator('[data-runout-seat]');
    await expect(bars).toHaveCount(s.faceUp.length);
    const barSeats = await bars.evaluateAll((els) =>
      els.map((el) => Number(el.getAttribute('data-runout-seat'))),
    );
    expect(barSeats.sort()).toEqual([...s.faceUp].sort());
    const viewport = page.viewportSize();
    for (const bar of await bars.all()) {
      const box = await bar.boundingBox();
      expect(box).not.toBeNull();
      if (box === null || viewport === null) continue;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      await expect(bar).toHaveAttribute('role', 'img');
      await expect(bar).toHaveAttribute('aria-label', /\d+% win chance$/);
    }
    await attach(page, testInfo, `tv-mode-${sizeOf(testInfo)}`);

    // The hand end: the bars go, and the banner has the luck line exactly when §7.6 says so.
    const end = await nextFlowPoint(page);
    expect(end === 'end' || end === 'bust').toBe(true);
    await expect(bars).toHaveCount(0);
    // The all-in number may land a moment after the banner.
    await page
      .waitForFunction(
        () =>
          (window.__pc?.state() as unknown as { equity: { allIn: { final: boolean } | null } })
            .equity.allIn?.final === true,
        undefined,
        { timeout: 5_000 },
      )
      .catch(() => {});
    const luck = expectedLuck(await snapshot(page));
    if (end === 'end') {
      const banner = page.locator('[data-hand-end]');
      if (luck === null) await expect(banner).not.toContainText('when the chips went in');
      else await expect(banner).toContainText(luck);
      await attach(page, testInfo, `tv-mode-end-${sizeOf(testInfo)}`);
    }
  }
  expect(seen, 'a run-out with the hero in it').toBe(true);
  expect(await leakViolations(page)).toEqual([]);
  expect(errors).toEqual([]);
});
