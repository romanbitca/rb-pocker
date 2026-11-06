/**
 * The controller's side of the provable shuffle (PLAN §16.3, chunk 9.4): every hand's seed is
 * drawn and committed to (its shuffle code) before the hand is dealt, off the deal's path, and
 * the code goes with the hand into the session, Review's record and the stored hand record, where
 * "Check the shuffle" verifies it. A New table's first hand too (its table seed is drawn ahead), a
 * hand with an Undo, a hand resumed after a reload and a hand counted at the next launch. The
 * seeds are the same with or without the hash (the `?seed=` games do not change), and no worker
 * ever receives a hand seed or a shuffle code (§9.6 3b). Fake timers throughout; the hash is
 * `node:crypto` answering on the next microtask.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { realTimers } from '../../src/app/controller.ts';
import { checkShuffle } from '../../src/app/shuffleCheck.ts';
import { commitText, pageSha256, type Sha256 } from '../../src/app/shuffleCode.ts';
import { createBrainClient, createEquityClient } from '../../src/app/workerClient.ts';
import type { EquityResult, HandAnalysis } from '../../src/analysis/types.ts';
import { coachAnswer } from '../../src/brain/grade.ts';
import type { Card } from '../../src/core/cards.ts';
import type { Seed128 } from '../../src/core/rng.ts';
import type { HandState, LegalActions, PlayerAction, TableState } from '../../src/engine/types.ts';
import type { HandRecord, HandRing, SessionState } from '../../src/persist/schema.ts';
import { createSafeStorage, STORAGE_KEYS } from '../../src/persist/storage.ts';
import type { EquityMath } from '../../src/workers/equityService.ts';
import { FakeStorage } from '../persist/fakeStorage.ts';
import { simpleDecide } from '../helpers/simpleDecide.ts';
import { nodeSha256, sha256Hex } from '../helpers/sha256.ts';
import { fakeBrainWorker } from '../workers/fakeBrainWorker.ts';
import { fakeWorker } from '../workers/fakeWorker.ts';
import { stubGrader } from './graders.ts';
import {
  drive,
  flush,
  heroPolicy,
  makeHarness,
  SEED,
  tick,
  type Harness,
  type HarnessOptions,
} from './harness.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const K = STORAGE_KEYS;
const pageHash = pageSha256() as Sha256; // the check's own path: crypto.subtle

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

/** One page load over `backend` with the hash (unless `sha256` says otherwise), booted. */
function launch(backend: FakeStorage, options: HarnessOptions = {}): Harness {
  return makeHarness({
    storage: createSafeStorage(() => backend),
    sha256: nodeSha256,
    ...options,
  });
}

const read = <T>(backend: FakeStorage, key: string): T =>
  JSON.parse(backend.data.get(key) as string) as T;
const ringOf = (backend: FakeStorage): HandRecord[] =>
  backend.data.has(K.hands) ? read<HandRing>(backend, K.hands).hands : [];

/** The code a hand must have: SHA-256 of `seed:tableId:handSeq` (node:crypto). */
const codeOf = (seed: Seed128, table: TableState, handSeq: number): string =>
  sha256Hex(commitText(seed, table.tableId, handSeq));

/** The controller's 'hand start' lines: when each hand was dealt, was its code ready? */
function dealt(h: Harness): { handSeq: number; shuffleCode: string }[] {
  return h.controller
    .logs()
    .events.filter((e) => e.what === 'hand start')
    .map((e) => e.detail as { handSeq: number; shuffleCode: string });
}

/** Each stored record has its hand's code, and the check says ✓. */
async function expectVerified(records: readonly HandRecord[]): Promise<void> {
  expect(records.length).toBeGreaterThan(0);
  for (const r of records) {
    expect(r.commit).toBe(codeOf(r.seed, r.table, r.handSeq));
    expect((await checkShuffle(r, pageHash)).status).toBe('ok');
  }
}

