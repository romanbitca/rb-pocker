/**
 * The controller's side of the commit protocol (PLAN §14.3, §14.5, §14.6, §14.9; chunk 8.1): every
 * finished hand is committed once (its record, the stats, the hero model) and the session moves to
 * the next table; the §14.3 load table at boot; the handSeq rule across a New table and with an
 * imported profile; crash injection at every write of whole games; a storage that throws (private
 * mode); a second writer; a decision resumed with its hint. The protocol itself (the `rev` check,
 * the backup, the ring) is `tests/persist/commit.test.ts`. Fake timers throughout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HERO_ID } from '../../src/app/controller.ts';
import { coachKeyOf } from '../../src/app/hintJobs.ts';
import { replay } from '../../src/engine/replay.ts';
import type { HandState, LegalActions, PlayerAction } from '../../src/engine/types.ts';
import type {
  HandRecord,
  HandRing,
  Profile,
  SessionState,
  Settings,
} from '../../src/persist/schema.ts';
import { createSafeStorage, STORAGE_KEYS, type SafeStorage } from '../../src/persist/storage.ts';
import { FakeStorage, quotaError } from '../persist/fakeStorage.ts';
import { stubGrader, type StubGrader } from './graders.ts';
import { drive, flush, heroPolicy, makeHarness, SEED, tick, type Harness } from './harness.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const K = STORAGE_KEYS;

const passive = (legal: LegalActions): PlayerAction =>
  legal.canCheck ? { type: 'check' } : { type: 'call' };

/** A backend that also keeps every successful write, in order. */
class RecordingStorage extends FakeStorage {
  readonly history: [key: string, value: string][] = [];
  override setItem(key: string, value: string): void {
    super.setItem(key, value);
    this.history.push([key, value]);
  }
}

interface LaunchOptions {
  grader?: StubGrader;
  hints?: boolean;
}

/** One page load over `backend`: a new store, a new controller, booted. */
function launch(backend: FakeStorage | SafeStorage, options: LaunchOptions = {}): Harness {
  const storage = backend instanceof FakeStorage ? createSafeStorage(() => backend) : backend;
  return makeHarness({
    storage,
    ...(options.grader !== undefined && { grader: options.grader }),
    ...(options.hints !== undefined && { hints: options.hints }),
  });
}

/** The first launch: a table of `players` at Instant speed (Settings, then Play). */
function start(
  backend: FakeStorage | SafeStorage,
  patch: Partial<Settings> = {},
  options: LaunchOptions = {},
): Harness {
  const h = launch(backend, options);
  h.dispatch({ type: 'settings', patch: { players: 3, speed: 'instant', ...patch } });
  h.dispatch({ type: 'play' });
  return h;
}

const read = <T>(backend: FakeStorage, key: string): T =>
  JSON.parse(backend.data.get(key) as string) as T;
const profileOf = (backend: FakeStorage): Profile => read<Profile>(backend, K.profile);
const ringOf = (backend: FakeStorage): HandRecord[] =>
  backend.data.has(K.hands) ? read<HandRing>(backend, K.hands).hands : [];
const sessionOf = (backend: FakeStorage): SessionState => read<SessionState>(backend, K.session);
/** Hands the stats have counted (chunk 8.1's `applyHand`: the results buckets). */
const counted = (p: Profile): number =>
  p.stats.results.clean.hands + p.stats.results.practice.hands;

/** Hands played to their end, each with its table as at hand start and every input. */
async function play(h: Harness, hands: number, seed = SEED) {
  const played: { hand: HandState; record: ReturnType<Harness['controller']['snapshot']> }[] = [];
  await drive(h, {
    hands,
    hero: heroPolicy(seed),
    onComplete: (hand) => played.push({ hand, record: h.controller.snapshot() }),
  });
  return played;
}

