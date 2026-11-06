/**
 * New versions between hands (PLAN §15.1, §12.11, chunk 9.5): the controller with a fake service
 * worker port (`app/swUpdate.ts` is `tests/app/swUpdate.test.ts`). A new version never reloads
 * the page mid-hand: found while a hand runs, the toast says it installs after this hand, the hand
 * plays to its end and is counted, and the page reloads as the next hand would be dealt; the new
 * version (a new launch over the same storage) goes straight back to the Table and deals that
 * hand. With no hand unfinished, on Welcome or Home, it goes in at once (an update found at
 * launch). It waits on other screens, in a tab without the game, and for good when the browser
 * keeps nothing (§14.6). Without a service worker (a plain-http LAN address, §12.14) nothing of
 * this happens. The Playwright run of the same (Stage 9 acceptance 5) is `tests/e2e/update.spec.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TIMING } from '../../src/app/controller.ts';
import type { UpdateEvent, UpdatePort } from '../../src/app/swUpdate.ts';
import { createTabLock } from '../../src/app/tabLock.ts';
import type { LegalActions, PlayerAction } from '../../src/engine/types.ts';
import type { HandRing, Profile, SessionState } from '../../src/persist/schema.ts';
import { createSafeStorage, STORAGE_KEYS } from '../../src/persist/storage.ts';
import { FakeStorage, securityError } from '../persist/fakeStorage.ts';
import { FakeOrigin, settle } from './fakeLocks.ts';
import { drive, flush, makeHarness, tick, type Harness, type HarnessOptions } from './harness.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const K = STORAGE_KEYS;

/** The service worker, as the controller sees it. */
class FakePort implements UpdatePort {
  private listener: ((event: UpdateEvent) => void) | null = null;
  checks = 0;
  applies = 0;
  reloads = 0;
  /** `apply()` is answered with `activated` at once (the worker takes over within milliseconds). */
  answerApply = true;
  started(): boolean {
    return this.listener !== null;
  }
  start(listener: (event: UpdateEvent) => void): void {
    this.listener = listener;
  }
  check(): void {
    this.checks++;
  }
  apply(): void {
    this.applies++;
    if (this.answerApply) this.emit('activated');
  }
  reload(): void {
    this.reloads++;
  }
  emit(event: UpdateEvent): void {
    this.listener?.(event);
  }
}

interface Launch {
  h: Harness;
  port: FakePort;
}

/** A launch of the app over `backend` (a new launch = the page after a reload). */
function launch(backend: FakeStorage, options: HarnessOptions = {}): Launch {
  const port = new FakePort();
  const h = makeHarness({ storage: createSafeStorage(() => backend), updates: port, ...options });
  return { h, port };
}

const passive = (legal: LegalActions): PlayerAction =>
  legal.canCheck ? { type: 'check' } : { type: 'call' };

/**
 * The toasts of these tests. The hands they play bring the collection moment's toasts too (§12.9,
 * chunk 9.1b), which `controller.collection.test.ts` covers; they are left out here.
 */
const toasts = (h: Harness): string[] =>
  h
    .state()
    .ui.toasts.map((t) => t.kind)
    .filter((kind) => kind !== 'collection');
const session = (backend: FakeStorage): SessionState =>
  JSON.parse(backend.data.get(K.session) as string) as SessionState;
const profile = (backend: FakeStorage): Profile =>
  JSON.parse(backend.data.get(K.profile) as string) as Profile;
const ring = (backend: FakeStorage): HandRing =>
  JSON.parse(backend.data.get(K.hands) as string) as HandRing;

/** Plays (the hero checks or calls) until `until` holds. */
async function playUntil(h: Harness, until: () => boolean): Promise<void> {
  for (let i = 0; i < 3000 && !until(); i++) {
    const s = h.state();
    if (s.game.mode === 'heroTurn' && s.game.legal !== null) {
      h.dispatch({ type: 'act', action: passive(s.game.legal) });
    } else {
      await tick();
    }
  }
  expect(until()).toBe(true);
}

/** 3 players at Instant speed; the next hand waits for the banner's tap unless `autoNext`. */
function setUp(h: Harness, autoNext = false): void {
  h.dispatch({ type: 'settings', patch: { players: 3, speed: 'instant', autoNext } });
}

