import { describe, expect, it } from 'vitest';
import type { RoomSeat } from '../../src/mp/seating.js';
import {
  AWAY_TURN_MS,
  DEAL_GRACE_MS,
  HAND_END_FOLD_MS,
  HAND_END_SHOWDOWN_MS,
  IDLE_NOBODY_MS,
  IDLE_WAITING_MS,
  OFFLINE_TURN_MS,
  RESUME_MS,
  REVEAL_MS,
  RUNOUT_PAUSE_MS,
  SEAT_LOST_MS,
  STREET_PAUSE_MS,
  TIMEOUTS_TO_SIT_OUT,
} from '../../src/mp/timing.js';
import { FakeClock } from '../helpers/fake-clock.js';
import { foldOrCheck, Harness, passive, shove, userId } from '../helpers/room-harness.js';

/** A clock whose `clearTimeout` does nothing: every timer ever armed fires. */
class LeakyClock extends FakeClock {
  override clearTimeout(): void {}
}

describe('§19.5 numbers', () => {
  it("the numbers are the plan's", () => {
    expect({
      DEAL_GRACE_MS,
      OFFLINE_TURN_MS,
      AWAY_TURN_MS,
      STREET_PAUSE_MS,
      RUNOUT_PAUSE_MS,
      REVEAL_MS,
      HAND_END_FOLD_MS,
      HAND_END_SHOWDOWN_MS,
      RESUME_MS,
      TIMEOUTS_TO_SIT_OUT,
      SEAT_LOST_MS,
      IDLE_NOBODY_MS,
      IDLE_WAITING_MS,
    }).toEqual({
      DEAL_GRACE_MS: 1_500,
      OFFLINE_TURN_MS: 15_000,
      AWAY_TURN_MS: 3_000,
      STREET_PAUSE_MS: 1_000,
      RUNOUT_PAUSE_MS: 1_500,
      REVEAL_MS: 500,
      HAND_END_FOLD_MS: 4_000,
      HAND_END_SHOWDOWN_MS: 7_000,
      RESUME_MS: 3_000,
      TIMEOUTS_TO_SIT_OUT: 2,
      SEAT_LOST_MS: 600_000,
      IDLE_NOBODY_MS: 300_000,
      IDLE_WAITING_MS: 1_800_000,
    });
  });

  it.each([15, 30, 60] as const)('Turn: settings.turnSeconds (%i)', (turnSeconds) => {
    const h = new Harness({ turnSeconds }).deal(3);
    h.play(passive);
    expect(h.msToDeadline()).toBe(turnSeconds * 1000);
    const seat = h.toAct();
    h.clock.advance(turnSeconds * 1000 - 1);
    expect(h.toAct()).toBe(seat);
    h.clock.advance(1);
    expect(h.toAct()).not.toBe(seat);
  });

  it('DEAL_GRACE_MS: added to the first decision of a hand', () => {
    const h = new Harness({ turnSeconds: 15 }).deal(3);
    expect(h.msToDeadline()).toBe(15_000 + DEAL_GRACE_MS);
    const seat = h.toAct();
    h.clock.advance(15_000 + DEAL_GRACE_MS - 1);
    expect(h.toAct()).toBe(seat);
  });

  it('OFFLINE_TURN_MS: at most this long for a player who is offline', () => {
    const h = new Harness({ turnSeconds: 60 }).deal(3);
    const next = (h.toAct() + 1) % 3;
    h.room.disconnected(userId(next));
    h.play(passive);
    expect(h.msToDeadline()).toBe(OFFLINE_TURN_MS);
  });

  it('AWAY_TURN_MS: a player whose timeouts already stands at the limit, for the rest of this hand', () => {
    const h = new Harness({ turnSeconds: 15 }).deal(2);
    const bb = h.hand().bbSeat;
    h.play(passive); // the small blind calls
    h.timeOut(); // the big blind's check, 1
    h.clock.advance(STREET_PAUSE_MS);
    h.timeOut(); // flop, 2
    h.play(passive);
    h.clock.advance(STREET_PAUSE_MS);
    expect(h.toAct()).toBe(bb);
    expect(h.msToDeadline()).toBe(AWAY_TURN_MS);
  });

  it('STREET_PAUSE_MS: before an advance', () => {
    const h = new Harness().deal(2);
    h.play(passive);
    h.play(passive);
    h.clock.advance(STREET_PAUSE_MS - 1);
    expect(h.hand().street).toBe('preflop');
    h.clock.advance(1);
    expect(h.hand().street).toBe('flop');
  });

  it('RUNOUT_PAUSE_MS: before each advance of an all-in run-out', () => {
    const h = new Harness().deal(2);
    h.play(shove);
    h.play(shove);
    h.clock.advance(STREET_PAUSE_MS);
    expect(h.hand().street).toBe('flop');
    for (const street of ['turn', 'river'] as const) {
      h.clock.advance(RUNOUT_PAUSE_MS - 1);
      expect(h.hand().street).not.toBe(street);
      h.clock.advance(1);
      expect(h.hand().street).toBe(street);
    }
  });

  it('REVEAL_MS: per shown hand, before the advance that settles a showdown', () => {
    const h = new Harness().deal(2);
    while (h.hand().phase !== 'showdown') h.move(passive);
    h.clock.advance(2 * REVEAL_MS - 1);
    expect(h.hand().phase).toBe('showdown');
    h.clock.advance(1);
    expect(h.hand().phase).toBe('complete');
  });

  it('HAND_END_FOLD_MS: from a hand won by folds to the next deal', () => {
    const h = new Harness().deal(2);
    h.playHand(foldOrCheck);
    h.clock.advance(HAND_END_FOLD_MS - 1);
    expect(h.hand().phase).toBe('complete');
    h.clock.advance(1);
    expect(h.hand().phase).toBe('betting');
  });

  it('HAND_END_SHOWDOWN_MS: from a showdown to the next deal', () => {
    const h = new Harness().deal(2);
    h.playHand(passive);
    h.clock.advance(HAND_END_SHOWDOWN_MS - 1);
    expect(h.hand().phase).toBe('complete');
    h.clock.advance(1);
    expect(h.hand().phase).toBe('betting');
  });

  it('RESUME_MS: from "two can play again" to the next deal, started tables only', () => {
    const h = new Harness({ seats: 3 }).deal(2);
    h.playHand(foldOrCheck);
    h.room.leave(userId(1));
    h.clock.advance(HAND_END_SHOWDOWN_MS);
    h.room.join(h.user(5));
    h.clock.advance(RESUME_MS - 1);
    expect(h.latest().status).toBe('waiting');
    h.clock.advance(1);
    expect(h.latest().status).toBe('playing');
  });

  it('TIMEOUTS_TO_SIT_OUT: 2 in a row, and an action in between starts the count again', () => {
    const h = new Harness({ turnSeconds: 15 }).deal(3);
    const away = h.toAct();
    h.timeOut(); // folds, 1
    h.playHand(passive);
    h.clock.next();
    for (let guard = 0; guard < 50 && h.latest().decision?.seat !== away; guard++) {
      h.move(foldOrCheck);
    }
    h.play(passive); // acts: back to 0
    h.playHand(passive);
    expect(h.latest().seats[away]?.status).toBe('playing');
    h.clock.next();
    for (let guard = 0; guard < 50 && h.latest().decision?.seat !== away; guard++) {
      h.move(foldOrCheck);
    }
    h.timeOut(); // 1 again
    h.playHand(passive);
    expect(h.latest().seats[away]?.status).toBe('playing');
  });

  it('SEAT_LOST_MS: offline this long and the seat empties at the next deal', () => {
    const h = new Harness({ seats: 3 }).deal(2);
    h.room.join(h.user(2));
    h.room.disconnected(userId(2));
    const row = h.rawSeats()[2] as RoomSeat;

    h.playHand(foldOrCheck);
    row.offlineSince = h.clock.now() + HAND_END_FOLD_MS - (SEAT_LOST_MS - 1); // 1 ms short at the deal
    h.clock.advance(HAND_END_FOLD_MS);
    expect(h.latest().seats[2]).not.toBeNull();

    h.playHand(foldOrCheck);
    row.offlineSince = h.clock.now() + HAND_END_FOLD_MS - SEAT_LOST_MS; // exactly at the deal
    h.clock.advance(HAND_END_FOLD_MS);
    expect(h.latest().seats[2]).toBeNull();
  });

  it('IDLE_NOBODY_MS: nobody online this long ends the table with idle', () => {
    const h = new Harness().sit(2);
    h.room.disconnected(userId(0));
    h.room.disconnected(userId(1));
    h.clock.advance(IDLE_NOBODY_MS - 1);
    expect(h.closed).toEqual([]);
    h.clock.advance(1);
    expect(h.closed).toEqual(['ABCD2345']);
  });

  it('IDLE_WAITING_MS: status waiting this long ends the table with idle', () => {
    const h = new Harness().sit(2);
    h.clock.advance(IDLE_WAITING_MS - 1);
    expect(h.closed).toEqual([]);
    h.clock.advance(1);
    expect(h.closed).toEqual(['ABCD2345']);
    expect(h.messagesTo(0).at(-1)).toEqual({ t: 'ended', code: 'ABCD2345', reason: 'idle' });
  });
});