describe('every finished hand is committed once (§14.3)', () => {
  it('its record, the stats and the hero model in the profile; the session moves on', async () => {
    const backend = new FakeStorage();
    const h = start(backend);
    const played = await play(h, 4);
    const profile = profileOf(backend);
    const last = played[3]?.hand as HandState;
    expect(profile.lastCommittedHandSeq).toBe(last.handSeq);
    expect(counted(profile)).toBe(4);
    expect(profile.stats.results.practice.hands).toBe(0);
    expect(profile.stats.results.clean.netChips).toBe(
      played.reduce((sum, p) => sum + (p.hand.result?.net[0] ?? 0), 0),
    );
    // §9.5: the hero model is the profile's, written by every commit.
    expect(profile.heroModel.hands).toBe(4);
    expect(profile.heroModel).toEqual(h.state().game.seatStats[HERO_ID]);
    // The records: one per hand, in order, each replaying to exactly its final state (§4.7).
    const ring = ringOf(backend);
    expect(ring.map((r) => r.handSeq)).toEqual(played.map((p) => p.hand.handSeq));
    ring.forEach((r, i) => {
      const { hand, record } = played[i] as (typeof played)[number];
      expect(r.table).toEqual(record.table);
      expect(r.inputs).toEqual(record.inputs);
      expect(replay({ ...r, commit: null })).toEqual(hand);
      expect(r).toMatchObject({
        net: hand.result?.net,
        heroHole: hand.seats[0]?.hole,
        board: hand.board,
        assisted: false,
        undoCount: 0,
        botLevel: 'easy',
        coachLevel: 'beginner',
        decisions: record.meta.decisions,
      });
      expect(r.heroNetMilliBB).toBe(Math.round(((hand.result?.net[0] ?? 0) * 1000) / hand.bb));
    });
    // Step 5: between hands the session is the next table.
    expect(sessionOf(backend)).toMatchObject({ hand: null, table: h.state().game.next });
  }, 30_000);

  it('a hand with an Undo is practice: the undone decision is kept, the record replays', async () => {
    const backend = new FakeStorage();
    const h = start(backend, { coachLevel: 'beginner' }, { grader: stubGrader() });
    for (let i = 0; i < 400 && h.state().game.mode !== 'heroTurn'; i++) await tick();
    h.dispatch({ type: 'act', action: passive(h.state().game.legal as LegalActions) });
    await flush(); // the grade ('best')
    expect(h.state().game.canUndo).toBe(true);
    h.dispatch({ type: 'undo' });
    expect(h.state().game.mode).toBe('heroTurn');
    const [done] = await drive(h, { hands: 1, hero: passive });
    const record = ringOf(backend)[0] as HandRecord;
    expect(record.handSeq).toBe(done?.handSeq);
    expect(record).toMatchObject({ assisted: true, undoCount: 1 });
    expect(record.decisions[0]).toMatchObject({ decisionId: 0, grade: 'best', undone: true });
    expect(record.decisions.filter((d) => !d.undone).length).toBeGreaterThan(0);
    expect(record.inputs.some((input) => input.kind === 'reshuffle')).toBe(true);
    expect(replay({ ...record, commit: null })).toEqual(done);
    const { results } = profileOf(backend).stats;
    expect(results.clean.hands).toBe(0);
    expect(results.practice.hands).toBe(1);
  }, 30_000);
});