const heroTurn = (h: Harness) => (): boolean => h.state().game.mode === 'heroTurn';
const handEnd = (h: Harness) => (): boolean => h.state().game.mode === 'handEnd';

describe('found while a hand runs (Stage 9 acceptance 5)', () => {
  it('toast; the hand plays to its end and is counted; the reload comes with the next hand', async () => {
    const backend = new FakeStorage();
    const { h, port } = launch(backend);
    setUp(h);
    h.dispatch({ type: 'play' });
    await playUntil(h, heroTurn(h));
    const handSeq = h.state().game.hand?.handSeq as number;

    port.emit('updateReady');
    expect(toasts(h)).toEqual(['updateReady']);
    // Every step of the rest of the hand: no reload, nothing let in.
    await playUntil(h, () => {
      expect(port.applies + port.reloads).toBe(0);
      return handEnd(h)();
    });
    expect(h.state().game.hand?.phase).toBe('complete');
    // The hand is committed (§14.3): its record, with every hero decision, and the stats.
    expect(profile(backend).lastCommittedHandSeq).toBe(handSeq);
    const record = ring(backend).hands.find((r) => r.handSeq === handSeq);
    expect(record?.decisions.length).toBe(h.state().game.decisions.length);
    expect(record?.decisions.length).toBeGreaterThan(0);
    // The banner waits for its tap: still the old page.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(port.applies + port.reloads).toBe(0);
    expect(toasts(h)).toEqual([]); // the toast went after its 4 s
    port.emit('updateReady'); // found again by a later check: once per launch is enough
    expect(toasts(h)).toEqual([]);

    // "Next hand": instead of dealing, the session is saved and the new version comes in.
    h.dispatch({ type: 'nextHand' });
    expect([port.applies, port.reloads]).toEqual([1, 1]);
    expect(h.state().game.hand?.handSeq).toBe(handSeq); // nothing dealt in the old page
    const saved = session(backend);
    expect(saved.hand).toBeNull();
    expect(saved.resumeAfterUpdate).toBe(true);
    expect(saved.table.nextHandSeq).toBe(handSeq + 1);
    h.controller.dispose();

    // The new version: straight back to the Table, the next hand dealt; play goes on.
    const v2 = launch(backend).h;
    expect(v2.state().ui.screen).toBe('table');
    expect(v2.state().game.hand?.handSeq).toBe(handSeq + 1);
    expect(v2.state().game.hand?.phase).not.toBe('complete');
    expect(session(backend).resumeAfterUpdate).toBe(false); // once
    expect(toasts(v2)).toEqual([]);
    v2.dispatch({ type: 'settings', patch: { autoNext: true } });
    const played = await drive(v2, { hands: 2, hero: passive });
    expect(played.map((hand) => hand.handSeq)).toEqual([handSeq + 1, handSeq + 2]);
    expect(profile(backend).lastCommittedHandSeq).toBe(handSeq + 2);
  });

  it('with "deal the next hand by itself": the reload comes after the hand-end pause', async () => {
    const backend = new FakeStorage();
    const { h, port } = launch(backend);
    setUp(h, true);
    h.dispatch({ type: 'play' });
    await playUntil(h, heroTurn(h));
    port.emit('updateReady');
    await playUntil(h, handEnd(h));
    expect(port.reloads).toBe(0);
    await vi.advanceTimersByTimeAsync(TIMING.nextHandMinMs - 50);
    expect(port.reloads).toBe(0); // the result stays on show for the whole pause
    await vi.advanceTimersByTimeAsync(100);
    expect([port.applies, port.reloads]).toEqual([1, 1]);
    expect(session(backend).resumeAfterUpdate).toBe(true);
  });

  it('the page reloads only once the new version has taken over, and at the latest after 5 s', async () => {
    const backend = new FakeStorage();
    const { h, port } = launch(backend);
    port.answerApply = false;
    setUp(h);
    h.dispatch({ type: 'play' });
    await playUntil(h, heroTurn(h));
    port.emit('updateReady');
    await playUntil(h, handEnd(h));
    h.dispatch({ type: 'nextHand' });
    expect([port.applies, port.reloads]).toEqual([1, 0]);
    h.dispatch({ type: 'nextHand' }); // a second tap deals nothing either
    h.dispatch({ type: 'topUp' }); // nor changes the session the reload resumes
    expect(port.applies).toBe(1);
    expect(session(backend).resumeAfterUpdate).toBe(true);
    port.emit('activated');
    expect(port.reloads).toBe(1);

    const slow = launch(new FakeStorage());
    slow.port.answerApply = false;
    slow.h.dispatch({ type: 'settings', patch: { players: 3 } });
    slow.port.emit('updateReady'); // Welcome, nothing unfinished: at once
    expect([slow.port.applies, slow.port.reloads]).toEqual([1, 0]);
    await vi.advanceTimersByTimeAsync(TIMING.updateReloadMs - 1);
    expect(slow.port.reloads).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(slow.port.reloads).toBe(1);
  });

  it('a new table from Setup, or Reload after a bust, also reloads instead of dealing', async () => {
    const backend = new FakeStorage();
    const { h, port } = launch(backend);
    setUp(h);
    h.dispatch({ type: 'go', screen: 'setup' });
    port.emit('updateReady'); // Setup: the player is choosing; nothing yet
    expect(port.applies).toBe(0);
    h.dispatch({ type: 'newTable', setup: { players: 4 } });
    expect([port.applies, port.reloads]).toEqual([1, 1]);
    const saved = session(backend);
    expect([saved.hand, saved.resumeAfterUpdate, saved.table.config.seatCount]).toEqual([
      null,
      true,
      4,
    ]);
    h.controller.dispose();
    const v2 = launch(backend).h;
    expect(v2.state().ui.screen).toBe('table');
    expect(v2.state().game.hand?.seats).toHaveLength(4);
  });
});

