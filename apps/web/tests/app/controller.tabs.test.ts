/**
 * Several tabs (PLAN §14.7, §14.9, chunk 8.3): one writer at a time. Two or three controllers over
 * one fake origin (one `localStorage`, one lock manager, each tab hearing the others' `storage`
 * events) are tabs of one site. With Web Locks the first tab writes and a second one is
 * read-only (Home shows the §12.11 banner) until its "Play here" takes the game; without them the
 * `rev` check and the `storage` event decide. No hand is ever lost or counted twice. The lock
 * itself is `tests/app/tabLock.test.ts`; the Playwright two-page test is `tests/e2e/tabs.spec.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTabLock } from '../../src/app/tabLock.ts';
import type { LegalActions, PlayerAction } from '../../src/engine/types.ts';
import type { HandRing, Profile, SessionState } from '../../src/persist/schema.ts';
import { createSafeStorage, STORAGE_KEYS } from '../../src/persist/storage.ts';
import { FakeStorage } from '../persist/fakeStorage.ts';
import { FakeLocks, FakeOrigin, settle, type FakePage } from './fakeLocks.ts';
import { drive, flush, makeHarness, tick, type Harness } from './harness.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const K = STORAGE_KEYS;

const passive = (legal: LegalActions): PlayerAction =>
  legal.canCheck ? { type: 'check' } : { type: 'call' };

interface Tab extends Harness {
  page: FakePage;
}

/** A new tab of `origin`: its store and controller, booted, its lock asked. */
function openTab(origin: FakeOrigin): Tab {
  const page = origin.page();
  const h = makeHarness({
    storage: createSafeStorage(() => origin.storageFor(page)),
    tabLock: createTabLock(page),
  });
  return { ...h, page };
}

/** Instant speed, 3 players; then Play. */
function play(tab: Tab): void {
  tab.dispatch({ type: 'settings', patch: { players: 3, speed: 'instant' } });
  tab.dispatch({ type: 'play' });
}

const read = <T>(origin: FakeOrigin, key: string): T =>
  JSON.parse(origin.backend.data.get(key) as string) as T;
const profileOf = (origin: FakeOrigin): Profile => read<Profile>(origin, K.profile);
const counted = (p: Profile): number =>
  p.stats.results.clean.hands + p.stats.results.practice.hands;
const ringSeqs = (origin: FakeOrigin): number[] =>
  origin.backend.data.has(K.hands)
    ? read<HandRing>(origin, K.hands).hands.map((r) => r.handSeq)
    : [];

/** Until the hero is to act (bots on the fake clock). */
async function toHeroTurn(tab: Tab): Promise<void> {
  for (let i = 0; i < 800 && tab.state().game.mode !== 'heroTurn'; i++) await tick();
  expect(tab.state().game.mode).toBe('heroTurn');
}

