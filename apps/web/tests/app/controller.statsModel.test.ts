/**
 * The controller's side of the stats (PLAN §14.4, §11.4; chunk 8.2): the profile's stats in the
 * store at boot and after every commit; Stage 8 acceptance 4 (an Undo hand is practice only, its
 * undone decision still counts) and 4b (3 hands, New table, 3 more: 6); the session's end (Leave
 * table with its line, New table, Change table, 30 minutes without an action at the next launch);
 * reloads; Stats → History read from `pc.v1.hands` and a stored hand opened in Review. The
 * reducers themselves are `tests/persist/stats.test.ts`. Fake timers (and so a fake `Date`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Toast } from '../../src/app/store.ts';
import type { LegalActions, PlayerAction } from '../../src/engine/types.ts';
import type { HandRing, Profile, SessionState, Settings, Stats } from '../../src/persist/schema.ts';
import { SESSION_IDLE_MS } from '../../src/persist/stats.ts';
import { createSafeStorage, STORAGE_KEYS } from '../../src/persist/storage.ts';
import { statsView } from '../../src/ui/stats.ts';
import { FakeStorage } from '../persist/fakeStorage.ts';
import { stubGrader, type StubGrader } from './graders.ts';
import {
  drive,
  flush,
  heroPolicy,
  makeHarness,
  scriptedBrain,
  tick,
  type Harness,
} from './harness.ts';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-20T12:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

const K = STORAGE_KEYS;
const SEED = 'feedc0de00000000feedc0de00000000';

const passive = (legal: LegalActions): PlayerAction =>
  legal.canCheck ? { type: 'check' } : { type: 'call' };

interface LaunchOptions {
  grader?: StubGrader;
  /** Bots that only check or call (a hand then always reaches the hero). */
  passiveBots?: boolean;
}

/** One page load over `backend`: a new store, a new controller, booted. */
function launch(backend: FakeStorage, options: LaunchOptions = {}): Harness {
  return makeHarness({
    seed: SEED,
    storage: createSafeStorage(() => backend),
    ...(options.grader !== undefined && { grader: options.grader }),
    ...(options.passiveBots === true && {
      brain: scriptedBrain({ thinkMs: 300, choose: (obs) => passive(obs.legal) }),
    }),
  });
}

/**
 * The first launch: a 3-seat table at Instant speed, the next hand by itself unless `patch` says
 * otherwise (off by default since 1.3.94; these tests play on past a hand end without tapping)
 * (Settings, then Play).
 */
function start(backend: FakeStorage, patch: Partial<Settings> = {}, options: LaunchOptions = {}) {
  const h = launch(backend, options);
  h.dispatch({
    type: 'settings',
    patch: { players: 3, speed: 'instant', autoNext: true, ...patch },
  });
  h.dispatch({ type: 'play' });
  return h;
}

const read = <T>(backend: FakeStorage, key: string): T =>
  JSON.parse(backend.data.get(key) as string) as T;
const profileOf = (backend: FakeStorage): Profile => read<Profile>(backend, K.profile);
const counted = (s: Stats): number => s.results.clean.hands + s.results.practice.hands;
const statsOf = (h: Harness): Stats => {
  const stats = h.state().stats;
  if (stats === null) throw new Error('no stats in the store');
  return stats;
};

const play = (h: Harness, hands: number) => drive(h, { hands, hero: heroPolicy(SEED) });

/** Runs the clock until the finished hands are committed (no grade on its way). */
async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) await tick();
  await flush();
}

