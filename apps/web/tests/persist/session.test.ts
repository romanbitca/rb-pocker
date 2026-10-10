import { describe, expect, it, vi } from 'vitest';
import { ENGINE_VERSION, type HandState } from '../../src/engine/types.ts';
import {
  clearSession,
  loadSession,
  newSession,
  saveSession,
  type SessionLoad,
  type SessionLoadOptions,
} from '../../src/persist/session.ts';
import { isSessionState, type SessionState } from '../../src/persist/schema.ts';
import { STORAGE_KEYS, createSafeStorage } from '../../src/persist/storage.ts';
import { clone, foldedToBigBlind, handAtStart } from '../engine/fixtures.ts';
import { FakeStorage, quotaError, securityError } from './fakeStorage.ts';
import { NOW, decision, idleSession, midHandSession, tableFor } from './fixtures.ts';

const KEY = STORAGE_KEYS.session;
const OPTIONS: SessionLoadOptions = { engineVersion: ENGINE_VERSION, now: NOW };

function setup(initial: Record<string, string> = {}): {
  fake: FakeStorage;
  launch: () => ReturnType<typeof createSafeStorage>;
} {
  const fake = new FakeStorage(initial);
  return { fake, launch: () => createSafeStorage(() => fake) };
}

/** Saves `s` (as the controller does after a step), then loads it in a new launch. */
function reload(s: SessionState, options: SessionLoadOptions = OPTIONS) {
  const { fake, launch } = setup();
  expect(saveSession(launch(), s)).toEqual({ ok: true });
  return { fake, launch, load: loadSession(launch(), options) };
}

/** The stored session text for `s` after `edit` (the controller never writes these: damage). */
function stored(s: SessionState, edit: (copy: SessionState) => void): string {
  const copy = clone(s);
  edit(copy);
  return JSON.stringify(copy);
}

/** A 9-handed hand with a long input list and meta: an upper bound for the session's size. */
function bigSession(): SessionState {
  const hand = handAtStart({ stacks: Array.from({ length: 9 }, () => 10000), button: 0 });
  const session = midHandSession();
  return {
    ...idleSession(tableFor(hand)),
    hand,
    handInputs: Array.from({ length: 80 }, (_, i) => ({
      kind: 'act' as const,
      seat: i % 9,
      action: { type: 'raise' as const, to: 1000 + i * 200 },
    })),
    meta: {
      decisions: Array.from({ length: 12 }, (_, i) => decision({ decisionId: i + 1 })),
      undoCount: 2,
      hintShown: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, true])),
    },
    undoSnapshot: {
      decisionId: 12,
      state: clone(hand),
      meta: { decisions: [], undoCount: 0, hintShown: {} },
      inputCount: 40,
    },
    seatStats: Array.from({ length: 9 }, () => session.seatStats[1] ?? null),
  };
}