describe('the commit waits for the last grade (§11.3 r5)', () => {
  /** Heads-up until the hero can fold (a fold ends the hand); then folds. */
  async function foldAHand(h: Harness): Promise<HandState> {
    for (let i = 0; i < 4000; i++) {
      const s = h.state();
      if (s.game.mode === 'heroTurn' && s.game.legal !== null) {
        const fold = s.game.legal.canFold;
        h.dispatch({ type: 'act', action: fold ? { type: 'fold' } : passive(s.game.legal) });
        if (fold) return s.game.hand as HandState;
      } else if (s.game.mode === 'feedback') {
        h.dispatch({ type: 'keepMove' });
      } else if (s.game.mode === 'handEnd' && !s.settings.autoNext) {
        h.dispatch({ type: 'nextHand' });
      } else if (s.ui.overlays.includes('outOfChips')) {
        h.dispatch({ type: 'reload' });
      } else {
        await tick();
      }
    }
    throw new Error('no fold');
  }

  it('a late grade: the session keeps the complete hand until the grade is in, then commits it', async () => {
    const backend = new FakeStorage();
    const grader = stubGrader({ delayMs: 4000 });
    // The next hand waits for a tap, so only the grade can bring the commit.
    const h = start(backend, { players: 2, autoNext: false }, { grader });
    const before = await foldAHand(h);
    // The grading pause (1.5 s) ends; the hand is complete, its grade still on its way.
    for (let i = 0; i < 50 && h.state().game.mode !== 'handEnd'; i++) await tick();
    expect(h.state().game.mode).toBe('handEnd');
    expect(profileOf(backend).lastCommittedHandSeq).toBe(before.handSeq - 1);
    expect(sessionOf(backend).hand).toMatchObject({ handSeq: before.handSeq, phase: 'complete' });
    await vi.advanceTimersByTimeAsync(4000);
    await flush();
    const record = ringOf(backend).at(-1) as HandRecord;
    expect(record.handSeq).toBe(before.handSeq);
    expect(record.decisions.at(-1)).toMatchObject({ grade: 'best' });
    expect(profileOf(backend).lastCommittedHandSeq).toBe(before.handSeq);
    expect(sessionOf(backend).hand).toBeNull();
  }, 30_000);

  it('a grade that never comes: the next hand commits the hand, that decision ungraded', async () => {
    const backend = new FakeStorage();
    const grader = stubGrader({ answer: () => 'never' });
    const h = start(backend, { players: 2 }, { grader });
    const before = await foldAHand(h);
    for (let i = 0; i < 400 && (h.state().game.hand?.handSeq ?? 0) <= before.handSeq; i++) {
      await tick();
    }
    expect(h.state().game.hand?.handSeq).toBe(before.handSeq + 1);
    const record = ringOf(backend).at(-1) as HandRecord;
    expect(record.handSeq).toBe(before.handSeq);
    expect(record.decisions.at(-1)).toMatchObject({ grade: null });
    expect(profileOf(backend).lastCommittedHandSeq).toBe(before.handSeq);
  }, 30_000);
});

