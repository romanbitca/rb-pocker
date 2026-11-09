import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveSeed, ZERO_SEED } from '../../src/game/core/rng.js';
import { TABLE_CODE_RE, type ServerMsg, type TableSettings } from '../../src/game/net/protocol.js';
import { RoomRegistry } from '../../src/mp/registry.js';
import {
  CREATE_LIMIT,
  CREATE_WINDOW_MS,
  FAILED_JOIN_LIMIT,
  FAILED_JOIN_WINDOW_MS,
  MAX_ROOMS,
  SEAT_LOST_MS,
} from '../../src/mp/timing.js';
import { FakeClock } from '../helpers/fake-clock.js';

/** Lets a test decide the next "random" numbers of `crypto.randomInt`. */
const fixed = vi.hoisted(() => ({ next: [] as number[] }));
vi.mock('node:crypto', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:crypto')>();
  const randomInt = ((range: number): number =>
    fixed.next.shift() ?? real.randomInt(range)) as typeof real.randomInt;
  return { ...real, randomInt };
});

const SETTINGS: TableSettings = { seats: 6, stakes: 'normal', turnSeconds: 30 };
const user = (id: number) => ({ id, name: `U${id}` });
const UNUSED_CODE = 'ZZZZZZZZ';

function setup() {
  const clock = new FakeClock();
  let seeds = 0;
  const sent: { to: number; msg: ServerMsg }[] = [];
  const registry = new RoomRegistry({
    clock,
    newSeed: () => deriveSeed(ZERO_SEED, 'registry', seeds++),
    inviteUrl: (code) => `https://t.me/bot/app?startapp=${code}`,
  });
  registry.setSender((to, msg) => {
    sent.push({ to, msg });
  });
  const tableOf = (to: number) => {
    const tables = sent.filter((s) => s.to === to && s.msg.t === 'table');
    const last = tables[tables.length - 1];
    if (last === undefined || last.msg.t !== 'table') throw new Error('no table');
    return last.msg.view;
  };
  return { clock, registry, sent, tableOf };
}

beforeEach(() => {
  fixed.next = [];
});

describe('§19.4 table codes', () => {
  it('a code is 8 letters of the alphabet, and the invite link names it', () => {
    const { registry, tableOf } = setup();
    expect(registry.create(user(1), SETTINGS)).toBeNull();
    const { code, invite } = tableOf(1);
    expect(code).toMatch(TABLE_CODE_RE);
    expect(invite).toBe(`https://t.me/bot/app?startapp=${code}`);
  });

  it('every one of the 31 letters can come up (crypto.randomInt, index by index)', () => {
    const { registry, tableOf } = setup();
    fixed.next = [0, 30, 1, 29, 2, 28, 3, 27];
    registry.create(user(1), SETTINGS);
    expect(tableOf(1).code).toBe('2Z3Y4X5W');
    fixed.next = [8, 9, 10, 11, 12, 13, 14, 15];
    registry.create(user(2), SETTINGS);
    expect(tableOf(2).code).toBe('ABCDEFGH');
  });

  it('a code in use is drawn again', () => {
    const { registry, tableOf } = setup();
    const taken = [0, 0, 0, 0, 0, 0, 0, 0];
    fixed.next = [...taken];
    registry.create(user(1), SETTINGS);
    expect(tableOf(1).code).toBe('22222222');
    fixed.next = [...taken, 1, 1, 1, 1, 1, 1, 1, 1];
    registry.create(user(2), SETTINGS);
    expect(tableOf(2).code).toBe('33333333');
  });
});

