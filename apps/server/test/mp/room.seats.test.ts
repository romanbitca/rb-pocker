import { describe, expect, it } from 'vitest';
import { cleanName, nextHost, seatName, type RoomSeat } from '../../src/mp/seating.js';
import {
  HAND_END_FOLD_MS,
  HAND_END_SHOWDOWN_MS,
  RESUME_MS,
  TIMEOUTS_TO_SIT_OUT,
} from '../../src/mp/timing.js';
import { foldOrCheck, Harness, passive, shove, userId } from '../helpers/room-harness.js';

/** Two hands in a row in which `away` times out: at the end of the second it sits out. */
function sitOut(h: Harness, away: number): void {
  for (let done = 0; done < TIMEOUTS_TO_SIT_OUT;) {
    const view = h.latest();
    if (view.decision?.seat === away) {
      h.timeOut();
      done++;
    } else if (view.decision !== null) {
      h.play(foldOrCheck);
    } else {
      h.clock.next();
    }
  }
  h.playHand(foldOrCheck);
}

/** Heads-up all-ins (one more deal after each) until a seat is busted; returns it. */
function bust(h: Harness): number {
  for (let tries = 0; tries < 50; tries++) {
    h.playHand(shove);
    const busted = h.latest().seats.findIndex((seat) => seat?.status === 'busted');
    if (busted !== -1) return busted;
    h.clock.next();
  }
  throw new Error('nobody busted');
}

describe('§19.5 seat status', () => {
  it('nextHand: just joined, and dealt into the next hand', () => {
    const h = new Harness().deal(2);
    h.room.join(h.user(2));
    expect(h.latest().seats[2]?.status).toBe('nextHand');
    h.playHand(foldOrCheck);
    h.clock.next();
    expect(h.latest().seats[2]?.status).toBe('playing');
    expect(h.hand().seats[2]?.dealtIn).toBe(true);
  });

  it('playing: normal, and dealt into the next hand', () => {
    const h = new Harness().deal(2);
    h.playHand(foldOrCheck);
    h.clock.next();
    expect(
      h
        .hand()
        .seats.slice(0, 2)
        .every((seat) => seat.dealtIn),
    ).toBe(true);
  });

  it('sittingOut: stays until "I\'m back", and is not dealt in', () => {
    const h = new Harness({ turnSeconds: 15 }).deal(3);
    const away = h.toAct();
    sitOut(h, away);
    expect(h.latest().seats[away]?.status).toBe('sittingOut');
    for (let hands = 0; hands < 3; hands++) {
      h.clock.next();
      expect(h.hand().seats[away]?.dealtIn).toBe(false);
      expect(h.latest().seats[away]?.status).toBe('sittingOut');
      h.playHand(foldOrCheck);
    }
  });

  it('busted: no chips, a reload is offered, and is not dealt in', () => {
    const h = new Harness().deal(3);
    const rows = h.rawSeats();
    h.playHand(foldOrCheck);
    (rows[2] as RoomSeat).stack = 0;
    (rows[2] as RoomSeat).status = 'busted';
    h.clock.next();
    expect(h.hand().seats[2]?.dealtIn).toBe(false);
    expect(h.latest().seats[2]?.status).toBe('busted');
  });

  it('leaving: left while dealt in, the server plays out the cards, the seat empties at hand end, and is not dealt in', () => {
    const h = new Harness().deal(3);
    const leaver = (h.toAct() + 1) % 3;
    h.room.leave(userId(leaver));
    expect(h.latest().seats[leaver]?.status).toBe('leaving');
    expect(h.hand().seats[leaver]?.dealtIn).toBe(true);
    h.playHand(passive);
    expect(h.hand().seats[leaver]?.folded).toBe(true);
    h.clock.next();
    expect(h.latest().seats[leaver]).toBeNull();
    expect(h.hand().seats[leaver]?.dealtIn).toBe(false);
  });

  it('⚠️ a seat dealt into a hand stays taken until that hand is off the table', () => {
    const h = new Harness({ seats: 3 }).deal(3);
    const leaver = (h.toAct() + 1) % 3;
    h.room.leave(userId(leaver));
    expect(h.room.join(h.user(5))).toBe('full');
    h.playHand(passive);
    expect(h.room.join(h.user(5))).toBe('full'); // the finished hand is still on show
    expect(h.latest().seats[leaver]).not.toBeNull();
  });

  it('⚠️ every seat number of a finished hand on show exists in seats, even if its player leaves then', () => {
    const h = new Harness({ seats: 3 }).deal(3);
    h.playHand(foldOrCheck);
    expect(h.hand().phase).toBe('complete');
    const leaver = h.hand().seats.findIndex((seat) => seat.dealtIn);
    expect(h.room.leave(userId(leaver))).toBeNull();
    const view = h.view((leaver + 1) % 3);
    expect(view.seats[leaver]?.status).toBe('leaving');
    expect(h.room.join(h.user(5))).toBe('full');
    h.clock.next();
    expect(h.latest().seats[leaver]).toBeNull();
  });
});

