import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EngineError, InvariantError } from '../../src/core/assert.ts';
import {
  deriveSeed,
  randInt,
  rngFromSeed,
  seedFromWords,
  type Seed128,
} from '../../src/core/rng.ts';
import { startHand } from '../../src/engine/start.ts';
import {
  BOT_NAMES,
  PERSONALITY_LISTS,
  buttonForHand,
  createTable,
  initialSlots,
  nameOrder,
  nextTable,
  topUp,
  validateTable,
  withLevels,
} from '../../src/engine/table.ts';
import {
  BOT_LEVELS,
  ENGINE_VERSION,
  PERSONALITY_IDS,
  type BotLevel,
  type HandState,
  type PlayerSlot,
  type TableConfig,
  type TableState,
} from '../../src/engine/types.ts';
import { clone } from './fixtures.ts';
import {
  FC_SEED,
  SEED,
  TABLE_SEED,
  configFor,
  deal,
  finishAllIn,
  finishByFolds,
  rigDeck,
  slotsFor,
  tableWith,
} from './helpers.ts';

function engineError(f: () => unknown): EngineError {
  try {
    f();
  } catch (e) {
    if (e instanceof EngineError) return e;
    throw e;
  }
  throw new Error('expected an EngineError');
}

function deepFreeze<T>(x: T): T {
  if (typeof x === 'object' && x !== null) {
    for (const v of Object.values(x)) deepFreeze(v);
    Object.freeze(x);
  }
  return x;
}

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
const slot = (t: TableState, i: number): PlayerSlot => t.slots[i] as PlayerSlot;

/** A 2,000-chip table with real seating (initialSlots). */
function seatedTable(
  seatCount: number,
  botLevel: BotLevel = 'medium',
  seatLevels: (BotLevel | null)[] = new Array<BotLevel | null>(seatCount).fill(null),
  tableSeed: Seed128 = TABLE_SEED,
): TableState {
  const cfg: TableConfig = { seatCount, sb: 10, bb: 20, startingStack: 2000, botLevel, seatLevels };
  return createTable(cfg, initialSlots(cfg, tableSeed, 'You'), tableSeed);
}