describe('§19.5 the flow timer', () => {
  it('one flow timer at a time: a new one replaces the old one', () => {
    const h = new Harness().deal(3);
    expect(h.clock.pending).toBe(1); // the turn; playing and someone online: no idle timer
    h.play(passive);
    expect(h.clock.pending).toBe(1);
    h.playHand(passive);
    expect(h.clock.pending).toBe(1); // nextHand
    h.room.disconnected(userId(0));
    expect(h.clock.pending).toBe(1);
  });

  it('a timer from before a state change does nothing, even if it was never cleared (pitfall 53)', () => {
    const script = (clock: FakeClock): unknown[] => {
      const h = new Harness({ seats: 3, turnSeconds: 15 }, clock).deal(3);
      h.play(foldOrCheck); // the turn timer of the first decision is now stale
      h.clock.advance(1_000);
      h.room.disconnected(userId(h.toAct()));
      h.clock.advance(1_000);
      h.playHand(passive);
      h.clock.advance(HAND_END_SHOWDOWN_MS);
      return h.tablesTo(0).map((t) => [t.view.rev, t.view.decision?.seq, t.view.hand?.handSeq]);
    };
    const honest = script(new FakeClock());
    expect(script(new LeakyClock())).toEqual(honest);
  });

  it('after the table ends no timer is left, and no old one can do anything', () => {
    const clock = new LeakyClock();
    const h = new Harness({}, clock).deal(3);
    h.room.end('idle');
    const sent = h.sent.length;
    h.clock.advance(IDLE_WAITING_MS * 2);
    expect(h.sent).toHaveLength(sent);
  });
});

