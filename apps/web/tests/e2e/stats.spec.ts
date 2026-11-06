import type { Page } from '@playwright/test';
import { volumeStorage } from '../helpers/statsVolume.ts';
import { expect, test } from './fixtures.ts';
import { newTable, openApp, pcState, playHands, prng, seedFor, sizeOf } from './game.ts';

// PLAN §18 Stage 8 (chunk 8.2): acceptance 3, first half (play 5 hands, reload: Stats shows exactly
// 5 hands) and 4b, the Stats part (3 hands, New table, 3 more: 6), through the real Stats screen;
// History opens a stored hand in Review after a reload; and §14.9: with 10,000 hands stored the
// Stats screen renders in under 300 ms at 6× CPU (Chromium: CDP throttling).

/** Hands the store's stats have counted (the profile's, §14.4). */
const counted = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const s = window.__pc?.state().stats;
    return s === null || s === undefined ? -1 : s.results.clean.hands + s.results.practice.hands;
  });

/** Home → Stats → Results: the "Hands" row and the practice line. */
async function resultsFromHome(page: Page): Promise<{ hands: string; practice: string }> {
  await page.getByRole('button', { name: 'Stats', exact: true }).click();
  await page.getByRole('radio', { name: 'Results', exact: true }).click();
  const hands = page.locator('[data-stat="hands"] dd');
  await expect(hands).toBeVisible();
  return {
    hands: await hands.innerText(),
    practice: await page.locator('[data-stat="practice"]').innerText(),
  };
}

/** Back on Home after a reload (the game boots and shows Home: a profile is stored). */
async function reloadHome(page: Page): Promise<void> {
  await page.reload();
  await page.waitForFunction(() => {
    const s = window.__pc?.state();
    return s !== undefined && s.game.mode !== 'booting' && s.ui.screen === 'home';
  });
}

test.describe('stats', () => {
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(
      !['390x844', '844x390', '1280x800'].includes(sizeOf(testInfo)),
      'a phone, landscape and a wide screen per browser',
    );
  });

  test('acceptance 3: play 5 hands, reload: Stats shows exactly 5 hands', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await page.clock.install();
    const seed = seedFor(testInfo, 'stats');
    await openApp(page, seed);
    await newTable(page, { players: 4 });
    await playHands(page, { hands: 5, random: prng(seed), fast: true });
    // The fifth hand is committed (the sixth is dealt and in play, not counted).
    await expect.poll(() => counted(page)).toBe(5);

    await reloadHome(page);
    expect(await resultsFromHome(page)).toEqual({
      hands: '5',
      practice: 'Practice hands (used Undo): 0, not counted above.',
    });

    // History: the five hands, newest first; the oldest opens in Review (from storage).
    await page.getByRole('radio', { name: 'History', exact: true }).click();
    const rows = page.locator('[data-history-hand]');
    await expect(rows).toHaveCount(5);
    const seqs = await rows.evaluateAll((els) =>
      els.map((e) => Number(e.getAttribute('data-history-hand'))),
    );
    expect(seqs).toEqual([...seqs].sort((a, b) => b - a));
    await rows.last().click();
    await expect(page.locator('[data-review]')).toBeVisible();
    const s = await pcState(page);
    expect(s.ui.screen).toBe('review');
    await page.getByRole('button', { name: 'Back' }).first().click();
    await expect(page.locator('[data-stats]')).toBeVisible();
  });

  test('acceptance 4b: 3 hands, New table, 3 more: Stats shows 6', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.clock.install();
    const seed = seedFor(testInfo, 'stats-4b');
    await openApp(page, seed);
    await newTable(page, { players: 4 });
    const random = prng(seed);
    // The New table starts at the third hand's banner, before another hand is dealt (a hand in
    // play would be folded and counted too, §3.1).
    let played = 0;
    const table = async () => {
      played++;
      if (played === 3) await newTable(page, { players: 3 });
    };
    await playHands(page, { hands: 3, random, fast: true, onHandEnd: table });
    await playHands(page, { hands: 3, random, fast: true });
    await expect.poll(() => counted(page)).toBe(6);

    // Through the Table's Menu this time.
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('button', { name: 'Stats', exact: true }).click();
    await page.getByRole('radio', { name: 'Results', exact: true }).click();
    await expect(page.locator('[data-stat="hands"] dd')).toHaveText('6');
  });
});

