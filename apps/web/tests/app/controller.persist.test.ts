/**
 * The controller with storage (chunk 3.2 API, PLAN §14.2, §14.5, §14.6, §12.1): Welcome on the
 * first launch and Home after it; the session saved after every step and resumed deep-equal; the
 * settings saved 250 ms after a change and at once when hidden; Change table ends the session; a
 * hand that cannot be restored is voided with its chips back; storage failures keep the game
 * playing in memory with the banner.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TIMING } from '../../src/app/controller.ts';
import { replay } from '../../src/engine/replay.ts';
import type { EngineInput, HandState, LegalActions, PlayerAction } from '../../src/engine/types.ts';
import type { SessionState } from '../../src/persist/schema.ts';
import { createSafeStorage, STORAGE_KEYS, type SafeStorage } from '../../src/persist/storage.ts';
import { FakeStorage, securityError } from '../persist/fakeStorage.ts';
import { drive, flush, heroPolicy, makeHarness, SEED, tick, type Harness } from './harness.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const passive = (legal: LegalActions): PlayerAction =>
  legal.canCheck ? { type: 'check' } : { type: 'call' };

/** A launch: a new store and controller over the same stored data. */
function launch(backend: FakeStorage): { h: Harness; storage: SafeStorage } {
  const storage = createSafeStorage(() => backend);
  return { h: makeHarness({ storage }), storage };
}

const stored = (backend: FakeStorage): SessionState | null => {
  const raw = backend.data.get(STORAGE_KEYS.session);
  return raw === undefined ? null : (JSON.parse(raw) as SessionState);
};

/** Plays (hero passive) until `until` holds, a step at a time. */
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

/** What resume must restore exactly. */
const core = (h: Harness) => {
  const snap = h.controller.snapshot();
  return { table: snap.table, hand: snap.hand, next: snap.next, inputs: snap.inputs };
};

describe('first launch and later launches (§12.1)', () => {
  it('Welcome first; Play writes the profile and the session; the next launch opens Home', () => {
    const backend = new FakeStorage();
    const first = launch(backend).h;
    expect(first.state().ui.screen).toBe('welcome');
    expect(backend.data.size).toBe(0); // nothing written before Play
    first.dispatch({ type: 'play' });
    expect(backend.data.has(STORAGE_KEYS.profile)).toBe(true);
    expect(stored(backend)?.hand).toEqual(first.state().game.hand);
    first.controller.dispose();

    const second = launch(backend).h;
    expect(second.state().ui.screen).toBe('home');
    expect(second.state().game.hand).toEqual(first.state().game.hand);
  });
});