describe('every hand is committed to before it is dealt (§16.3)', () => {
  it('the code is ready at every deal, and every stored record keeps it and checks ✓', async () => {
    const backend = new FakeStorage();
    const h = launch(backend, { settings: { players: 4, speed: 'instant' } });
    await flush(); // the moment before the first tap: the first hand's code is ready already
    h.dispatch({ type: 'play' });
    const hands = await drive(h, { hands: 12, hero: heroPolicy(SEED) });
    const ring = ringOf(backend);
    expect(ring.map((r) => r.handSeq)).toEqual(hands.map((hand) => hand.handSeq));
    await expectVerified(ring);
    const starts = dealt(h);
    expect(starts.length).toBeGreaterThanOrEqual(12);
    expect(starts.filter((s) => s.shuffleCode !== 'ready')).toEqual([]);
    // Review's hands (from memory) carry the same codes.
    for (const kept of h.state().review.hands) {
      const r = ring.find((x) => x.handSeq === kept.handSeq) as HandRecord;
      expect(kept.record.commit).toBe(r.commit);
      expect(kept.board).toEqual(r.board);
    }
  }, 60_000);

  it('a tap before the digest answered: dealt at once anyway, and the code still reaches the record', async () => {
    const backend = new FakeStorage();
    const h = launch(backend, { settings: { players: 3, speed: 'instant' } });
    h.dispatch({ type: 'play' }); // no time at all after boot
    expect(dealt(h)[0]?.shuffleCode).toBe('late');
    expect(h.state().game.hand).not.toBeNull();
    await drive(h, { hands: 2, hero: passive });
    await expectVerified(ringOf(backend));
    expect(dealt(h)[1]?.shuffleCode).toBe('ready');
  }, 30_000);

  it('a New table: its first hand was committed to with its table seed, drawn ahead', async () => {
    const backend = new FakeStorage();
    const h = launch(backend, { settings: { players: 3, speed: 'instant' } });
    await flush();
    h.dispatch({ type: 'play' });
    await drive(h, { hands: 2, hero: passive });
    const first = h.state().game.table?.tableId;
    h.dispatch({ type: 'newTable', setup: { players: 5 }, confirmed: true });
    await flush();
    const second = h.state().game.table?.tableId;
    expect(second).not.toBe(first);
    await drive(h, { hands: 2, hero: passive });
    const ring = ringOf(backend);
    expect(new Set(ring.map((r) => r.table.tableId))).toEqual(new Set([first, second]));
    await expectVerified(ring);
    expect(dealt(h).filter((s) => s.shuffleCode !== 'ready')).toEqual([]);
  }, 30_000);

  it('a hand with an Undo: the reshuffle comes from the same seed and the hand checks ✓', async () => {
    const backend = new FakeStorage();
    const h = launch(backend, {
      settings: { players: 3, speed: 'instant', coachLevel: 'beginner' },
      grader: stubGrader(),
    });
    await flush();
    h.dispatch({ type: 'play' });
    for (let i = 0; i < 400 && h.state().game.mode !== 'heroTurn'; i++) await tick();
    h.dispatch({ type: 'act', action: passive(h.state().game.legal as LegalActions) });
    await flush(); // the grade
    h.dispatch({ type: 'undo' });
    await drive(h, { hands: 1, hero: passive });
    const [record] = ringOf(backend);
    expect(record?.undoCount).toBe(1);
    expect(record?.inputs.some((input) => input.kind === 'reshuffle')).toBe(true);
    await expectVerified(ringOf(backend));
  }, 30_000);
});

describe('the deals do not change (the `?seed=` games)', () => {
  /** Hands of a fixed script: 3 hands, a New table, 2 hands. Their seeds and your cards. */
  async function script(sha256: boolean) {
    const backend = new FakeStorage();
    const h = makeHarness({
      storage: createSafeStorage(() => backend),
      settings: { players: 3, speed: 'instant' },
      ...(sha256 && { sha256: nodeSha256 }),
    });
    await flush();
    h.dispatch({ type: 'play' });
    const out: { tableSeed: Seed128; seed: Seed128; hole: readonly Card[] | null }[] = [];
    const onComplete = (hand: HandState): void => {
      const table = h.state().game.table as TableState;
      out.push({ tableSeed: table.tableSeed, seed: hand.seed, hole: hand.seats[0]?.hole ?? null });
    };
    await drive(h, { hands: 3, hero: passive, onComplete });
    h.dispatch({ type: 'newTable', confirmed: true });
    await flush();
    await drive(h, { hands: 2, hero: passive, onComplete });
    return { out, ring: ringOf(backend) };
  }

  it('the same table and hand seeds with the hash as without it; only the commit differs', async () => {
    const withHash = await script(true);
    const without = await script(false);
    expect(withHash.out).toHaveLength(5);
    expect(withHash.out).toEqual(without.out);
    expect(new Set(withHash.out.map((x) => x.tableSeed)).size).toBe(2);
    expect(without.ring.every((r) => r.commit === null)).toBe(true);
    expect(withHash.ring.map((r) => ({ ...r, commit: null, at: '' }))).toEqual(
      without.ring.map((r) => ({ ...r, at: '' })),
    );
  }, 60_000);
});