describe('createTable', () => {
  it('builds the §4.2 table: button −1, cursors after the seated bots, a seed-derived id', () => {
    const t = seatedTable(6);
    expect(t).toMatchObject({
      schema: 1,
      engineVersion: ENGINE_VERSION,
      tableSeed: TABLE_SEED,
      tableId: deriveSeed(TABLE_SEED, 'id').slice(0, 8),
      button: -1,
      prevBB: null,
      nextHandSeq: 1,
      handsDealt: 0,
      personalityCursor: 5,
      nameCursor: 5,
      reloads: 0,
    });
    expect(t.tableId).toMatch(/^[0-9a-f]{8}$/);
    expect(JSON.parse(JSON.stringify(t))).toStrictEqual(t);
  });

  it('copies its inputs: changing them later does not change the table', () => {
    const cfg = configFor(3);
    const slots = slotsFor([10000, 10000, 10000]);
    const t = createTable(cfg, slots, TABLE_SEED);
    const snapshot = clone(t);
    cfg.seatLevels[1] = 'hard';
    (slots[1] as PlayerSlot).stack = 1;
    expect(t).toStrictEqual(snapshot);
  });

  it('accepts the §3.2 limits', () => {
    const ok = (bb: number, startingStack: number, seatCount = 6): TableState =>
      createTable(
        configFor(seatCount, { sb: bb / 2, bb, startingStack }),
        slotsFor(new Array<number>(seatCount).fill(startingStack)),
        TABLE_SEED,
      );
    expect(ok(2, 200).config.bb).toBe(2); // 100 bb
    expect(ok(2, 1000).config.startingStack).toBe(1000); // 500 bb
    expect(ok(100_000, 1_000_000).config.bb).toBe(100_000); // 10 bb
    expect(ok(100, 1000).config.startingStack).toBe(1000); // exactly 10 bb
    expect(ok(100, 50_000).config.startingStack).toBe(50_000); // exactly 500 bb
    expect(ok(20, 2000, 2).config.seatCount).toBe(2);
    expect(ok(20, 2000, 9).config.seatCount).toBe(9);
  });

  it('rejects stakes outside §3.2 with BAD_AMOUNT', () => {
    const bad: [string, Partial<TableConfig>][] = [
      ['one seat', { seatCount: 1 }],
      ['ten seats', { seatCount: 10 }],
      ['fractional seats', { seatCount: 2.5 }],
      ['odd big blind', { sb: 1.5, bb: 3 }],
      ['big blind 0', { sb: 0, bb: 0 }],
      ['big blind above 100,000', { sb: 50_001, bb: 100_002, startingStack: 1_000_000 }],
      ['small blind not half', { sb: 40, bb: 100 }],
      ['stack below 200', { sb: 1, bb: 2, startingStack: 199 }],
      ['stack above 1,000,000', { sb: 50_000, bb: 100_000, startingStack: 1_000_001 }],
      ['below 10 bb', { sb: 50, bb: 100, startingStack: 999 }],
      ['above 500 bb', { sb: 50, bb: 100, startingStack: 50_001 }],
      ['fractional stack', { startingStack: 2000.5 }],
    ];
    for (const [what, change] of bad) {
      const cfg = { ...configFor(3), ...change };
      const n = cfg.seatCount;
      const levels = Number.isInteger(n) && n > 0 && n < 20 ? new Array(n).fill(null) : [null];
      const slots = slotsFor(new Array<number>(Number.isInteger(n) && n > 0 ? n : 1).fill(1000));
      expect(
        engineError(() => createTable({ ...cfg, seatLevels: levels }, slots, TABLE_SEED)).code,
        what,
      ).toBe('BAD_AMOUNT');
    }
  });

  it('rejects bad slots, levels and seeds', () => {
    const three = (): PlayerSlot[] => slotsFor([1000, 1000, 1000]);
    const cases: [string, 'BAD_AMOUNT' | 'ILLEGAL_ACTION', () => unknown][] = [
      [
        'too few slots',
        'BAD_AMOUNT',
        () => createTable(configFor(3), three().slice(1), TABLE_SEED),
      ],
      [
        'a bot in seat 0',
        'ILLEGAL_ACTION',
        () =>
          createTable(configFor(3), [three()[1] as PlayerSlot, ...three().slice(1)], TABLE_SEED),
      ],
      [
        'a second hero',
        'ILLEGAL_ACTION',
        () => {
          const s = three();
          s[2] = { ...(s[0] as PlayerSlot), playerId: 'hero2', name: 'Other' };
          return createTable(configFor(3), s, TABLE_SEED);
        },
      ],
      [
        'a bot without personality',
        'ILLEGAL_ACTION',
        () => {
          const s = three();
          (s[1] as PlayerSlot).personality = null;
          return createTable(configFor(3), s, TABLE_SEED);
        },
      ],
      [
        'a duplicate id',
        'ILLEGAL_ACTION',
        () => {
          const s = three();
          (s[2] as PlayerSlot).playerId = (s[1] as PlayerSlot).playerId;
          return createTable(configFor(3), s, TABLE_SEED);
        },
      ],
      [
        'a duplicate name',
        'ILLEGAL_ACTION',
        () => {
          const s = three();
          (s[2] as PlayerSlot).name = (s[1] as PlayerSlot).name;
          return createTable(configFor(3), s, TABLE_SEED);
        },
      ],
      [
        'a negative stack',
        'BAD_AMOUNT',
        () => createTable(configFor(3), slotsFor([1000, -1, 1000]), TABLE_SEED),
      ],
      [
        'a fractional stack',
        'BAD_AMOUNT',
        () => createTable(configFor(3), slotsFor([1000, 1.5, 1000]), TABLE_SEED),
      ],
      [
        'one player with chips',
        'BAD_AMOUNT',
        () => createTable(configFor(3), slotsFor([1000, 0, 0]), TABLE_SEED),
      ],
      [
        'an unknown level',
        'ILLEGAL_ACTION',
        () => createTable(configFor(3, { botLevel: 'pro' as BotLevel }), three(), TABLE_SEED),
      ],
      [
        'a level for the hero',
        'ILLEGAL_ACTION',
        () => createTable(configFor(3, { seatLevels: ['easy', null, null] }), three(), TABLE_SEED),
      ],
      [
        'too few seat levels',
        'ILLEGAL_ACTION',
        () => createTable(configFor(3, { seatLevels: [null, null] }), three(), TABLE_SEED),
      ],
      ['a bad seed', 'ILLEGAL_ACTION', () => createTable(configFor(3), three(), 'ABC')],
    ];
    for (const [what, code, f] of cases) expect(engineError(f).code, what).toBe(code);
  });
});

