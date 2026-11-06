/**
 * The first-table tips in the controller and the store (PLAN §12.11, chunk 9.3): `data.tips` says
 * which tips were seen (null when tips are off); a tip opens only over the bare Table; while it
 * shows, its `tip` gate holds the bots; its closing (a tap, a key, Back, leaving the Table) marks
 * it seen once, in `profile.flags.tips`, so a later launch never shows it again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LegalActions, PlayerAction } from '../../src/engine/types.ts';
import type { Profile } from '../../src/persist/schema.ts';
import { createSafeStorage, STORAGE_KEYS } from '../../src/persist/storage.ts';
import { FakeStorage } from '../persist/fakeStorage.ts';
import { elapse, makeHarness, tick, type Harness } from './harness.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const passive = (legal: LegalActions): PlayerAction =>
  legal.canCheck ? { type: 'check' } : { type: 'call' };

/** Plays (hero passive) until `until` holds. */
async function playUntil(h: Harness, until: () => boolean): Promise<void> {
  for (let i = 0; i < 2000 && !until(); i++) {
    const s = h.state();
    if (s.game.mode === 'heroTurn' && s.game.legal !== null) {
      h.dispatch({ type: 'act', action: passive(s.game.legal) });
    } else {
      await tick();
    }
  }
  expect(until()).toBe(true);
}

const storedProfile = (backend: FakeStorage): Profile =>
  JSON.parse(backend.data.get(STORAGE_KEYS.profile) ?? 'null') as Profile;

describe('first-table tips (§12.11)', () => {
  it('are off unless the controller is asked for them: data.tips is null', () => {
    const h = makeHarness();
    h.dispatch({ type: 'play' });
    expect(h.state().data.tips).toBeNull();
    h.controller.dispose();
  });

  it('a tip opens only over the bare Table, and closing it marks it seen once', () => {
    const h = makeHarness({ tips: true });
    expect(h.state().data.tips).toEqual({});
    // Not off the Table (Home): nothing opens.
    h.dispatch({ type: 'tip', tip: 'heroStrip' });
    expect(h.state().ui.overlays).toEqual([]);
    h.dispatch({ type: 'play' });
    // Not over another layer.
    h.dispatch({ type: 'open', overlay: 'menu' });
    h.dispatch({ type: 'tip', tip: 'heroStrip' });
    expect(h.state().ui.overlays).toEqual(['menu']);
    expect(h.state().ui.tip).toBeNull();
    h.dispatch({ type: 'close', overlay: 'menu' });

    h.dispatch({ type: 'tip', tip: 'heroStrip' });
    expect(h.state().ui.overlays).toEqual(['tip']);
    expect(h.state().ui.tip).toBe('heroStrip');
    expect(h.state().ui.gates).toContain('tip');
    expect(h.state().data.tips).toEqual({}); // shown is not seen: closing it is
    h.dispatch({ type: 'close', overlay: 'tip' });
    expect(h.state().ui.tip).toBeNull();
    expect(h.state().ui.gates).not.toContain('tip');
    expect(h.state().data.tips).toEqual({ heroStrip: true });
    // Back closes a tip too, and that counts as seen.
    h.dispatch({ type: 'tip', tip: 'coachStrip' });
    h.dispatch({ type: 'back' });
    expect(h.state().ui.screen).toBe('table');
    expect(h.state().data.tips).toEqual({ heroStrip: true, coachStrip: true });
    // Leaving the Table closes it as well.
    h.dispatch({ type: 'tip', tip: 'undo' });
    h.dispatch({ type: 'leaveTable' });
    expect(h.state().ui.tip).toBeNull();
    expect(h.state().data.tips).toEqual({ heroStrip: true, coachStrip: true, undo: true });
    h.controller.dispose();
  });

  it('while a tip shows, the bots wait for the tap (the tip gate)', async () => {
    const h = makeHarness({ tips: true, settings: { players: 4, speed: 'normal' } });
    h.dispatch({ type: 'play' });
    // Wait for a bot's turn, then open a tip: nothing moves until it closes.
    await playUntil(h, () => h.state().game.mode === 'botTurn');
    h.dispatch({ type: 'tip', tip: 'handsTab' });
    const inputs = h.controller.snapshot().inputs.length;
    await elapse(10_000);
    expect(h.controller.snapshot().inputs.length).toBe(inputs);
    expect(h.state().game.mode).toBe('botTurn');
    h.dispatch({ type: 'close', overlay: 'tip' });
    await elapse(10_000);
    expect(h.controller.snapshot().inputs.length).toBeGreaterThan(inputs);
    h.controller.dispose();
  });

  it('the seen flags go to profile.flags.tips at once, and the next launch keeps them', () => {
    const backend = new FakeStorage();
    const first = makeHarness({ tips: true, storage: createSafeStorage(() => backend) });
    first.dispatch({ type: 'play' });
    const rev = storedProfile(backend).rev;
    first.dispatch({ type: 'tip', tip: 'heroStrip' });
    expect(storedProfile(backend).flags.tips).toEqual({}); // nothing written while it shows
    first.dispatch({ type: 'close', overlay: 'tip' });
    const profile = storedProfile(backend);
    expect(profile.flags.tips).toEqual({ heroStrip: true });
    expect(profile.rev).toBe(rev + 1);
    // Closing an already seen tip again writes nothing.
    first.dispatch({ type: 'tip', tip: 'heroStrip' });
    first.dispatch({ type: 'close', overlay: 'tip' });
    expect(storedProfile(backend).rev).toBe(rev + 1);
    first.controller.dispose();

    const second = makeHarness({ tips: true, storage: createSafeStorage(() => backend) });
    expect(second.state().data.tips).toEqual({ heroStrip: true });
    second.controller.dispose();
  });

  it('a settings change after a tip keeps the flag (one profile, written in turn)', async () => {
    const backend = new FakeStorage();
    const h = makeHarness({ tips: true, storage: createSafeStorage(() => backend) });
    h.dispatch({ type: 'play' });
    h.dispatch({ type: 'settings', patch: { amounts: 'bb' } });
    h.dispatch({ type: 'tip', tip: 'coachStrip' });
    h.dispatch({ type: 'close', overlay: 'tip' });
    await elapse(1000); // the settings' 250 ms debounce
    const profile = storedProfile(backend);
    expect(profile.flags.tips).toEqual({ coachStrip: true });
    expect(profile.settings.amounts).toBe('bb');
    h.controller.dispose();
  });
});