describe('session: saved after every step, resumed deep-equal (§14.5, Stage 3 acceptance 8)', () => {
  it('every step writes the session: its hand is the controller hand, savedAt moves on', async () => {
    const backend = new FakeStorage();
    const { h } = launch(backend);
    h.dispatch({ type: 'play' });
    let checks = 0;
    let lastSaved = '';
    h.store.subscribe((s, prev) => {
      if (s.game.hand === prev.game.hand || s.game.hand === null) return;
      const session = stored(backend) as SessionState;
      const snap = h.controller.snapshot();
      if (snap.next === null) {
        expect(session.hand).toEqual(snap.hand);
        expect(session.handInputs).toEqual(snap.inputs);
        expect(session.table).toEqual(snap.table); // the table as at hand start
      } else {
        expect(session.hand).toBeNull();
        expect(session.table).toEqual(snap.next);
      }
      expect(session.savedAt >= lastSaved).toBe(true);
      lastSaved = session.savedAt;
      checks++;
    });
    await drive(h, { hands: 3, hero: heroPolicy(SEED) });
    expect(checks).toBeGreaterThan(20);
  });

  it('mid-hand: a new launch restores table, hand and inputs deep-equal, and plays on', async () => {
    for (const cut of [1, 4, 9]) {
      const backend = new FakeStorage();
      const a = launch(backend).h;
      a.dispatch({ type: 'play' });
      await playUntil(a, () => a.controller.snapshot().inputs.length >= cut);
      const before = core(a);
      a.controller.dispose(); // the tab dies

      const b = launch(backend).h;
      expect(core(b)).toEqual(before);
      expect(b.state().game.mode).toBe('idle');
      b.dispatch({ type: 'play' }); // Home's Play continues it
      expect(b.state().ui.screen).toBe('table');
      const [done] = await drive(b, { hands: 1, hero: passive });
      const snap = b.controller.snapshot();
      // The resumed hand is one hand: its inputs replay from its table to its end.
      expect(
        replay({
          engineVersion: (done as HandState).engineVersion,
          seed: (done as HandState).seed,
          commit: null,
          table: snap.table as NonNullable<typeof snap.table>,
          inputs: snap.inputs,
        }),
      ).toEqual(done);
      expect((done as HandState).handSeq).toBe((before.hand as HandState).handSeq);
    }
  });

  it("on the hero's turn: the resumed state has the same decision and legal actions", async () => {
    const backend = new FakeStorage();
    const a = launch(backend).h;
    a.dispatch({ type: 'play' });
    await playUntil(a, () => a.state().game.mode === 'heroTurn');
    const legal = a.state().game.legal;
    const before = core(a);
    a.controller.dispose();
    const b = launch(backend).h;
    expect(core(b)).toEqual(before);
    b.dispatch({ type: 'play' });
    expect(b.state().game.mode).toBe('heroTurn');
    expect(b.state().game.legal).toEqual(legal);
  });

  it('between hands: the next table is saved and the next hand deals from it', async () => {
    const backend = new FakeStorage();
    const a = launch(backend).h;
    a.dispatch({ type: 'settings', patch: { autoNext: false } });
    a.dispatch({ type: 'play' });
    const [done] = await drive(a, { hands: 1, hero: passive });
    const next = a.state().game.next;
    expect(stored(backend)).toMatchObject({ hand: null, handInputs: [], table: next });
    a.controller.dispose();

    const b = launch(backend).h;
    expect(b.state().game).toMatchObject({ hand: null, table: null, next });
    expect(b.state().settings.autoNext).toBe(false);
    b.dispatch({ type: 'play' });
    const hand = b.state().game.hand as HandState;
    expect(hand.handSeq).toBe((done as HandState).handSeq + 1);
    expect(hand.startStacks).toEqual(next?.slots.map((slot) => slot.stack));
  });

  it('a complete hand saved just before nextTable: boot runs §14.3 step 5, Play deals the next', async () => {
    const backend = new FakeStorage();
    const a = launch(backend).h;
    a.dispatch({ type: 'play' });
    const [done] = await drive(a, { hands: 1, hero: passive });
    // Put back the session as it was right after the last step (the hand complete, no next table).
    const session = stored(backend) as SessionState;
    const table = a.controller.snapshot().table;
    backend.data.set(
      STORAGE_KEYS.session,
      JSON.stringify({ ...session, table, hand: done, handInputs: a.controller.snapshot().inputs }),
    );
    a.controller.dispose();
    // The hand was counted already (the profile says so): only step 5, the next table.
    const b = launch(backend).h;
    expect(b.state().game).toMatchObject({ hand: null, table: null });
    expect(b.state().game.next?.handsDealt).toBe((table?.handsDealt ?? 0) + 1);
    expect(stored(backend)).toMatchObject({ hand: null, table: b.state().game.next });
    b.dispatch({ type: 'play' });
    expect(b.state().game.hand?.handSeq).toBe((done as HandState).handSeq + 1);
  });

  it('a bust hero resumes into the out-of-chips dialog', async () => {
    const backend = new FakeStorage();
    const a = launch(backend).h;
    a.dispatch({ type: 'newTable', setup: { players: 3, startingStack: 200, sb: 10, bb: 20 } });
    const shove = (legal: LegalActions): PlayerAction =>
      legal.raise !== null
        ? { type: 'raise', to: legal.raise.max }
        : legal.bet !== null
          ? { type: 'bet', to: legal.bet.max }
          : passive(legal);
    for (let i = 0; i < 20_000 && !a.state().ui.overlays.includes('outOfChips'); i++) {
      const s = a.state();
      if (s.game.mode === 'heroTurn' && s.game.legal !== null) {
        a.dispatch({ type: 'act', action: shove(s.game.legal) });
      } else await tick();
    }
    expect(a.state().game.heroBust).toBe(true);
    a.controller.dispose();
    const b = launch(backend).h;
    expect(b.state().game.heroBust).toBe(true);
    b.dispatch({ type: 'play' });
    expect(b.state().ui.overlays).toEqual(['outOfChips']);
    b.dispatch({ type: 'reload' });
    expect(b.state().game.hand?.startStacks[0]).toBe(200);
  });

  it('Change table ends the session; the next launch has none', () => {
    const backend = new FakeStorage();
    const a = launch(backend).h;
    a.dispatch({ type: 'play' });
    expect(backend.data.has(STORAGE_KEYS.session)).toBe(true);
    // Change table is offered between hands only; a table with no hand in play qualifies too.
    a.controller.dispose();
    const session = stored(backend) as SessionState;
    backend.data.set(
      STORAGE_KEYS.session,
      JSON.stringify({ ...session, hand: null, handInputs: [] }),
    );
    const b = launch(backend).h;
    b.dispatch({ type: 'changeTable' });
    expect(backend.data.has(STORAGE_KEYS.session)).toBe(false);
    expect(b.state().ui.screen).toBe('setup');
    b.controller.dispose();
    const c = launch(backend).h;
    expect(c.state().game).toMatchObject({ table: null, hand: null, next: null });
  });

  it('a stored hand that fails its checks is voided: chips back, toast, table kept', () => {
    const backend = new FakeStorage();
    const a = launch(backend).h;
    a.dispatch({ type: 'play' });
    const session = stored(backend) as SessionState;
    const hand = session.hand as HandState;
    // Break chip conservation (I1): the loader must not use this hand.
    const broken = {
      ...session,
      hand: {
        ...hand,
        seats: hand.seats.map((s, i) => (i === 1 ? { ...s, stack: s.stack + 7 } : s)),
      },
    };
    backend.data.set(STORAGE_KEYS.session, JSON.stringify(broken));
    a.controller.dispose();
    const b = launch(backend).h;
    expect(b.state().ui.toasts.map((t) => t.kind)).toContain('handNotRestored');
    expect(b.state().game.hand).toBeNull();
    expect(b.state().game.next?.slots.map((s) => s.stack)).toEqual(
      session.table.slots.map((s) => s.stack),
    );
  });
});