describe('initialSlots and names (§9.3)', () => {
  it('nameOrder is a seed-determined permutation of the 24 names', () => {
    const order = nameOrder(TABLE_SEED);
    expect([...order].sort()).toEqual([...BOT_NAMES].sort());
    expect(BOT_NAMES).toHaveLength(24);
    expect(new Set(BOT_NAMES).size).toBe(24);
    expect(BOT_NAMES.every((name) => name.length <= 8)).toBe(true);
    expect(nameOrder(TABLE_SEED)).toEqual(order);
    expect(nameOrder(SEED)).not.toEqual(order);
  });

  it('the personality lists are the §9.3 table', () => {
    expect(PERSONALITY_LISTS).toEqual({
      easy: ['station', 'station', 'maniac', 'station', 'rock', 'station', 'lag', 'station'],
      medium: ['tag', 'station', 'lag', 'rock', 'station', 'maniac', 'tag', 'station'],
      hard: ['tag', 'lag', 'rock', 'tag', 'lag', 'station', 'tag', 'rock'],
      expert: ['tag', 'lag', 'tag', 'lag', 'tag', 'rock', 'lag', 'tag'],
    });
    for (const level of BOT_LEVELS) {
      expect(PERSONALITY_LISTS[level].every((p) => PERSONALITY_IDS.includes(p))).toBe(true);
    }
  });

  it('seats the hero first, then bots with the first names and personalities', () => {
    const cfg: TableConfig = { ...configFor(9), botLevel: 'easy' };
    const slots = initialSlots(cfg, TABLE_SEED, 'You');
    expect(slots[0]).toEqual({
      playerId: 'hero',
      name: 'You',
      kind: 'hero',
      personality: null,
      stack: 10000,
    });
    expect(slots.slice(1).map((s) => s.name)).toEqual(nameOrder(TABLE_SEED).slice(0, 8));
    expect(slots.slice(1).map((s) => s.playerId)).toEqual([
      'bot-0',
      'bot-1',
      'bot-2',
      'bot-3',
      'bot-4',
      'bot-5',
      'bot-6',
      'bot-7',
    ]);
    expect(slots.slice(1).map((s) => s.personality)).toEqual(PERSONALITY_LISTS.easy);
    expect(slots.every((s) => s.stack === 10000)).toBe(true);
  });

  it('a seat with its own level takes its personality from that level list', () => {
    const cfg: TableConfig = {
      ...configFor(4),
      botLevel: 'medium',
      seatLevels: [null, 'expert', null, 'hard'],
    };
    const personalities = initialSlots(cfg, TABLE_SEED, 'You').map((s) => s.personality);
    // seat 1: expert[0]; seat 2: medium[1]; seat 3: hard[2]
    expect(personalities).toEqual([null, 'tag', 'station', 'rock']);
  });

  it('rejects a bad config, seed or hero name', () => {
    expect(
      engineError(() => initialSlots({ ...configFor(3), seatCount: 12 }, TABLE_SEED, 'You')).code,
    ).toBe('BAD_AMOUNT');
    expect(engineError(() => initialSlots(configFor(3), 'x', 'You')).code).toBe('ILLEGAL_ACTION');
    expect(engineError(() => initialSlots(configFor(3), TABLE_SEED, '')).code).toBe(
      'ILLEGAL_ACTION',
    );
  });
});