describe('the load table at boot (§14.3)', () => {
  /** One hand played; the session as written while it was complete, and the profile before it. */
  async function oneHand() {
    const backend = new RecordingStorage();
    const h = start(backend);
    const hand = (await play(h, 1))[0]?.hand as HandState;
    h.controller.dispose();
    const complete = backend.history.findLast(
      ([key, value]) =>
        key === K.session && (JSON.parse(value) as SessionState).hand?.phase === 'complete',
    )?.[1] as string;
    return { backend, hand, complete };
  }

  it('a complete hand not counted yet is committed now; the game waits between hands', async () => {
    const { backend, hand, complete } = await oneHand();
    // The tab died after saving the complete hand: the profile is the one before it (its backup).
    backend.data.set(K.profile, backend.data.get(K.profileBackup) as string);
    backend.data.set(K.session, complete);
    const b = launch(backend);
    expect(profileOf(backend).lastCommittedHandSeq).toBe(hand.handSeq);
    expect(counted(profileOf(backend))).toBe(1);
    expect(ringOf(backend).map((r) => r.handSeq)).toEqual([hand.handSeq]);
    expect(sessionOf(backend).hand).toBeNull();
    expect(b.state().game).toMatchObject({ hand: null, table: null, mode: 'idle' });
    b.dispatch({ type: 'play' });
    expect(b.state().game.hand?.handSeq).toBe(hand.handSeq + 1);
  }, 30_000);

  it('a complete hand already counted: step 5 only, never counted twice', async () => {
    const { backend, hand, complete } = await oneHand();
    backend.data.set(K.session, complete);
    const profile = profileOf(backend);
    const b = launch(backend);
    expect(profileOf(backend)).toEqual(profile);
    expect(sessionOf(backend)).toMatchObject({ hand: null });
    expect(sessionOf(backend).table.nextHandSeq).toBe(hand.handSeq + 1);
    b.dispatch({ type: 'play' });
    expect(b.state().game.hand?.handSeq).toBe(hand.handSeq + 1);
  }, 30_000);

  it('a record whose hand was never counted is left out, and dropped by the next commit', async () => {
    const { backend, hand } = await oneHand();
    // The tab died between the ring write and the commit point, and the session was lost.
    backend.data.set(K.profile, backend.data.get(K.profileBackup) as string);
    backend.data.delete(K.session);
    const b = launch(backend);
    b.dispatch({ type: 'play' });
    // A new table: its first hand takes the uncounted hand's number (§14.3 handSeq rule).
    expect(b.state().game.hand?.handSeq).toBe(hand.handSeq);
    await drive(b, { hands: 1, hero: passive });
    expect(ringOf(backend).map((r) => r.handSeq)).toEqual([hand.handSeq]);
    expect(ringOf(backend)[0]?.table.tableId).toBe(b.state().game.table?.tableId);
    expect(counted(profileOf(backend))).toBe(1);
  }, 30_000);
});

describe('crash injection at every write (§14.9)', () => {
  /** Plays 3 heads-up hands over `backend`, then the tab dies. */
  async function game(backend: FakeStorage): Promise<void> {
    const h = start(backend, { players: 2 });
    await play(h, 3);
    h.controller.dispose();
  }

  it('after any crash each hand counts exactly once, or not at all when its end never reached the storage', async () => {
    const reference = new RecordingStorage();
    await game(reference);
    // The first write after which each hand's end is in the storage: the session holding it
    // complete, or a profile that counted it.
    const durableAt = new Map<number, number>();
    reference.history.forEach(([key, value], i) => {
      if (key === K.session) {
        const hand = (JSON.parse(value) as SessionState).hand;
        if (hand?.phase === 'complete' && !durableAt.has(hand.handSeq)) {
          durableAt.set(hand.handSeq, i + 1);
        }
      }
    });
    const handSeqs = [...durableAt.keys()];
    expect(handSeqs).toHaveLength(3);
    const writes = reference.history.length;
    expect(writes).toBeGreaterThan(20);

    for (let k = 0; k <= writes; k++) {
      const dying = new FakeStorage();
      dying.dieAfterWrites = k;
      await game(dying);
      const backend = new FakeStorage(Object.fromEntries(dying.data));
      const next = launch(backend);
      const toasts = next.state().ui.toasts.map((t) => t.kind);
      expect(toasts, `k = ${k}`).not.toContain('dataRecovered');
      expect(toasts, `k = ${k}`).not.toContain('dataRestored');
      expect([...backend.data.keys()].filter((key) => key.startsWith('pc.corrupt.'))).toEqual([]);
      const done = handSeqs.filter((seq) => (durableAt.get(seq) as number) <= k);
      if (!backend.data.has(K.profile)) {
        expect(done, `k = ${k}`).toEqual([]);
        next.controller.dispose();
        continue;
      }
      const profile = profileOf(backend);
      expect(counted(profile), `k = ${k}`).toBe(done.length);
      expect(profile.heroModel.hands, `k = ${k}`).toBe(done.length);
      expect(profile.lastCommittedHandSeq, `k = ${k}`).toBe(done.at(-1) ?? 0);
      expect(
        ringOf(backend)
          .map((r) => r.handSeq)
          .filter((seq) => seq <= profile.lastCommittedHandSeq),
        `k = ${k}`,
      ).toEqual(done);
      next.controller.dispose();
    }
  }, 120_000);
});

