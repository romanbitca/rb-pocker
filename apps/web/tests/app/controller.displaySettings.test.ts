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
