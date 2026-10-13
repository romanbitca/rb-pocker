/**
 * The commit protocol at hand end and the stores it writes (PLAN §14.3, §14.6, §14.9; chunk 8.1):
 * the profile's `rev` check and `.bak` copy on every write, the `.bak` fallback on load, the hand
 * ring, and crash injection at every write of the protocol. The controller's side (records, the
 * load table at boot, every write of whole games) is `tests/app/controller.commit.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { commitHand, type CommitResult, type HandCommit } from '../../src/persist/commit.ts';
import { HANDS_KEEP, loadHands, upsertHand } from '../../src/persist/hands.ts';
import { checkWriter, loadProfile, saveProfile, saveSettings } from '../../src/persist/profile.ts';
import {
  defaultProfile,
  type HandRecord,
  type HandRing,
  type Profile,
  type SessionState,
} from '../../src/persist/schema.ts';
import { applyHand } from '../../src/persist/stats.ts';
import { createSafeStorage, STORAGE_KEYS, type SafeStorage } from '../../src/persist/storage.ts';
import { FakeStorage, quotaError } from './fakeStorage.ts';
import {
  handRecord,
  idleSession,
  midHandSession,
  NOW,
  profileV0ToV1,
  v0Profile,
} from './fixtures.ts';

const K = STORAGE_KEYS;
const LATER = new Date('2026-09-28T10:05:00.000Z');
const COPY = 'pc.corrupt.2026-09-28T10:00:00.000Z';

const storeOver = (fake: FakeStorage): SafeStorage => createSafeStorage(() => fake);
const stored = <T>(fake: FakeStorage, key: string): T =>
  JSON.parse(fake.data.get(key) as string) as T;
const ring = (fake: FakeStorage): number[] =>
  stored<HandRing>(fake, K.hands).hands.map((r) => r.handSeq);

/** A clean hand (no Undo) with this `handSeq`. */
const record = (handSeq: number, overrides: Partial<HandRecord> = {}): HandRecord => ({
  ...handRecord(),
  handSeq,
  assisted: false,
  undoCount: 0,
  ...overrides,
});

/** Between hands, at the record's table: what step 5 writes. */
const nextSession = (): SessionState => idleSession(midHandSession().table);

/** The commit of `r`: `applyHand` only (the hero model is the controller's). */
const commitOf = (r: HandRecord, session: SessionState | null = nextSession()): HandCommit => ({
  record: r,
  apply: (p) => ({ ...p, stats: applyHand(p.stats, r) }),
  session,
});

/** A profile that has counted `hands` hands (1..hands), as stored after `rev` writes. */
function counted(hands: number, rev = hands + 1): Profile {
  let profile = defaultProfile(NOW);
  for (let seq = 1; seq <= hands; seq++) profile = commitOf(record(seq)).apply(profile);
  return { ...profile, rev, lastCommittedHandSeq: hands };
}

const total = (p: Profile): number => p.stats.results.clean.hands + p.stats.results.practice.hands;

describe('profile writes: the rev check and the backup (§14.3 steps 2–4)', () => {
  it('the first write has nothing to back up; every later one copies the stored string first', () => {
    const fake = new FakeStorage();
    const store = storeOver(fake);
    const first = saveProfile(store, defaultProfile(NOW), NOW);
    expect(fake.writeLog).toEqual([K.profile]);
    const raw = fake.data.get(K.profile);
    const second = saveProfile(store, first.profile, LATER);
    expect(second.result).toEqual({ ok: true });
    expect(fake.writeLog).toEqual([K.profile, K.profileBackup, K.profile]);
    expect(fake.data.get(K.profileBackup)).toBe(raw);
    expect(stored<Profile>(fake, K.profile)).toEqual(second.profile);
    expect(second.profile.rev).toBe(2);
  });

  it('another writer since our read: nothing is written, and the result says whose rev is stored', () => {
    const ours = counted(3, 4);
    const theirs = JSON.stringify({ ...ours, rev: 5 });
    const fake = new FakeStorage({ [K.profile]: theirs });
    const store = storeOver(fake);
    expect(saveProfile(store, ours, LATER)).toEqual({
      profile: ours,
      result: { ok: false, reason: 'conflict', storedRev: 5 },
    });
    expect(saveSettings(store, ours, ours.settings, LATER).result).toMatchObject({
      reason: 'conflict',
    });
    expect(fake.writeLog).toEqual([]);
    expect(fake.data.get(K.profile)).toBe(theirs);
  });

  it('a stored value that is no profile at all is kept as a corrupt copy, never backed up', () => {
    for (const junk of ['{"schema":1,"rev', '[1,2]', '{"rev":-1}', 'null']) {
      const fake = new FakeStorage({ [K.profile]: junk });
      const saved = saveProfile(storeOver(fake), defaultProfile(NOW), NOW);
      expect(saved.result).toEqual({ ok: true });
      expect(fake.data.get(COPY)).toBe(junk);
      expect(fake.data.has(K.profileBackup)).toBe(false);
      expect(stored<Profile>(fake, K.profile)).toEqual(saved.profile);
    }
  });

  it('a storage that cannot be read lets the write go on (it lands in memory, §14.6 rule 3)', () => {
    expect(
      checkWriter(
        createSafeStorage(() => null),
        7,
        NOW,
      ),
    ).toEqual({ ok: true, backup: null });
  });
});