describe('validateTable', () => {
  it('rejects a corrupt stored table, and so does every function that takes one', () => {
    const cases: [string, 'BAD_AMOUNT' | 'ILLEGAL_ACTION', (t: TableState) => void][] = [
      ['a bad seed', 'ILLEGAL_ACTION', (t) => (t.tableSeed = 'x')],
      ['a button off the table', 'BAD_AMOUNT', (t) => (t.button = 3)],
      ['a button below −1', 'BAD_AMOUNT', (t) => (t.button = -2)],
      ['prevBB off the table', 'BAD_AMOUNT', (t) => (t.prevBB = 3)],
      ['nextHandSeq 0', 'BAD_AMOUNT', (t) => (t.nextHandSeq = 0)],
      ['negative handsDealt', 'BAD_AMOUNT', (t) => (t.handsDealt = -1)],
      ['a fractional name cursor', 'BAD_AMOUNT', (t) => (t.nameCursor = 1.5)],
      ['negative reloads', 'BAD_AMOUNT', (t) => (t.reloads = -1)],
      [
        'an unknown seat level',
        'ILLEGAL_ACTION',
        (t) => (t.config.seatLevels[1] = 'pro' as BotLevel),
      ],
      ['no slots', 'BAD_AMOUNT', (t) => ((t as { slots: unknown }).slots = null)],
      [
        'stacks past the safe integers',
        'BAD_AMOUNT',
        (t) => {
          slot(t, 0).stack = 2 ** 52;
          slot(t, 1).stack = 2 ** 52;
        },
      ],
    ];
    for (const [what, code, corrupt] of cases) {
      const t = seatedTable(3);
      corrupt(t);
      expect(engineError(() => validateTable(t)).code, what).toBe(code);
      expect(engineError(() => startHand(t, SEED)).code, what).toBe(code);
      expect(engineError(() => topUp(t, 0, 2000)).code, what).toBe(code);
      expect(engineError(() => withLevels(t, 'easy', [null, null, null])).code, what).toBe(code);
    }
  });
});

describe('buttonForHand (§3.3)', () => {
  it('draws the first button from the table seed', () => {
    const t = seatedTable(7, 'easy', undefined, SEED);
    expect(buttonForHand(t)).toBe(randInt(rngFromSeed(deriveSeed(SEED, 'button')), 7));
  });

  it('needs two players with chips', () => {
    const t = seatedTable(3);
    slot(t, 1).stack = 0;
    slot(t, 2).stack = 0;
    expect(engineError(() => buttonForHand(t)).code).toBe('BAD_PHASE');
  });
});

/**
 * Deals one hand at `table` with rigged hole cards and a fixed board, everyone all-in, and
 * returns it finished (so seats that win nothing bust).
 */
function allInHand(table: TableState, holes: Record<number, string>, board: string): HandState {
  return finishAllIn(rigDeck(deal(table), { holes, board }));
}

const BOARD = '3h 4s 9d Jc 8s'; // no straight or flush for the hands below

