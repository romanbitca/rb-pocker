import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { newTable, openApp, playHands, prng, seedFor, sizeOf } from './game.ts';

// PLAN §14.8, §14.9 and Stage 8 acceptance 4b (chunk 8.3), in real browsers: Export through the
// share sheet (stubbed: a test cannot tap a native sheet) and through a download, Reset, Import of
// the downloaded file, and an imported profile that counted more hands than this table dealt.
// The Data section's buttons are chunk 8.4's: the commands are sent the way its buttons will send
// them, through the store (`window.__pc.dispatch`), and Export from a real tap. The unit tests are
// tests/app/controller.data.test.ts and tests/persist/transfer.test.ts.

interface Stored {
  profile: Record<string, unknown> & {
    rev: number;
    updatedAt: string;
    lastCommittedHandSeq: number;
    stats: { results: { clean: { hands: number }; practice: { hands: number } } };
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

/** Settings: a Data screen, so the Data chunk loads before the Export tap (§14.8). */
async function openSettings(page: Page): Promise<void> {
  await page.evaluate(() => window.__pc?.dispatch({ type: 'go', screen: 'settings' }));
  await page.waitForFunction(() =>
    performance.getEntriesByType('resource').some((r) => r.name.includes('/dataTools-')),
  );
}

/** A real tap that sends Export, as the Data section's button will (chunk 8.4). */
async function tapExport(page: Page): Promise<void> {
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.id = 'e2e-export';
    button.textContent = 'Export';
    button.style.cssText =
      'position:fixed;left:8px;bottom:8px;z-index:1000;width:120px;height:48px';
    button.addEventListener('click', () => window.__pc?.dispatch({ type: 'exportStats' }));
    document.body.append(button);
  });
  await page.click('#e2e-export');
}

/** Import's file picked and checked; then Replace (its confirmation is chunk 8.4's dialog). */
async function importText(page: Page, text: string): Promise<{ hands?: number }> {
  await page.evaluate(
    (t) => window.__pc?.dispatch({ type: 'importFile', file: new Blob([t]) }),
    text,
  );
  await page.waitForFunction(() => window.__pc?.state().data.importCheck?.status === 'ready');
  const check = await page.evaluate(() => window.__pc?.state().data.importCheck);
  await page.evaluate(() => window.__pc?.dispatch({ type: 'importConfirm' }));
  await expect(page.getByText('Your stats were imported.')).toBeVisible();
  return check ?? {};
}

const FILE_NAME = /^rb-poker-coach-stats-\d{4}-\d{2}-\d{2}\.json$/;

test.describe('Export, Import, Reset', () => {
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(sizeOf(testInfo) !== '390x844', 'one phone size per browser');
  });

  test('Stage 8 acceptance 4b: a profile that counted more hands than the table dealt; 1 hand → counted', async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    const seed = seedFor(testInfo);
    const random = prng(seed);
    await openApp(page, seed);
    await newTable(page, { players: 3 });
    // At the second hand's end (before its banner is tapped): a file from another device, whose
    // profile has counted hands up to 500, replaces the stats.
    let fileHands = -1;
    await playHands(page, {
      hands: 2,
      random,
      onHandEnd: async (record) => {
        if (record.handSeq !== 2) return;
        const text = await page.evaluate(() => {
          const profile = JSON.parse(localStorage.getItem('pc.v1.profile') as string) as object;
          return JSON.stringify({
            app: 'poker-coach',
            schemaVersion: 1,
            exportedAt: new Date().toISOString(),
            profile: { ...profile, lastCommittedHandSeq: 500 },
            hands: [],
          });
        });
        fileHands = (await importText(page, text)).hands ?? -1;
        expect(fileHands).toBeGreaterThan(0);
        expect((await stored(page)).profile.lastCommittedHandSeq).toBe(500);
      },
    });
    // The next hand (dealt by the banner's tap) is numbered above the file's, and counts.
    const next = await page.evaluate(() => window.__pc?.state().game.hand?.handSeq);
    expect(next).toBe(501);
    await playHands(page, { hands: 1, random });
    const after = await stored(page);
    expect(after.profile.lastCommittedHandSeq).toBe(501);
    expect(counted(after)).toBe(fileHands + 1);
    expect(after.hands.map((r) => r.handSeq)).toEqual([501]);
  });

  test('Export (a download) → Reset → Import gives back the same profile and hands', async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
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

    const downloading = page.waitForEvent('download');
    await tapExport(page);
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(FILE_NAME);
    const text = await readFile((await download.path()) as string, 'utf8');
    const file = JSON.parse(text) as { app: string; profile: unknown; hands: unknown[] };
    expect(file.app).toBe('poker-coach');
    expect(file.profile).toEqual(before.profile);
    expect(file.hands).toEqual(before.hands);

    await page.evaluate(() => window.__pc?.dispatch({ type: 'resetStats' }));
    await expect(page.getByText('Your stats were deleted.')).toBeVisible();
    const reset = await stored(page);
    expect(counted(reset)).toBe(0);
    expect(reset.hands).toEqual([]);
    expect(reset.profile.settings).toEqual(before.profile.settings);
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem('pc.v1.preimport') ?? 'null')),
    ).toEqual(before.profile);

    expect(await importText(page, text)).toMatchObject({ hands: 3 });
    const back = await stored(page);
    expect({
      ...back.profile,
      rev: before.profile.rev,
      updatedAt: before.profile.updatedAt,
    }).toEqual(before.profile);
    expect(back.hands).toEqual(before.hands);
  });

  test('Export opens the share sheet inside the tap, with the JSON file (iOS: Save to Files)', async ({
    page,
  }, testInfo) => {
    // The share sheet is native UI a test cannot tap: a stand-in records what it was given and
    // whether the tap's user activation was still there (Safari requires it, §14.8).
    await page.addInitScript(() => {
      const shared: { name: string; type: string; text: string; active: boolean | null }[] = [];
      (window as unknown as { __shared: typeof shared }).__shared = shared;
      Object.defineProperty(Navigator.prototype, 'canShare', {
        configurable: true,
        value: (data: { files?: File[] }) => (data.files?.length ?? 0) === 1,
      });
      Object.defineProperty(Navigator.prototype, 'share', {
        configurable: true,
        value: async (data: { files: File[] }) => {
          const active =
            (navigator as { userActivation?: { isActive: boolean } }).userActivation?.isActive ??
            null;
          const file = data.files[0] as File;
          shared.push({ name: file.name, type: file.type, text: await file.text(), active });
        },
      });
    });
    const seed = seedFor(testInfo);
    await openApp(page, seed);
    await newTable(page, { players: 3 });
    await playHands(page, { hands: 1, random: prng(seed) });
    await openSettings(page);
    const before = await stored(page);
    await tapExport(page);
    await page.waitForFunction(
      () => (window as unknown as { __shared: unknown[] }).__shared.length === 1,
    );
    const [sent] = await page.evaluate(
      () =>
        (
          window as unknown as {
            __shared: { name: string; type: string; text: string; active: boolean | null }[];
          }
        ).__shared,
    );
    expect(sent?.name).toMatch(FILE_NAME);
    expect(sent?.type).toBe('application/json');
    if (sent?.active !== null) expect(sent?.active).toBe(true);
    const file = JSON.parse(sent?.text ?? '{}') as { app: string; profile: unknown };
    expect(file).toMatchObject({ app: 'poker-coach', schemaVersion: 1 });
    expect(file.profile).toEqual(before.profile);
    // No toast: the sheet is the feedback.
    await expect(page.getByText('Export did not work. Please try again.')).toHaveCount(0);
  });
});