describe('with Web Locks (§14.7)', () => {
  it('boot only reads until the lock answers; granted, it writes back what loading repaired', async () => {
    const good = JSON.stringify({ ...JSON.parse(seededProfile()), rev: 3 });
    const origin = new FakeOrigin(
      new FakeStorage({ [K.profile]: '{"schema":1,"rev":', [K.profileBackup]: good }),
    );
    const tab = openTab(origin);
    // Synchronous boot: the backup is in memory and on screen, nothing is written yet.
    expect(tab.state().data.tab).toBe('pending');
    expect(tab.page.writes).toEqual([]);
    expect(tab.state().ui.toasts.map((t) => t.kind)).toEqual(['dataRestored']);
    expect(tab.state().ui.screen).toBe('home');
    await settle();
    // Granted: read again, writing this time (the damaged text kept, the backup in its place).
    expect(tab.state().data.tab).toBe('writer');
    expect(tab.page.writes.filter((k) => k === K.profile)).toHaveLength(1);
    expect(origin.backend.data.get(K.profile)).toBe(good);
    expect([...origin.backend.data.keys()].some((k) => k.startsWith('pc.corrupt.'))).toBe(true);
    expect(tab.state().ui.toasts.map((t) => t.kind)).toEqual(['dataRestored']); // not twice
    tab.controller.dispose();
  });

  it('a Play tapped before the lock answers deals once it is granted', async () => {
    const origin = new FakeOrigin(new FakeStorage());
    const tab = openTab(origin);
    play(tab);
    expect(tab.state().game.hand).toBeNull();
    expect(tab.page.writes).toEqual([]);
    await settle();
    expect(tab.state().game.hand?.handSeq).toBe(1);
    expect(tab.state().ui.screen).toBe('table');
    expect(read<SessionState>(origin, K.session).hand?.handSeq).toBe(1);
    tab.controller.dispose();
  });

  it('a second tab is read-only: the banner, nothing written, Play ignored; it hears new stats', async () => {
    const origin = new FakeOrigin(new FakeStorage());
    const a = openTab(origin);
    await settle();
    play(a);
    await drive(a, { hands: 1, hero: passive });
    const b = openTab(origin);
    await settle();
    expect(b.state().data.tab).toBe('readOnly');
    expect(b.controller.snapshot().writer).toBe(false);
    expect(b.state().ui.screen).toBe('home');
    expect(b.state().game.hand).toBeNull();
    b.dispatch({ type: 'play' });
    b.dispatch({ type: 'newTable', setup: { players: 4 }, confirmed: true });
    b.dispatch({ type: 'settings', patch: { sound: false } });
    await flush();
    vi.advanceTimersByTime(1000); // the settings' 250 ms save, were it a writer
    expect(b.state().game.hand).toBeNull();
    expect(b.page.writes).toEqual([]);
    // A plays on; B shows the new numbers (the profile it hears about).
    a.dispatch({ type: 'settings', patch: { amounts: 'bb' } });
    await drive(a, { hands: 1, hero: passive });
    expect(counted(profileOf(origin))).toBe(2);
    expect(b.state().settings.amounts).toBe('bb');
    expect(b.page.writes).toEqual([]);
    a.controller.dispose();
    b.controller.dispose();
  }, 30_000);

  it('"Play here" moves the game: the other tab stops at once, this one continues the same hand', async () => {
    const origin = new FakeOrigin(new FakeStorage());
    const a = openTab(origin);
    await settle();
    play(a);
    await drive(a, { hands: 1, hero: passive });
    await toHeroTurn(a);
    const hand = a.state().game.hand;
    const b = openTab(origin);
    await settle();
    expect(b.state().data.tab).toBe('readOnly');
    const aWrites = a.page.writes.length;
    b.dispatch({ type: 'playHere' });
    expect(b.state().data.tab).toBe('pending'); // the banner goes at once
    await settle();
    // A: lock taken → read-only, its game forgotten, Home with the banner, no more writes.
    expect(a.state().data.tab).toBe('readOnly');
    expect(a.state().game.hand).toBeNull();
    expect(a.state().ui.screen).toBe('home');
    // B: the session A saved after its last step, so the very same decision.
    expect(b.state().data.tab).toBe('writer');
    expect(b.state().ui.screen).toBe('table');
    expect(b.state().game.hand).toEqual(hand);
    expect(b.state().game.mode).toBe('heroTurn');
    await drive(b, { hands: 2, hero: passive });
    expect(a.page.writes.length).toBe(aWrites);
    expect(counted(profileOf(origin))).toBe(3);
    expect(ringSeqs(origin)).toEqual([1, 2, 3]);
    a.controller.dispose();
    b.controller.dispose();
  }, 30_000);

  it('no lost update: hands played in turn by three tabs are all counted, each once', async () => {
    const origin = new FakeOrigin(new FakeStorage());
    const a = openTab(origin);
    await settle();
    play(a);
    await drive(a, { hands: 2, hero: passive });
    const b = openTab(origin);
    const c = openTab(origin);
    await settle();
    expect([b, c].map((t) => t.state().data.tab)).toEqual(['readOnly', 'readOnly']);
    b.dispatch({ type: 'playHere' });
    await settle();
    await drive(b, { hands: 2, hero: passive });
    c.dispatch({ type: 'playHere' });
    await settle();
    expect([a, b, c].map((t) => t.state().data.tab)).toEqual(['readOnly', 'readOnly', 'writer']);
    await drive(c, { hands: 1, hero: passive });
    a.dispatch({ type: 'playHere' });
    await settle();
    await drive(a, { hands: 1, hero: passive });
    const profile = profileOf(origin);
    expect(counted(profile)).toBe(6);
    expect(profile.heroModel.hands).toBe(6);
    expect(ringSeqs(origin)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(profile.lastCommittedHandSeq).toBe(6);
    for (const tab of [a, b, c]) tab.controller.dispose();
  }, 60_000);

  it('closing the tab that has the game hands it to the read-only one (the banner: "Close it")', async () => {
    const origin = new FakeOrigin(new FakeStorage());
    const a = openTab(origin);
    await settle();
    play(a);
    await drive(a, { hands: 1, hero: passive });
    await toHeroTurn(a);
    const hand = a.state().game.hand;
    const b = openTab(origin);
    await settle();
    expect(b.state().data.tab).toBe('readOnly');
    a.controller.dispose(); // the tab closes: its lock goes
    await settle();
    expect(b.state().data.tab).toBe('writer');
    expect(b.state().ui.screen).toBe('home');
    b.dispatch({ type: 'play' });
    expect(b.state().game.hand).toEqual(hand);
    await drive(b, { hands: 1, hero: passive });
    expect(counted(profileOf(origin))).toBe(2);
    b.controller.dispose();
  }, 30_000);

  it('a tab that loses the lock mid-hand sends nothing more: no bot job, no write', async () => {
    const origin = new FakeOrigin(new FakeStorage());
    const a = openTab(origin);
    await settle();
    play(a);
    await toHeroTurn(a);
    a.dispatch({ type: 'act', action: { type: 'fold' } }); // the bots play on, in A
    const b = openTab(origin);
    await settle();
    b.dispatch({ type: 'playHere' });
    await settle();
    const aWrites = a.page.writes.length;
    const events = a.controller.logs().brain.length;
    for (let i = 0; i < 50; i++) await tick();
    expect(a.page.writes.length).toBe(aWrites);
    expect(a.controller.logs().brain.filter((e) => e.what === 'request').length).toBe(
      a.controller
        .logs()
        .brain.slice(0, events)
        .filter((e) => e.what === 'request').length,
    );
    a.controller.dispose();
    b.controller.dispose();
  }, 30_000);
});

describe('without Web Locks: the rev check and the storage event (§14.7)', () => {
  it('the tab that writes the game has it; the other becomes read-only, and "Play here" takes it back', async () => {
    const origin = new FakeOrigin(new FakeStorage(), null);
    const a = openTab(origin);
    expect(a.state().data.tab).toBe('writer'); // at once
    play(a);
    await drive(a, { hands: 1, hero: passive });
    const b = openTab(origin);
    expect(b.state().data.tab).toBe('writer'); // it cannot know about A yet
    await drive(a, { hands: 1, hero: passive }); // A writes the game: B hears it
    await flush();
    expect(b.state().data.tab).toBe('readOnly');
    expect(b.state().ui.screen).toBe('home');
    expect(b.page.writes).toEqual([]);
    // B takes it: one profile write tells A.
    b.dispatch({ type: 'playHere' });
    await flush();
    expect(b.page.writes.slice(0, 2)).toEqual([K.profileBackup, K.profile]);
    expect(a.state().data.tab).toBe('readOnly');
    expect(b.state().data.tab).toBe('writer');
    expect(b.state().ui.screen).toBe('table');
    await drive(b, { hands: 2, hero: passive });
    const profile = profileOf(origin);
    expect(counted(profile)).toBe(4);
    expect(ringSeqs(origin)).toEqual([1, 2, 3, 4]);
    a.controller.dispose();
    b.controller.dispose();
  }, 30_000);
});

describe('a rev conflict (§14.3 step 2): another writer without the lock', () => {
  it('the tab becomes read-only: the game stops, Home shows the banner, nothing more is written', async () => {
    const backend = new FakeStorage();
    const h = makeHarness({ storage: createSafeStorage(() => backend) });
    play(h as Tab);
    await drive(h, { hands: 1, hero: passive });
    const stored = JSON.parse(backend.data.get(K.profile) as string) as Profile;
    backend.data.set(K.profile, JSON.stringify({ ...stored, rev: stored.rev + 1 }));
    const writes = backend.writeLog.length;
    for (let i = 0; i < 2000 && h.state().data.tab === 'writer'; i++) {
      const s = h.state();
      if (s.game.mode === 'heroTurn' && s.game.legal !== null) {
        h.dispatch({ type: 'act', action: passive(s.game.legal) });
      } else await tick();
    }
    await flush();
    expect(h.state().data.tab).toBe('readOnly');
    expect(h.state().ui.screen).toBe('home');
    expect(h.state().game.hand).toBeNull();
    expect(h.controller.logs().errors.map((e) => e.what)).toContain('another writer');
    // Its commit wrote nothing; nor does anything after.
    expect(backend.writeLog.slice(writes).filter((k) => k !== K.session)).toEqual([]);
    const after = backend.writeLog.length;
    h.dispatch({ type: 'play' });
    h.dispatch({ type: 'pagehide' });
    expect(backend.writeLog.length).toBe(after);
    // "Play here" without a lock: read again (the finished hand its commit could not count is
    // counted now, §14.3 load table), claim with a profile write, play on.
    h.dispatch({ type: 'playHere' });
    expect(h.state().data.tab).toBe('writer');
    expect(backend.writeLog.slice(after)).toContain(K.profile);
    expect(profileOf2(backend).rev).toBeGreaterThan(stored.rev + 1);
    expect(h.state().ui.screen).toBe('table');
    h.controller.dispose();
  }, 30_000);
});

const profileOf2 = (backend: FakeStorage): Profile =>
  JSON.parse(backend.data.get(K.profile) as string) as Profile;

/** A stored profile (rev 2) with one hand counted, from a real game. */
function seededProfile(): string {
  const backend = new FakeStorage();
  const h = makeHarness({ storage: createSafeStorage(() => backend) });
  h.dispatch({ type: 'settings', patch: { players: 3 } });
  h.dispatch({ type: 'pagehide' });
  h.controller.dispose();
  return backend.data.get(K.profile) as string;
}

// The fake lock manager is shared by the tabs of an origin: a sanity check of the test double.
describe('the fake origin', () => {
  it('one lock per name, stolen with steal', async () => {
    const locks = new FakeLocks();
    const order: string[] = [];
    locks
      .request('x', {}, () => new Promise(() => order.push('a')))
      .catch((e: unknown) => order.push((e as DOMException).name));
    await settle();
    void locks
      .request('x', { steal: true }, () => order.push('b'))
      .then(() => order.push('b done'));
    await settle();
    expect(order[0]).toBe('a');
    expect([...order].sort()).toEqual(['AbortError', 'a', 'b', 'b done']);
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('b done'));
  });
});
