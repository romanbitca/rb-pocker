/**
 * PLAN §19.4 and §18 Stage 10, acceptance 5 (the decoder half): every message a client may send
 * decodes to a fresh object with only the known fields; anything else is null, and the decoder
 * never throws, whatever `JSON.parse` gave.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createTable } from '../../src/engine/table.ts';
import type { PlayerSlot, TableConfig } from '../../src/engine/types.ts';
import {
  MAX_SEATS,
  MIN_SEATS,
  MP_MAX_INBOUND_BYTES,
  MP_PING_EVERY_MS,
  MP_PONG_WAIT_MS,
  MP_PROTOCOL_VERSION,
  MP_WS_PATH,
  STAKES,
  START_NEW,
  TABLE_CODE_RE,
  TURN_SECONDS,
  WS_CLOSE,
  decodeClientMsg,
  type ClientMsg,
  type StakesId,
} from '../../src/net/protocol.ts';
import { FC_SEED, TABLE_SEED } from '../engine/helpers.ts';

const LETTERS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** Good messages of every kind. The mapped type stops compiling when a kind has no sample. */
const GOOD: { [K in ClientMsg['t']]: Extract<ClientMsg, { t: K }>[] } = {
  hello: [
    { t: 'hello', v: 1, initData: 'query_id=AAE&auth_date=1&hash=ab' },
    { t: 'hello', v: 0, initData: 'x' },
    { t: 'hello', v: 99, initData: 'x'.repeat(8192) },
  ],
  create: [
    { t: 'create', settings: { seats: MIN_SEATS, stakes: 'quick', turnSeconds: 15 } },
    { t: 'create', settings: { seats: 6, stakes: 'normal', turnSeconds: 30 } },
    { t: 'create', settings: { seats: MAX_SEATS, stakes: 'long', turnSeconds: 60 } },
  ],
  join: [
    { t: 'join', code: 'ABCDEFGH' },
    { t: 'join', code: '23456789' },
    { t: 'join', code: 'JKMNPQRS' },
    { t: 'join', code: 'TUVWXYZ2' },
  ],
  leave: [{ t: 'leave' }],
  start: [{ t: 'start' }],
  act: [
    { t: 'act', seq: 0, action: { type: 'fold' } },
    { t: 'act', seq: 1, action: { type: 'check' } },
    { t: 'act', seq: 2, action: { type: 'call' } },
    { t: 'act', seq: 3, action: { type: 'bet', to: 1 } },
    { t: 'act', seq: Number.MAX_SAFE_INTEGER, action: { type: 'raise', to: 2_000 } },
    { t: 'act', seq: 5, action: { type: 'raise', to: Number.MAX_SAFE_INTEGER } },
  ],
  back: [{ t: 'back' }],
  reload: [{ t: 'reload' }],
  ping: [
    { t: 'ping', n: 0 },
    { t: 'ping', n: -5 },
    { t: 'ping', n: Number.MAX_SAFE_INTEGER },
  ],
};
const GOOD_MESSAGES: ClientMsg[] = Object.values(GOOD).flat();

const BAD_ACTIONS: unknown[] = [
  undefined,
  null,
  'fold',
  [],
  {},
  { type: 'allin' },
  { type: 'Fold' },
  { type: 1 },
  { type: 'bet' },
  { type: 'bet', to: 0 },
  { type: 'bet', to: -20 },
  { type: 'bet', to: 1.5 },
  { type: 'bet', to: '100' },
  { type: 'bet', to: null },
  { type: 'bet', to: Number.NaN },
  { type: 'bet', to: Number.POSITIVE_INFINITY },
  { type: 'bet', to: Number.MAX_SAFE_INTEGER + 1 },
  { type: 'raise' },
  { type: 'raise', to: 0 },
  { type: 'raise', to: 2.5 },
];

