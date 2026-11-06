import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import {
  newTable,
  openApp,
  openSummary,
  pcState,
  playHands,
  prng,
  seedFor,
  sizeOf,
} from './game.ts';

// Chunk 8.4 in real browsers (PLAN §14.8, §10.4, Stage 8): Settings → Data with its real buttons
// (Export as a download, Reset stats with its "Delete my stats" dialog, Import through the file
// picker with its preview and Replace) gives back the same stats; and the level suggestion card
// shows from a stored fixture (300 winning Easy hands: "You beat Easy bots. Try Medium?"), on Stats
// → Progress and on the hand summary, and [Try Medium] changes the bot level. The commands are 8.3's
// (`data.spec.ts`); the unit tests are tests/app/controller.nudges.test.ts and the component tests.

interface Stored {
  profile: Record<string, unknown> & {
    rev: number;
    updatedAt: string;
    stats: { results: { clean: { hands: number }; practice: { hands: number } } };
    flags: { suggestionSnoozedUntil: Record<string, string | null>; iosInstall: boolean };
    settings: { botLevel: string };
  };
  hands: { handSeq: number }[];
}

const stored = (page: Page): Promise<Stored> =>
  page.evaluate(() => ({
    profile: JSON.parse(localStorage.getItem('pc.v1.profile') ?? 'null') as Stored['profile'],
    hands: (
      JSON.parse(localStorage.getItem('pc.v1.hands') ?? '{"hands":[]}') as {
        hands: { handSeq: number }[];
      }
    ).hands,
  }));

const counted = (s: Stored): number =>
  s.profile.stats.results.clean.hands + s.profile.stats.results.practice.hands;

/** From the Table: Menu → Settings, then down to the Data section. */
async function openSettings(page: Page): Promise<void> {
  // A hero who lost every chip in the last hand gets the out-of-chips dialog first (§3.1).
  if (await page.evaluate(() => window.__pc?.state().game.heroBust === true)) {
    await page.getByRole('button', { name: /^Reload / }).click();
  }
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await page.getByRole('heading', { name: 'Data', level: 2 }).scrollIntoViewIfNeeded();
  // The Data chunk loads when Settings opens, so Export's tap finds it (§14.8).
  await page.waitForFunction(() =>
    performance.getEntriesByType('resource').some((r) => r.name.includes('/dataTools-')),
  );
}