describe('the stats in the store (§14.4)', () => {
  it('boot publishes the profile`s stats; each commit publishes the new ones', async () => {
    const backend = new FakeStorage();
    const h = start(backend);
    expect(statsOf(h)).toEqual(profileOf(backend).stats);
    await play(h, 3);
    await settle();
    expect(counted(statsOf(h))).toBe(3);
    expect(statsOf(h)).toEqual(profileOf(backend).stats);
    // A new launch reads them back.
    const again = launch(backend);
    expect(statsOf(again)).toEqual(profileOf(backend).stats);
  }, 30_000);

  it('acceptance 4b: 3 hands, New table, 3 more: the Stats screen says 6 hands', async () => {
    const backend = new FakeStorage();
    const h = start(backend);
    await play(h, 3);
    h.dispatch({ type: 'newTable', setup: { players: 4 }, confirmed: true });
    await play(h, 3);
    await settle();
    const view = statsView(statsOf(h), 20, new Date());
    expect(view.hands).toBe(6);
    expect(view.results.hands + view.results.practice).toBe(6);
    expect(counted(profileOf(backend).stats)).toBe(6);
  }, 30_000);
});

describe('acceptance 4: Undo hands are practice; undone decisions still count (§11.4)', () => {
  it('the hand goes to the practice bucket only, and the undone Big mistake is in the score', async () => {
    const backend = new FakeStorage();
    // The first decision is a Big mistake (the card opens at Beginner), every later one Best.
    const grader = stubGrader({ answer: (ask) => (ask.decisionId === 0 ? 'blunder' : 'best') });
    const h = start(backend, { speed: 'normal' }, { grader, passiveBots: true });
    for (let i = 0; i < 400 && h.state().game.mode !== 'heroTurn'; i++) await tick();
    h.dispatch({ type: 'act', action: passive(h.state().game.legal as LegalActions) });
    await flush();
    expect(h.state().game.mode).toBe('feedback');
    h.dispatch({ type: 'undo' });
    // The decision again, now graded Best (the stub grades by decisionId: Big mistake again).
    for (let i = 0; i < 4000; i++) {
      const s = h.state();
      if (s.game.hand?.phase === 'complete' && s.game.mode === 'handEnd') break;
      if (s.game.mode === 'heroTurn' && s.game.legal !== null) {
        h.dispatch({ type: 'act', action: passive(s.game.legal) });
      } else if (s.game.mode === 'feedback') {
        h.dispatch({ type: 'keepMove' });
      } else {
        await tick();
      }
    }
    await settle();
    const stats = profileOf(backend).stats;
    expect(stats.results.practice.hands).toBe(1);
    expect(stats.results.clean.hands).toBe(0);
    expect(Object.values(stats.results.byBotLevel).every((b) => b.hands === 0)).toBe(true);
    // Both blunders (the undone one and its retry) and every later decision are in the score.
    const all = stats.decisions.all;
    expect(all.undone).toBe(1);
    expect(all.byGrade.blunder).toBe(2);
    expect(all.decisions).toBe(all.byGrade.blunder + all.byGrade.best);
    const session = stats.currentSession;
    expect(session?.decisions).toBe(all.decisions);
    expect(session?.blunders).toBe(2);
    expect(session?.decisionScore).toBeCloseTo((100 * all.byGrade.best) / all.decisions, 9);
    // The Stats screen: no clean hand, one practice hand, "Fixed with Undo: 1".
    const view = statsView(statsOf(h), 20, new Date());
    expect(view.results).toMatchObject({ hands: 0, practice: 1 });
    expect(view.progress.fixedWithUndo).toBe(1);
  }, 30_000);
});