/** What must decode to null: a label and the value. */
const BAD: [string, unknown][] = [
  ['null', null],
  ['undefined', undefined],
  ['a number', 7],
  ['a string', 'leave'],
  ['a boolean', true],
  ['an empty array', []],
  ['an array holding a message', [{ t: 'leave' }]],
  ['an object without t', {}],
  ['another t', { t: 'act2' }],
  ['a capital T', { T: 'leave' }],
  ['t a number', { t: 1 }],
  ['t null', { t: null }],
  ['t as a key of Object', { t: 'constructor' }],
  ['t inherited from __proto__', JSON.parse('{"__proto__":{"t":"leave"}}')],
  ['hello: no fields', { t: 'hello' }],
  ['hello: no v', { t: 'hello', initData: 'x' }],
  ['hello: v a string', { t: 'hello', v: '1', initData: 'x' }],
  ['hello: v a fraction', { t: 'hello', v: 1.5, initData: 'x' }],
  ['hello: v NaN', { t: 'hello', v: Number.NaN, initData: 'x' }],
  ['hello: v past safe', { t: 'hello', v: Number.MAX_SAFE_INTEGER + 1, initData: 'x' }],
  ['hello: no initData', { t: 'hello', v: 1 }],
  ['hello: empty initData', { t: 'hello', v: 1, initData: '' }],
  ['hello: initData a number', { t: 'hello', v: 1, initData: 7 }],
  ['hello: initData over 8192', { t: 'hello', v: 1, initData: 'x'.repeat(8193) }],
  ['create: no settings', { t: 'create' }],
  ['create: settings null', { t: 'create', settings: null }],
  ['create: settings an array', { t: 'create', settings: [] }],
  ['create: 1 seat', { t: 'create', settings: { seats: 1, stakes: 'quick', turnSeconds: 15 } }],
  ['create: 10 seats', { t: 'create', settings: { seats: 10, stakes: 'quick', turnSeconds: 15 } }],
  ['create: 2.5 seats', { t: 'create', settings: { seats: 2.5, stakes: 'quick', turnSeconds: 15 } }],
  ['create: seats a string', { t: 'create', settings: { seats: '2', stakes: 'quick', turnSeconds: 15 } }],
  ['create: unknown stakes', { t: 'create', settings: { seats: 2, stakes: 'high', turnSeconds: 15 } }],
  ['create: chips, no stakes', { t: 'create', settings: { seats: 2, sb: 1, bb: 2, stack: 9, turnSeconds: 15 } }],
  ['create: 20 seconds', { t: 'create', settings: { seats: 2, stakes: 'quick', turnSeconds: 20 } }],
  ['create: seconds a string', { t: 'create', settings: { seats: 2, stakes: 'quick', turnSeconds: '15' } }],
  ['join: no code', { t: 'join' }],
  ['join: a number', { t: 'join', code: 12345678 }],
  ['join: 7 letters', { t: 'join', code: 'ABCDEFG' }],
  ['join: 9 letters', { t: 'join', code: 'ABCDEFGHJ' }],
  ['join: lower case', { t: 'join', code: 'abcdefgh' }],
  ['join: a zero', { t: 'join', code: 'ABCDEFG0' }],
  ['join: a one', { t: 'join', code: 'ABCDEFG1' }],
  ['join: an I', { t: 'join', code: 'ABCDEFGI' }],
  ['join: an L', { t: 'join', code: 'ABCDEFGL' }],
  ['join: an O', { t: 'join', code: 'ABCDEFGO' }],
  ['join: a line end after the code', { t: 'join', code: 'ABCDEFGH\n' }],
  ['join: "new" (a start parameter, not a table)', { t: 'join', code: START_NEW }],
  ['act: no seq', { t: 'act', action: { type: 'fold' } }],
  ['act: seq negative', { t: 'act', seq: -1, action: { type: 'fold' } }],
  ['act: seq a fraction', { t: 'act', seq: 1.5, action: { type: 'fold' } }],
  ['act: seq a string', { t: 'act', seq: '1', action: { type: 'fold' } }],
  ['act: seq past safe', { t: 'act', seq: Number.MAX_SAFE_INTEGER + 1, action: { type: 'fold' } }],
  ...BAD_ACTIONS.map((action): [string, unknown] => [
    `act: action ${JSON.stringify(action)}`,
    { t: 'act', seq: 1, action },
  ]),
  ['ping: no n', { t: 'ping' }],
  ['ping: n a string', { t: 'ping', n: '1' }],
  ['ping: n a fraction', { t: 'ping', n: 0.5 }],
  ['ping: n past safe', { t: 'ping', n: 2 ** 53 }],
]; // prettier-ignore