describe('nextTable', () => {
  it('carries the stacks, records the button and BB, counts the hand (fold win)', () => {
    const table = tableWith([10000, 10000, 10000], { button: 0, nextHandSeq: 5 });
    const done = finishByFolds(deal(table)) as HandState;
    const next = nextTable(table, done);
    expect(next.slots.map((s) => s.stack)).toEqual([10000, 9950, 10050]);
    expect(next).toMatchObject({
      button: 0,
      prevBB: 2,
      handsDealt: 1,
      nextHandSeq: 6,
      personalityCursor: 2,
      nameCursor: 2,
      reloads: 0,
    });
    expect(next.slots.map((s) => s.playerId)).toEqual(table.slots.map((s) => s.playerId));
    expect(JSON.parse(JSON.stringify(next))).toStrictEqual(next);
  });

  it('keeps nextHandSeq when the controller already raised it (§14.3)', () => {
    const table = tableWith([10000, 10000], { button: 0, nextHandSeq: 5 });
    const done = finishByFolds(deal(table)) as HandState;
    expect(nextTable({ ...table, nextHandSeq: 9 }, done).nextHandSeq).toBe(9);
  });

  it('replaces a busted bot: starting stack, next personality, next free name, new id', () => {
    // Seat 2 is short with the worst hand; the hero and seat 1 tie and split everything.
    const table = seatedTable(3, 'medium', [null, null, 'expert']);
    slot(table, 2).stack = 150;
    const names = nameOrder(TABLE_SEED);
    const done = allInHand(table, { 0: 'Kc Kd', 1: 'Kh Ks', 2: '7c 2d' }, BOARD);
    expect(done.seats.map((s) => s.stack)).toEqual([2075, 2075, 0]);
    const next = nextTable(table, done);
    expect(slot(next, 0)).toEqual({ ...slot(table, 0), stack: 2075 });
    expect(slot(next, 1)).toEqual({ ...slot(table, 1), stack: 2075 });
    expect(slot(next, 2)).toEqual({
      playerId: 'bot-2',
      name: names[2],
      kind: 'bot',
      personality: PERSONALITY_LISTS.expert[2], // the seat's own level, cursor 2
      stack: 2000,
    });
    expect(next).toMatchObject({ personalityCursor: 3, nameCursor: 3 });
  });

  it("skips every name seated now, the busted bot's own name included", () => {
    const names = nameOrder(TABLE_SEED);
    const table = seatedTable(3);
    slot(table, 1).name = names[3] as string; // the name after the busted one
    slot(table, 2).name = names[2] as string; // the name at nameCursor (2): the bot that busts
    slot(table, 2).stack = 150;
    const done = allInHand(table, { 0: 'Kc Kd', 1: 'Kh Ks', 2: '7c 2d' }, BOARD);
    const next = nextTable(table, done);
    expect(slot(next, 2)).toMatchObject({ name: names[4], playerId: 'bot-4' });
    expect(next.nameCursor).toBe(5);
    expect(next.personalityCursor).toBe(3);
  });

  it('replaces several busted bots in seat order; a busted hero stays at 0', () => {
    // Seat 2 wins everything; the hero and seats 1 and 3 bust.
    const table = seatedTable(4, 'hard', [null, 'easy', null, null]);
    const names = nameOrder(TABLE_SEED);
    const done = allInHand(table, { 0: '7c 2d', 1: '6c 2h', 2: 'As Ah', 3: '5c 2s' }, BOARD);
    expect(done.seats.map((s) => s.stack)).toEqual([0, 0, 8000, 0]);
    const next = nextTable(table, done);
    expect(slot(next, 0)).toEqual({ ...slot(table, 0), stack: 0 });
    expect(slot(next, 2)).toEqual({ ...slot(table, 2), stack: 8000 });
    expect(slot(next, 1)).toMatchObject({
      playerId: 'bot-3',
      name: names[3],
      personality: PERSONALITY_LISTS.easy[3],
      stack: 2000,
    });
    expect(slot(next, 3)).toMatchObject({
      playerId: 'bot-4',
      name: names[4],
      personality: PERSONALITY_LISTS.hard[4],
      stack: 2000,
    });
    expect(next).toMatchObject({ personalityCursor: 5, nameCursor: 5 });
  });

  it('rejects a hand that is not over, not from this table, or broken', () => {
    const table = tableWith([10000, 10000, 10000], { button: 0 });
    const h = deal(table);
    expect(engineError(() => nextTable(table, h)).code).toBe('BAD_PHASE');
    const done = finishByFolds(h) as HandState;
    const other = tableWith([10000, 10000, 9000], { button: 0 });
    expect(engineError(() => nextTable(other, done)).code).toBe('BAD_PHASE');
    const broken = clone(done);
    (broken.seats[2] as { stack: number }).stack += 1;
    expect(() => nextTable(table, broken)).toThrow(InvariantError);
  });

  it('does not change its (deep-frozen) inputs', () => {
    const table = seatedTable(4);
    const done = allInHand(table, { 0: '7c 2d', 1: '6c 2h', 2: 'As Ah', 3: '5c 2s' }, BOARD);
    const before = [JSON.stringify(table), JSON.stringify(done)];
    const next = nextTable(deepFreeze(table), deepFreeze(done));
    expect([JSON.stringify(table), JSON.stringify(done)]).toEqual(before);
    expect(next.slots[1]).not.toBe(table.slots[1]);
    expect(next.config).not.toBe(table.config);
  });
});