describe('§19.9 who sits where', () => {
  it('create: seats the user; roomOf and codeOfUser name the table', () => {
    const { registry, tableOf } = setup();
    registry.create(user(1), SETTINGS);
    const { code } = tableOf(1);
    expect(registry.roomOf(1)?.code).toBe(code);
    expect(registry.codeOfUser(1)).toBe(code);
    expect(registry.codeOfUser(2)).toBeNull();
  });

  it('create: refused with already_seated and the other table', () => {
    const { registry, tableOf } = setup();
    registry.create(user(1), SETTINGS);
    expect(registry.create(user(1), SETTINGS)).toEqual({
      code: 'already_seated',
      other: tableOf(1).code,
    });
  });

  it('join: seats the user; a second table is already_seated with the other', () => {
    const { registry, tableOf } = setup();
    registry.create(user(1), SETTINGS);
    registry.create(user(2), SETTINGS);
    const [a, b] = [tableOf(1).code, tableOf(2).code];
    expect(registry.join(user(3), a)).toBeNull();
    expect(registry.codeOfUser(3)).toBe(a);
    expect(registry.join(user(3), b)).toEqual({ code: 'already_seated', other: a });
  });

  it('join: someone already at this table is let through (nothing changes)', () => {
    const { registry, tableOf } = setup();
    registry.create(user(1), SETTINGS);
    expect(registry.join(user(1), tableOf(1).code)).toBeNull();
    expect(registry.roomCount).toBe(1);
  });

  it('join: not_found for an unknown code, and full for a full table', () => {
    const { registry, tableOf } = setup();
    registry.create(user(1), { ...SETTINGS, seats: 2 });
    const { code } = tableOf(1);
    expect(registry.join(user(2), UNUSED_CODE)).toEqual({ code: 'not_found' });
    expect(registry.join(user(2), code)).toBeNull();
    expect(registry.join(user(3), code)).toEqual({ code: 'full' });
  });

  it('leave: frees the user; not_seated when there is nothing to leave', () => {
    const { registry, tableOf } = setup();
    registry.create(user(1), SETTINGS);
    registry.join(user(2), tableOf(1).code);
    expect(registry.leave(2)).toBeNull();
    expect(registry.roomOf(2)).toBeNull();
    expect(registry.leave(2)).toBe('not_seated');
  });

  it('leave: the last player closes the table, and the code stops working', () => {
    const { registry, tableOf } = setup();
    registry.create(user(1), SETTINGS);
    const { code } = tableOf(1);
    registry.leave(1);
    expect(registry.roomCount).toBe(0);
    expect(registry.join(user(2), code)).toEqual({ code: 'not_found' });
  });

  it('a leaver mid-hand can make another table at once, and then cannot come back', () => {
    const { registry, tableOf } = setup();
    registry.create(user(1), SETTINGS);
    const old = tableOf(1).code;
    registry.join(user(2), old);
    registry.roomOf(1)?.start(1);
    registry.leave(1);
    expect(registry.roomOf(1)).toBeNull();
    expect(registry.create(user(1), SETTINGS)).toBeNull();
    const fresh = tableOf(1).code;
    expect(fresh).not.toBe(old);
    expect(registry.join(user(1), old)).toEqual({ code: 'already_seated', other: fresh });
  });

  it('a leaver mid-hand who joins before the seat empties is back at the table', () => {
    const { registry, tableOf } = setup();
    registry.create(user(1), SETTINGS);
    const { code } = tableOf(1);
    registry.join(user(2), code);
    registry.roomOf(1)?.start(1);
    registry.leave(1);
    expect(registry.join(user(1), code)).toBeNull();
    expect(registry.codeOfUser(1)).toBe(code);
    expect(tableOf(1).seats[0]?.status).toBe('playing');
  });

  it('a seat the room emptied by itself frees its user', () => {
    const { clock, registry, tableOf } = setup();
    registry.create(user(1), SETTINGS);
    const { code } = tableOf(1);
    registry.join(user(2), code);
    registry.join(user(3), code);
    const room = registry.roomOf(1);
    room?.start(1);
    room?.disconnected(3);
    for (let guard = 0; guard < 20_000 && registry.roomOf(3) !== null; guard++) {
      const view = tableOf(1);
      const d = view.decision;
      if (d !== null && view.seats[d.seat]?.online === true) {
        const legal = tableOf(d.seat + 1).legal;
        if (legal === null) throw new Error('no legal');
        const action = legal.canCheck ? ({ type: 'check' } as const) : ({ type: 'call' } as const);
        room?.act(d.seat + 1, d.seq, action);
      } else {
        clock.next();
      }
    }
    expect(clock.now()).toBeGreaterThan(SEAT_LOST_MS);
    expect(registry.roomOf(3)).toBeNull();
    expect(registry.codeOfUser(3)).toBeNull();
    expect(registry.create(user(3), SETTINGS)).toBeNull();
  });

  it('a table that ends frees everyone in it', () => {
    const { registry, tableOf } = setup();
    registry.create(user(1), SETTINGS);
    registry.join(user(2), tableOf(1).code);
    registry.roomOf(1)?.end('idle');
    expect(registry.roomCount).toBe(0);
    expect(registry.roomOf(1)).toBeNull();
    expect(registry.roomOf(2)).toBeNull();
  });

  it('endAll: every table ends and says why', () => {
    const { registry, sent, tableOf } = setup();
    registry.create(user(1), SETTINGS);
    registry.create(user(2), SETTINGS);
    const code = tableOf(1).code;
    registry.endAll('server_restart');
    expect(registry.roomCount).toBe(0);
    expect(sent).toContainEqual({
      to: 1,
      msg: { t: 'ended', code, reason: 'server_restart' },
    });
  });
});