describe('decodeClientMsg: every message of §19.4 decodes', () => {
  it.each(GOOD_MESSAGES.map((msg): [string, ClientMsg] => [JSON.stringify(msg).slice(0, 72), msg]))(
    '%s',
    (_, msg) => {
      const wire: unknown = JSON.parse(JSON.stringify(msg));
      const decoded = decodeClientMsg(wire);
      expect(decoded).toStrictEqual(msg);
      expect(decoded).not.toBe(wire);
    },
  );

  it('keeps only the known fields, at every level', () => {
    const extra = { secret: 'x', __v: 1 };
    expect(decodeClientMsg({ t: 'leave', ...extra })).toStrictEqual({ t: 'leave' });
    expect(decodeClientMsg({ t: 'start', ...extra })).toStrictEqual({ t: 'start' });
    expect(decodeClientMsg({ t: 'back', ...extra })).toStrictEqual({ t: 'back' });
    expect(decodeClientMsg({ t: 'reload', ...extra })).toStrictEqual({ t: 'reload' });
    expect(decodeClientMsg({ t: 'ping', n: 1, ...extra })).toStrictEqual({ t: 'ping', n: 1 });
    expect(decodeClientMsg({ t: 'join', code: 'ABCDEFGH', ...extra })).toStrictEqual({
      t: 'join',
      code: 'ABCDEFGH',
    });
    expect(decodeClientMsg({ t: 'hello', v: 1, initData: 'x', ...extra })).toStrictEqual({
      t: 'hello',
      v: 1,
      initData: 'x',
    });
    expect(
      decodeClientMsg({
        t: 'create',
        settings: { seats: 2, stakes: 'quick', turnSeconds: 15, sb: 1, bb: 2, ...extra },
        ...extra,
      }),
    ).toStrictEqual({ t: 'create', settings: { seats: 2, stakes: 'quick', turnSeconds: 15 } });
    // A chip amount means nothing on a fold; it must not travel with it.
    expect(
      decodeClientMsg({ t: 'act', seq: 4, action: { type: 'fold', to: 500, ...extra }, ...extra }),
    ).toStrictEqual({ t: 'act', seq: 4, action: { type: 'fold' } });
    expect(
      decodeClientMsg({ t: 'act', seq: 4, action: { type: 'bet', to: 500, seat: 3 } }),
    ).toStrictEqual({ t: 'act', seq: 4, action: { type: 'bet', to: 500 } });
  });
});

describe('decodeClientMsg: anything else is null', () => {
  it.each(BAD)('%s', (_, value) => {
    expect(decodeClientMsg(value)).toBeNull();
  });
});

