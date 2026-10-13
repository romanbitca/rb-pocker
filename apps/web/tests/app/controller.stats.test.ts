/**
 * The controller's seat statistics (PLAN §9.5, chunk 7.1): updated only at hand end, by
 * `playerId` (a bot that replaces a busted one starts with none), the hero's kept across tables
 * (the hero model, in memory until Stage 8), sent to the brain in every observation, saved in
 * the session and restored with it, and published for the Hard/Expert bot card.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HERO_ID, statsBySeat } from '../../src/app/controller.ts';
import { updateSeatStats } from '../../src/brain/opponentStats.ts';
import type { HandState, SeatStats, TableState } from '../../src/engine/types.ts';
import type { SessionState } from '../../src/persist/schema.ts';
import { createSafeStorage, STORAGE_KEYS } from '../../src/persist/storage.ts';
import { FakeStorage } from '../persist/fakeStorage.ts';
import { drive, heroPolicy, makeHarness, spyBrain, SEED, type Harness } from './harness.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** The statistics the hands imply: `updateSeatStats` folded over each player's hands. */
function expected(played: readonly { hand: HandState; table: TableState }[]) {
  const out: Record<string, SeatStats> = {};
  for (const { hand, table } of played) {
    hand.seats.forEach((seat, i) => {
      const id = table.slots[i]?.playerId as string;
      if (seat.dealtIn) out[id] = updateSeatStats(out[id] ?? null, hand.log, i);
    });
  }
  return out;
}

/** Plays `hands` hands, recording each with the table it was dealt from. */
async function play(h: Harness, hands: number, seed = 'a1') {
  const played: { hand: HandState; table: TableState }[] = [];
  await drive(h, {
    hands,
    hero: heroPolicy(`${seed.padStart(32, '0')}`),
    onComplete: (hand) => played.push({ hand, table: h.controller.snapshot().table as TableState }),
  });
  return played;
}

describe('seat statistics (§9.5)', () => {
  it('change only at hand end, follow each player, and reach the brain and the store', async () => {
    const brain = spyBrain();
    const h = makeHarness({
      brain: brain.client,
      settings: { players: 6, startingStack: 400, sb: 10, bb: 20, botLevel: 'expert' },
    });
    h.dispatch({ type: 'play' });
    const played = await play(h, 30);
    const seated = (h.controller.snapshot().next ?? h.controller.snapshot().table) as TableState;
    const want = expected(played);
    // Only the players still at the table keep an entry; a newcomer has none yet.
    const ids = new Set(seated.slots.map((s) => s.playerId));
    const kept = Object.fromEntries(Object.entries(want).filter(([id]) => ids.has(id)));
    const got = h.state().game.seatStats;
    for (const id of Object.keys(got)) expect(ids.has(id) || id === HERO_ID).toBe(true);
    for (const [id, stats] of Object.entries(kept)) expect(got[id]).toEqual(stats);
    expect(got[HERO_ID]?.hands).toBe(played.filter((p) => p.hand.seats[0]?.dealtIn).length);

    // Some bot busted at 20 bb in 30 hands, and its seat's newcomer started with nothing.
    const replaced = played.some(({ table }) =>
      table.slots.some((slot, i) => slot.playerId !== played[0]?.table.slots[i]?.playerId),
    );
    expect(replaced).toBe(true);

    // Every request of a hand saw the statistics of the hands before it, by player.
    const byHand = new Map<number, (SeatStats | null)[]>();
    for (const req of brain.requests) {
      const prior = byHand.get(req.obs.handSeq);
      if (prior === undefined) byHand.set(req.obs.handSeq, req.obs.seatStats);
      else expect(req.obs.seatStats).toEqual(prior);
    }
    for (let k = 0; k < played.length; k++) {
      const { hand, table } = played[k] as { hand: HandState; table: TableState };
      const seen = byHand.get(hand.handSeq);
      if (seen === undefined) continue; // nobody but the hero decided
      expect(seen).toEqual(statsBySeat(expected(played.slice(0, k)), table));
    }
  }, 60_000);

  it('the hero model stays across tables; the bots of a new table start unseen', async () => {
    const brain = spyBrain();
    const h = makeHarness({
      brain: brain.client,
      settings: { players: 4, startingStack: 2000, sb: 10, bb: 20, botLevel: 'expert' },
    });
    h.dispatch({ type: 'play' });
    const first = await play(h, 6);
    const hero = expected(first)[HERO_ID] as SeatStats;
    expect(hero.hands).toBe(6);
    expect(h.state().game.seatStats[HERO_ID]).toEqual(hero);

    const before = brain.requests.length;
    h.dispatch({ type: 'newTable', confirmed: true });
    await vi.waitFor(() => expect(h.state().game.hand?.handSeq).toBeGreaterThan(6));
    expect(h.state().game.seatStats).toEqual({ [HERO_ID]: hero });
    const second = await play(h, 1, 'b2');
    const next = brain.requests
      .slice(before)
      .find((r) => r.obs.handSeq === second[0]?.hand.handSeq);
    expect(next?.obs.seatStats[0]).toEqual(hero);
    expect(next?.obs.seatStats.slice(1)).toEqual([null, null, null]);
  }, 60_000);

  it('are saved with the session and come back with it', async () => {
    const backend = new FakeStorage();
    const storage = createSafeStorage(() => backend);
    const h = makeHarness({
      storage,
      settings: { players: 5, startingStack: 2000, sb: 10, bb: 20, botLevel: 'hard' },
    });
    h.dispatch({ type: 'play' });
    await play(h, 4);
    const raw = backend.data.get(STORAGE_KEYS.session) as string;
    const session = JSON.parse(raw) as SessionState;
    const live = h.state().game.seatStats;
    expect(session.seatStats).toEqual(statsBySeat(live, session.table));
    expect(session.seatStats[0]).toEqual(live[HERO_ID]);

    // The next launch restores them at boot, and Home's Play goes on with them.
    const restored = Object.fromEntries(
      Object.entries(live).filter(([id]) => session.table.slots.some((s) => s.playerId === id)),
    );
    const again = makeHarness({ storage: createSafeStorage(() => backend), seed: SEED });
    expect(again.state().game.seatStats).toEqual(restored);
    again.dispatch({ type: 'play' });
    expect(again.state().game.seatStats).toEqual(restored);
  }, 60_000);
});
