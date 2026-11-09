import { describe, expect, it, vi } from 'vitest';
import { EngineError, InvariantError } from '../../src/game/core/assert.js';
import type { Notice } from '../../src/game/net/protocol.js';
import {
  AWAY_TURN_MS,
  DEAL_GRACE_MS,
  HAND_END_FOLD_MS,
  HAND_END_SHOWDOWN_MS,
  OFFLINE_TURN_MS,
  REVEAL_MS,
  RUNOUT_PAUSE_MS,
  SEAT_LOST_MS,
  STREET_PAUSE_MS,
} from '../../src/mp/timing.js';
import { foldOrCheck, Harness, passive, shove, userId } from '../helpers/room-harness.js';

/** Makes the next call of `step` throw what `failNext` throws. The rest is the real engine. */
const engine = vi.hoisted(() => ({ failNext: null as (() => never) | null }));
vi.mock('../../src/game/engine/step.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/game/engine/step.js')>();
  const step: typeof real.step = (hand, input) => {
    const fail = engine.failNext;
    if (fail !== null) {
      engine.failNext = null;
      fail();
    }
    return real.step(hand, input);
  };
  return { ...real, step };
});

const broken = (): never => {
  throw new InvariantError(['I1 chip conservation: test']);
};

/** Deals a heads-up hand and runs it to the end with everyone all in, until someone busts. */
function untilBust(h: Harness): number {
  for (let tries = 0; tries < 50; tries++) {
    h.playHand(shove);
    const busted = h.latest().seats.findIndex((seat) => seat?.status === 'busted');
    if (busted !== -1) return busted;
    h.clock.next();
  }
  throw new Error('nobody busted in 50 hands');
}

describe('§19.5 create', () => {
  it('create: the first seat, status nextHand, host, chips settings.stack; room waiting, not started', () => {
    const h = new Harness().sit(1);
    const view = h.view(0);
    expect(view).toMatchObject({
      rev: 1,
      code: 'ABCD2345',
      invite: 'https://t.me/test_bot/app?startapp=ABCD2345',
      settings: { seats: 6, sb: 10, bb: 20, stack: 2000, turnSeconds: 30 },
      status: 'waiting',
      started: false,
      you: 0,
      handsPlayed: 0,
      hand: null,
      decision: null,
      legal: null,
      nextHandAt: null,
    });
    expect(view.seats[0]).toEqual({
      name: 'Ann',
      host: true,
      status: 'nextHand',
      stack: 2000,
      online: true,
    });
    expect(view.seats.slice(1).every((seat) => seat === null)).toBe(true);
  });

  it.each([
    ['quick', 25, 50, 1000],
    ['normal', 10, 20, 2000],
    ['long', 10, 20, 5000],
  ] as const)(
    'create: the stakes %s become the server numbers %i/%i, %i chips',
    (s, sb, bb, stack) => {
      const h = new Harness({ stakes: s }).sit(1);
      expect(h.view(0).settings).toMatchObject({ sb, bb, stack });
      expect(h.view(0).seats[0]?.stack).toBe(stack);
    },
  );
});