test.describe('Settings → Data and the level suggestion card', () => {
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(sizeOf(testInfo) !== '390x844', 'one phone size per browser');
  });

  test('Settings → Export → Reset stats → Import gives back the same profile and hands', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    // A browser that cannot share files: Export falls back to a download (§14.8).
    await page.addInitScript(() => {
      delete (Navigator.prototype as { share?: unknown }).share;
      delete (Navigator.prototype as { canShare?: unknown }).canShare;
    });
    const seed = seedFor(testInfo);
    await openApp(page, seed);
    await newTable(page, { players: 3 });
    await playHands(page, { hands: 3, random: prng(seed) });
    await openSettings(page); // off the Table: the game waits, nothing changes the stats
    const before = await stored(page);
    expect(counted(before)).toBe(3);
    await expect(
      page.getByText('Protected from automatic clean-up: ', { exact: false }),
    ).toBeVisible();

    // Export: the real button, a download named after the date.
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^rb-poker-coach-stats-\d{4}-\d{2}-\d{2}\.json$/);
    const file = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(file);

    // Reset stats: its dialog first; Cancel keeps everything.
    await page.getByRole('button', { name: 'Reset stats' }).click();
    const ask = page.getByRole('alertdialog', { name: 'Delete your stats?' });
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: 'Cancel' }).click();
    await expect(ask).toHaveCount(0);
    expect(counted(await stored(page))).toBe(3);
    await page.getByRole('button', { name: 'Reset stats' }).click();
    await page.getByRole('button', { name: 'Delete my stats' }).click();
    await expect(page.getByText('Your stats were deleted.')).toBeVisible();
    const reset = await stored(page);
    expect(counted(reset)).toBe(0);
    expect(reset.hands).toEqual([]);

    // Import: the browser's file picker, the preview, Replace.
    const choosing = page.waitForEvent('filechooser');
    // The button is a label with the file input laid over it: a tap opens the picker.
    await page
      .locator('label')
      .filter({ hasText: /^Import$/ })
      .click();
    const chooser = await choosing;
    await chooser.setFiles(file);
    const preview = page.getByRole('alertdialog', { name: 'Import stats' });
    await expect(preview).toContainText(/3 hands, exported \d{1,2} [A-Z][a-z]{2} \d{4}/);
    await preview.getByRole('button', { name: 'Replace' }).click();
    await expect(page.getByText('Your stats were imported.')).toBeVisible();
    await expect(preview).toHaveCount(0);
    const back = await stored(page);
    expect({
      ...back.profile,
      rev: before.profile.rev,
      updatedAt: before.profile.updatedAt,
    }).toEqual(before.profile);
    expect(back.hands).toEqual(before.hands);
  });

  test('the level suggestion card shows from a stored fixture; [Try Medium] changes the bot level', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const seed = seedFor(testInfo);
    await openApp(page, seed);
    await newTable(page, { players: 3 }); // writes the profile
    // The fixture: 300 clean hands against Easy bots at +50 bb/100 with a decision score of 90
    // (§10.4 "Bots up": ≥ +10 bb/100 and ≥ 80), as `stats.recentHands` (A.7) stores them.
    await page.evaluate(() => {
      const profile = JSON.parse(localStorage.getItem('pc.v1.profile') as string) as {
        stats: { recentHands: unknown[]; results: { clean: { hands: number } } };
        settings: { coachLevel: string };
      };
      // The 300 hands are counted too (the ring holds counted hands only), so Progress shows.
      profile.stats.results.clean.hands = 300;
      profile.stats.recentHands = Array.from({ length: 300 }, () => ({
        botLevel: 'easy',
        coachLevel: 'beginner',
        assisted: false,
        netMilliBB: 500,
        scorePoints: 90,
        graded: 1,
      }));
      profile.settings.coachLevel = 'beginner'; // a summary after every hand (§10.2)
      localStorage.setItem('pc.v1.profile', JSON.stringify(profile));
    });
    await openApp(page, seed);

    // Stats → Progress: the card first on the page (the answer waits for the summary below).
    await page.getByRole('button', { name: 'Stats', exact: true }).click();
    const onStats = page.getByRole('region', { name: 'You beat Easy bots. Try Medium?' });
    await expect(onStats).toBeVisible();
    await expect(onStats.getByRole('button', { name: 'Try Medium' })).toBeVisible();
    await page.getByRole('button', { name: 'Back', exact: true }).click();

    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect
      .poll(async () => (await pcState(page)).data.suggestion)
      .toEqual({ rule: 'botsUp', from: 'easy', to: 'medium' });

    // On the hand summary (Beginner has one after every hand with a decision; the banner's "Hand
    // summary" opens it, 1.3.92).
    let shown = false;
    await playHands(page, {
      hands: 4,
      random: prng(seed),
      onHandEnd: async () => {
        if (shown) return;
        if ((await page.locator('[data-hand-summary]').count()) === 0) return;
        await openSummary(page);
        const card = page.getByRole('region', { name: 'You beat Easy bots. Try Medium?' });
        await expect(card).toBeVisible();
        await expect(card.getByRole('button', { name: 'Not now' })).toBeVisible();
        await card.getByRole('button', { name: 'Try Medium' }).click();
        await expect(card).toHaveCount(0);
        shown = true;
      },
    });
    expect(shown, 'a hand summary showed the card').toBe(true);
    const state = await pcState(page);
    expect(state.settings.botLevel).toBe('medium');
    expect(state.data.suggestion).toBeNull();
    const saved = await stored(page);
    expect(saved.profile.settings.botLevel).toBe('medium');
    expect(saved.profile.flags.suggestionSnoozedUntil.botsUp).not.toBeNull();
    // The next hands are dealt at Medium (§10: from the next hand).
    expect((state.game.next ?? state.game.table)?.config.botLevel).toBe('medium');
  });

  test('the iOS Share tip on Home after the first finished session (WebKit plays an iPhone)', async ({
    page,
    browserName,
  }, testInfo) => {
    test.setTimeout(90_000);
    const seed = seedFor(testInfo);
    await openApp(page, seed);
    await newTable(page, { players: 3 });
    await playHands(page, { hands: 1, random: prng(seed) });
    await openSettings(page); // the out-of-chips dialog, if any, is answered on the way
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('button', { name: 'Leave table', exact: true }).click(); // §14.4: the session ends
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    const tip = page.getByRole('region', { name: /^Tip: add RB Poker Coach to your Home Screen/ });
    if (browserName !== 'webkit') {
      // Chromium plays an Android phone that offers no install here: no card.
      await expect(page.locator('[data-nudge]')).toHaveCount(0);
      return;
    }
    await expect(tip).toBeVisible();
    // The card sits under the buttons: Play is still the first button on the page.
    expect(await page.locator('button').first().textContent()).toBe('Play');
    await tip.getByRole('button', { name: 'Got it' }).click();
    await expect(tip).toHaveCount(0);
    expect((await stored(page)).profile.flags).toMatchObject({ iosInstall: true });
    await page.reload();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await expect(page.locator('[data-nudge]')).toHaveCount(0);
  });
});