describe('topUp and withLevels', () => {
  it('reloads a busted hero, even heads-up where nobody else has chips', () => {
    const table = seatedTable(2);
    slot(table, 0).stack = 0;
    slot(table, 1).stack = 4000;
    const next = topUp(table, 0, 2000);
    expect(slot(next, 0).stack).toBe(2000);
    expect(next.reloads).toBe(1);
    expect(slot(table, 0).stack).toBe(0); // the input is unchanged
    expect(deal(next).seats.every((s) => s.dealtIn)).toBe(true);
  });

  it('tops a short hero up to the starting stack', () => {
    const table = seatedTable(3);
    slot(table, 0).stack = 500;
    const next = topUp(table, 0, 2000);
    expect(next.slots.map((s) => s.stack)).toEqual([2000, 2000, 2000]);
    expect(next.reloads).toBe(1);
  });

  it('rejects bots, amounts that do not top up, and amounts above the starting stack', () => {
    const table = seatedTable(3);
    slot(table, 0).stack = 500;
    expect(engineError(() => topUp(table, 1, 2000)).code).toBe('ILLEGAL_ACTION');
    expect(engineError(() => topUp(table, 0, 500)).code).toBe('BAD_AMOUNT');
    expect(engineError(() => topUp(table, 0, 400)).code).toBe('BAD_AMOUNT');
    expect(engineError(() => topUp(table, 0, 2001)).code).toBe('BAD_AMOUNT');
    expect(engineError(() => topUp(table, 0, 1000.5)).code).toBe('BAD_AMOUNT');
  });

  it('withLevels changes the levels, keeps the seated personalities, and drives replacements', () => {
    const table = seatedTable(3, 'easy');
    const next = withLevels(table, 'expert', [null, 'hard', null]);
    expect(next.config).toMatchObject({ botLevel: 'expert', seatLevels: [null, 'hard', null] });
    expect(next.slots).toStrictEqual(table.slots);
    slot(next, 2).stack = 150;
    const done = allInHand(next, { 0: 'Kc Kd', 1: 'Kh Ks', 2: '7c 2d' }, BOARD);
    expect(slot(nextTable(next, done), 2).personality).toBe(PERSONALITY_LISTS.expert[2]);
  });

  it('withLevels rejects unknown levels and a level for the hero', () => {
    const table = seatedTable(3);
    expect(engineError(() => withLevels(table, 'pro' as BotLevel, [null, null, null])).code).toBe(
      'ILLEGAL_ACTION',
    );
    expect(engineError(() => withLevels(table, 'easy', ['easy', null, null])).code).toBe(
      'ILLEGAL_ACTION',
    );
    expect(engineError(() => withLevels(table, 'easy', [null, null])).code).toBe('ILLEGAL_ACTION');
  });
});