describe('the handSeq rule (§14.3, Stage 8 acceptance 4b)', () => {
  it('3 hands, a New table, 3 more: all 6 are counted, numbers never reused', async () => {
    const backend = new FakeStorage();
    const h = start(backend);
    const first = await play(h, 3);
    h.dispatch({ type: 'newTable', setup: { players: 4 } });
    await flush();
    const second = await play(h, 3, 'b2'.padStart(32, '0'));
    const seqs = [...first, ...second].map((p) => p.hand.handSeq);
    expect(new Set(seqs).size).toBe(6);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(second[0]?.record.table?.tableId).not.toBe(first[0]?.record.table?.tableId);
    const profile = profileOf(backend);
    expect(counted(profile)).toBe(6);
    expect(profile.lastCommittedHandSeq).toBe(seqs.at(-1));
    expect(ringOf(backend).map((r) => r.handSeq)).toEqual(seqs);
  }, 60_000);

  it('a New table mid-hand: that hand counts as a normal hand, not in the hero model (§3.1)', async () => {
    const backend = new FakeStorage();
    const h = start(backend);
    // The hero folds when it can (checks when that is free): no bust before the third hand.
    const careful = (legal: LegalActions): PlayerAction =>
      legal.canFold ? { type: 'fold' } : passive(legal);
    await drive(h, { hands: 2, hero: careful });
    for (let i = 0; i < 400 && h.state().game.mode !== 'heroTurn'; i++) await tick();
    const unfinished = h.state().game.hand as HandState;
    expect(unfinished.phase).toBe('betting');
    h.dispatch({ type: 'newTable', setup: { players: 4 }, confirmed: true });
    for (let i = 0; i < 400 && h.state().game.hand?.handSeq === unfinished.handSeq; i++) {
      await tick();
    }
    const profile = profileOf(backend);
    expect(profile.lastCommittedHandSeq).toBe(unfinished.handSeq);
    expect(counted(profile)).toBe(3);
    expect(profile.heroModel.hands).toBe(2);
    const record = ringOf(backend).at(-1) as HandRecord;
    expect(record.handSeq).toBe(unfinished.handSeq);
    expect(replay({ ...record, commit: null }).phase).toBe('complete');
    expect(h.state().game.hand?.handSeq).toBe(unfinished.handSeq + 1);
  }, 60_000);

  it('an imported profile that counted more hands: the next hand is numbered above it, and counts', async () => {
    const backend = new FakeStorage();
    const a = start(backend);
    await play(a, 3);
    a.controller.dispose();
    // What an import (chunk 8.3) leaves: another device's profile, the table of this one.
    const imported: Profile = { ...profileOf(backend), lastCommittedHandSeq: 50 };
    backend.data.set(K.profile, JSON.stringify(imported));
    expect(sessionOf(backend).table.nextHandSeq).toBe(4);
    const b = launch(backend);
    b.dispatch({ type: 'play' });
    expect(b.state().game.hand?.handSeq).toBe(51);
    await drive(b, { hands: 1, hero: passive });
    expect(profileOf(backend).lastCommittedHandSeq).toBe(51);
    expect(counted(profileOf(backend))).toBe(counted(imported) + 1);
  }, 60_000);
});