describe('§19.5 join', () => {
  it('join: the lowest free seat, nextHand, chips settings.stack, notice joined for everyone else', () => {
    const h = new Harness().sit(2);
    expect(h.view(1).you).toBe(1);
    expect(h.view(1).seats[1]).toMatchObject({ status: 'nextHand', stack: 2000, host: false });
    expect(h.notices(0)).toEqual([{ n: 'joined', name: 'Bob' }]);
    expect(h.notices(1)).toEqual([]);

    h.room.leave(userId(1));
    h.room.join(h.user(2));
    expect(h.view(2).you).toBe(1);
  });

  it('join: a full table answers full and changes nothing', () => {
    const h = new Harness({ seats: 2 }).sit(2);
    const rev = h.latest().rev;
    expect(h.room.join(h.user(2))).toBe('full');
    expect(h.latest().rev).toBe(rev);
    expect(h.messagesTo(2)).toEqual([]);
  });

  it('join: someone who already sits here changes nothing and gets the table again', () => {
    const h = new Harness().sit(2);
    const { rev } = h.latest();
    const before = h.sent.length;
    expect(h.room.join(h.user(1))).toBeNull();
    expect(h.sent).toHaveLength(before + 1);
    expect(h.view(1).rev).toBe(rev);
    expect(h.notices(1)).toEqual([]);
  });

  it('join: a leaving seat of the same user turns back to playing', () => {
    const h = new Harness().deal(3);
    const other = (h.toAct() + 1) % 3;
    h.room.leave(userId(other));
    expect(h.view((other + 1) % 3).seats[other]?.status).toBe('leaving');

    expect(h.room.join(h.user(other))).toBeNull();
    expect(h.view(other).seats[other]).toMatchObject({ status: 'playing', online: true });
    expect(h.notices((other + 1) % 3)).toEqual([{ n: 'joined', name: h.user(other).name }]);
  });

  it('join: an empty first name becomes "Player {seat + 1}"', () => {
    const h = new Harness().sit(1);
    h.room.join(h.user(1, ''));
    expect(h.view(0).seats[1]?.name).toBe('Player 2');
  });
});

describe('§19.5 start (host)', () => {
  it('start: started becomes true, then the deal; everyone gets the first hand', () => {
    const h = new Harness().sit(2);
    expect(h.room.start(userId(0))).toBeNull();
    for (const i of [0, 1]) {
      expect(h.view(i)).toMatchObject({ started: true, status: 'playing' });
      expect(h.view(i).hand?.handSeq).toBe(1);
    }
  });

  it('start: refused for someone who is not seated, a guest, a started table, and fewer than 2', () => {
    const h = new Harness().sit(1);
    expect(h.room.start(userId(5))).toBe('not_seated');
    expect(h.room.start(userId(0))).toBe('not_enough_players');
    h.room.join(h.user(1));
    expect(h.room.start(userId(1))).toBe('not_host');
    expect(h.room.start(userId(0))).toBeNull();
    expect(h.room.start(userId(0))).toBe('already_started');
  });
});