describe('found with no hand unfinished (an update found at launch)', () => {
  it('Welcome on a first launch: reloads at once, writes nothing, no toast', () => {
    const backend = new FakeStorage();
    const { h, port } = launch(backend);
    expect(h.state().ui.screen).toBe('welcome');
    port.emit('updateReady');
    expect([port.applies, port.reloads]).toEqual([1, 1]);
    expect(toasts(h)).toEqual([]);
    expect(backend.data.size).toBe(0); // still a first launch
  });

  it('Home after a finished hand: reloads at once; the new version opens Home, Play deals', async () => {
    const backend = new FakeStorage();
    const { h, port } = launch(backend);
    setUp(h);
    h.dispatch({ type: 'play' });
    await playUntil(h, handEnd(h));
    const handSeq = h.state().game.hand?.handSeq as number;
    h.dispatch({ type: 'leaveTable' });
    expect(h.state().ui.screen).toBe('home');
    port.emit('updateReady');
    expect([port.applies, port.reloads]).toEqual([1, 1]);
    expect(toasts(h)).not.toContain('updateReady');
    expect(session(backend).resumeAfterUpdate).toBe(false);
    h.controller.dispose();

    const v2 = launch(backend).h;
    expect(v2.state().ui.screen).toBe('home');
    expect(v2.state().game.hand).toBeNull();
    v2.dispatch({ type: 'play' });
    expect(v2.state().game.hand?.handSeq).toBe(handSeq + 1);
  });

  it('a saved hand left unfinished: no reload on Home; the toast; Play finishes it, then the reload', async () => {
    const backend = new FakeStorage();
    const first = launch(backend).h;
    setUp(first);
    first.dispatch({ type: 'play' });
    await playUntil(first, heroTurn(first));
    first.controller.dispose(); // the app was closed mid-hand

    const { h, port } = launch(backend);
    expect(h.state().ui.screen).toBe('home');
    port.emit('updateReady'); // found at launch
    expect(port.applies + port.reloads).toBe(0);
    expect(toasts(h)).toEqual(['updateReady']);
    h.dispatch({ type: 'go', screen: 'settings' });
    h.dispatch({ type: 'back' }); // Home again: the hand is still unfinished
    expect(port.applies).toBe(0);
    h.dispatch({ type: 'play' });
    await playUntil(h, handEnd(h));
    expect(port.applies).toBe(0);
    h.dispatch({ type: 'nextHand' });
    expect([port.applies, port.reloads]).toEqual([1, 1]);
    expect(session(backend).resumeAfterUpdate).toBe(true);
  });

  it('other screens wait (no toast without a hand); back on Home it goes in', () => {
    const backend = new FakeStorage();
    const { h, port } = launch(backend);
    h.dispatch({ type: 'go', screen: 'settings' });
    port.emit('updateReady');
    expect(port.applies).toBe(0);
    expect(toasts(h)).toEqual([]);
    h.dispatch({ type: 'open', overlay: 'menu' });
    h.dispatch({ type: 'back' });
    h.dispatch({ type: 'back' });
    expect(h.state().ui.screen).toBe('welcome');
    expect([port.applies, port.reloads]).toEqual([1, 1]);
  });
});