describe('withLevels: per-seat overrides (§9.3, chunk 7.2)', () => {
  const seats4 = (): TableState => seatedTable(4, 'easy');

  it('changes the levels and nothing else: the same bots, stacks, button, cursors and counters', () => {
    const table = seats4();
    const next = withLevels(table, 'hard', [null, 'expert', null, 'medium']);
    expect(next.config).toStrictEqual({
      ...table.config,
      botLevel: 'hard',
      seatLevels: [null, 'expert', null, 'medium'],
    });
    expect({ ...next, config: table.config }).toStrictEqual(table);
    // Every seated bot keeps its id, name, personality and stack.
    expect(next.slots).toStrictEqual(table.slots);
  });

  it('keeps the personalities of the seated bots even when the new level’s list reads differently', () => {
    const table = seats4();
    const was = table.slots.map((s) => s.personality);
    expect(was.slice(1)).toEqual(PERSONALITY_LISTS.easy.slice(0, 3));
    const next = withLevels(table, 'expert', [null, 'expert', 'expert', 'expert']);
    expect(next.slots.map((s) => s.personality)).toEqual(was);
  });

  it('null puts a seat back on the table level; a new table level moves every seat without an override', () => {
    const table = withLevels(seats4(), 'easy', [null, 'hard', 'hard', null]);
    const back = withLevels(table, 'medium', [null, null, 'hard', null]);
    expect(back.config.seatLevels).toEqual([null, null, 'hard', null]);
    expect(back.config.botLevel).toBe('medium');
  });

  it('does not change its input and shares nothing with it', () => {
    const table = deepFreeze(seats4());
    const levels: (BotLevel | null)[] = [null, 'hard', null, null];
    const next = withLevels(table, 'medium', levels);
    expect(table.config.seatLevels).toEqual([null, null, null, null]);
    expect(next.config).not.toBe(table.config);
    expect(next.slots).not.toBe(table.slots);
    levels[2] = 'expert'; // changing the list given afterwards changes nothing
    expect(next.config.seatLevels).toEqual([null, 'hard', null, null]);
  });

  it('the hand in play is not touched: it settles on the table with the new levels, and a hand can be dealt from it', () => {
    const table = seats4();
    const hand = deal(table);
    const relevelled = withLevels(table, 'expert', [null, 'hard', null, null]);
    // A hand holds no levels: the same hand is "from" both tables, and the next one is dealt from either.
    const done = finishByFolds(hand) as HandState;
    expect(nextTable(relevelled, done).slots.map((s) => s.stack)).toEqual(
      nextTable(table, done).slots.map((s) => s.stack),
    );
    expect(deal(relevelled).seats).toHaveLength(4);
    expect(hand.seats).toHaveLength(4); // unchanged by the call above
  });

  it('a bot that busts is replaced from the list of its seat’s level, in seat order, one cursor', () => {
    const table = withLevels(seats4(), 'hard', [null, 'expert', 'easy', null]);
    const done = allInHand(table, { 0: 'Ac Ad', 1: '7c 2d', 2: 'Qc 5d', 3: 'Th 6d' }, BOARD);
    expect(done.seats.slice(1).every((s) => s.stack === 0)).toBe(true);
    const next = nextTable(table, done);
    // The cursor stood at 3: seat 1 takes entry 3 of the Expert list, seat 2 entry 4 of the Easy
    // list, seat 3 (no override: the table’s Hard) entry 5 of the Hard list.
    expect(next.slots.slice(1).map((s) => s.personality)).toEqual([
      PERSONALITY_LISTS.expert[3],
      PERSONALITY_LISTS.easy[4],
      PERSONALITY_LISTS.hard[5],
    ]);
    expect(next.personalityCursor).toBe(6);
    expect(next.slots.slice(1).every((s) => s.stack === 2000)).toBe(true);
    expect(next.config.seatLevels).toEqual([null, 'expert', 'easy', null]); // the overrides stay
  });

  it('a seat’s override stays with the seat when its bot is replaced', () => {
    const table = withLevels(seats4(), 'easy', [null, null, 'hard', null]);
    const done = allInHand(table, { 0: 'Ac Ad', 1: '7c 2d', 2: 'Qc 5d', 3: 'Th 6d' }, BOARD);
    const next = nextTable(table, done);
    expect(next.slots[2]?.playerId).not.toBe(table.slots[2]?.playerId);
    expect(next.config.seatLevels[2]).toBe('hard');
  });

  it('rejects a table that is not valid, and a list for another number of seats', () => {
    const table = seats4();
    expect(engineError(() => withLevels(table, 'easy', [null, null, null, null, null])).code).toBe(
      'ILLEGAL_ACTION',
    );
    expect(
      engineError(() => withLevels(table, 'easy', [null, 'pro' as BotLevel, null, null])).code,
    ).toBe('ILLEGAL_ACTION');
    const broken = { ...table, button: 9 };
    expect(engineError(() => withLevels(broken, 'easy', [null, null, null, null])).code).toBe(
      'BAD_AMOUNT',
    );
  });

  it('for any run of changes: the table stays valid, the bots stay, the levels are the last ones set', () => {
    const levelOrNull = fc.constantFrom<BotLevel | null>(null, ...BOT_LEVELS);
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.constantFrom(...BOT_LEVELS),
            fc.array(levelOrNull, { minLength: 3, maxLength: 3 }),
          ),
          { minLength: 1, maxLength: 12 },
        ),
        (changes) => {
          const base = seats4();
          let table = base;
          for (const [level, own] of changes) table = withLevels(table, level, [null, ...own]);
          validateTable(table);
          const [level, own] = changes[changes.length - 1] as (typeof changes)[number];
          expect(table.config.botLevel).toBe(level);
          expect(table.config.seatLevels).toEqual([null, ...own]);
          expect(table.slots).toStrictEqual(base.slots);
          expect({ ...table, config: base.config }).toStrictEqual(base);
        },
      ),
      { seed: FC_SEED, numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Many hands in a row.

const seedArb: fc.Arbitrary<Seed128> = fc
  .tuple(fc.nat(), fc.nat(), fc.nat(), fc.nat())
  .map(([a, b, c, d]) => seedFromWords(a, b, c, d));
const levelArb = fc.constantFrom<BotLevel>(...BOT_LEVELS);
const overrideArb = fc.array(fc.option(levelArb, { nil: null }), { minLength: 9, maxLength: 9 });

/** §3.3 by hand: the button `startHand` must pick next, from the table alone. */
function expectedButton(table: TableState): number {
  const n = table.config.seatCount;
  const hasChips = (seat: number): boolean => slot(table, seat).stack > 0;
  const next = (from: number): number => {
    for (let d = 1; d <= n; d++) if (hasChips((from + d) % n)) return (from + d) % n;
    throw new Error('nobody has chips');
  };
  const k = table.slots.filter((s) => s.stack > 0).length;
  if (table.button === -1) {
    const pick = randInt(rngFromSeed(deriveSeed(table.tableSeed, 'button')), n);
    return hasChips(pick) ? pick : next(pick);
  }
  if (k === 2 && table.prevBB !== null && hasChips(table.prevBB)) return table.prevBB;
  return next(table.button);
}

/**
 * Plays `hands` hands (fold wins and all-in showdowns), checking every `nextTable` transition.
 * With `reload`, a busted hero is reloaded as the v1 controller does (§3.1), so everyone is
 * dealt every hand and the button moves exactly one seat; without it the hero sits out
 * (engine mode) and the button skips the empty seat.
 */
function playMany(
  seatCount: number,
  botLevel: BotLevel,
  overrides: (BotLevel | null)[],
  tableSeed: Seed128,
  hands: number,
  reload: boolean,
): void {
  const seatLevels = overrides.slice(0, seatCount);
  seatLevels[0] = null;
  let table = seatedTable(seatCount, botLevel, seatLevels, tableSeed);
  const idsEverSeated = new Set(table.slots.map((s) => s.playerId));
  let personalityCursor = seatCount - 1;
  let lastButton: number | null = null;
  for (let hand = 0; hand < hands; hand++) {
    if (table.slots.filter((s) => s.stack > 0).length < 2) break; // engine mode: the hero is out
    const button = expectedButton(table);
    const h = startHand(table, deriveSeed(tableSeed, 'hand', hand));
    expect(h.button).toBe(button);
    if (reload && lastButton !== null) expect(h.button).toBe((lastButton + 1) % seatCount);
    lastButton = h.button;
    const k = h.seats.filter((s) => s.dealtIn).length;
    if (k === 2) expect(h.sbSeat).toBe(h.button);
    expect(h.seats.map((s) => s.dealtIn)).toEqual(table.slots.map((s) => s.stack > 0));

    const done = (hand % 3 === 1 ? finishByFolds(h) : null) ?? finishAllIn(h);
    const next = nextTable(table, done);

    expect(next.slots).toHaveLength(seatCount);
    expect(next.config).toStrictEqual(table.config);
    expect(next).toMatchObject({
      button: done.button,
      prevBB: done.bbSeat,
      handsDealt: table.handsDealt + 1,
      nextHandSeq: done.handSeq + 1,
      tableId: table.tableId,
      reloads: table.reloads,
    });
    const namesBefore = new Set(table.slots.map((s) => s.name));
    let replaced = 0;
    next.slots.forEach((s, seat) => {
      const final = (done.seats[seat] as HandState['seats'][number]).stack;
      if (seat > 0 && final === 0) {
        replaced++;
        const level = seatLevels[seat] ?? botLevel;
        expect(s.kind).toBe('bot');
        expect(s.stack).toBe(2000);
        expect(s.personality).toBe(PERSONALITY_LISTS[level][personalityCursor % 8]);
        personalityCursor++;
        expect(namesBefore.has(s.name)).toBe(false);
        expect(idsEverSeated.has(s.playerId)).toBe(false);
        idsEverSeated.add(s.playerId);
        expect(s.playerId).toMatch(/^bot-\d+$/);
        expect(Number(s.playerId.slice(4))).toBeLessThan(next.nameCursor);
      } else {
        expect(s).toStrictEqual({ ...slot(table, seat), stack: final });
      }
    });
    expect(next.personalityCursor).toBe(personalityCursor);
    expect(new Set(next.slots.map((s) => s.name)).size).toBe(seatCount);
    expect(sum(next.slots.map((s) => s.stack))).toBe(
      sum(done.seats.map((s) => s.stack)) + 2000 * replaced,
    );
    expect(JSON.parse(JSON.stringify(next))).toStrictEqual(next);
    table = next;
    if (reload && slot(table, 0).stack === 0) table = topUp(table, 0, 2000);
  }
}

describe('nextTable over many hands (property)', () => {
  it('v1: keeps the table size, moves the button one seat a hand, replaces busted bots', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 9 }),
        levelArb,
        overrideArb,
        seedArb,
        (n, level, over, seed) => playMany(n, level, over, seed, 40, true),
      ),
      { seed: FC_SEED, numRuns: 60 },
    );
  });

  it('engine mode: a hero who is not reloaded sits out and the button skips the seat', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 9 }),
        levelArb,
        overrideArb,
        seedArb,
        (n, level, over, seed) => playMany(n, level, over, seed, 30, false),
      ),
      { seed: FC_SEED, numRuns: 60 },
    );
  });
});
