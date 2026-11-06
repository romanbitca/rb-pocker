import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import {
  collectErrors,
  heroAct,
  nextFlowPoint,
  openApp,
  pcState,
  prng,
  reloadAfterBust,
  seedFor,
  sizeOf,
  tapNextHand,
} from './game.ts';

// Chunk 9.1 (PLAN §12.8, §12.13): sounds, vibration and the wake lock in a real browser, with the
// production build's lazy chunks. The page's AudioContext is the browser's own, wrapped to count
// what the game asks of it; `navigator.vibrate` and `navigator.wakeLock` are stand-ins that record
// their calls (a headless browser has no motor and may refuse a real wake lock).
// - Welcome's Play makes and resumes the AudioContext inside its own tap; the deal and "your turn"
//   are heard, with 10 ms of vibration; the screen is kept on while the hand runs and let go at
//   Home; the top bar's mute button silences the game at once.
// - Sound off is remembered: after a reload the synth chunk is not even loaded and no context is
//   made; turning Sound on in Settings loads it, and the tap back to the Table starts the audio.

interface Recorded {
  audio: { made: number; inTap: number; resumes: number; sources: number; oscillators: number };
  state: string | null;
  vibrations: unknown[];
  wake: { requests: number; releases: number };
}

declare global {
  interface Window {
    __audio?: Recorded['audio'] & { last: AudioContext | null };
    __vibrations?: unknown[];
    __wake?: Recorded['wake'];
  }
}

/** Before the app's scripts: wrap AudioContext, stand in for vibrate and wakeLock. */
function recordDevice(): void {
  const w = window;
  const audio = { made: 0, inTap: 0, resumes: 0, sources: 0, oscillators: 0, last: null };
  w.__audio = audio as NonNullable<Window['__audio']>;
  const Native = w.AudioContext;
  if (typeof Native === 'function') {
    class Recording extends Native {
      constructor(options?: AudioContextOptions) {
        super(options);
        audio.made++;
        // `window.event`: the event being handled right now (the tap's click, or none).
        if ((w as { event?: Event }).event?.type === 'click') audio.inTap++;
        (audio as { last: AudioContext | null }).last = this;
      }
      override resume(): Promise<void> {
        audio.resumes++;
        return super.resume();
      }
      override createOscillator(): OscillatorNode {
        audio.oscillators++;
        return super.createOscillator();
      }
      override createBufferSource(): AudioBufferSourceNode {
        audio.sources++;
        return super.createBufferSource();
      }
    }
    w.AudioContext = Recording;
  }
  const vibrations: unknown[] = [];
  w.__vibrations = vibrations;
  Object.defineProperty(Navigator.prototype, 'vibrate', {
    configurable: true,
    value: (pattern: unknown) => {
      vibrations.push(pattern);
      return true;
    },
  });
  const wake = { requests: 0, releases: 0 };
  w.__wake = wake;
  const lock = {
    request: () => {
      wake.requests++;
      const sentinel = Object.assign(new EventTarget(), {
        released: false,
        release: () => {
          if (!sentinel.released) {
            sentinel.released = true;
            wake.releases++;
            sentinel.dispatchEvent(new Event('release'));
          }
          return Promise.resolve();
        },
      });
      return Promise.resolve(sentinel);
    },
  };
  Object.defineProperty(Navigator.prototype, 'wakeLock', { configurable: true, get: () => lock });
}

const recorded = (page: Page): Promise<Recorded> =>
  page.evaluate(() => ({
    audio: { ...(window.__audio as Recorded['audio']) },
    state: window.__audio?.last?.state ?? null,
    vibrations: [...(window.__vibrations ?? [])],
    wake: { ...(window.__wake as Recorded['wake']) },
  }));

/** The page has fetched one of the app's chunks (`name-<hash>.js`). */
const fetched = (page: Page, name: string): Promise<boolean> =>
  page.evaluate(
    (n) =>
      performance
        .getEntriesByType('resource')
        .some((e) => new RegExp(`/assets/${n}-[\\w-]+\\.js$`).test(e.name)),
    name,
  );

/** Waits until a chunk is fetched, and a moment for it to run. */
async function chunkLoaded(page: Page, name: string): Promise<void> {
  await expect.poll(() => fetched(page, name)).toBe(true);
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
}

/**
 * The tab holds the game (§14.7). A Play tapped before the lock answers waits for it, so the Table
 * would come after the tap, outside it; these checks need it inside.
 */
async function writer(page: Page): Promise<void> {
  await expect.poll(async () => (await pcState(page)).data.tab).toBe('writer');
}

/** Plays on to the hero's next decision (tapping through hand ends). */
async function toHeroTurn(page: Page): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const point = await nextFlowPoint(page);
    if (point === 'hero') return;
    if (point === 'end') await tapNextHand(page);
    else await reloadAfterBust(page);
  }
  throw new Error('no hero turn');
}

const is10ms = (v: unknown): boolean => v === 10 || (Array.isArray(v) && v[2] === 10);