describe('the session (§14.4)', () => {
  it('Leave table ends it, with its line; Play goes on at the same table in a new session', async () => {
    const backend = new FakeStorage();
    const h = start(backend);
    await play(h, 2);
    await settle();
    const running = profileOf(backend).stats.currentSession;
    expect(running?.hands).toBe(2);
    h.dispatch({ type: 'leaveTable' });
    expect(h.state().ui.screen).toBe('home');
    const stats = profileOf(backend).stats;
    expect(stats.currentSession).toBeNull();
    expect(stats.sessions).toBe(1);
    expect(stats.recentSessions).toEqual([running]);
    expect(h.state().stats).toEqual(stats);
    const toast = h.state().ui.toasts.find((t) => t.kind === 'session') as
      Extract<Toast, { kind: 'session' }> | undefined;
    expect(toast?.session).toEqual(running);
    // Leaving again with no hand played: no line, no new session.
    h.dispatch({ type: 'play' });
    h.dispatch({ type: 'leaveTable' });
    expect(h.state().ui.toasts.filter((t) => t.kind === 'session')).toHaveLength(1);
    expect(profileOf(backend).stats.sessions).toBe(1);
    // Play continues the table; its next hand starts a new session.
    const table = h.controller.snapshot().next?.tableId ?? h.controller.snapshot().table?.tableId;
    h.dispatch({ type: 'play' });
    await play(h, 1);
    await settle();
    const later = profileOf(backend).stats;
    expect(h.controller.snapshot().table?.tableId ?? h.controller.snapshot().next?.tableId).toBe(
      table,
    );
    expect(later.currentSession?.hands).toBe(1);
    expect(later.sessions).toBe(1);
  }, 30_000);

  it('New table and Change table end it', async () => {
    const backend = new FakeStorage();
    // The next hand waits for a tap: Change table is offered between hands only (§3.1).
    const h = start(backend, { autoNext: false });
    await play(h, 1);
    h.dispatch({ type: 'newTable', confirmed: true });
    await settle();
    expect(profileOf(backend).stats.sessions).toBe(1);
    expect(profileOf(backend).stats.recentSessions[0]?.hands).toBe(1);
    await play(h, 1);
    await settle();
    expect(profileOf(backend).stats.currentSession?.hands).toBe(1);
    // Change table (out of chips): Setup, and the session ends.
    h.dispatch({ type: 'changeTable' });
    expect(profileOf(backend).stats.sessions).toBe(2);
    expect(profileOf(backend).stats.currentSession).toBeNull();
  }, 30_000);

  it('at the next launch it ends after 30 minutes without an action, not before', async () => {
    const backend = new FakeStorage();
    const h = start(backend);
    await play(h, 2);
    await settle();
    h.controller.dispose();
    const savedAt = Date.parse(read<SessionState>(backend, K.session).savedAt);

    vi.setSystemTime(savedAt + SESSION_IDLE_MS - 60_000);
    const soon = launch(backend);
    expect(profileOf(backend).stats.currentSession?.hands).toBe(2);
    expect(statsOf(soon).sessions).toBe(0);
    soon.controller.dispose();

    vi.setSystemTime(savedAt + SESSION_IDLE_MS);
    const later = launch(backend);
    expect(statsOf(later).sessions).toBe(1);
    expect(statsOf(later).currentSession).toBeNull();
    expect(profileOf(backend).stats).toEqual(statsOf(later));
  }, 30_000);
});

describe('reloads (§3.1, §14.4 Results)', () => {
  it('Reload after a bust and Menu → Top up each count one, saved at once', async () => {
    const backend = new FakeStorage();
    // 200 chips at 10/20: the hero busts soon against bots that call everything.
    const h = start(backend, { startingStack: 200, sb: 10, bb: 20 }, { passiveBots: true });
    const allIn = (legal: LegalActions): PlayerAction =>
      legal.raise !== null
        ? { type: 'raise', to: legal.raise.max }
        : legal.bet !== null
          ? { type: 'bet', to: legal.bet.max }
          : passive(legal);
    for (let i = 0; i < 20000 && profileOf(backend).stats.reloads === 0; i++) {
      const s = h.state();
      if (s.ui.overlays.includes('outOfChips')) h.dispatch({ type: 'reload' });
      else if (s.game.mode === 'heroTurn' && s.game.legal !== null) {
        h.dispatch({ type: 'act', action: allIn(s.game.legal) });
      } else await tick();
    }
    expect(profileOf(backend).stats.reloads).toBe(1);
    expect(statsOf(h).reloads).toBe(1);
  }, 30_000);

  it('Menu → Top up counts one too', async () => {
    const backend = new FakeStorage();
    const h = start(backend, { autoNext: false });
    // Hands until the hero is below the starting stack between hands.
    for (let hands = 0; hands < 30; hands++) {
      await play(h, 1);
      const next = h.controller.snapshot().next;
      const stack = next?.slots[0]?.stack ?? 0;
      if (stack > 0 && stack < (next?.config.startingStack ?? 0)) break;
      h.dispatch({ type: 'nextHand' });
    }
    await settle();
    expect(profileOf(backend).stats.reloads).toBe(0);
    h.dispatch({ type: 'topUp' });
    expect(profileOf(backend).stats.reloads).toBe(1);
    expect(statsOf(h).reloads).toBe(1);
  }, 30_000);
});