describe('storage that fails (§14.6 rule 3, Stage 8 acceptance 5)', () => {
  it('private mode, every write throws: playable, hands counted in memory, the banner once', async () => {
    const backend = new FakeStorage();
    backend.failWrites = quotaError();
    const storage = createSafeStorage(() => backend);
    const banners = vi.fn();
    const h = launch(storage);
    h.store.subscribe((s, prev) => {
      if (s.ui.storageBanner && !prev.ui.storageBanner) banners();
    });
    h.dispatch({ type: 'settings', patch: { players: 3, speed: 'instant' } });
    h.dispatch({ type: 'play' });
    expect(h.state().ui.storageBanner).toBe(true);
    h.dispatch({ type: 'dismissStorageBanner' });
    const played = await play(h, 4);
    expect(played).toHaveLength(4);
    expect(banners).toHaveBeenCalledTimes(1);
    expect(h.state().ui.storageBanner).toBe(false);
    expect(backend.data.size).toBe(0);
    // In memory the commit went on as usual (§14.6: a failed key reads back what we wrote).
    const inMemory = storage.get(K.profile);
    const profile = JSON.parse(inMemory.ok ? (inMemory.value ?? '{}') : '{}') as Profile;
    expect(counted(profile)).toBe(4);
    expect(profile.heroModel).toEqual(h.state().game.seatStats[HERO_ID]);
    expect(h.controller.logs().errors).toEqual([]);
  }, 30_000);
});

describe('a second writer (§14.3 step 2, §14.7)', () => {
  it('another tab writes the profile: this tab writes nothing more and plays on in memory', async () => {
    const backend = new FakeStorage();
    const h = start(backend);
    await play(h, 1);
    const theirs: Profile = { ...profileOf(backend), rev: profileOf(backend).rev + 1 };
    backend.data.set(K.profile, JSON.stringify(theirs));
    const before = new Map(backend.data);
    await play(h, 1); // its commit finds the other rev
    expect(h.controller.snapshot().writer).toBe(false);
    expect(h.controller.logs().errors.map((e) => e.what)).toContain('another writer');
    expect(profileOf(backend)).toEqual(theirs);
    expect(ringOf(backend).length).toBe(1);
    const writes = backend.writeLog.length;
    h.dispatch({ type: 'settings', patch: { sound: false } });
    await play(h, 1);
    h.dispatch({ type: 'pagehide' });
    expect(backend.writeLog.length).toBe(writes);
    expect(backend.data.get(K.profile)).toBe(before.get(K.profile));
  }, 30_000);
});

describe('resume a decision with its hint (§14.5, Stage 8 acceptance 3)', () => {
  /** Runs until the hero is to act and the coach's hint for that decision is in. */
  async function toHint(h: Harness): Promise<void> {
    for (let i = 0; i < 800; i++) {
      const s = h.state();
      const hand = s.game.hand;
      if (
        s.game.mode === 'heroTurn' &&
        hand !== null &&
        s.coach.key === coachKeyOf(hand) &&
        s.coach.status === 'ready'
      ) {
        return;
      }
      await tick();
    }
    throw new Error('no hint');
  }

  it.each([true, false])(
    'closed at a decision (hint opened: %s): Play returns to it, with the same hint',
    async (opened) => {
      const backend = new FakeStorage();
      const a = start(backend, { coachLevel: 'intermediate', speed: 'normal' }, { hints: true });
      await toHint(a);
      if (opened) a.dispatch({ type: 'showHint' });
      const key = a.state().coach.key;
      const before = {
        hand: a.state().game.hand,
        legal: a.state().game.legal,
        decision: a.state().coach.decision,
        explanation: a.state().coach.explanation,
        meta: a.controller.snapshot().meta,
      };
      expect(before.meta.hintShown[0] === true).toBe(opened);
      a.controller.dispose();

      const b = launch(backend, { hints: true });
      b.dispatch({ type: 'play' });
      await toHint(b);
      expect(b.state().game.hand).toEqual(before.hand);
      expect(b.state().game.legal).toEqual(before.legal);
      expect(b.state().coach.key).toBe(key);
      expect(b.state().coach.decision).toEqual(before.decision);
      expect(b.state().coach.explanation).toEqual(before.explanation);
      expect(b.state().coach.opened).toBe(opened ? key : null);
      expect(b.controller.snapshot().meta).toEqual(before.meta);
    },
    30_000,
  );
});