describe('persist/session save and resume (§14.5)', () => {
  it('nothing saved: status none', () => {
    expect(loadSession(setup().launch(), OPTIONS)).toEqual({ status: 'none' });
  });

  it.each([
    ['mid-hand, with an undo snapshot', midHandSession],
    [
      'between hands',
      () => idleSession(tableFor(handAtStart({ stacks: [2000, 0, 2000], button: 2 }))),
    ],
    [
      'a complete hand waiting for its commit',
      () => {
        const done = foldedToBigBlind().complete;
        return { ...idleSession(tableFor(done)), hand: done };
      },
    ],
    ['nine seats, a long hand', bigSession],
  ])('%s: the JSON round trip restores a deep-equal state', (_, make) => {
    const original = make();
    expect(isSessionState(original)).toBe(true);
    const { load } = reload(original);
    expect(load).toStrictEqual({ status: 'ok', session: original });
  });

  it('saving is one setItem and nothing else (it runs after every engine step)', () => {
    const { fake, launch } = setup();
    const store = launch();
    const getItem = vi.spyOn(fake, 'getItem');
    const setItem = vi.spyOn(fake, 'setItem');
    const session = bigSession();
    expect(saveSession(store, session)).toEqual({ ok: true });
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(setItem).toHaveBeenCalledWith(KEY, JSON.stringify(session));
    expect(getItem).not.toHaveBeenCalled();
  });

  it('a nine-seat session stays small (§14.1: ~15 KB)', () => {
    expect(JSON.stringify(bigSession()).length).toBeLessThan(20_000);
  });

  it('saving never throws, even for a value JSON cannot write', () => {
    const store = setup().launch();
    const cyclic = midHandSession() as SessionState & { self?: unknown };
    cyclic.self = cyclic;
    expect(saveSession(store, cyclic)).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('newSession: a valid session between hands', () => {
    const table = tableFor(handAtStart({ stacks: [2000, 2000, 2000, 2000], button: 0 }));
    const s = newSession(table, NOW);
    expect(isSessionState(s)).toBe(true);
    expect(s).toMatchObject({
      savedAt: NOW.toISOString(),
      sessionStart: NOW.toISOString(),
      hand: null,
      undoSnapshot: null,
      seatStats: [null, null, null, null],
    });
  });

  it('clearSession removes it', () => {
    const { fake, launch } = reload(midHandSession());
    expect(clearSession(launch())).toEqual({ ok: true });
    expect(fake.data.has(KEY)).toBe(false);
    expect(loadSession(launch(), OPTIONS)).toEqual({ status: 'none' });
  });
});

describe('persist/session voiding a hand that cannot be restored (§14.3, §14.6)', () => {
  /** Loads a damaged mid-hand session and checks the void: hand dropped, chips returned. */
  function expectVoided(raw: string, problem: string): SessionState {
    const { fake, launch } = setup({ [KEY]: raw });
    const load = loadSession(launch(), OPTIONS);
    expect(load.status).toBe('voided');
    if (load.status !== 'voided') throw new Error('not voided');
    expect(load.problem).toContain(problem);
    const s = load.session;
    expect(isSessionState(s)).toBe(true);
    expect(s).toMatchObject({ hand: null, handInputs: [], undoSnapshot: null });
    // Written back: the next launch resumes the table with no hand and no second toast.
    expect(JSON.parse(fake.data.get(KEY) as string)).toStrictEqual(s);
    expect(loadSession(launch(), OPTIONS)).toStrictEqual({ status: 'ok', session: s });
    return s;
  }

  it('a hand rejected by the invariants: the table keeps the hand-start stacks (chips returned)', () => {
    const original = midHandSession();
    const hand = original.hand as HandState;
    expect(hand.seats.map((seat) => seat.stack)).toEqual([9900, 9900]); // 100 each in the pot
    const s = expectVoided(
      stored(original, (c) => (((c.hand as HandState).seats[1] as { stack: number }).stack += 500)),
      'session.hand: I1 chip conservation',
    );
    expect(s.table).toStrictEqual(original.table);
    expect(s.table.slots.map((slot) => slot.stack)).toEqual(hand.startStacks);
    // What is still valid at table level is kept.
    expect(s.savedAt).toBe(original.savedAt);
    expect(s.sessionStart).toBe(original.sessionStart);
    expect(s.seatStats).toStrictEqual(original.seatStats);
  });

  it.each([
    [
      'a hand that fails the type guard',
      (c: SessionState) => ((c as { hand: unknown }).hand = 'hand'),
      'session.hand: I0',
    ],
    [
      'a missing hand field',
      (c: SessionState) => delete (c as { hand?: unknown }).hand,
      'session.hand: I0',
    ],
    [
      'a hand from another table',
      (c: SessionState) => (c.table.nextHandSeq = 5),
      'session.hand.handSeq',
    ],
    [
      'a broken undo snapshot',
      (c: SessionState) => ((c.undoSnapshot as { inputCount: number }).inputCount = 9),
      'session.undoSnapshot.inputCount',
    ],
    ['broken hand meta', (c: SessionState) => (c.meta.undoCount = -1), 'session.meta.undoCount'],
    [
      'an input for a missing seat',
      (c: SessionState) => c.handInputs.push({ kind: 'act', seat: 4, action: { type: 'fold' } }),
      'session.handInputs[3].seat',
    ],
  ])('%s', (_, edit, problem) => {
    expectVoided(stored(midHandSession(), edit), problem);
  });

  it('table-level fields that are damaged fall back to fresh values', () => {
    const s = expectVoided(
      stored(midHandSession(), (c) => {
        c.savedAt = 'yesterday';
        (c as { sessionStart: unknown }).sessionStart = 7;
        c.seatStats = [null];
        (c as { resumeAfterUpdate: unknown }).resumeAfterUpdate = 'no';
      }),
      'session.savedAt',
    );
    expect(s).toMatchObject({
      savedAt: NOW.toISOString(),
      sessionStart: NOW.toISOString(),
      seatStats: [null, null],
      resumeAfterUpdate: false,
    });
  });

  it('a hand from another engine major version is voided (H.2 rule 4)', () => {
    const { load } = reload(midHandSession(), { ...OPTIONS, engineVersion: '1.0.0' });
    expect(load).toMatchObject({ status: 'voided', session: { hand: null } });
    if (load.status === 'voided') expect(load.problem).toContain('H.2 rule 4');
  });

  it('an undo snapshot from another engine major version voids the hand too', () => {
    const s = midHandSession();
    (s.undoSnapshot as { state: HandState }).state.engineVersion = '2.0.0';
    const { load } = reload(s);
    expect(load.status).toBe('voided');
    if (load.status === 'voided') expect(load.problem).toContain('session.undoSnapshot.state');
  });

  it('another minor version of the same engine major resumes', () => {
    const s = midHandSession();
    const [major] = ENGINE_VERSION.split('.');
    (s.hand as HandState).engineVersion = `${major}.99.3`;
    expect(reload(s).load).toMatchObject({ status: 'ok' });
    expect(reload(midHandSession(), { ...OPTIONS, engineVersion: 'dev' }).load.status).toBe(
      'voided',
    );
  });

  it('between hands nothing is voided when the engine changes', () => {
    const idle = idleSession(tableFor(handAtStart({ stacks: [2000, 2000], button: 0 })));
    expect(reload(idle, { ...OPTIONS, engineVersion: '9.0.0' }).load).toStrictEqual({
      status: 'ok',
      session: idle,
    });
  });
});

describe('persist/session discarding what has no usable table (§14.6)', () => {
  const valid = JSON.stringify(midHandSession());
  it.each([
    ['corrupt JSON', '{"schema":1,"savedAt"', 'not valid JSON'],
    ['a truncated session', valid.slice(0, valid.length / 2), 'not valid JSON'],
    ['not an object', '[]', 'no schema version'],
    ['null', 'null', 'no schema version'],
    ['no schema', JSON.stringify({ table: 1 }), 'no schema version'],
    [
      'a newer schema',
      stored(midHandSession(), (c) => ((c as { schema: number }).schema = 2)),
      'schema 2 is newer than this app (1)',
    ],
    [
      'an older schema',
      stored(midHandSession(), (c) => ((c as { schema: number }).schema = 0)),
      'no migration from schema 0',
    ],
    [
      'no table',
      stored(midHandSession(), (c) => delete (c as { table?: unknown }).table),
      'session.table',
    ],
    [
      'a damaged table',
      stored(midHandSession(), (c) => ((c.table.slots[0] as { kind: string }).kind = 'bot')),
      'session.table.slots[0]',
    ],
  ])('%s: discarded and removed, never thrown', (_, raw, problem) => {
    const { fake, launch } = setup({ [KEY]: raw });
    const load = loadSession(launch(), OPTIONS);
    expect(load.status).toBe('discarded');
    if (load.status === 'discarded') expect(load.problem).toContain(problem);
    expect(fake.data.has(KEY)).toBe(false);
    expect(loadSession(launch(), OPTIONS)).toEqual({ status: 'none' });
  });

  it('an older schema with a migration is migrated and written back', () => {
    const raw = stored(midHandSession(), (c) => ((c as { schema: number }).schema = 0));
    const { fake, launch } = setup({ [KEY]: raw });
    const migrations = { 0: (x: unknown) => ({ ...(x as object), schema: 1 }) };
    const load = loadSession(launch(), { ...OPTIONS, migrations });
    expect(load).toStrictEqual({ status: 'ok', session: midHandSession() });
    expect(JSON.parse(fake.data.get(KEY) as string)).toStrictEqual(midHandSession());
  });

  it('readOnly (a tab without the writer lock, §14.7): the same results, nothing written or removed', () => {
    const cases: [string, SessionLoad['status']][] = [
      ['{broken', 'discarded'],
      [stored(midHandSession(), (c) => (c.table.nextHandSeq = 5)), 'voided'],
      [stored(midHandSession(), (c) => ((c as { schema: number }).schema = 0)), 'ok'],
    ];
    const migrations = { 0: (x: unknown) => ({ ...(x as object), schema: 1 }) };
    for (const [raw, status] of cases) {
      const { fake, launch } = setup({ [KEY]: raw });
      const load = loadSession(launch(), { ...OPTIONS, migrations, readOnly: true });
      expect(load.status).toBe(status);
      expect(fake.writeLog).toEqual([]);
      expect(fake.data.get(KEY)).toBe(raw);
    }
  });
});

describe('persist/session with per-seat bot levels (§9.3, chunk 7.2)', () => {
  /** The stored text of a mid-hand session whose table plays at Medium, with these overrides. */
  function sessionWith(seatLevels: unknown[]): string {
    return stored(midHandSession(), (c) => {
      c.table.config.botLevel = 'medium';
      c.table.config.seatLevels = seatLevels as typeof c.table.config.seatLevels;
    });
  }
  const seats = midHandSession().table.config.seatCount;
  const own = (...levels: ('easy' | 'medium' | 'hard' | 'expert' | null)[]) =>
    Array.from({ length: seats }, (_, i) => levels[i] ?? null);

  it('keeps the levels in force: the table of the hand in play comes back as it was saved', () => {
    const original = bigSession();
    original.table.config.botLevel = 'medium';
    original.table.config.seatLevels = [
      null,
      'expert',
      null,
      'easy',
      null,
      'hard',
      null,
      null,
      'medium',
    ];
    expect(isSessionState(original)).toBe(true);
    const { load } = reload(original);
    expect(load).toStrictEqual({ status: 'ok', session: original });
    if (load.status === 'ok') {
      expect(load.session.table.config.botLevel).toBe('medium');
      expect(load.session.table.config.seatLevels).toEqual(original.table.config.seatLevels);
    }
  });

  it('a table between hands keeps its levels too', () => {
    const between = idleSession(tableFor(handAtStart({ stacks: [2000, 2000, 2000], button: 1 })));
    between.table.config.seatLevels = [null, 'hard', null];
    const { load } = reload(between);
    expect(load).toStrictEqual({ status: 'ok', session: between });
  });

  it.each([
    ['one level too few', (l: unknown[]) => l.slice(0, -1), 'session.table.config.seatLevels'],
    ['one level too many', (l: unknown[]) => [...l, null], 'session.table.config.seatLevels'],
    [
      'a level for the hero',
      (l: unknown[]) => ['hard', ...l.slice(1)],
      'session.table.config.seatLevels[0]',
    ],
    [
      'a level that is not one',
      (l: unknown[]) => l.map((x, i) => (i === 1 ? 'legend' : x)),
      'session.table.config.seatLevels[1]',
    ],
    [
      'a level as a number',
      (l: unknown[]) => l.map((x, i) => (i === 1 ? 3 : x)),
      'session.table.config.seatLevels[1]',
    ],
  ])('%s: discarded, never thrown', (_, damage, problem) => {
    const { fake, launch } = setup({ [KEY]: sessionWith(damage(own(null, 'hard', null, 'easy'))) });
    const load = loadSession(launch(), OPTIONS);
    expect(load.status).toBe('discarded');
    if (load.status === 'discarded') expect(load.problem).toContain(problem);
    expect(fake.data.has(KEY)).toBe(false);
  });
});

describe('persist/session when storage fails (§14.6 rule 3, §14.9)', () => {
  it('missing localStorage: unavailable, no exception; saves keep the session in memory', () => {
    const store = createSafeStorage(() => null);
    const banner = vi.fn();
    store.onFailure(banner);
    expect(loadSession(store, OPTIONS)).toEqual({ status: 'unavailable', reason: 'unavailable' });
    for (let i = 0; i < 5; i++) {
      expect(saveSession(store, midHandSession())).toEqual({ ok: false, reason: 'unavailable' });
    }
    expect(loadSession(store, OPTIONS)).toStrictEqual({ status: 'ok', session: midHandSession() });
    expect(banner).toHaveBeenCalledTimes(1);
  });

  it('quota exceeded on every step: ok false, the banner once, the last good save kept', () => {
    const { fake, launch } = setup();
    const store = launch();
    const banner = vi.fn();
    store.onFailure(banner);
    const first = idleSession(tableFor(handAtStart({ stacks: [2000, 2000], button: 0 })));
    expect(saveSession(store, first)).toEqual({ ok: true });
    fake.failWrites = quotaError();
    for (let i = 0; i < 10; i++) {
      expect(saveSession(store, midHandSession())).toEqual({ ok: false, reason: 'quota' });
    }
    expect(banner).toHaveBeenCalledTimes(1);
    expect(fake.data.get(KEY)).toBe(JSON.stringify(first));
    fake.failWrites = null;
    expect(saveSession(store, midHandSession())).toEqual({ ok: true });
    expect(loadSession(launch(), OPTIONS)).toStrictEqual({
      status: 'ok',
      session: midHandSession(),
    });
  });

  it('a SecurityError on read is "unavailable"', () => {
    const { fake, launch } = setup({ [KEY]: JSON.stringify(midHandSession()) });
    fake.failAll = securityError();
    expect(loadSession(launch(), OPTIONS)).toEqual({ status: 'unavailable', reason: 'security' });
  });

  it('a void that cannot be written back still returns its result', () => {
    const raw = stored(midHandSession(), (c) => (c.table.nextHandSeq = 5));
    const { fake, launch } = setup({ [KEY]: raw });
    fake.failWrites = quotaError();
    expect(loadSession(launch(), OPTIONS)).toMatchObject({ status: 'voided' });
    expect(fake.data.get(KEY)).toBe(raw);
  });
});
