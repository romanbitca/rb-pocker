import { describe, expect, it, vi } from 'vitest';
import { deriveSeed, randInt, rngFromSeed, ZERO_SEED, type Rng } from '../../src/game/core/rng.js';
import { legalActions } from '../../src/game/engine/legal.js';
import type {
  EngineInput,
  HandState,
  LegalActions,
  PlayerAction,
} from '../../src/game/engine/types.js';
import {
  MAX_SEATS,
  MIN_SEATS,
  type EndReason,
  type TableView,
} from '../../src/game/net/protocol.js';
import { SEAT_LOST_MS } from '../../src/mp/timing.js';
import { Harness, userId } from '../helpers/room-harness.js';

/** Sees every input the room gives the engine; `probing`: a client's deliberately illegal action. */
const seen = vi.hoisted(() => ({
  probing: false,
  check: null as null | ((hand: unknown, input: unknown) => void),
}));
vi.mock('../../src/game/engine/step.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/game/engine/step.js')>();
  const step: typeof real.step = (hand, input) => {
    seen.check?.(hand, input);
    return real.step(hand, input);
  };
  return { ...real, step };
});

function isLegal(legal: LegalActions | null, action: PlayerAction): boolean {
  if (legal === null) return false;
  switch (action.type) {
    case 'fold':
      return legal.canFold;
    case 'check':
      return legal.canCheck;
    case 'call':
      return legal.canCall;
    case 'bet':
      return legal.bet !== null && action.to >= legal.bet.min && action.to <= legal.bet.max;
    case 'raise':
      return legal.raise !== null && action.to >= legal.raise.min && action.to <= legal.raise.max;
  }
}

function randomLegal(rng: Rng, legal: LegalActions): PlayerAction {
  const options: PlayerAction[] = [];
  if (legal.canFold) options.push({ type: 'fold' });
  if (legal.canCheck) options.push({ type: 'check' }, { type: 'check' });
  if (legal.canCall) options.push({ type: 'call' }, { type: 'call' }, { type: 'call' });
  if (legal.bet !== null) {
    const { min, max } = legal.bet;
    options.push({ type: 'bet', to: min + randInt(rng, max - min + 1) }, { type: 'bet', to: max });
  }
  if (legal.raise !== null) {
    const { min, max } = legal.raise;
    options.push(
      { type: 'raise', to: min + randInt(rng, max - min + 1) },
      { type: 'raise', to: max },
    );
  }
  return options[randInt(rng, options.length)] as PlayerAction;
}

const POOL = 12;
const OPS_PER_SESSION = 120;

interface SessionStats {
  hands: number;
  acts: number;
  timeouts: number;
  leaves: number;
  reloads: number;
  disconnects: number;
}

/** The chips of each seat as last seen between hands, and the last hand seen. */
interface Ledger {
  chips: Map<number, number>;
  seq: number;
  /** The table was watched between the last hand and now; with nobody online no view is sent. */
  fresh: boolean;
}

/** Within a hand the chips add up (I1), and a hand starts from the chips its seats had. */
function checkChips(view: TableView, ledger: Ledger): void {
  const hand = view.hand;
  if (hand !== null) {
    const started = hand.startStacks.reduce((a, b) => a + b, 0);
    const now =
      hand.phase === 'complete'
        ? hand.seats.reduce((sum, s) => sum + s.stack, 0)
        : hand.seats.reduce((sum, s) => sum + s.stack + s.totalBet, 0);
    expect(now).toBe(started);
    if (hand.handSeq !== ledger.seq) {
      if (ledger.fresh && hand.handSeq === ledger.seq + 1) {
        hand.seats.forEach((s, i) => {
          if (s.dealtIn) expect(hand.startStacks[i]).toBe(ledger.chips.get(i));
        });
      }
      ledger.seq = hand.handSeq;
      ledger.fresh = false;
    }
  }
  if (hand === null || hand.phase === 'complete') {
    ledger.fresh = true;
    view.seats.forEach((seat, i) => {
      if (seat === null) ledger.chips.delete(i);
      else ledger.chips.set(i, seat.stack);
    });
  }
}