describe('§19.5 empty seats and 2 to 9 players', () => {
  it.each([2, 3, 4, 5, 6, 7, 8, 9])('%i players play a hand and the chips add up', (n) => {
    const h = new Harness({ seats: n }).deal(n);
    expect(h.hand().seats.filter((seat) => seat.dealtIn)).toHaveLength(n);
    h.playHand(passive);
    const total = h.latest().seats.reduce((sum, seat) => sum + (seat?.stack ?? 0), 0);
    expect(total).toBe(n * 2000);
  });

  it('a 9-seat table with empty seats: only taken seats are dealt in, and real seat numbers stay', () => {
    const h = new Harness({ seats: 9 }).sit(8);
    for (const i of [1, 2, 4, 5, 6, 8]) h.room.leave(userId(i));
    h.room.start(userId(0));
    const hand = h.hand();
    expect(hand.seats.map((seat) => seat.dealtIn)).toEqual([
      true,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
    ]);
    expect([0, 3, 7]).toContain(hand.button);
    expect([0, 3, 7]).toContain(hand.toAct);
    expect(h.view(3).you).toBe(3);
    expect(h.view(7).you).toBe(7);
    h.playHand(passive);
    h.clock.next();
    expect([0, 3, 7]).toContain(h.hand().button);
    expect(h.hand().handSeq).toBe(2);
  });

  it('a joiner mid-hand is dealt from the next hand', () => {
    const h = new Harness().deal(3);
    h.room.join(h.user(3));
    const view = h.view(3);
    expect(view.you).toBe(3);
    expect(view.seats[3]?.status).toBe('nextHand');
    expect(view.hand?.seats[3]?.dealtIn).toBe(false);
    expect(view.hand?.seats[3]?.hole).toBeNull();
    expect(view.legal).toBeNull();
    h.playHand(foldOrCheck);
    h.clock.next();
    expect(h.view(3).hand?.seats[3]?.dealtIn).toBe(true);
    expect(h.view(3).hand?.seats[3]?.hole).not.toBeNull();
    expect(h.view(3).seats[3]?.status).toBe('playing');
  });
});

describe('§19.5 back ("I\'m back")', () => {
  it('back: sittingOut becomes nextHand, timeouts 0, and everyone gets the view', () => {
    const h = new Harness({ turnSeconds: 15 }).deal(3);
    const away = h.toAct();
    sitOut(h, away);
    expect(h.room.back(userId(away))).toBeNull();
    expect(h.view((away + 1) % 3).seats[away]?.status).toBe('nextHand');
    expect(h.rawSeats()[away]?.timeouts).toBe(0);
    h.clock.next();
    expect(h.hand().seats[away]?.dealtIn).toBe(true);
  });

  it('back: with no chips becomes busted', () => {
    const h = new Harness({ turnSeconds: 15 }).deal(3);
    const away = h.toAct();
    sitOut(h, away);
    (h.rawSeats()[away] as RoomSeat).stack = 0;
    expect(h.room.back(userId(away))).toBeNull();
    expect(h.latest().seats[away]?.status).toBe('busted');
  });

  it('back: anything but sittingOut changes nothing and is not an error', () => {
    const h = new Harness().deal(2);
    const { rev } = h.latest();
    expect(h.room.back(userId(0))).toBeNull();
    expect(h.latest().rev).toBe(rev);
  });

  it('back: not_seated without a seat', () => {
    expect(new Harness().deal(2).room.back(userId(5))).toBe('not_seated');
  });

  it('back: at a started table with 2 who can play, the game goes on by itself after RESUME_MS', () => {
    const h = new Harness({ turnSeconds: 15, seats: 2 }).deal(2);
    const away = h.toAct();
    sitOut(h, away);
    h.clock.advance(HAND_END_SHOWDOWN_MS);
    expect(h.latest()).toMatchObject({ status: 'waiting', started: true, hand: null });
    expect(h.room.back(userId(away))).toBeNull();
    h.clock.advance(RESUME_MS - 1);
    expect(h.latest().status).toBe('waiting');
    h.clock.advance(1);
    expect(h.latest().status).toBe('playing');
    expect(h.hand().phase).toBe('betting');
  });
});