describe('with Import and Reset (§14.8, chunk 8.3)', () => {
  it('the Stats screen follows a Reset: empty stats in the store, History read again', async () => {
    const backend = new FakeStorage();
    const h = start(backend);
    await play(h, 3);
    await settle();
    h.dispatch({ type: 'history' });
    expect(h.state().history).toHaveLength(3);
    h.dispatch({ type: 'resetStats' });
    await vi.dynamicImportSettled(); // the Data commands are a lazy chunk
    await flush();
    expect(counted(profileOf(backend).stats)).toBe(0);
    expect(h.state().stats).toEqual(profileOf(backend).stats);
    expect(h.state().history).toBeNull(); // stale: the Stats screen reads it again
    h.dispatch({ type: 'history' });
    expect(h.state().history).toEqual([]);
  }, 30_000);
});

describe('Stats → History (§14.4)', () => {
  it('lists the stored hands without cards; one of an earlier launch opens in Review', async () => {
    const backend = new FakeStorage();
    const h = start(backend);
    const hands = await play(h, 3);
    await settle();
    h.controller.dispose();

    const again = launch(backend);
    expect(again.state().history).toBeNull();
    again.dispatch({ type: 'history' });
    const rows = again.state().history ?? [];
    expect(rows.map((r) => r.handSeq)).toEqual(hands.map((x) => x.handSeq).reverse());
    expect(rows[0]).toEqual({
      handSeq: hands[2]?.handSeq,
      handNumber: 3,
      at: expect.any(String),
      net: hands[2]?.result?.net[0],
      bestCategory: expect.toSatisfy((c: unknown) => c === null || typeof c === 'string'),
      grades: expect.any(Array),
      practice: false,
    });
    // No cards in a row (§2.2, the non-cheating boundary): numbers and words only.
    expect(JSON.stringify(rows)).not.toMatch(/hole|board|deck|seed|cards/);

    // Review of the first hand: it was played in the earlier launch, so it comes from storage.
    expect(again.state().review.hands).toHaveLength(0);
    const first = hands[0]?.handSeq as number;
    again.dispatch({ type: 'historyReview', handSeq: first });
    const s = again.state();
    expect(s.ui.screen).toBe('review');
    expect(s.review.selected).toBe(first);
    expect(s.review.hands.map((x) => x.handSeq)).toEqual([first]);
    expect(s.review.hands[0]?.end.heroNet).toBe(hands[0]?.result?.net[0]);
    // With the hand's decisions, so Review can show them on their steps (§12.10).
    const stored = (JSON.parse(backend.data.get(STORAGE_KEYS.hands) as string) as HandRing).hands;
    expect(s.review.hands[0]?.decisions).toEqual(
      stored.find((r) => r.handSeq === first)?.decisions,
    );

    // A new hand makes the rows stale; asking again lists it.
    again.dispatch({ type: 'back' });
    again.dispatch({ type: 'play' });
    await play(again, 1);
    await settle();
    expect(again.state().history).toBeNull();
    again.dispatch({ type: 'history' });
    expect(again.state().history).toHaveLength(4);
  }, 30_000);
});
