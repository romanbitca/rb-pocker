/**
 * The Settings rows chunk 9.1b added (PLAN §12.1): "Show win chance", "Four-colour cards", "Text
 * size" and "Reduce motion" change the settings (Appendix A.7's fields, there since chunk 3.2), are
 * saved with them 250 ms later like every other row (§14.2) and read back by the next launch;
 * values that are not choices of these rows are refused. "Show win chance" off hides the badge
 * (§7.6); the other three act on the root element (tests/ui/App.test.tsx) and in the browser
 * (tests/e2e/settingsComplete.spec.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TIMING } from '../../src/app/controller.ts';
import { winBadgeOf } from '../../src/app/equityViews.ts';
import { initialEquity } from '../../src/app/store.ts';
import type { Settings } from '../../src/persist/schema.ts';
import { createSafeStorage, STORAGE_KEYS } from '../../src/persist/storage.ts';
import { FakeStorage } from '../persist/fakeStorage.ts';
import { makeHarness, type Harness } from './harness.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const launch = (backend: FakeStorage): Harness =>
  makeHarness({ storage: createSafeStorage(() => backend) });

const storedSettings = (backend: FakeStorage): Settings =>
  (JSON.parse(backend.data.get(STORAGE_KEYS.profile) as string) as { settings: Settings }).settings;

const ROWS: Partial<Settings> = {
  showEquity: false,
  fourColour: false,
  textSize: 'large',
  reduceMotion: 'on',
};

describe('Settings complete: the rows of chunk 9.1b (§12.1)', () => {
  it('start as §12.1 says: win chance shown, four colours, Normal text, the system`s motion', () => {
    const h = launch(new FakeStorage());
    expect(h.state().settings).toMatchObject({
      showEquity: true,
      fourColour: true,
      textSize: 'normal',
      reduceMotion: 'system',
    });
  });

  it('a change is saved with the settings, and the next launch has it', async () => {
    const backend = new FakeStorage();
    const a = launch(backend);
    a.dispatch({ type: 'play' }); // writes the profile
    for (const [key, value] of Object.entries(ROWS)) {
      a.dispatch({ type: 'settings', patch: { [key]: value } });
      expect(a.state().settings).toMatchObject({ [key]: value });
    }
    await vi.advanceTimersByTimeAsync(TIMING.settingsDebounceMs);
    expect(storedSettings(backend)).toMatchObject(ROWS);
    a.controller.dispose();
    const b = launch(backend);
    expect(b.state().settings).toMatchObject(ROWS);
    // And back: Follow system, Normal.
    b.dispatch({ type: 'settings', patch: { textSize: 'normal', reduceMotion: 'system' } });
    b.dispatch({ type: 'pagehide' });
    expect(storedSettings(backend)).toMatchObject({ textSize: 'normal', reduceMotion: 'system' });
  });

  it('refuses what is not a choice of the rows', () => {
    const h = launch(new FakeStorage());
    const before = h.state().settings;
    h.dispatch({ type: 'settings', patch: { textSize: 'huge' as never } });
    h.dispatch({ type: 'settings', patch: { reduceMotion: 'sometimes' as never } });
    h.dispatch({ type: 'settings', patch: { fourColour: 'yes' as never } });
    h.dispatch({ type: 'settings', patch: { showEquity: 1 as never } });
    expect(h.state().settings).toBe(before);
  });

  it('"Show win chance" off hides the badge (§7.6): the setting a player practises with', () => {
    const working = { ...initialEquity(), status: 'computing' as const };
    expect(winBadgeOf(working, true, 'beginner').status).toBe('computing');
    expect(winBadgeOf(working, false, 'beginner').status).toBe('off');
  });
});

describe('the default speed under reduced motion (§12.8 "default speed Fast", §12.1 notes)', () => {
  /** A launch over `backend`, the system asking for reduced motion or not. */
  const start = (backend: FakeStorage, reducedMotion: boolean): Harness =>
    makeHarness({ storage: createSafeStorage(() => backend), reducedMotion });

  it('a first launch starts at Fast when the system asks for less motion, else at Normal', () => {
    const reduced = start(new FakeStorage(), true);
    expect(reduced.state().ui.screen).toBe('welcome');
    expect(reduced.state().settings.speed).toBe('fast');
    expect(start(new FakeStorage(), false).state().settings.speed).toBe('normal');
  });

  it('Play writes it as the speed, which the next launches keep whatever the system says', () => {
    const backend = new FakeStorage();
    const a = start(backend, true);
    a.dispatch({ type: 'play' });
    expect(a.state().game.hand).not.toBeNull();
    expect(storedSettings(backend).speed).toBe('fast');
    a.controller.dispose();
    expect(start(backend, false).state().settings.speed).toBe('fast');
  });

  it('a stored speed is the player`s: Normal stays Normal when the system asks later', () => {
    const backend = new FakeStorage();
    const a = start(backend, false);
    a.dispatch({ type: 'play' });
    a.controller.dispose();
    const b = start(backend, true);
    expect(b.state().settings.speed).toBe('normal');
    // Picked under reduced motion: kept too.
    b.dispatch({ type: 'settings', patch: { speed: 'instant' } });
    b.dispatch({ type: 'settings', patch: { speed: 'normal' } });
    b.dispatch({ type: 'pagehide' });
    b.controller.dispose();
    expect(start(backend, true).state().settings.speed).toBe('normal');
  });

  it('Welcome again (nothing written yet), or a damaged profile started again: the defaults', () => {
    const backend = new FakeStorage();
    start(backend, true).controller.dispose();
    expect(backend.data.size).toBe(0); // still a first launch
    expect(start(backend, false).state().settings.speed).toBe('normal');
    // §14.6: unreadable and no backup: the defaults again, so Fast under reduced motion.
    const damaged = new FakeStorage();
    damaged.data.set(STORAGE_KEYS.profile, '{ not json');
    expect(start(damaged, true).state().settings.speed).toBe('fast');
  });

  it('the Reduce motion setting changes no speed: only the system`s choice at a first launch', () => {
    const h = start(new FakeStorage(), false);
    h.dispatch({ type: 'settings', patch: { reduceMotion: 'on' } });
    expect(h.state().settings.speed).toBe('normal');
  });
});
