/**
 * The collection moment (PLAN §12.9, §14.4; chunk 9.1b): the commit that gives a hand category its
 * first date in `stats.collection` (made at the showdown or on the river, as the 8.2 bucket counts
 * it) toasts "New in your collection: …". Once per category, ever: a hand that makes a category
 * already collected toasts nothing, and a reload (a new launch over the same storage) does not
 * repeat a moment, because it is read from the stored first dates. Fake timers (and so a fake
 * `Date`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LegalActions, PlayerAction } from '../../src/engine/types.ts';
import type { HandCategory } from '../../src/eval/evaluate.ts';
import type { HandRing, Profile } from '../../src/persist/schema.ts';
import { createSafeStorage, STORAGE_KEYS } from '../../src/persist/storage.ts';
import { FakeStorage } from '../persist/fakeStorage.ts';
import { drive, flush, makeHarness, scriptedBrain, tick, type Harness } from './harness.ts';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-06T12:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

const SEED = 'c011ec7100000000c011ec7100000000';

/** Check or call: with bots that do the same, almost every hand reaches the river. */
const passive = (legal: LegalActions): PlayerAction =>
  legal.canCheck ? { type: 'check' } : { type: 'call' };

/** One page load over `backend`: a new store and controller, booted, with passive bots. */
function launch(backend: FakeStorage): Harness {
  return makeHarness({
    seed: SEED,
    storage: createSafeStorage(() => backend),
    brain: scriptedBrain({ thinkMs: 300, choose: (obs) => passive(obs.legal) }),
  });
}

const read = <T>(backend: FakeStorage, key: string): T =>
  JSON.parse(backend.data.get(key) as string) as T;
const profileOf = (backend: FakeStorage): Profile => read<Profile>(backend, STORAGE_KEYS.profile);
const ringOf = (backend: FakeStorage) => read<HandRing>(backend, STORAGE_KEYS.hands).hands;

interface Moment {
  category: HandCategory;
  /** The category's first date was already stored when the toast came. */
  stored: boolean;
}

/** Every collection toast of this launch, in order (the controller removes a toast after 4 s). */
function moments(h: Harness, backend: FakeStorage): Moment[] {
  const seen = new Set<number>();
  const out: Moment[] = [];
  h.store.subscribe((s) => {
    for (const t of s.ui.toasts) {
      if (t.kind !== 'collection' || seen.has(t.id)) continue;
      seen.add(t.id);
      const first = profileOf(backend).stats.collection[t.category].first;
      out.push({ category: t.category, stored: first !== null });
    }
  });
  return out;
}

/** The categories of `made` (in order) that `known` does not have yet, each once. */
function firstTimes(made: readonly (HandCategory | null)[], known: Set<HandCategory>) {
  const out: HandCategory[] = [];
  for (const c of made) {
    if (c === null || known.has(c)) continue;
    known.add(c);
    out.push(c);
  }
  return out;
}

/** Runs the clock until the finished hands are committed (the next hand waits for the hero). */
async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) await tick();
  await flush();
}

const collected = (p: Profile): HandCategory[] =>
  (Object.keys(p.stats.collection) as HandCategory[]).filter(
    (c) => p.stats.collection[c].first !== null,
  );

describe('the collection moment (§12.9)', () => {
  it('comes once per category, at the commit that stores its first date, and a reload does not repeat it', async () => {
    const backend = new FakeStorage();
    const a = launch(backend);
    const firstLaunch = moments(a, backend);
    a.dispatch({ type: 'settings', patch: { players: 3, speed: 'instant' } });
    a.dispatch({ type: 'play' });
    await drive(a, { hands: 8, hero: passive });
    await settle();

    const ringA = ringOf(backend);
    const known = new Set<HandCategory>();
    const expectedA = firstTimes(
      ringA.map((r) => r.bestCategory),
      known,
    );
    expect(expectedA.length, 'the hands made some categories').toBeGreaterThan(1);
    expect(firstLaunch.map((m) => m.category)).toEqual(expectedA);
    expect(firstLaunch.every((m) => m.stored)).toBe(true);
    expect(collected(profileOf(backend)).sort()).toEqual([...expectedA].sort());
    // A category made again (most hands make a pair) toasted nothing the second time.
    const made = ringA.map((r) => r.bestCategory).filter((c) => c !== null);
    expect(made.length).toBeGreaterThan(expectedA.length);

    a.dispatch({ type: 'pagehide' });
    a.controller.dispose();

    // A reload: the moments seen are read from the stored first dates, not remembered in memory.
    const b = launch(backend);
    const secondLaunch = moments(b, backend);
    const lastA = ringA.at(-1)?.handSeq ?? -1;
    b.dispatch({ type: 'play' });
    await drive(b, { hands: 20, hero: passive });
    await settle();

    const ringB = ringOf(backend).filter((r) => r.handSeq > lastA);
    expect(ringB.length).toBeGreaterThanOrEqual(20);
    const expectedB = firstTimes(
      ringB.map((r) => r.bestCategory),
      known,
    );
    // A category new after the reload still has its moment (this seed: Three of a Kind).
    expect(expectedB.length).toBeGreaterThan(0);
    expect(secondLaunch.map((m) => m.category)).toEqual(expectedB);
    expect(secondLaunch.every((m) => m.stored)).toBe(true);
    // Hands after the reload made categories of the first launch again: no moment for them.
    expect(ringB.some((r) => r.bestCategory !== null && expectedA.includes(r.bestCategory))).toBe(
      true,
    );
    const all = [...firstLaunch, ...secondLaunch].map((m) => m.category);
    expect(new Set(all).size).toBe(all.length);
    b.controller.dispose();
  }, 60_000);

  it('a collection that already has the category (an older first date) gives no moment', async () => {
    const backend = new FakeStorage();
    const a = launch(backend);
    a.dispatch({ type: 'settings', patch: { players: 3, speed: 'instant' } });
    a.dispatch({ type: 'play' });
    await drive(a, { hands: 1, hero: passive });
    a.dispatch({ type: 'pagehide' });
    a.controller.dispose();

    // Every category already made once, long ago (an imported file, say).
    const profile = profileOf(backend);
    for (const c of Object.keys(profile.stats.collection) as HandCategory[]) {
      const entry = profile.stats.collection[c];
      if (entry.first === null)
        profile.stats.collection[c] = { count: 1, first: '2026-01-01T00:00:00.000Z' };
    }
    backend.data.set(STORAGE_KEYS.profile, JSON.stringify(profile));

    const b = launch(backend);
    const seen = moments(b, backend);
    b.dispatch({ type: 'play' });
    await drive(b, { hands: 4, hero: passive });
    await settle();
    expect(ringOf(backend).some((r) => r.bestCategory !== null)).toBe(true);
    expect(seen).toEqual([]);
    b.controller.dispose();
  }, 60_000);
});