describe('§19.5 reload', () => {
  it('reload: busted gets settings.stack chips and nextHand; everyone gets the view', () => {
    const h = new Harness({ seats: 2 }).deal(2);
    const busted = bust(h);
    expect(h.room.reload(userId(busted))).toBeNull();
    const view = h.view((busted + 1) % 2);
    expect(view.seats[busted]).toMatchObject({ status: 'nextHand', stack: 2000 });
  });

  it('reload: a bust offers a free reload, and only a bust', () => {
    const h = new Harness().deal(2);
    const { rev } = h.latest();
    expect(h.room.reload(userId(0))).toBe('not_busted');
    h.playHand(foldOrCheck);
    expect(h.room.reload(userId(0))).toBe('not_busted');
    expect(h.room.reload(userId(5))).toBe('not_seated');
    expect(h.latest().rev).toBeGreaterThan(rev);
    expect(h.latest().seats[0]?.status).toBe('playing');
  });

  it('reload: old timeouts do not sit the player out again', () => {
    const h = new Harness({ seats: 2, turnSeconds: 15 }).deal(2);
    const busted = bust(h);
    (h.rawSeats()[busted] as RoomSeat).timeouts = TIMEOUTS_TO_SIT_OUT;
    h.room.reload(userId(busted));
    expect(h.rawSeats()[busted]?.timeouts).toBe(0);
  });

  it('reload: at a started table with 2 who can play, the game goes on by itself after RESUME_MS', () => {
    const h = new Harness({ seats: 2 }).deal(2);
    const busted = bust(h);
    h.clock.next(); // the deal finds one player and stops
    expect(h.latest()).toMatchObject({ status: 'waiting', started: true, hand: null });
    h.room.reload(userId(busted));
    h.clock.advance(RESUME_MS - 1);
    expect(h.latest().status).toBe('waiting');
    h.clock.advance(1);
    expect(h.latest().status).toBe('playing');
  });
});

describe('§19.5 waiting and going on by itself', () => {
  it('a join while started, status waiting: the same resume rule', () => {
    const h = new Harness({ seats: 3 }).deal(2);
    h.playHand(foldOrCheck);
    h.room.leave(userId(1));
    h.clock.advance(HAND_END_SHOWDOWN_MS);
    expect(h.latest()).toMatchObject({ status: 'waiting', started: true });
    h.room.join(h.user(5));
    expect(h.latest().status).toBe('waiting');
    h.clock.advance(RESUME_MS);
    expect(h.latest().status).toBe('playing');
    expect(h.hand().seats.filter((seat) => seat.dealtIn)).toHaveLength(2);
  });

  it('resume: a second joiner does not start the countdown again', () => {
    const h = new Harness({ seats: 4 }).deal(2);
    h.playHand(foldOrCheck);
    h.room.leave(userId(1));
    h.clock.advance(HAND_END_SHOWDOWN_MS);
    h.room.join(h.user(5));
    h.clock.advance(RESUME_MS - 1);
    h.room.join(h.user(6));
    h.clock.advance(1);
    expect(h.latest().status).toBe('playing');
  });

  it('resume: if someone leaves in the countdown the deal finds too few and waits again', () => {
    const h = new Harness({ seats: 4 }).deal(2);
    h.playHand(foldOrCheck);
    h.room.leave(userId(1));
    h.clock.advance(HAND_END_SHOWDOWN_MS);
    h.room.join(h.user(5));
    h.room.leave(userId(5));
    h.clock.advance(RESUME_MS);
    expect(h.latest()).toMatchObject({ status: 'waiting', started: true, hand: null });
  });

  it('a join at a table that was never started does not start it', () => {
    const h = new Harness().sit(2);
    h.clock.advance(RESUME_MS * 2);
    expect(h.latest()).toMatchObject({ status: 'waiting', started: false });
  });
});