describe('§19.5 deal', () => {
  it('deal ①: a leaving seat empties', () => {
    const h = new Harness().deal(3);
    const leaver = (h.toAct() + 1) % 3;
    h.room.leave(userId(leaver));
    h.playHand(passive);
    expect(h.latest().seats[leaver]?.status).toBe('leaving');
    h.clock.next(); // the next hand
    expect(h.latest().seats[leaver]).toBeNull();
    expect(h.latest().hand?.handSeq).toBe(2);
  });

  it('deal ①: a seat offline for SEAT_LOST_MS empties at the next deal, and not before', () => {
    const h = new Harness().deal(3);
    h.room.disconnected(userId(2));
    const offAt = h.clock.now();
    const offRev = h.latest().rev;
    for (let guard = 0; guard < 20_000 && h.latest().seats[2] !== null; guard++) h.move(passive);
    const views = h
      .tablesTo(0)
      .map((t) => t.view)
      .filter((view) => view.rev >= offRev);
    const gone = views.find((view) => view.seats[2] === null);
    expect(gone).toBeDefined();
    expect((gone as (typeof views)[number]).now - offAt).toBeGreaterThanOrEqual(SEAT_LOST_MS);
    for (const view of views) {
      if (view.now - offAt < SEAT_LOST_MS) expect(view.seats[2]).not.toBeNull();
    }
    expect(h.allNotices(0)).toContainEqual({ n: 'left', name: 'Cid' });
  });

  it('deal ①: a seat offline for less than SEAT_LOST_MS stays', () => {
    const h = new Harness().deal(3);
    h.room.disconnected(userId(2));
    h.clock.advance(SEAT_LOST_MS - 60_000);
    h.room.connected(userId(2));
    expect(h.latest().seats[2]?.online).toBe(true);
    h.clock.advance(SEAT_LOST_MS);
    expect(h.latest().seats[2]).not.toBeNull();
  });

  it('deal ②: nextHand becomes playing', () => {
    const h = new Harness().deal(2);
    expect(
      h
        .view(0)
        .seats.slice(0, 2)
        .map((seat) => seat?.status),
    ).toEqual(['playing', 'playing']);
  });

  it('deal ②: nextHand with a stack of 0 becomes busted', () => {
    const h = new Harness().deal(3);
    h.playHand(foldOrCheck);
    const seat = h.rawSeats()[2];
    if (seat === null || seat === undefined) throw new Error('no seat 2');
    seat.status = 'nextHand';
    seat.stack = 0;
    h.clock.next();
    expect(h.latest().seats[2]?.status).toBe('busted');
    expect(h.hand().seats[2]?.dealtIn).toBe(false);
  });

  it('deal ③: only playing seats with chips are dealt in', () => {
    const h = new Harness().deal(3);
    expect(h.hand().seats.map((seat) => seat.dealtIn)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
  });

  it('deal ④: fewer than 2: status waiting, hand null, nextHandAt null, a broadcast, and it stops', () => {
    const h = new Harness().deal(2);
    h.playHand(foldOrCheck);
    h.room.leave(userId(1));
    const pendingAfterLeave = h.clock.pending;
    h.clock.advance(HAND_END_SHOWDOWN_MS);
    const view = h.view(0);
    expect(view).toMatchObject({
      status: 'waiting',
      started: true,
      hand: null,
      decision: null,
      nextHandAt: null,
    });
    expect(view.seats[1]).toBeNull();
    // Only the idle timer is left: no flow timer.
    expect(h.clock.pending).toBeLessThanOrEqual(pendingAfterLeave);
    const { rev } = view;
    h.clock.advance(60_000);
    expect(h.latest().rev).toBe(rev);
  });

  it('deal ⑤: the first deal creates the table, later ones build on the last nextTable (the button moves, seats are skipped)', () => {
    const h = new Harness({ seats: 4 }).deal(3);
    const first = h.hand();
    expect(first.handSeq).toBe(1);
    h.playHand(foldOrCheck);
    h.clock.next();
    const second = h.hand();
    expect(second.handSeq).toBe(2);
    // Seat 3 is empty: the button goes round the taken seats only.
    expect(second.button).toBe((first.button + 1) % 3);
    expect(second.seats[3]?.dealtIn).toBe(false);
    expect(h.seeds).toHaveLength(3); // one table seed, two hand seeds
  });

  it('deal ⑥: status playing, then next step', () => {
    const h = new Harness().deal(2);
    expect(h.latest().status).toBe('playing');
    expect(h.latest().decision).not.toBeNull();
  });
});

describe('§19.5 next step', () => {
  it('next step, betting: opens a decision for hand.toAct', () => {
    const h = new Harness().deal(3);
    const view = h.latest();
    expect(view.decision?.seat).toBe(view.hand?.toAct);
  });

  it('next step, roundComplete: a broadcast with no decision, advance after STREET_PAUSE_MS', () => {
    const h = new Harness().deal(2);
    h.play(passive); // the small blind calls
    h.play(passive); // the big blind checks
    expect(h.hand().phase).toBe('roundComplete');
    expect(h.latest().decision).toBeNull();
    expect(h.latest().legal).toBeNull();
    h.clock.advance(STREET_PAUSE_MS - 1);
    expect(h.hand().street).toBe('preflop');
    h.clock.advance(1);
    expect(h.hand().street).toBe('flop');
  });

  it('next step, showdown: advance after REVEAL_MS × hands shown', () => {
    const h = new Harness().deal(3);
    while (h.hand().phase !== 'showdown') {
      if (h.latest().decision !== null) h.play(passive);
      else h.clock.next();
    }
    expect(h.hand().revealed).toHaveLength(3);
    h.clock.advance(3 * REVEAL_MS - 1);
    expect(h.hand().phase).toBe('showdown');
    h.clock.advance(1);
    expect(h.hand().phase).toBe('complete');
  });

  it('next step, a run-out: RUNOUT_PAUSE_MS before each advance', () => {
    const h = new Harness().deal(2);
    h.play(shove);
    h.play(shove); // all in and called
    expect(h.hand().phase).toBe('roundComplete');
    h.clock.advance(STREET_PAUSE_MS); // the hands turn face up and the flop comes
    expect(h.hand().street).toBe('flop');
    expect(h.hand().runout).toBe(true);
    h.clock.advance(RUNOUT_PAUSE_MS - 1);
    expect(h.hand().street).toBe('flop');
    h.clock.advance(1);
    expect(h.hand().street).toBe('turn');
  });

  it('next step, complete: the hand ends', () => {
    const h = new Harness().deal(2);
    h.playHand(foldOrCheck);
    expect(h.hand().phase).toBe('complete');
    expect(h.latest().handsPlayed).toBe(1);
  });
});

describe('§19.5 open decision', () => {
  it('open decision: decisionSeq grows by one with each decision, and legal goes only to its seat', () => {
    const h = new Harness().deal(3);
    const first = h.latest().decision?.seq as number;
    const seat = h.toAct();
    expect(h.view(seat).legal).not.toBeNull();
    expect(h.view((seat + 1) % 3).legal).toBeNull();
    h.play(passive);
    expect(h.latest().decision?.seq).toBe(first + 1);
  });

  it('open decision: the turn, plus DEAL_GRACE_MS on the first decision of a hand only', () => {
    const h = new Harness({ turnSeconds: 30 }).deal(3);
    expect(h.msToDeadline()).toBe(30_000 + DEAL_GRACE_MS);
    h.play(passive);
    expect(h.msToDeadline()).toBe(30_000);
  });

  it('open decision: a leaving seat acts at once (the deadline is now)', () => {
    const h = new Harness().deal(3);
    const after = (h.toAct() + 1) % 3;
    h.room.leave(userId(after));
    h.play(passive);
    expect(h.toAct()).toBe(after);
    expect(h.latest().decision?.deadlineAt).toBe(h.clock.now());
  });

  it('open decision: timeouts at the limit get AWAY_TURN_MS for the rest of the hand', () => {
    const h = new Harness({ turnSeconds: 60 }).deal(2);
    const bb = h.hand().bbSeat;
    h.play(passive); // the small blind calls
    expect(h.toAct()).toBe(bb);
    h.timeOut(); // 1: checks the option
    h.clock.advance(STREET_PAUSE_MS);
    // Flop: the big blind acts first heads-up.
    expect(h.toAct()).toBe(bb);
    h.timeOut(); // 2
    h.play(passive); // the button checks behind
    h.clock.advance(STREET_PAUSE_MS);
    expect(h.toAct()).toBe(bb);
    expect(h.msToDeadline()).toBe(AWAY_TURN_MS);
  });

  it.each([15, 30, 60] as const)(
    'open decision: offline at a %i-second table gets the smaller of OFFLINE_TURN_MS and the turn',
    (turnSeconds) => {
      const h = new Harness({ turnSeconds }).deal(3);
      const next = (h.toAct() + 1) % 3;
      h.room.disconnected(userId(next));
      h.play(passive);
      expect(h.toAct()).toBe(next);
      expect(h.msToDeadline()).toBe(Math.min(OFFLINE_TURN_MS, turnSeconds * 1000));
    },
  );
});

describe('§19.5 act', () => {
  it('act: not_seated first, for someone with no seat here', () => {
    const h = new Harness().deal(2);
    const { rev, decision } = h.latest();
    expect(h.room.act(userId(7), decision?.seq as number, { type: 'fold' })).toBe('not_seated');
    expect(h.latest().rev).toBe(rev);
  });

  it('act: a wrong seq is stale_action and changes nothing, before anything about the seat', () => {
    const h = new Harness().deal(3);
    const { rev, decision } = h.latest();
    const seat = (decision?.seat as number) + 1;
    expect(h.room.act(userId(seat % 3), (decision?.seq as number) + 1, { type: 'fold' })).toBe(
      'stale_action',
    );
    expect(h.latest().rev).toBe(rev);
  });

  it('act: a doubled message is stale_action (same rev, same hand)', () => {
    const h = new Harness().deal(3);
    const { decision } = h.latest();
    const seat = decision?.seat as number;
    expect(h.room.act(userId(seat), decision?.seq as number, { type: 'call' })).toBeNull();
    const after = h.latest();
    expect(h.room.act(userId(seat), decision?.seq as number, { type: 'call' })).toBe(
      'stale_action',
    );
    expect(h.latest().rev).toBe(after.rev);
    expect(h.latest().hand).toEqual(after.hand);
  });

  it('act: with the right seq on another seat is not_your_turn', () => {
    const h = new Harness().deal(3);
    const { rev, decision } = h.latest();
    const other = ((decision?.seat as number) + 1) % 3;
    expect(h.room.act(userId(other), decision?.seq as number, { type: 'fold' })).toBe(
      'not_your_turn',
    );
    expect(h.latest().rev).toBe(rev);
  });

  it('act: what the engine refuses is illegal_action and changes nothing', () => {
    const h = new Harness().deal(2);
    const { rev, decision } = h.latest();
    const seat = decision?.seat as number;
    expect(h.room.act(userId(seat), decision?.seq as number, { type: 'check' })).toBe(
      'illegal_action',
    );
    expect(h.room.act(userId(seat), decision?.seq as number, { type: 'raise', to: 1 })).toBe(
      'illegal_action',
    );
    expect(h.latest().rev).toBe(rev);
    expect(h.latest().decision).toEqual(decision);
  });

  it('act: no decision open is stale_action', () => {
    const h = new Harness().sit(2);
    expect(h.room.act(userId(0), 1, { type: 'fold' })).toBe('stale_action');
  });

  it('act: goes through the engine, sets timeouts to 0, and moves on', () => {
    const h = new Harness({ turnSeconds: 15 }).deal(3);
    const first = h.toAct();
    h.timeOut(); // the first to act folds (timeouts 1), in hand 1
    expect(h.rawSeats()[first]?.timeouts).toBe(1);
    h.playHand(passive);
    h.clock.next(); // hand 2
    for (let guard = 0; guard < 50 && h.latest().decision?.seat !== first; guard++) {
      if (h.latest().decision !== null) h.play(foldOrCheck);
      else h.clock.next();
    }
    expect(h.latest().decision?.seat).toBe(first);
    h.play(passive);
    expect(h.rawSeats()[first]?.timeouts).toBe(0);
  });
});

describe('§19.5 turn fires', () => {
  it('turn fires: checks when that is free', () => {
    const h = new Harness().deal(2);
    const bb = h.hand().bbSeat;
    h.play(passive); // the small blind calls: the big blind may check
    h.timeOut();
    const last = h.hand().log.at(-1);
    expect(last).toMatchObject({ e: 'act', seat: bb, action: { type: 'check' } });
    expect(h.notices(bb)).toEqual([{ n: 'timedOut', action: 'check' }]);
  });

  it('turn fires: folds otherwise', () => {
    const h = new Harness().deal(3);
    const seat = h.toAct();
    h.timeOut();
    expect(h.hand().seats[seat]?.folded).toBe(true);
    expect(h.notices(seat)).toEqual([{ n: 'timedOut', action: 'fold' }]);
  });

  it('turn fires: timeouts + 1, and the notice goes to that player only', () => {
    const h = new Harness().deal(3);
    const seat = h.toAct();
    h.timeOut();
    expect(h.rawSeats()[seat]?.timeouts).toBe(1);
    expect(h.notices((seat + 1) % 3)).toEqual([]);
    expect(h.notices((seat + 2) % 3)).toEqual([]);
  });

  it('turn fires: for a leaving seat no timeouts and no notice', () => {
    const h = new Harness().deal(3);
    const seat = h.toAct();
    h.room.leave(userId(seat));
    h.clock.flush();
    expect(h.rawSeats()[seat]?.timeouts).toBe(0);
    expect(h.allNotices(seat)).not.toContainEqual(expect.objectContaining({ n: 'timedOut' }));
  });

  it('turn fires: a tap after its turn ended is stale_action', () => {
    const h = new Harness().deal(3);
    const { decision } = h.latest();
    h.timeOut();
    const { rev } = h.latest();
    expect(
      h.room.act(userId(decision?.seat as number), decision?.seq as number, { type: 'fold' }),
    ).toBe('stale_action');
    expect(h.latest().rev).toBe(rev);
  });
});

describe('§19.5 advance fires', () => {
  it('advance fires: step(advance), then next step', () => {
    const h = new Harness().deal(2);
    h.play(passive);
    h.play(passive);
    h.clock.advance(STREET_PAUSE_MS);
    expect(h.hand()).toMatchObject({ street: 'flop', phase: 'betting' });
    expect(h.hand().board).toHaveLength(3);
    expect(h.latest().decision).not.toBeNull();
  });
});

describe('§19.5 hand end', () => {
  it('hand end: every dealt-in seat takes the final stack, handsPlayed + 1, nextHandAt set, broadcast', () => {
    const h = new Harness().deal(2);
    h.playHand(foldOrCheck);
    const view = h.latest();
    const hand = h.hand();
    expect(view.seats[0]?.stack).toBe(hand.seats[0]?.stack);
    expect(view.seats[1]?.stack).toBe(hand.seats[1]?.stack);
    expect((view.seats[0]?.stack ?? 0) + (view.seats[1]?.stack ?? 0)).toBe(4000);
    expect(view.handsPlayed).toBe(1);
    expect(view.decision).toBeNull();
    expect(view.status).toBe('playing');
  });

  it('hand end: a hand won by folds is on show for HAND_END_FOLD_MS', () => {
    const h = new Harness().deal(2);
    h.playHand(foldOrCheck);
    const end = h.clock.now();
    expect(h.hand().result?.endedBy).toBe('fold');
    expect(h.latest().nextHandAt).toBe(end + HAND_END_FOLD_MS);
    h.clock.advance(HAND_END_FOLD_MS - 1);
    expect(h.hand().handSeq).toBe(1);
    h.clock.advance(1);
    expect(h.hand().handSeq).toBe(2);
  });

  it('hand end: a showdown is on show for HAND_END_SHOWDOWN_MS', () => {
    const h = new Harness().deal(2);
    h.playHand(passive);
    const end = h.clock.now();
    expect(h.hand().result?.endedBy).toBe('showdown');
    expect(h.latest().nextHandAt).toBe(end + HAND_END_SHOWDOWN_MS);
    h.clock.advance(HAND_END_SHOWDOWN_MS - 1);
    expect(h.hand().handSeq).toBe(1);
    h.clock.advance(1);
    expect(h.hand().handSeq).toBe(2);
  });

  it('hand end: a stack of 0 becomes busted', () => {
    const h = new Harness().deal(2);
    const busted = untilBust(h);
    expect(h.latest().seats[busted]).toMatchObject({ status: 'busted', stack: 0 });
    expect(h.latest().nextHandAt).not.toBeNull();
  });

  it('hand end: timeouts ≥ 2 becomes sittingOut, with the notice to that player', () => {
    const h = new Harness({ turnSeconds: 15 }).deal(3);
    const away = h.toAct();
    h.timeOut(); // folds (1)
    h.playHand(passive);
    expect(h.latest().seats[away]?.status).toBe('playing');
    h.clock.next();
    for (let guard = 0; guard < 50 && h.latest().decision?.seat !== away; guard++) {
      if (h.latest().decision !== null) h.play(foldOrCheck);
      else h.clock.next();
    }
    h.timeOut(); // 2, in a row, in another hand
    h.playHand(passive);
    expect(h.latest().seats[away]?.status).toBe('sittingOut');
    expect(h.notices(away)).toEqual([{ n: 'sittingOut' }]);
    expect(h.notices((away + 1) % 3)).toEqual([]);
  });

  it('hand end: a busted player is not sitting out, whatever timeouts says', () => {
    const h = new Harness().deal(2);
    const seats = h.rawSeats();
    const busted = untilBust(h);
    const seat = seats[busted];
    expect(seat?.status).toBe('busted');
    expect(h.allNotices(busted)).not.toContainEqual({ n: 'sittingOut' });
  });

  it('hand end: table = nextTable(table, hand): the next hand has the next handSeq', () => {
    const h = new Harness().deal(2);
    h.playHand(foldOrCheck);
    h.clock.next();
    expect(h.hand().handSeq).toBe(2);
  });

  it('nextHand fires: the next deal', () => {
    const h = new Harness().deal(2);
    h.playHand(foldOrCheck);
    expect(h.latest().nextHandAt).not.toBeNull();
    h.clock.next();
    expect(h.latest().nextHandAt).toBeNull();
    expect(h.hand().phase).toBe('betting');
    expect(h.hand().handSeq).toBe(2);
  });
});

describe('§19.5 a voided hand', () => {
  it('voided: an InvariantError on a player action gives back startStacks, says handVoided, hand null, nextHand after HAND_END_FOLD_MS', () => {
    const h = new Harness().deal(2);
    const { decision } = h.latest();
    const seat = decision?.seat as number;
    const stacks = h.hand().startStacks.slice(0, 2);
    engine.failNext = broken;
    expect(h.room.act(userId(seat), decision?.seq as number, { type: 'call' })).toBeNull();
    const view = h.view(0);
    expect(view.hand).toBeNull();
    expect(view.decision).toBeNull();
    expect(view.seats.slice(0, 2).map((s) => s?.stack)).toEqual(stacks);
    expect(h.notices(0)).toEqual([{ n: 'handVoided' }]);
    expect(h.notices(1)).toEqual([{ n: 'handVoided' }]);
    h.clock.advance(HAND_END_FOLD_MS - 1);
    expect(h.latest().hand).toBeNull();
    h.clock.advance(1);
    expect(h.latest().hand?.phase).toBe('betting');
  });

  it('voided: an EngineError on an action the server itself made (a timeout) voids the hand', () => {
    const h = new Harness().deal(2);
    engine.failNext = () => {
      throw new EngineError('ILLEGAL_ACTION', 'test');
    };
    h.timeOut();
    expect(h.latest().hand).toBeNull();
    expect(h.notices(0)).toEqual([{ n: 'handVoided' }]);
  });

  it('voided: an EngineError on a player action is illegal_action, not a void', () => {
    const h = new Harness().deal(2);
    const { decision, rev } = h.latest();
    engine.failNext = () => {
      throw new EngineError('ILLEGAL_ACTION', 'test');
    };
    expect(
      h.room.act(userId(decision?.seat as number), decision?.seq as number, { type: 'call' }),
    ).toBe('illegal_action');
    expect(h.latest().rev).toBe(rev);
    expect(h.latest().hand).not.toBeNull();
  });

  it('voided: the table stays as it was, so the button does not move', () => {
    const h = new Harness({ seats: 3 }).deal(3);
    h.playHand(foldOrCheck);
    h.clock.next();
    const { button, handSeq } = h.hand();
    const { decision } = h.latest();
    engine.failNext = broken;
    h.room.act(userId(decision?.seat as number), decision?.seq as number, { type: 'fold' });
    h.clock.advance(HAND_END_FOLD_MS);
    expect(h.hand().button).toBe(button);
    expect(h.hand().handSeq).toBe(handSeq);
  });

  it('voided: a second voided hand in a row ends the table with error', () => {
    const h = new Harness().deal(2);
    engine.failNext = broken;
    h.timeOut();
    h.clock.advance(HAND_END_FOLD_MS);
    engine.failNext = broken;
    h.timeOut();
    expect(h.messagesTo(0).at(-1)).toEqual({ t: 'ended', code: 'ABCD2345', reason: 'error' });
    expect(h.closed).toEqual(['ABCD2345']);
  });

  it('voided: a finished hand between two voids starts the count again', () => {
    const h = new Harness().deal(2);
    engine.failNext = broken;
    h.timeOut();
    h.clock.advance(HAND_END_FOLD_MS);
    h.playHand(foldOrCheck);
    h.clock.next();
    engine.failNext = broken;
    h.timeOut();
    expect(h.closed).toEqual([]);
    expect(h.notices(0)).toEqual([{ n: 'handVoided' }]);
  });

  it('voided: an InvariantError on the advance also voids the hand', () => {
    const h = new Harness().deal(2);
    h.play(passive);
    h.play(passive);
    engine.failNext = broken;
    h.clock.advance(STREET_PAUSE_MS);
    expect(h.latest().hand).toBeNull();
    expect(h.notices(0)).toEqual([{ n: 'handVoided' }]);
  });
});

describe('§19.5 chips', () => {
  it('chips: a seat that empties takes its chips away, and nothing else moves any', () => {
    const h = new Harness().deal(3);
    const leaver = (h.toAct() + 1) % 3;
    h.room.leave(userId(leaver));
    h.playHand(passive);
    h.clock.next();
    const view = h.view((leaver + 1) % 3);
    const total = view.seats.reduce((sum, seat) => sum + (seat?.stack ?? 0), 0);
    const inHand = view.hand?.seats.reduce((sum, s) => sum + s.totalBet, 0) ?? 0;
    // Two seats are left; the leaver put 20 in if it had to, and its folded chips stayed in the pot.
    expect(view.hand?.startStacks.reduce((a, b) => a + b, 0)).toBe(total + inHand);
  });

  it('chips: a client never sends chips: the numbers are the server stakes', () => {
    const h = new Harness({ stakes: 'quick' }).deal(2);
    expect(h.hand()).toMatchObject({ sb: 25, bb: 50 });
  });
});

describe('§19.5 server restart', () => {
  it('end(server_restart): ended to each online player, nothing to an offline one, and terminal', () => {
    const h = new Harness().deal(3);
    h.room.disconnected(userId(2));
    const pendingBefore = h.clock.pending;
    expect(pendingBefore).toBeGreaterThan(0);
    h.room.end('server_restart');
    const ended = { t: 'ended', code: 'ABCD2345', reason: 'server_restart' };
    expect(h.messagesTo(0).at(-1)).toEqual(ended);
    expect(h.messagesTo(1).at(-1)).toEqual(ended);
    expect(h.messagesTo(2).at(-1)).not.toEqual(ended);
    expect(h.closed).toEqual(['ABCD2345']);
    expect(h.clock.pending).toBe(0);

    const sent = h.sent.length;
    expect(h.room.join(h.user(5))).toBe('not_found');
    h.room.end('idle');
    expect(h.sent).toHaveLength(sent);
    expect(h.closed).toHaveLength(1);
  });
});

describe('§19.4 the rest of what a table tells', () => {
  it('rev grows by one with every change, and every seated, online player gets that rev', () => {
    const h = new Harness().deal(3);
    const revs = h.tablesTo(0).map((t) => t.view.rev);
    revs.forEach((rev, i) => {
      if (i > 0) expect(rev).toBeGreaterThan(revs[i - 1] as number);
    });
    h.play(passive);
    expect(h.view(0).rev).toBe(h.view(1).rev);
    expect(h.view(1).rev).toBe(h.view(2).rev);
  });

  it('a seat dealt in shows the same chips in seats and in hand.seats while the hand runs', () => {
    const h = new Harness().deal(3);
    h.play(passive);
    const view = h.latest();
    view.hand?.seats.forEach((s, i) => {
      if (s.dealtIn) expect(view.seats[i]?.stack).toBe(s.stack);
    });
  });

  it('a notice is sent once, with the view of the change', () => {
    const h = new Harness().sit(2);
    const notices: Notice[] = h.allNotices(0);
    expect(notices.filter((n) => n.n === 'joined')).toHaveLength(1);
    h.room.start(userId(0));
    expect(h.notices(0)).toEqual([]);
  });
});