describe('when it never reloads', () => {
  it('the browser keeps nothing (§14.6): no reload, no toast; the game plays on in memory', async () => {
    const backend = new FakeStorage();
    backend.failAll = securityError();
    const { h, port } = launch(backend);
    setUp(h, true);
    h.dispatch({ type: 'play' });
    port.emit('updateReady');
    const played = await drive(h, { hands: 2, hero: passive });
    expect(played).toHaveLength(2);
    h.dispatch({ type: 'leaveTable' });
    expect(port.applies + port.reloads).toBe(0);
    expect(toasts(h)).not.toContain('updateReady');
  });

  it('no service worker (a plain-http LAN address, §12.14): no port, no timers of its own', async () => {
    const backend = new FakeStorage();
    const h = makeHarness({ storage: createSafeStorage(() => backend) });
    expect(vi.getTimerCount()).toBe(0);
    setUp(h);
    h.dispatch({ type: 'visibility', hidden: true });
    h.dispatch({ type: 'visibility', hidden: false });
    await vi.advanceTimersByTimeAsync(TIMING.updateCheckMs * 2);
    h.dispatch({ type: 'play' });
    await drive(h, { hands: 1, hero: passive });
    expect(toasts(h)).toEqual([]);
    expect(session(backend).resumeAfterUpdate).toBe(false);
  });
});

describe('several tabs (§14.7): only the tab with the game lets a new version in', () => {
  /** A tab of `origin` (its own page: lock and storage events), launched over its storage. */
  const tabOf = (origin: FakeOrigin): Launch => {
    const page = origin.page();
    return launch(origin.backend as FakeStorage, {
      storage: createSafeStorage(() => origin.storageFor(page)),
      tabLock: createTabLock(page),
    });
  };

  /** One hand played in a tab with the lock, then reloaded into a new version as the next is due. */
  async function reloadedAtHandEnd(origin: FakeOrigin): Promise<number> {
    const first = tabOf(origin);
    await settle();
    setUp(first.h);
    first.h.dispatch({ type: 'play' });
    await playUntil(first.h, handEnd(first.h));
    const handSeq = first.h.state().game.hand?.handSeq as number;
    first.port.emit('updateReady');
    first.h.dispatch({ type: 'nextHand' });
    expect(first.port.reloads).toBe(1);
    first.h.controller.dispose(); // the old page goes, and its lock with it
    await settle();
    return handSeq;
  }

  it('a read-only tab waits; once in (another tab let it in), it reloads; the writer only at its hand end', async () => {
    const origin = new FakeOrigin(new FakeStorage());
    const a = tabOf(origin);
    await settle();
    setUp(a.h);
    a.h.dispatch({ type: 'play' });
    await playUntil(a.h, heroTurn(a.h));
    const b = tabOf(origin);
    await settle();
    expect(b.h.state().data.tab).toBe('readOnly');

    b.port.emit('updateReady'); // Home, but another tab has the game (mid-hand)
    a.port.emit('updateReady');
    expect([b.port.applies, b.port.reloads, a.port.applies, a.port.reloads]).toEqual([0, 0, 0, 0]);
    expect(toasts(a.h)).toEqual(['updateReady']);
    expect(toasts(b.h)).toEqual([]);

    // Say the new version got in anyway (a third tab, an older page): it controls both pages now.
    b.port.emit('activated');
    a.port.emit('activated');
    expect(b.port.reloads).toBe(1); // nothing to lose there
    expect(a.port.reloads).toBe(0); // mid-hand: not now
    await playUntil(a.h, handEnd(a.h));
    expect(a.port.reloads).toBe(0);
    a.h.dispatch({ type: 'nextHand' });
    expect([a.port.applies, a.port.reloads]).toEqual([0, 1]); // in already: only the reload
    expect(session(origin.backend as FakeStorage).resumeAfterUpdate).toBe(true);
  });

  it('after the reload, the way back to the Table waits for the lock (it writes first)', async () => {
    const origin = new FakeOrigin(new FakeStorage());
    const handSeq = await reloadedAtHandEnd(origin);
    const { h } = tabOf(origin);
    expect(h.state().data.tab).toBe('pending');
    expect(h.state().ui.screen).toBe('home');
    expect(h.state().game.hand).toBeNull();
    await settle();
    expect(h.state().data.tab).toBe('writer');
    expect(h.state().ui.screen).toBe('table');
    expect(h.state().game.hand?.handSeq).toBe(handSeq + 1);
  });

  it('a newer version found before the lock answered goes in then, before the hand is dealt', async () => {
    const origin = new FakeOrigin(new FakeStorage());
    await reloadedAtHandEnd(origin);
    const { h, port } = tabOf(origin);
    port.emit('updateReady');
    expect(port.applies).toBe(0); // not before this tab knows it has the game
    await settle();
    expect([port.applies, port.reloads]).toEqual([1, 1]);
    expect(h.state().game.hand).toBeNull(); // the newest version deals it
    expect(session(origin.backend as FakeStorage).resumeAfterUpdate).toBe(true);
  });
});