describe('§19.5 leave', () => {
  it('leave: left to the player, and the view stops', () => {
    const h = new Harness().deal(3);
    const leaver = (h.toAct() + 1) % 3;
    const before = h.tablesTo(leaver).length;
    expect(h.room.leave(userId(leaver))).toBeNull();
    expect(h.messagesTo(leaver).at(-1)).toEqual({ t: 'left' });
    h.play(passive);
    expect(h.tablesTo(leaver)).toHaveLength(before);
  });

  it('leave: dealt into the running hand becomes leaving until hand end; the others hear it', () => {
    const h = new Harness().deal(3);
    const leaver = (h.toAct() + 1) % 3;
    h.room.leave(userId(leaver));
    const other = (leaver + 1) % 3;
    expect(h.view(other).seats[leaver]).toMatchObject({ status: 'leaving', online: false });
    expect(h.notices(other)).toEqual([{ n: 'left', name: h.user(leaver).name }]);
  });

  it('leave: a seat that already folded is leaving too', () => {
    const h = new Harness().deal(3);
    const folded = h.toAct();
    h.play(foldOrCheck);
    h.room.leave(userId(folded));
    expect(h.latest().seats[folded]?.status).toBe('leaving');
  });

  it('leave: a seat that is the current decision acts at once', () => {
    const h = new Harness().deal(3);
    const seat = h.toAct();
    h.room.leave(userId(seat));
    expect(h.latest().decision?.deadlineAt).toBe(h.clock.now());
    h.clock.flush();
    expect(h.hand().seats[seat]?.folded).toBe(true);
    expect(h.latest().decision?.seat).not.toBe(seat);
  });

  it('leave: when the turn comes the server checks if that is free, and folds otherwise', () => {
    const h = new Harness().deal(2);
    const bb = h.hand().bbSeat;
    const sb = h.hand().sbSeat;
    h.room.leave(userId(bb));
    h.play(passive); // the small blind calls: the big blind's check is free
    expect(h.toAct()).toBe(bb);
    h.clock.flush();
    expect(h.hand().log.at(-1)).toMatchObject({ e: 'act', seat: bb, action: { type: 'check' } });
    expect(h.hand().seats[bb]?.folded).toBe(false);
    expect(sb).not.toBe(bb);
  });

  it('leave: not dealt into the hand, the seat empties now', () => {
    const h = new Harness({ seats: 6 }).deal(2);
    h.room.join(h.user(2));
    expect(h.room.leave(userId(2))).toBeNull();
    expect(h.view(0).seats[2]).toBeNull();
    expect(h.notices(0)).toEqual([{ n: 'left', name: 'Cid' }]);
  });

  it('leave: in the waiting room the seat empties now', () => {
    const h = new Harness().sit(2);
    h.room.leave(userId(1));
    expect(h.view(0).seats[1]).toBeNull();
  });

  it('leave: no seat left ends the room', () => {
    const h = new Harness().sit(1);
    expect(h.room.leave(userId(0))).toBeNull();
    expect(h.closed).toEqual(['ABCD2345']);
    expect(h.clock.pending).toBe(0);
  });

  it('leave: everyone leaving mid-hand plays the hand out, then the room ends at the deal', () => {
    const h = new Harness().deal(2);
    h.room.leave(userId(0));
    h.room.leave(userId(1));
    expect(h.closed).toEqual([]);
    for (let guard = 0; guard < 50 && h.closed.length === 0; guard++) h.clock.next();
    expect(h.closed).toEqual(['ABCD2345']);
    expect(h.clock.pending).toBe(0);
  });

  it('leave: not_seated for someone with no seat, and twice for a leaver', () => {
    const h = new Harness().deal(3);
    expect(h.room.leave(userId(5))).toBe('not_seated');
    const leaver = (h.toAct() + 1) % 3;
    h.room.leave(userId(leaver));
    expect(h.room.leave(userId(leaver))).toBe('not_seated');
  });

  it('a leaver is not seated any more: act, back and reload say not_seated', () => {
    const h = new Harness().deal(3);
    const leaver = h.toAct();
    const { decision } = h.latest();
    h.room.leave(userId(leaver));
    expect(h.room.act(userId(leaver), decision?.seq as number, { type: 'fold' })).toBe(
      'not_seated',
    );
    expect(h.room.back(userId(leaver))).toBe('not_seated');
    expect(h.room.reload(userId(leaver))).toBe('not_seated');
    expect(h.room.seatOf(userId(leaver))).toBeNull();
  });

  it("leaving mid-hand: a leaver's chips are gone", () => {
    const h = new Harness().deal(3);
    const leaver = (h.toAct() + 1) % 3;
    h.room.leave(userId(leaver));
    h.playHand(passive);
    h.clock.next();
    const total = h.hand().startStacks.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(2 * 2000 + 40);
    expect(h.latest().seats[leaver]).toBeNull();
  });

  it('leaving mid-hand: a join before the seat empties cancels it, and the seat keeps its chips', () => {
    const h = new Harness().deal(3);
    const leaver = (h.toAct() + 1) % 3;
    h.room.leave(userId(leaver));
    h.room.join(h.user(leaver));
    h.play(passive);
    expect(h.toAct()).toBe(leaver);
    expect(h.msToDeadline()).toBe(30_000);
    h.play(passive);
    h.playHand(passive);
    h.clock.next();
    expect(h.latest().seats[leaver]?.status).toBe('playing');
    expect(h.hand().seats[leaver]?.dealtIn).toBe(true);
  });

  it('leaving mid-hand: rejoining at hand end with no chips left is a bust', () => {
    const h = new Harness({ seats: 2 }).deal(2);
    const leaver = (h.toAct() + 1) % 2;
    h.room.leave(userId(leaver));
    h.playHand(foldOrCheck);
    (h.rawSeats()[leaver] as RoomSeat).stack = 0;
    h.room.join(h.user(leaver));
    expect(h.latest().seats[leaver]?.status).toBe('busted');
  });
});