describe('settings (§14.2, §14.6 rule 4)', () => {
  const storedSettings = (backend: FakeStorage) =>
    (JSON.parse(backend.data.get(STORAGE_KEYS.profile) as string) as { settings: unknown })
      .settings as Record<string, unknown>;

  it('are saved 250 ms after the last change, and at once when the page is hidden', async () => {
    const backend = new FakeStorage();
    const { h } = launch(backend);
    h.dispatch({ type: 'play' }); // writes the profile
    h.dispatch({ type: 'settings', patch: { speed: 'fast' } });
    await vi.advanceTimersByTimeAsync(TIMING.settingsDebounceMs - 1);
    expect(storedSettings(backend).speed).toBe('normal');
    h.dispatch({ type: 'settings', patch: { amounts: 'bb' } }); // restarts the 250 ms
    await vi.advanceTimersByTimeAsync(TIMING.settingsDebounceMs - 1);
    expect(storedSettings(backend).amounts).toBe('chips');
    await vi.advanceTimersByTimeAsync(1);
    expect(storedSettings(backend)).toMatchObject({ speed: 'fast', amounts: 'bb' });
    h.dispatch({ type: 'settings', patch: { autoNext: false } });
    h.dispatch({ type: 'visibility', hidden: true });
    expect(storedSettings(backend).autoNext).toBe(false);
  });

  it('pagehide flushes them too; the next launch uses them', async () => {
    const backend = new FakeStorage();
    const a = launch(backend).h;
    a.dispatch({ type: 'play' });
    a.dispatch({ type: 'settings', patch: { speed: 'instant' } });
    a.dispatch({ type: 'pagehide' });
    a.controller.dispose();
    const b = launch(backend).h;
    expect(b.state().settings.speed).toBe('instant');
  });

  it('keep one bot level per seat, and refuse values that are not valid settings', () => {
    const backend = new FakeStorage();
    const { h } = launch(backend);
    h.dispatch({ type: 'settings', patch: { players: 3 } });
    expect(h.state().settings.seatLevels).toEqual([null, null, null]);
    h.dispatch({ type: 'settings', patch: { players: 9 } });
    expect(h.state().settings.seatLevels).toHaveLength(9);
    const before = h.state().settings;
    h.dispatch({ type: 'settings', patch: { players: 12 } });
    h.dispatch({ type: 'settings', patch: { bb: 15 } }); // odd big blind
    h.dispatch({ type: 'settings', patch: { speed: 'warp' as never } });
    expect(h.state().settings).toBe(before);
  });

  it('Setup’s Start game stores the last-used values at once (§12.2)', async () => {
    const backend = new FakeStorage();
    const { h } = launch(backend);
    h.dispatch({ type: 'newTable', setup: { players: 4, startingStack: 5000, sb: 25, bb: 50 } });
    await flush();
    expect(storedSettings(backend)).toMatchObject({
      players: 4,
      startingStack: 5000,
      sb: 25,
      bb: 50,
      seatLevels: [null, null, null, null],
    });
  });
});

describe('storage failures (§12.14, §14.6)', () => {
  it('no usable storage: the game plays in memory and the banner shows once', async () => {
    const backend = new FakeStorage();
    backend.failAll = securityError();
    const { h } = launch(backend);
    expect(h.state().ui.storageBanner).toBe(true);
    expect(h.state().ui.screen).toBe('welcome');
    h.dispatch({ type: 'play' });
    const [done] = await drive(h, { hands: 2, hero: passive });
    expect(done?.phase).toBe('complete');
    h.dispatch({ type: 'dismissStorageBanner' });
    expect(h.state().ui.storageBanner).toBe(false);
  });

  it('a damaged profile: defaults, a kept copy and the "data damaged" toast', () => {
    const backend = new FakeStorage({ [STORAGE_KEYS.profile]: '{"schema":1,"rev":' });
    const { h } = launch(backend);
    expect(h.state().ui.toasts.map((t) => t.kind)).toContain('dataRecovered');
    expect([...backend.data.keys()].some((k) => k.startsWith('pc.corrupt.'))).toBe(true);
    expect(h.state().settings.players).toBe(6);
  });

  it('the inputs of a session are what the replay needs, nothing else', async () => {
    const backend = new FakeStorage();
    const { h } = launch(backend);
    h.dispatch({ type: 'play' });
    await playUntil(h, () => h.controller.snapshot().inputs.length >= 3);
    const session = stored(backend) as SessionState;
    const inputs: EngineInput[] = session.handInputs;
    expect(
      replay({
        engineVersion: (session.hand as HandState).engineVersion,
        seed: (session.hand as HandState).seed,
        commit: null,
        table: session.table,
        inputs,
      }),
    ).toEqual(session.hand);
  });
});