describe('asking the server for a new version', () => {
  it('when the page comes back to the front, at most once a minute, and hourly while in front', async () => {
    const { h, port } = launch(new FakeStorage());
    expect(port.started()).toBe(true);
    expect(port.checks).toBe(0); // the browser checks by itself when a page loads
    h.dispatch({ type: 'visibility', hidden: true });
    h.dispatch({ type: 'visibility', hidden: false });
    expect(port.checks).toBe(1);
    h.dispatch({ type: 'visibility', hidden: true });
    h.dispatch({ type: 'visibility', hidden: false });
    expect(port.checks).toBe(1); // within a minute
    await vi.advanceTimersByTimeAsync(TIMING.updateCheckMinMs);
    h.dispatch({ type: 'visibility', hidden: false });
    expect(port.checks).toBe(2);
    await vi.advanceTimersByTimeAsync(TIMING.updateCheckMs);
    expect(port.checks).toBe(3); // the hourly one
    h.dispatch({ type: 'visibility', hidden: true });
    await vi.advanceTimersByTimeAsync(TIMING.updateCheckMs);
    expect(port.checks).toBe(3); // hidden: it checks when it comes back
    h.dispatch({ type: 'visibility', hidden: false });
    expect(port.checks).toBe(4);
    h.controller.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('no more checks once a new version is on its way in', async () => {
    const { h, port } = launch(new FakeStorage());
    port.answerApply = false;
    port.emit('updateReady'); // Welcome: it goes in at once
    expect(port.applies).toBe(1);
    h.dispatch({ type: 'visibility', hidden: false });
    expect(port.checks).toBe(0);
    await flush();
  });
});

describe('"Ready to play offline." (§12.11: once ever)', () => {
  it('a first launch: the toast, the flag kept in memory; Play writes it with the profile', () => {
    const backend = new FakeStorage();
    const { h, port } = launch(backend);
    port.emit('offlineReady');
    expect(toasts(h)).toEqual(['offlineReady']);
    expect(backend.data.has(K.profile)).toBe(false); // still a first launch (Welcome next time)
    h.dispatch({ type: 'play' });
    expect(profile(backend).flags.offlineReady).toBe(true);
    h.controller.dispose();
    const again = launch(backend);
    again.port.emit('offlineReady');
    expect(toasts(again.h)).toEqual([]);
  });

  it('a stored profile: written at once', () => {
    const backend = new FakeStorage();
    const first = launch(backend);
    first.h.dispatch({ type: 'play' });
    first.h.controller.dispose();
    const { h, port } = launch(backend);
    const rev = profile(backend).rev;
    port.emit('offlineReady');
    expect(toasts(h)).toEqual(['offlineReady']);
    expect(profile(backend).flags.offlineReady).toBe(true);
    expect(profile(backend).rev).toBe(rev + 1);
  });

  it('turned off (`offlineToast: false`, the E2E specs that do not ask for it): nothing at all', () => {
    const backend = new FakeStorage();
    const { h, port } = launch(backend, { offlineToast: false });
    port.emit('offlineReady');
    expect(toasts(h)).toEqual([]);
    h.dispatch({ type: 'play' });
    expect(profile(backend).flags.offlineReady).toBe(false);
  });
});