describe('decodeClientMsg: never throws', () => {
  /** Field values a real message might have, mixed with anything at all. */
  const noise = fc.oneof(
    fc.anything(),
    fc.jsonValue(),
    fc.constantFrom<unknown>(1, 0, -1, 1.5, 'x', 'ABCDEFGH', { type: 'fold' }, { type: 'bet', to: 5 }),
    fc.record({
      seats: fc.oneof(fc.integer({ min: 0, max: 11 }), fc.anything()),
      stakes: fc.oneof(fc.constantFrom<unknown>('quick', 'normal', 'long'), fc.anything()),
      turnSeconds: fc.oneof(fc.constantFrom<unknown>(15, 30, 60), fc.anything()),
    }),
  ); // prettier-ignore
  const messageLike = fc.record(
    {
      t: fc.oneof(fc.constantFrom<unknown>(...Object.keys(GOOD)), fc.anything()),
      v: noise,
      initData: noise,
      settings: noise,
      code: noise,
      seq: noise,
      action: noise,
      n: noise,
    },
    { requiredKeys: ['t'] },
  );

  /** A result is null or a fixed point: decoding what the decoder gave changes nothing. */
  function holds(x: unknown): void {
    const decoded = decodeClientMsg(x);
    if (decoded !== null) expect(decodeClientMsg(decoded)).toStrictEqual(decoded);
  }

  it('on any value, with or without a prototype', () => {
    fc.assert(fc.property(fc.anything({ withNullPrototype: true, withBigInt: true }), holds), {
      seed: FC_SEED,
      numRuns: 2_000,
    });
  });

  it('on any JSON text a client could send', () => {
    fc.assert(
      fc.property(fc.json(), (text) => holds(JSON.parse(text))),
      { seed: FC_SEED, numRuns: 2_000 },
    );
  });

  it('on messages of the right shape with wrong fields', () => {
    const kinds = new Set<string>();
    fc.assert(
      fc.property(messageLike, (x) => {
        holds(x);
        const decoded = decodeClientMsg(x);
        if (decoded !== null) kinds.add(decoded.t);
      }),
      { seed: FC_SEED, numRuns: 3_000 },
    );
    // Not vacuous: some of these are real messages.
    expect(kinds).toContain('leave');
    expect(kinds).toContain('start');
    expect(kinds).toContain('ping');
  });
});

describe('the constants of §19.4', () => {
  it('names the version, the path and the sizes', () => {
    expect(MP_PROTOCOL_VERSION).toBe(1);
    expect(MP_WS_PATH).toBe('/api/mp/ws');
    expect(MP_MAX_INBOUND_BYTES).toBe(16_384);
    expect(MP_PING_EVERY_MS).toBe(20_000);
    expect(MP_PONG_WAIT_MS).toBe(10_000);
    expect(MIN_SEATS).toBe(2);
    expect(MAX_SEATS).toBe(9);
    expect([...TURN_SECONDS]).toEqual([15, 30, 60]);
  });

  it('a table code is 8 letters of the 31 that cannot be misread (§19.9)', () => {
    expect(LETTERS).toHaveLength(31);
    const accepted = Array.from({ length: 128 }, (_, code) => String.fromCharCode(code)).filter(
      (ch) => TABLE_CODE_RE.test(ch.repeat(8)),
    );
    expect(accepted.join('')).toBe(LETTERS);
    expect(TABLE_CODE_RE.test('A'.repeat(7))).toBe(false);
    expect(TABLE_CODE_RE.test('A'.repeat(9))).toBe(false);
    expect(TABLE_CODE_RE.test(START_NEW)).toBe(false);
  });

  it.each(Object.keys(STAKES) as StakesId[])('the %s game is a valid table (§3.2)', (id) => {
    const { sb, bb, stack } = STAKES[id];
    const seatCount = MAX_SEATS;
    const config: TableConfig = {
      seatCount,
      sb,
      bb,
      startingStack: stack,
      botLevel: 'easy',
      seatLevels: new Array<null>(seatCount).fill(null),
    };
    const slots: PlayerSlot[] = Array.from({ length: seatCount }, (_, seat) => ({
      playerId: `s${seat}`,
      name: `s${seat}`,
      kind: 'remote',
      personality: null,
      stack,
    }));
    expect(createTable(config, slots, TABLE_SEED).config.startingStack).toBe(stack);
  });

  it('close codes are the private ones of the §19.4 table, each once', () => {
    expect(WS_CLOSE).toEqual({
      authFailed: 4001,
      replaced: 4002,
      outdated: 4003,
      authTimeout: 4004,
      badMessage: 4005,
      rateLimited: 4008,
      silent: 4009,
    });
    expect(new Set(Object.values(WS_CLOSE)).size).toBe(Object.keys(WS_CLOSE).length);
  });
});