describe('the backup on load (§14.6 rule 2: at most one hand lost)', () => {
  const good = counted(7, 9);
  const damaged: [string, string][] = [
    ['corrupt JSON', '{"schema":1,"rev":'],
    ['a truncated profile', JSON.stringify(counted(8, 10)).slice(0, 200)],
    ['wrong types', JSON.stringify({ ...counted(8, 10), lastCommittedHandSeq: '8' })],
    ['a newer schema', JSON.stringify({ ...counted(8, 10), schema: 2 })],
  ];

  it.each(damaged)('%s, a good backup: restored, the damaged text kept', (_, raw) => {
    const fake = new FakeStorage({ [K.profile]: raw, [K.profileBackup]: JSON.stringify(good) });
    const load = loadProfile(storeOver(fake), { now: NOW });
    expect(load).toMatchObject({ status: 'restored', profile: good, copiedTo: COPY });
    expect(fake.data.get(COPY)).toBe(raw);
    // The backup is the profile now, so the next launch is normal and the next write's rev
    // check passes.
    expect(stored<Profile>(fake, K.profile)).toEqual(good);
    expect(loadProfile(storeOver(fake), { now: LATER })).toEqual({
      status: 'ok',
      profile: good,
      migratedFrom: null,
    });
    expect(saveProfile(storeOver(fake), good, LATER).result).toEqual({ ok: true });
  });

  it('a backup from an older schema is migrated on the way', () => {
    const fake = new FakeStorage({
      [K.profile]: '{oops',
      [K.profileBackup]: JSON.stringify(v0Profile()),
    });
    const load = loadProfile(storeOver(fake), { now: NOW, migrations: { 0: profileV0ToV1 } });
    expect(load.status).toBe('restored');
    expect(load.profile.settings).toMatchObject({ players: 4, bb: 50 });
  });

  it('a damaged backup too: start fresh (the "reset" path), the profile text kept', () => {
    for (const bak of ['{"schema":1', JSON.stringify({ schema: 1 }), '7']) {
      const fake = new FakeStorage({ [K.profile]: '{oops', [K.profileBackup]: bak });
      const load = loadProfile(storeOver(fake), { now: NOW });
      expect(load).toMatchObject({ status: 'reset', profile: defaultProfile(NOW), copiedTo: COPY });
      expect(fake.data.get(K.profileBackup)).toBe(bak); // never deleted
    }
  });

  it('readOnly, or a copy that cannot be written: restored in memory, nothing overwritten', () => {
    const initial = { [K.profile]: '{oops', [K.profileBackup]: JSON.stringify(good) };
    const readOnly = new FakeStorage(initial);
    expect(loadProfile(storeOver(readOnly), { now: NOW, readOnly: true })).toMatchObject({
      status: 'restored',
      profile: good,
      copiedTo: null,
    });
    expect(readOnly.writeLog).toEqual([]);
    const full = new FakeStorage(initial);
    full.failWrites = quotaError();
    expect(loadProfile(storeOver(full), { now: NOW })).toMatchObject({
      status: 'restored',
      copiedTo: null,
    });
    expect(full.data.get(K.profile)).toBe('{oops');
  });
});