describe('§19.5 disconnected and connected', () => {
  it('disconnected: online false; the others get the view', () => {
    const h = new Harness().deal(3);
    const other = (h.toAct() + 1) % 3;
    const before = h.tablesTo(other).length;
    h.room.disconnected(userId(other));
    const view = h.view((other + 1) % 3);
    expect(view.seats[other]?.online).toBe(false);
    expect(h.tablesTo(other)).toHaveLength(before); // an offline player gets none
  });

  it('disconnected: on their own decision with more than OFFLINE_TURN_MS left, the deadline moves to now + OFFLINE_TURN_MS', () => {
    const h = new Harness({ turnSeconds: 60 }).deal(3);
    const seat = h.toAct();
    const { seq } = h.latest().decision as { seq: number };
    h.clock.advance(1_000);
    h.room.disconnected(userId(seat));
    expect(h.latest().decision).toMatchObject({
      seat,
      seq,
      deadlineAt: h.clock.now() + OFFLINE_TURN_MS,
    });
    h.clock.advance(OFFLINE_TURN_MS);
    expect(h.latest().decision?.seat).not.toBe(seat);
    expect(h.hand().seats[seat]?.folded).toBe(true);
  });

  it('disconnected: with less than OFFLINE_TURN_MS left, the deadline stays', () => {
    const h = new Harness({ turnSeconds: 15 }).deal(3);
    const seat = h.toAct();
    h.clock.advance(5_000);
    const deadline = h.latest().decision?.deadlineAt as number;
    expect(deadline - h.clock.now()).toBeLessThanOrEqual(OFFLINE_TURN_MS);
    h.room.disconnected(userId(seat));
    expect(h.latest().decision?.deadlineAt).toBe(deadline);
  });

  it("disconnected: someone else's decision does not move", () => {
    const h = new Harness({ turnSeconds: 60 }).deal(3);
    const other = (h.toAct() + 1) % 3;
    const deadline = h.latest().decision?.deadlineAt;
    h.room.disconnected(userId(other));
    expect(h.latest().decision?.deadlineAt).toBe(deadline);
  });

  it('connected: online true, a table to that player, and the deadline does not move', () => {
    const h = new Harness({ turnSeconds: 60 }).deal(3);
    const seat = h.toAct();
    h.room.disconnected(userId(seat));
    const deadline = h.latest().decision?.deadlineAt;
    const before = h.tablesTo(seat).length;
    h.clock.advance(2_000);
    h.room.connected(userId(seat));
    expect(h.tablesTo(seat)).toHaveLength(before + 1);
    const view = h.view(seat);
    expect(view.seats[seat]?.online).toBe(true);
    expect(view.decision?.deadlineAt).toBe(deadline);
    expect(view.legal).not.toBeNull();
    // and can act
    expect(h.room.act(userId(seat), view.decision?.seq as number, { type: 'call' })).toBeNull();
  });

  it('connected: a player who is already online gets a table and nobody else hears of it (a new socket took over)', () => {
    const h = new Harness().deal(2);
    const { rev } = h.view(0);
    const before = [h.tablesTo(0).length, h.tablesTo(1).length] as const;
    h.room.connected(userId(1));
    expect(h.tablesTo(1)).toHaveLength(before[1] + 1);
    expect(h.tablesTo(0)).toHaveLength(before[0]);
    expect(h.view(1).rev).toBe(rev);
  });

  it('a disconnect takes the same path as a timeout: the same counter, the same sitting out, the same "I\'m back"', () => {
    const h = new Harness({ seats: 3, turnSeconds: 60 }).deal(3);
    const away = h.toAct();
    h.room.disconnected(userId(away));
    expect(h.msToDeadline()).toBeLessThanOrEqual(OFFLINE_TURN_MS);
    h.timeOut(); // folds, 1, with the shorter clock
    expect(h.rawSeats()[away]?.timeouts).toBe(1);
    h.playHand(passive);
    h.clock.next();
    for (let guard = 0; guard < 50 && h.latest().decision?.seat !== away; guard++) {
      h.move(foldOrCheck);
    }
    expect(h.msToDeadline()).toBe(OFFLINE_TURN_MS); // no grace, the offline clock
    h.timeOut(); // 2
    h.playHand(passive);
    expect(h.latest().seats[away]?.status).toBe('sittingOut');

    h.room.connected(userId(away));
    expect(h.view(away).seats[away]?.status).toBe('sittingOut');
    h.room.back(userId(away));
    expect(h.view(away).seats[away]?.status).toBe('nextHand');
  });

  it('a short drop costs at most the current turn: nothing about the seat changes', () => {
    const h = new Harness({ seats: 3, turnSeconds: 60 }).deal(3);
    const other = (h.toAct() + 1) % 3;
    const before = h.view(other).seats[other];
    h.room.disconnected(userId(other));
    h.clock.advance(1_000);
    h.room.connected(userId(other));
    expect(h.view(other).seats[other]).toEqual(before);
    expect(h.view(other).hand?.seats[other]?.hole).not.toBeNull();
  });
});