describe('§19.5 the host', () => {
  it('the host: when the host leaves, the next taken seat clockwise, with the notice hostChanged', () => {
    const h = new Harness().sit(3);
    h.room.leave(userId(0));
    expect(h.view(1).seats[1]?.host).toBe(true);
    expect(h.view(2).seats[2]?.host).toBe(false);
    expect(h.notices(1)).toEqual([
      { n: 'left', name: 'Ann' },
      { n: 'hostChanged', name: 'Bob' },
    ]);
    expect(h.room.start(userId(1))).toBeNull();
  });

  it('the host: clockwise past the empty seats and round the end of the table', () => {
    const h = new Harness({ seats: 5 }).sit(4);
    h.room.leave(userId(1));
    h.room.leave(userId(2));
    h.room.leave(userId(0)); // host seat 0 → the next taken clockwise is seat 3
    expect(h.view(3).seats[3]?.host).toBe(true);
    h.room.join(h.user(1)); // takes seat 0
    h.room.leave(userId(3)); // the last before the end: round to seat 0
    expect(h.view(1).seats[0]?.host).toBe(true);
  });

  it('the host: a leaving host passes it at once, and a leaving seat cannot be host', () => {
    const h = new Harness().deal(3);
    h.room.leave(userId(0));
    const view = h.view(1);
    expect(view.seats[0]).toMatchObject({ status: 'leaving', host: false });
    expect(view.seats[1]?.host).toBe(true);
    expect(view.seats.filter((seat) => seat?.host)).toHaveLength(1);
  });

  it('the host: passes over a seat that is leaving', () => {
    const h = new Harness().deal(3);
    const nextOfHost = 1;
    h.room.leave(userId(nextOfHost));
    h.room.leave(userId(0));
    expect(h.view(2).seats[2]?.host).toBe(true);
  });

  it('the host: a host seat lost at the deal passes on too', () => {
    const h = new Harness().deal(3);
    h.room.disconnected(userId(0));
    const row = h.rawSeats()[0] as RoomSeat;
    row.offlineSince = h.clock.now() - 10 * 60_000;
    for (let guard = 0; guard < 100 && h.latest().seats[0] !== null; guard++) h.move(foldOrCheck);
    expect(h.latest().seats[0]).toBeNull();
    expect(h.latest().seats[1]?.host).toBe(true);
    expect(h.allNotices(1)).toContainEqual({ n: 'hostChanged', name: 'Bob' });
  });

  it('the host: only the host starts, and the room needs no host after that', () => {
    const h = new Harness().deal(2);
    h.room.leave(userId(0));
    h.playHand(passive);
    h.clock.advance(HAND_END_FOLD_MS + HAND_END_SHOWDOWN_MS);
    expect(h.latest().hand).toBeNull();
    expect(h.latest().started).toBe(true);
  });

  it('nextHost: null when nobody can take over', () => {
    expect(nextHost([null, null], 0)).toBeNull();
  });
});

describe('§19.9 names', () => {
  it('cleanName: NFC, no control or format characters, trimmed, at most 24 code points', () => {
    expect(cleanName('  Ann  ')).toBe('Ann');
    expect(cleanName('éva')).toBe('éva');
    expect(cleanName('a‮b​c\u0007')).toBe('abc');
    expect([...cleanName('😀'.repeat(30))]).toHaveLength(24);
    expect(cleanName('x'.repeat(24) + '   y')).toBe('x'.repeat(24));
    expect(cleanName('‮​')).toBe('');
  });

  it('seatName: empty becomes "Player {seat + 1}"', () => {
    expect(seatName({ id: 1, name: '' }, 3)).toBe('Player 4');
    expect(seatName({ id: 1, name: 'Ann' }, 3)).toBe('Ann');
  });
});