describe('the hand ring, pc.v1.hands (§14.2, §14.3 step 1)', () => {
  it('upsert keeps one record per hand, in handSeq order, the newest 100', () => {
    const fake = new FakeStorage();
    const store = storeOver(fake);
    for (const seq of [2, 1, 3]) upsertHand(store, record(seq), 3, NOW);
    expect(ring(fake)).toEqual([1, 2, 3]);
    // Safe to repeat: the same hand again replaces its record.
    upsertHand(store, record(2, { undoCount: 1, assisted: true }), 3, NOW);
    expect(ring(fake)).toEqual([1, 2, 3]);
    expect(stored<HandRing>(fake, K.hands).hands[1]?.undoCount).toBe(1);
    for (let seq = 4; seq <= HANDS_KEEP + 7; seq++) upsertHand(store, record(seq), seq - 1, NOW);
    expect(ring(fake)).toEqual(Array.from({ length: HANDS_KEEP }, (_, i) => i + 8));
    expect(loadHands(store, HANDS_KEEP + 7)).toEqual({
      hands: stored<HandRing>(fake, K.hands).hands,
      problem: null,
    });
  });

  it('a record above lastCommittedHandSeq was never counted: readers skip it, the next upsert drops it', () => {
    const fake = new FakeStorage();
    const store = storeOver(fake);
    for (const seq of [1, 2, 3]) upsertHand(store, record(seq), seq - 1, NOW);
    // Hand 3's commit stopped before its commit point: the profile says 2.
    expect(loadHands(store, 2).hands.map((r) => r.handSeq)).toEqual([1, 2]);
    upsertHand(store, record(4), 2, NOW);
    expect(ring(fake)).toEqual([1, 2, 4]);
  });

  it('loadHands leaves out records that fail their guard, and says why', () => {
    const bad = { ...record(2), heroHole: [5, 5] };
    const fake = new FakeStorage({
      [K.hands]: JSON.stringify({ schema: 1, hands: [record(1), bad, record(3), 'x'] }),
    });
    const read = loadHands(storeOver(fake), 3);
    expect(read.hands.map((r) => r.handSeq)).toEqual([1, 3]);
    expect(read.problem).toBe('record: a card appears twice');
    // The next upsert keeps what is not obviously broken (it has a handSeq) and drops the rest.
    upsertHand(storeOver(fake), record(4), 3, NOW);
    expect(ring(fake)).toEqual([1, 2, 3, 4]);
  });

  const damaged: [string, string][] = [
    ['corrupt JSON', '{"schema":1,"hands":['],
    ['a truncated ring', JSON.stringify({ schema: 1, hands: [record(1)] }).slice(0, 300)],
    ['a newer schema', JSON.stringify({ schema: 2, hands: [] })],
    ['no list', JSON.stringify({ schema: 1, hands: {} })],
  ];

  it.each(damaged)('%s: reads as empty; the next upsert keeps a copy and starts over', (_, raw) => {
    const fake = new FakeStorage({ [K.hands]: raw });
    const store = storeOver(fake);
    expect(loadHands(store, 9).hands).toEqual([]);
    expect(loadHands(store, 9).problem).not.toBeNull();
    expect(upsertHand(store, record(5), 4, NOW)).toEqual({ ok: true });
    expect(fake.data.get(COPY)).toBe(raw);
    expect(ring(fake)).toEqual([5]);
  });

  it('when even the copy cannot be written, the damaged ring is not overwritten', () => {
    const fake = new FakeStorage({ [K.hands]: '{broken' });
    fake.failWrites = quotaError();
    expect(upsertHand(storeOver(fake), record(5), 4, NOW)).toEqual({ ok: false, reason: 'kept' });
    expect(fake.data.get(K.hands)).toBe('{broken');
  });

  it('a storage that cannot be read: an empty history, with the reason', () => {
    expect(
      loadHands(
        createSafeStorage(() => null),
        3,
      ),
    ).toEqual({
      hands: [],
      problem: 'hands: storage unavailable',
    });
  });
});