/** One random session of a table, on its own seeded generator. */
function runSession(index: number, stats: SessionStats): void {
  const rng = rngFromSeed(deriveSeed(ZERO_SEED, 'session', index));
  const pick = (n: number): number => randInt(rng, n);
  const seats = MIN_SEATS + pick(MAX_SEATS - MIN_SEATS + 1);
  const stakes = (['quick', 'normal', 'long'] as const)[pick(3)] as 'quick';
  const turnSeconds = ([15, 30, 60] as const)[pick(3)] as 15;
  const h = new Harness({ seats, stakes, turnSeconds }, undefined, `s${index}`);

  const ended: EndReason[] = [];
  const realEnd = h.room.end.bind(h.room);
  h.room.end = (reason) => {
    ended.push(reason);
    realEnd(reason);
  };
  let voids = 0;
  const internals = h.room as unknown as { voidHand(): void };
  const realVoid = internals.voidHand.bind(h.room);
  internals.voidHand = () => {
    voids++;
    realVoid();
  };

  seen.check = (hand, input) => {
    const inp = input as EngineInput;
    if (inp.kind !== 'act' || seen.probing) return;
    const legal = legalActions(hand as HandState);
    expect(legal?.seat).toBe(inp.seat);
    expect(isLegal(legal, inp.action)).toBe(true);
  };

  /** The user at `seat`, by what the room says; null for an empty or leaving seat. */
  const userAt = (seat: number): number | null => {
    for (let u = 0; u < POOL; u++) if (h.room.seatOf(userId(u)) === seat) return u;
    return null;
  };
  const anySeated = (): number | null => {
    const seated = h.latestSeats();
    return seated.length === 0 ? null : (seated[pick(seated.length)] as number);
  };

  h.room.create(h.user(0));
  const opening = 1 + pick(seats);
  for (let u = 1; u < opening; u++) h.room.join(h.user(u));
  if (opening >= 2 && pick(5) > 0) h.room.start(userId(0));

  const ledger: Ledger = { chips: new Map(), seq: 0, fresh: false };
  let checked = 0;
  const checkNewFrames = (): void => {
    for (; checked < h.sent.length; checked++) {
      const frame = h.sent[checked]?.msg;
      if (frame?.t === 'table') checkChips(frame.view, ledger);
    }
  };

  for (let op = 0; op < OPS_PER_SESSION && h.closed.length === 0; op++) {
    const roll = pick(100);
    const seated = anySeated();
    if (roll < 8) {
      h.room.join(h.user(pick(POOL)));
    } else if (roll < 12) {
      if (seated !== null && h.room.leave(userId(seated)) === null) stats.leaves++;
    } else if (roll < 16) {
      const hostSeat = h.latest().seats.findIndex((seat) => seat?.host === true);
      const host = userAt(hostSeat);
      h.room.start(userId(host ?? pick(POOL)));
    } else if (roll < 20) {
      if (seated !== null) {
        h.room.disconnected(userId(seated));
        stats.disconnects++;
      }
    } else if (roll < 26) {
      if (seated !== null) h.room.connected(userId(seated));
    } else if (roll < 30) {
      if (seated !== null && h.room.reload(userId(seated)) === null) stats.reloads++;
    } else if (roll < 34) {
      if (seated !== null) h.room.back(userId(seated));
    } else if (roll < 39) {
      h.clock.advance(pick(3_000));
    } else if (roll < 46) {
      // A timer fires: the turn runs out, the street advances, the next hand comes.
      if (h.latest().decision !== null) stats.timeouts++;
      h.clock.next();
    } else if (roll < 47) {
      h.clock.advance(SEAT_LOST_MS / 8);
    } else {
      // The player whose turn it is, through their own view.
      const decision = h.latest().decision;
      const actor = decision === null ? null : userAt(decision.seat);
      if (decision === null || actor === null || h.rawSeats()[decision.seat]?.online !== true) {
        // Nobody to ask (a leaving or offline seat, or nobody online): the clock decides.
        h.clock.next();
      } else {
        const own = h.view(actor);
        expect(own.decision?.seq).toBe(decision.seq);
        const legal = own.legal as LegalActions;
        if (pick(10) === 0) {
          // Stale, wrong-seat and illegal messages change nothing.
          const before = h.sent.length;
          const other = (actor + 1 + pick(POOL - 1)) % POOL;
          seen.probing = true;
          const errors = [
            h.room.act(userId(actor), decision.seq + 1 + pick(5), { type: 'fold' }),
            h.room.act(userId(actor), decision.seq, { type: 'raise', to: 1 }),
            h.room.act(userId(other), decision.seq, { type: 'fold' }),
          ];
          seen.probing = false;
          expect(errors[0]).toBe('stale_action');
          expect(errors[1]).toBe('illegal_action');
          expect(['not_your_turn', 'not_seated']).toContain(errors[2]);
          expect(h.sent.length).toBe(before);
        } else {
          expect(h.room.act(userId(actor), decision.seq, randomLegal(rng, legal))).toBeNull();
          stats.acts++;
        }
      }
    }
    checkNewFrames();
    expect(voids).toBe(0);
    expect(ended).not.toContain('error');
  }

  // Everyone goes: every hand reaches its end without help, and the table closes.
  for (const u of h.latestSeats()) h.room.leave(userId(u));
  for (let guard = 0; guard < 2_000 && h.closed.length === 0; guard++) h.clock.next();
  checkNewFrames();
  expect(h.closed).toHaveLength(1);
  expect(h.clock.pending).toBe(0);
  expect(voids).toBe(0);
  expect(ended).not.toContain('error');
  stats.hands += Math.max(0, h.seeds.length - 1); // the first seed is the table's
  seen.check = null;
}

describe('§19.5 the table machine under random sessions', () => {
  it('property: over 1,000 random sessions every action the machine sends the engine is legal, no call throws, and the chips of each hand add up', () => {
    const stats: SessionStats = {
      hands: 0,
      acts: 0,
      timeouts: 0,
      leaves: 0,
      reloads: 0,
      disconnects: 0,
    };
    for (let session = 0; session < 1_000; session++) {
      try {
        runSession(session, stats);
      } catch (err) {
        throw new Error(`session ${session}: ${String(err)}`, { cause: err });
      }
    }
    // The run has to have exercised the machine, or it proves nothing.
    expect(stats.hands).toBeGreaterThan(1_000);
    expect(stats.acts).toBeGreaterThan(5_000);
    expect(stats.timeouts).toBeGreaterThan(1_000);
    expect(stats.leaves).toBeGreaterThan(500);
    expect(stats.reloads).toBeGreaterThan(10);
    expect(stats.disconnects).toBeGreaterThan(500);
  }, 120_000);
});