describe('the code survives a reload (§14.5) and the next launch (§14.3 load table)', () => {
  async function toHeroTurn(h: Harness): Promise<void> {
    for (let i = 0; i < 400 && h.state().game.mode !== 'heroTurn'; i++) await tick();
    expect(h.state().game.mode).toBe('heroTurn');
  }

  it('a hand resumed mid-play keeps the code its session saved', async () => {
    const backend = new FakeStorage();
    const a = launch(backend, { settings: { players: 3, speed: 'instant' } });
    await flush();
    a.dispatch({ type: 'play' });
    await toHeroTurn(a);
    const hand = a.state().game.hand as HandState;
    const table = a.state().game.table as TableState;
    const session = read<SessionState>(backend, K.session);
    expect(session.commit).toBe(codeOf(hand.seed, table, hand.handSeq));
    a.controller.dispose();

    const b = launch(backend);
    b.dispatch({ type: 'play' }); // continues the saved hand
    expect(b.state().game.hand?.handSeq).toBe(hand.handSeq);
    await drive(b, { hands: 1, hero: passive });
    const [record] = ringOf(backend);
    expect(record?.handSeq).toBe(hand.handSeq);
    await expectVerified(ringOf(backend));
  }, 30_000);

  it('a session saved before chunk 9.4 (no code): the code is computed again from the seed', async () => {
    const backend = new FakeStorage();
    const a = launch(backend, { settings: { players: 3, speed: 'instant' } });
    await flush();
    a.dispatch({ type: 'play' });
    await toHeroTurn(a);
    a.controller.dispose();
    const old = read<SessionState>(backend, K.session);
    delete old.commit;
    backend.data.set(K.session, JSON.stringify(old));

    const b = launch(backend);
    b.dispatch({ type: 'play' });
    await drive(b, { hands: 1, hero: passive });
    await expectVerified(ringOf(backend));
  }, 30_000);

  it('a complete hand left in the session is counted at the next launch with its code', async () => {
    const backend = new RecordingStorage();
    const a = launch(backend, { settings: { players: 3, speed: 'instant' } });
    await flush();
    a.dispatch({ type: 'play' });
    const [hand] = await drive(a, { hands: 1, hero: passive });
    a.controller.dispose();
    const complete = backend.history.findLast(
      ([key, value]) =>
        key === K.session && (JSON.parse(value) as SessionState).hand?.phase === 'complete',
    )?.[1] as string;
    expect((JSON.parse(complete) as SessionState).commit).toMatch(/^[0-9a-f]{64}$/);
    // The tab died after saving the complete hand: no record, the profile from before it.
    backend.data.set(K.profile, backend.data.get(K.profileBackup) as string);
    backend.data.delete(K.hands);
    backend.data.set(K.session, complete);

    launch(backend); // boot counts it (synchronously, with the session's code)
    const [record] = ringOf(backend);
    expect(record?.handSeq).toBe(hand?.handSeq);
    await expectVerified(ringOf(backend));
  }, 30_000);
});

describe('no worker gets a hand seed or a shuffle code (§9.6 3b, §2.2)', () => {
  const ANALYSIS: HandAnalysis = {
    draws: [],
    outs: [],
    nextCardPct: null,
    byRiverPct: null,
    chances: null,
    beaters: null,
    nuts: false,
  };
  const result = (equity: number): EquityResult => ({
    n: 2_500,
    win: equity,
    split: 0,
    equity,
    exact: false,
    final: true,
    truncated: false,
  });
  const fastMath: EquityMath = {
    *equitySteps() {
      yield result(0.5);
    },
    *runoutSteps(hands) {
      yield hands.map(() => result(1 / hands.length));
    },
    handInfo: () => ANALYSIS,
  };

  it('bots, the coach’s hints and the equity jobs: none of their messages holds one', async () => {
    const brainFake = fakeBrainWorker({ service: { decide: simpleDecide, coach: coachAnswer } });
    const equityFake = fakeWorker({ math: fastMath, service: { now: () => 0 } });
    const h = makeHarness({
      brain: createBrainClient(brainFake.spawn, realTimers),
      equity: createEquityClient(equityFake.spawn, realTimers),
      hints: true,
      sha256: nodeSha256,
      settings: { players: 6, speed: 'instant' },
    });
    await flush();
    h.dispatch({ type: 'play' });
    const secrets: string[] = [];
    await drive(h, {
      hands: 8,
      hero: heroPolicy(SEED),
      onComplete: (hand) => {
        const table = h.state().game.table as TableState;
        secrets.push(hand.seed, codeOf(hand.seed, table, hand.handSeq));
      },
    });
    expect(secrets).toHaveLength(16);
    const kinds = new Set(brainFake.received.map((m) => m.kind));
    expect(kinds).toContain('botDecision');
    expect(kinds).toContain('hint');
    expect(equityFake.received.length).toBeGreaterThan(0);
    const sent = JSON.stringify([...brainFake.received, ...equityFake.received]);
    for (const secret of secrets) expect(sent).not.toContain(secret);
    // Nor anything of the hands to come: the codes prepared for the next deal.
    const next = h.state().game.hand as HandState;
    expect(sent).not.toContain(next.seed);
  }, 60_000);
});