describe('commitHand (§14.3)', () => {
  /** Hands 1..4 counted and stored; the session holds hand 5, complete. */
  function before(): { fake: FakeStorage; profile: Profile } {
    const fake = new FakeStorage();
    const store = storeOver(fake);
    let profile = defaultProfile(NOW);
    for (let seq = 1; seq <= 4; seq++) {
      const done = commitHand(store, profile, commitOf(record(seq)), NOW);
      profile = done.profile;
    }
    fake.data.set(K.session, JSON.stringify(midHandSession()));
    fake.writeLog.length = 0;
    return { fake, profile };
  }

  it('hands, backup, profile, then the session; the hand counted once, then never again', () => {
    const { fake, profile } = before();
    const store = storeOver(fake);
    const done = commitHand(store, profile, commitOf(record(5)), LATER);
    expect(done.status).toBe('committed');
    expect(fake.writeLog).toEqual([K.hands, K.profileBackup, K.profile, K.session]);
    const after = stored<Profile>(fake, K.profile);
    expect(after).toEqual(done.profile);
    expect(after).toMatchObject({ lastCommittedHandSeq: 5, rev: profile.rev + 1 });
    expect(after.updatedAt).toBe(LATER.toISOString());
    expect(total(after)).toBe(5);
    expect(ring(fake)).toEqual([1, 2, 3, 4, 5]);
    expect(stored<SessionState>(fake, K.session)).toEqual(nextSession());

    // Again (a second launch finding the hand in its session): only step 5.
    fake.writeLog.length = 0;
    expect(commitHand(store, done.profile, commitOf(record(5)), LATER)).toEqual({
      status: 'counted',
      profile: done.profile,
    });
    expect(fake.writeLog).toEqual([K.session]);
    expect(total(stored<Profile>(fake, K.profile))).toBe(5);
  });

  it('a practice hand (with an Undo) counts in the practice bucket only (§11.4)', () => {
    const { fake, profile } = before();
    commitHand(storeOver(fake), profile, commitOf(record(5, { assisted: true, undoCount: 1 })));
    const { results } = stored<Profile>(fake, K.profile).stats;
    expect(results.clean.hands).toBe(4);
    expect(results.practice.hands).toBe(1);
    expect(results.practice.netChips).toBe(-100);
    expect(results.practice.netMilliBB).toBe(-1000);
  });

  it('another writer: nothing at all is written (not even the hand record)', () => {
    const { fake, profile } = before();
    const theirs = JSON.stringify({ ...stored<Profile>(fake, K.profile), rev: profile.rev + 3 });
    fake.data.set(K.profile, theirs);
    const done = commitHand(storeOver(fake), profile, commitOf(record(5)), LATER);
    expect(done).toEqual({ status: 'conflict', profile, storedRev: profile.rev + 3 });
    expect(fake.writeLog).toEqual([]);
    expect(ring(fake)).toEqual([1, 2, 3, 4]);
  });

  it('a record or a counted profile that would not load again: not counted, the game moves on', () => {
    const { fake, profile } = before();
    const store = storeOver(fake);
    const badRecord = commitHand(store, profile, commitOf(record(5, { net: [1] })), LATER);
    expect(badRecord).toMatchObject({ status: 'invalid', profile });
    const badApply = commitHand(
      store,
      profile,
      { ...commitOf(record(5)), apply: (p) => ({ ...p, heroModel: null as never }) },
      LATER,
    );
    expect(badApply).toMatchObject({
      status: 'invalid',
      problem: expect.stringContaining('heroModel'),
    });
    expect(fake.writeLog).toEqual([K.session, K.session]);
    expect(stored<Profile>(fake, K.profile)).toEqual(profile);
  });

  it('a commit point that does not reach the storage leaves the session holding the hand', () => {
    const { fake, profile } = before();
    fake.failAttempt = 3; // the profile write
    const done = commitHand(storeOver(fake), profile, commitOf(record(5)), LATER);
    expect(done).toMatchObject({ status: 'committed', result: { ok: false, reason: 'quota' } });
    // In memory the hand is counted (the next write carries it); on disk the session still
    // holds it, so a launch now would count it.
    expect(total(done.profile)).toBe(5);
    expect(fake.writeLog).toEqual([K.hands, K.profileBackup, K.profile]);
    expect(fake.data.get(K.session)).toBe(JSON.stringify(midHandSession()));
  });

  /**
   * The next launch as the controller runs it (§14.3 load table): the profile (or its backup),
   * then, when the session still holds the complete hand, its commit again.
   */
  function relaunch(fake: FakeStorage): { profile: Profile; ring: number[] } {
    const alive = new FakeStorage(Object.fromEntries(fake.data));
    const store = storeOver(alive);
    const load = loadProfile(store, { now: LATER });
    expect(load.status, 'the profile is never unreadable').toBe('ok');
    let profile = load.profile;
    if (alive.data.get(K.session) === JSON.stringify(midHandSession())) {
      const again: CommitResult = commitHand(store, profile, commitOf(record(5)), LATER);
      profile = again.profile;
    }
    expect(loadProfile(store, { now: LATER }).profile).toEqual(profile);
    return {
      profile,
      ring: loadHands(store, profile.lastCommittedHandSeq).hands.map((r) => r.handSeq),
    };
  }

  it.each([0, 1, 2, 3, 4])(
    'crash injection: the storage dies after %i writes of the protocol; the hand counts exactly once',
    (k) => {
      const { fake, profile } = before();
      fake.dieAfterWrites = fake.writes + k;
      const done = commitHand(storeOver(fake), profile, commitOf(record(5)), LATER);
      expect(done.status).toBe('committed'); // never throws: the tab plays on in memory
      const after = relaunch(fake);
      expect(after.profile.lastCommittedHandSeq).toBe(5);
      expect(total(after.profile)).toBe(5);
      expect(after.ring).toEqual([1, 2, 3, 4, 5]);
    },
  );

  it.each([1, 2, 3, 4])(
    'one write fails (attempt %i), then a new launch: counted once, the data readable',
    (attempt) => {
      const { fake, profile } = before();
      fake.failAttempt = attempt;
      commitHand(storeOver(fake), profile, commitOf(record(5)), LATER);
      const after = relaunch(fake);
      expect(after.profile.lastCommittedHandSeq).toBe(5);
      expect(total(after.profile)).toBe(5);
      // A failed ring write loses only the record (attempt 1); the hand still counts.
      expect(after.ring).toEqual(attempt === 1 ? [1, 2, 3, 4] : [1, 2, 3, 4, 5]);
    },
  );
});