const muteButton = (page: Page) =>
  page.locator('header').getByRole('button', { name: 'Sound', exact: true });

test.describe('sounds, vibration and the wake lock (chunk 9.1)', () => {
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      !['390x844', '1280x800'].includes(sizeOf(testInfo)),
      'a phone and a wide screen per browser',
    );
  });

  test('Play starts the audio in its own tap; the deal and your turn sound, with vibration; the screen stays on until Home', async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    await page.addInitScript(recordDevice);
    await openApp(page, seedFor(testInfo));
    await page.evaluate(() =>
      window.__pc?.dispatch({ type: 'settings', patch: { speed: 'fast' } }),
    );
    // The device chunk and (sound is on by default) the synth arrive before the first tap.
    await chunkLoaded(page, 'device');
    await chunkLoaded(page, 'synth');
    expect((await recorded(page)).audio.made).toBe(0);

    await writer(page);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    let r = await recorded(page);
    expect(r.audio.made).toBe(1);
    expect(r.audio.inTap, 'the AudioContext is made inside the Play tap').toBe(1);
    // Chromium starts a context made in a tap running; WebKit's is resumed in the same tap.
    expect(r.state === 'running' || r.audio.resumes >= 1).toBe(true);
    // The hero's two cards: two noise bursts.
    await expect.poll(async () => (await recorded(page)).audio.sources).toBeGreaterThanOrEqual(2);
    await expect.poll(async () => (await recorded(page)).state).toBe('running');
    // The screen is kept on while the hand runs.
    await expect
      .poll(async () => (await recorded(page)).wake)
      .toEqual({ requests: 1, releases: 0 });

    await toHeroTurn(page);
    await expect.poll(async () => (await recorded(page)).vibrations.some(is10ms)).toBe(true);
    r = await recorded(page);
    expect(r.audio.oscillators, 'your turn: 660 then 880 Hz').toBeGreaterThanOrEqual(2);

    // The mute button: pressed while sound is on; a tap silences the game at once.
    await expect(muteButton(page)).toHaveAttribute('aria-pressed', 'true');
    await muteButton(page).click();
    await expect(muteButton(page)).toHaveAttribute('aria-pressed', 'false');
    expect((await pcState(page)).settings['sound']).toBe(false);
    await expect.poll(async () => (await recorded(page)).state).toBe('suspended');
    const muted = (await recorded(page)).audio;
    const random = prng(seedFor(testInfo, 'hero'));
    await heroAct(page, random);
    await toHeroTurn(page);
    r = await recorded(page);
    expect([r.audio.sources, r.audio.oscillators]).toEqual([muted.sources, muted.oscillators]);
    expect(r.vibrations.filter(is10ms).length, 'vibration has its own switch').toBeGreaterThan(1);

    // Leave the table: Home lets the screen sleep again.
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('button', { name: 'Leave table' }).click();
    await expect.poll(async () => (await pcState(page)).ui.screen).toBe('home');
    await expect
      .poll(async () => (await recorded(page)).wake)
      .toEqual({ requests: 1, releases: 1 });
    expect(errors).toEqual([]);
  });

  test('sound off is remembered and loads no synth; Sound on in Settings starts it on the way back', async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    await page.addInitScript(recordDevice);
    await openApp(page, seedFor(testInfo));
    await chunkLoaded(page, 'synth');
    await writer(page);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await muteButton(page).click();
    await expect(muteButton(page)).toHaveAttribute('aria-pressed', 'false');

    // Reload (the settings are saved at once on pagehide): Home, sound off.
    await page.reload();
    await page.waitForFunction(() => window.__pc?.state().game.mode !== 'booting');
    await chunkLoaded(page, 'device');
    expect(await fetched(page, 'synth'), 'the synth is not loaded while sound is off').toBe(false);
    await writer(page);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(muteButton(page)).toHaveAttribute('aria-pressed', 'false');
    expect((await recorded(page)).audio.made).toBe(0);

    // Settings: Display and Sound show the settings; Sound on loads the synth.
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('button', { name: 'Settings' }).click();
    const keep = page.getByRole('switch', { name: 'Keep screen on' });
    const sound = page.getByRole('switch', { name: 'Sound' });
    const vibration = page.getByRole('switch', { name: 'Vibration' });
    await expect(keep).toBeChecked();
    await expect(sound).not.toBeChecked();
    await expect(vibration).toBeChecked();
    // The switch is drawn over the native checkbox: tap its row, as a finger does.
    await page.locator('label', { has: sound }).click();
    await expect(sound).toBeChecked();
    await chunkLoaded(page, 'synth');
    expect((await recorded(page)).audio.made).toBe(0);

    // Back to the Table: that tap starts the audio.
    await page.getByRole('button', { name: 'Back' }).click();
    await expect.poll(async () => (await pcState(page)).ui.screen).toBe('table');
    const r = await recorded(page);
    expect(r.audio.made).toBe(1);
    expect(r.audio.inTap).toBe(1);
    await expect(muteButton(page)).toHaveAttribute('aria-pressed', 'true');
    expect(errors).toEqual([]);
  });
});