describe('§19.4 limits', () => {
  it('Rooms: the 201st table is server_full', () => {
    const { registry } = setup();
    expect(MAX_ROOMS).toBe(200);
    for (let i = 0; i < MAX_ROOMS; i++) expect(registry.create(user(i), SETTINGS)).toBeNull();
    expect(registry.create(user(9_999), SETTINGS)).toEqual({ code: 'server_full' });
    registry.leave(0);
    expect(registry.create(user(9_999), SETTINGS)).toBeNull();
  });

  it('create per user: 5 per 10 minutes, then rate_limited, and free again after the window', () => {
    const { clock, registry } = setup();
    expect(CREATE_LIMIT).toBe(5);
    expect(CREATE_WINDOW_MS).toBe(600_000);
    for (let i = 0; i < CREATE_LIMIT; i++) {
      expect(registry.create(user(1), SETTINGS)).toBeNull();
      registry.leave(1);
    }
    expect(registry.create(user(1), SETTINGS)).toEqual({ code: 'rate_limited' });
    expect(registry.create(user(2), SETTINGS)).toBeNull(); // per user
    clock.advance(CREATE_WINDOW_MS);
    expect(registry.create(user(1), SETTINGS)).toBeNull();
  });

  it('create: a refused create does not count', () => {
    const { registry } = setup();
    registry.create(user(1), SETTINGS);
    for (let i = 0; i < 2 * CREATE_LIMIT; i++) {
      expect(registry.create(user(1), SETTINGS)?.code).toBe('already_seated');
    }
    registry.leave(1);
    expect(registry.create(user(1), SETTINGS)).toBeNull();
  });

  it('failed join per user: 10 per 5 minutes, then rate_limited even for a good code, and free again after', () => {
    const { clock, registry, tableOf } = setup();
    expect(FAILED_JOIN_LIMIT).toBe(10);
    expect(FAILED_JOIN_WINDOW_MS).toBe(300_000);
    registry.create(user(1), SETTINGS);
    const { code } = tableOf(1);
    for (let i = 0; i < FAILED_JOIN_LIMIT; i++) {
      expect(registry.join(user(2), UNUSED_CODE)).toEqual({ code: 'not_found' });
    }
    expect(registry.join(user(2), UNUSED_CODE)).toEqual({ code: 'rate_limited' });
    expect(registry.join(user(2), code)).toEqual({ code: 'rate_limited' });
    expect(registry.join(user(3), code)).toBeNull(); // per user
    clock.advance(FAILED_JOIN_WINDOW_MS);
    expect(registry.join(user(2), code)).toBeNull();
  });

  it('the limits forget users whose window is over', () => {
    const { clock, registry } = setup();
    const internals = registry as unknown as {
      failedJoins: { events: Map<number, number[]> };
    };
    for (let u = 0; u < 1_100; u++) registry.join(user(u), UNUSED_CODE);
    expect(internals.failedJoins.events.size).toBe(1_100);
    clock.advance(FAILED_JOIN_WINDOW_MS);
    registry.join(user(5_000), UNUSED_CODE);
    expect(internals.failedJoins.events.size).toBe(1);
  });
});