describe('§19.5 idle watch', () => {
  it('idle: nobody online arms IDLE_NOBODY_MS; the condition gone cancels it', () => {
    const h = new Harness().deal(2);
    h.room.disconnected(userId(0));
    h.room.disconnected(userId(1));
    h.clock.advance(IDLE_NOBODY_MS - 1);
    h.room.connected(userId(1));
    h.clock.advance(IDLE_NOBODY_MS);
    expect(h.closed).toEqual([]);
  });

  it('idle: status waiting arms IDLE_WAITING_MS; starting the game cancels it', () => {
    const h = new Harness().sit(2);
    h.clock.advance(IDLE_WAITING_MS - 1);
    h.room.start(userId(0));
    h.clock.advance(2);
    expect(h.closed).toEqual([]);
  });

  it('idle: with both, the shorter of the two', () => {
    const h = new Harness().sit(2);
    h.room.disconnected(userId(0));
    h.room.disconnected(userId(1));
    h.clock.advance(IDLE_NOBODY_MS);
    expect(h.closed).toEqual(['ABCD2345']);
  });

  it('idle: waiting counts from when it began, so a joiner does not start it again', () => {
    const h = new Harness().sit(1);
    h.clock.advance(IDLE_WAITING_MS - 1_000);
    h.room.join(h.user(1));
    h.clock.advance(1_000);
    expect(h.closed).toEqual(['ABCD2345']);
  });

  it('idle: nobody online counts from when it began, while the hand plays itself out', () => {
    const h = new Harness().deal(2);
    h.room.disconnected(userId(0));
    h.room.disconnected(userId(1));
    h.clock.advance(IDLE_NOBODY_MS - 1);
    expect(h.closed).toEqual([]);
    h.clock.advance(1);
    expect(h.closed).toEqual(['ABCD2345']);
    expect(h.clock.pending).toBe(0);
  });

  it('idle: nobody is told when nobody is online', () => {
    const h = new Harness().deal(2);
    h.room.disconnected(userId(0));
    h.room.disconnected(userId(1));
    h.clock.advance(IDLE_NOBODY_MS);
    expect(h.sent.filter((s) => s.msg.t === 'ended')).toEqual([]);
  });
});