test.describe('stats volume (§14.9)', () => {
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium-phone-390x844',
      'CPU throttling is Chromium DevTools; one phone size',
    );
  });

  test('10,000 hands stored: Stats renders in under 300 ms at 6× CPU', async ({ page }) => {
    test.setTimeout(120_000);
    const { storage } = volumeStorage();
    const keys = Object.fromEntries(storage.data);
    await page.addInitScript((stored: Record<string, string>) => {
      if (sessionStorage.getItem('stats-volume') !== null) return;
      sessionStorage.setItem('stats-volume', '1');
      localStorage.clear();
      for (const [k, v] of Object.entries(stored)) localStorage.setItem(k, v);
    }, keys);
    await page.goto('/');
    await page.waitForFunction(() => window.__pc?.state().ui.screen === 'home');

    // Once to load the lazy chunk (precached in a real install), then the measured opens.
    const open = page.getByRole('button', { name: 'Stats', exact: true });
    await open.click();
    await expect(page.locator('[data-stat="scoreSession"]')).toBeVisible();
    await page.getByRole('button', { name: 'Back' }).first().click();

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
    /** From the tap to the first frame that shows the page (`selector`), in the page's clock. */
    const timed = (tap: string, selector: string): Promise<number> =>
      page.evaluate(
        ({ tap, selector }) =>
          new Promise<number>((resolve) => {
            const button = [...document.querySelectorAll('button, label')].find(
              (b) => b.textContent === tap,
            ) as HTMLElement | undefined;
            if (button === undefined) throw new Error(`no ${tap}`);
            const t0 = performance.now();
            button.click();
            const check = (): void => {
              if (document.querySelector(selector) === null) {
                requestAnimationFrame(check);
                return;
              }
              requestAnimationFrame(() => resolve(performance.now() - t0));
            };
            check();
          }),
        { tap, selector },
      );
    const progress = await timed('Stats', '[data-stat="scoreSession"]');
    const results = await timed('Results', '[data-stat="hands"]');
    const hands = await timed('Hands', '[data-category="highCard"]');
    const history = await timed('History', '[data-history-hand]');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await cdp.detach();
    console.info(
      `Stats at 6× CPU with 10,000 hands: Progress ${progress.toFixed(0)} ms, Results ${results.toFixed(0)} ms, Hands ${hands.toFixed(0)} ms, History ${history.toFixed(0)} ms`,
    );
    expect(progress).toBeLessThan(300);
    expect(results).toBeLessThan(300);
    expect(hands).toBeLessThan(300);
    expect(history).toBeLessThan(300);
    expect((await pcState(page)).ui.screen).toBe('stats');
  });

  // R21: every hand's commit rewrites the ring (100 records) and the profile. How long does that
  // take on the main thread, with the 10,000-hand storage and a 9-seat table, unthrottled and at 6×
  // CPU? The controller times the protocol (its 'commit' trace, `ms`); a wrapper around JSON and
  // the storage calls splits it by key. Report-only, like the §15.3 timings (the numbers go to R21).
  test('R21: the hand-end commit with a full ring, unthrottled and at 6× CPU', async ({ page }) => {
    test.setTimeout(180_000);
    const { storage } = volumeStorage();
    const keys = Object.fromEntries(storage.data);
    // No saved game: Play deals a new 9-seat table, numbered after the 10,000 counted hands.
    delete keys['pc.v1.session'];
    for (const key of ['pc.v1.profile', 'pc.v1.profile.bak']) {
      const p = JSON.parse(keys[key] as string) as { settings: Record<string, unknown> };
      p.settings = {
        ...p.settings,
        players: 9,
        seatLevels: new Array<null>(9).fill(null),
        speed: 'instant',
        autoNext: false,
      };
      keys[key] = JSON.stringify(p);
    }
    await page.addInitScript((stored: Record<string, string>) => {
      if (sessionStorage.getItem('r21') === null) {
        sessionStorage.setItem('r21', '1');
        localStorage.clear();
        for (const [k, v] of Object.entries(stored)) localStorage.setItem(k, v);
      }
      // Times every storage call and every JSON call over 2,000 characters, in order.
      type Io = { op: string; key: string; ms: number; n: number };
      const io: Io[] = [];
      (window as unknown as { __io: Io[] }).__io = io;
      const { stringify, parse } = JSON;
      const timed = <T>(op: string, key: string, n: () => number, run: () => T): T => {
        const t = performance.now();
        const out = run();
        const ms = performance.now() - t;
        if (op.endsWith('Item') || n() > 2000) io.push({ op, key, ms, n: n() });
        return out;
      };
      JSON.stringify = ((...args: Parameters<typeof stringify>) => {
        let out = '';
        return timed(
          'stringify',
          '',
          () => out.length,
          () => (out = stringify(...args)),
        );
      }) as typeof JSON.stringify;
      JSON.parse = ((text: string, reviver?: Parameters<typeof parse>[1]) =>
        timed(
          'parse',
          '',
          () => text.length,
          () => parse(text, reviver),
        )) as typeof JSON.parse;
      const { setItem, getItem } = Storage.prototype;
      Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
        timed(
          'setItem',
          key,
          () => value.length,
          () => setItem.call(this, key, value),
        );
      };
      Storage.prototype.getItem = function (this: Storage, key: string) {
        let out: string | null = null;
        return timed(
          'getItem',
          key,
          () => out?.length ?? 0,
          () => (out = getItem.call(this, key)),
        );
      };
    }, keys);
    await page.goto('/');
    await page.waitForFunction(() => window.__pc?.state().ui.screen === 'home');
    await page.getByRole('button', { name: 'Play', exact: true }).click();

    /** Plays one hand to its end; returns the commit's time and the storage work inside it. */
    const oneHand = async (label: string) => {
      const before = await page.evaluate(
        () => (window as unknown as { __io: unknown[] }).__io.length,
      );
      await playHands(page, { hands: 1, random: prng(label.padEnd(32, '0')) });
      await expect
        .poll(() =>
          page.evaluate(
            () => window.__pc?.logs().events.filter((e) => e.what === 'commit').length ?? 0,
          ),
        )
        .toBeGreaterThan(label === 'unthrottled' ? 0 : 1);
      return page.evaluate((from) => {
        const commit = (window.__pc?.logs().events ?? []).filter((e) => e.what === 'commit').at(-1);
        const io = (
          window as unknown as { __io: { op: string; key: string; ms: number; n: number }[] }
        ).__io.slice(from);
        // The protocol's own calls: from its read of the profile to its write of the session.
        const end = io.findLastIndex((x) => x.op === 'setItem' && x.key === 'pc.v1.hands');
        let start = end;
        while (start > 0 && !(io[start]?.op === 'getItem' && io[start]?.key === 'pc.v1.profile'))
          start--;
        let stop = end;
        while (
          stop < io.length - 1 &&
          !(io[stop]?.op === 'setItem' && io[stop]?.key === 'pc.v1.session')
        )
          stop++;
        const part = io.slice(start, stop + 1);
        const sum = (f: (x: (typeof part)[number]) => boolean) =>
          Math.round(part.filter(f).reduce((t, x) => t + x.ms, 0) * 10) / 10;
        return {
          detail: commit?.detail as { status: string; ms: number },
          json: sum((x) => x.op === 'stringify' || x.op === 'parse'),
          storage: sum((x) => x.op.endsWith('Item')),
          calls: part.map((x) => `${x.op} ${x.key} ${x.n} ${x.ms.toFixed(1)}`),
        };
      }, before);
    };

    const plain = await oneHand('unthrottled');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
    const slow = await oneHand('6x');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await cdp.detach();
    for (const [name, r] of [
      ['unthrottled', plain],
      ['6× CPU', slow],
    ] as const) {
      console.info(
        `R21 commit, ${name}: ${r.detail.ms} ms (${r.detail.status}); JSON ${r.json} ms, storage calls ${r.storage} ms\n  ${r.calls.join('\n  ')}`,
      );
    }
    expect(plain.detail.status).toBe('committed');
    expect(slow.detail.status).toBe('committed');
  });
});
