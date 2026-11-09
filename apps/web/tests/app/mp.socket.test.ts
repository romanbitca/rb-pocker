/**
 * `MpSocket` (PLAN §19.4): connect, `hello`, the heartbeat, the backoff, the close codes, a hidden
 * page and giving up after two minutes, all on a fake clock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { realTimers, type Timers } from '../../src/app/controller.ts';
import {
  GIVE_UP_AFTER_MS,
  MpSocket,
  RATE_LIMIT_WAIT_MS,
  RECONNECT_MS,
  WELCOME_WAIT_MS,
  type WebSocketLike,
} from '../../src/app/mp/socket.ts';
import type { MpConnection } from '../../src/app/store.ts';
import {
  MP_PING_EVERY_MS,
  MP_PONG_WAIT_MS,
  MP_PROTOCOL_VERSION,
  type ServerMsg,
} from '../../src/net/protocol.ts';
import { FakeWebSocket, socketFactory } from './mpFixtures.ts';

const WELCOME: ServerMsg = { t: 'welcome', v: 1, name: 'Ann', now: 1, code: null };
const FIRST_WAIT = RECONNECT_MS[0] as number;

interface Options {
  random?: () => number;
  timers?: Timers;
  open?: (url: string) => WebSocketLike;
}

function rig(options: Options = {}) {
  const factory = socketFactory();
  const statuses: MpConnection[] = [];
  const messages: ServerMsg[] = [];
  const stopped: number[] = [];
  const socket = new MpSocket({
    url: 'wss://poker.test/api/mp/ws',
    initData: 'INIT-DATA',
    timers: options.timers ?? realTimers,
    open: options.open ?? factory.open,
    onStatus: (s) => statuses.push(s),
    onMessage: (m) => messages.push(m),
    onStopped: (c) => stopped.push(c),
    random: options.random ?? (() => 0.5), // exactly the middle: no jitter
  });
  return { ...factory, socket, statuses, messages, stopped };
}

type Rig = ReturnType<typeof rig>;

/** Connected and answered. */
function online(r: Rig): FakeWebSocket {
  r.socket.connect();
  const ws = r.last();
  ws.open();
  ws.receive(WELCOME);
  return ws;
}

const advance = (ms: number): void => {
  vi.advanceTimersByTime(ms);
};
const pings = (ws: FakeWebSocket): number => ws.kinds().filter((k) => k === 'ping').length;
const status = (r: Rig): MpConnection | undefined => r.statuses[r.statuses.length - 1];

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('connecting', () => {
  it('opens the given url and says hello first, with the version and initData', () => {
    const r = rig();
    r.socket.connect();
    expect(r.sockets).toHaveLength(1);
    expect(r.last().url).toBe('wss://poker.test/api/mp/ws');
    expect(r.last().sent).toEqual([]);
    r.last().open();
    expect(r.last().sent).toEqual([{ t: 'hello', v: MP_PROTOCOL_VERSION, initData: 'INIT-DATA' }]);
  });

  it('is connecting until welcome, then online', () => {
    const r = rig();
    r.socket.connect();
    r.last().open();
    expect(r.statuses).toEqual(['connecting']);
    expect(r.socket.online).toBe(false);
    r.last().receive(WELCOME);
    expect(r.statuses).toEqual(['connecting', 'online']);
    expect(r.socket.online).toBe(true);
  });

  it('a second connect does nothing', () => {
    const r = rig();
    online(r);
    r.socket.connect();
    expect(r.sockets).toHaveLength(1);
  });

  it('sends nothing but hello before welcome, and send says so', () => {
    const r = rig();
    r.socket.connect();
    r.last().open();
    expect(r.socket.send({ t: 'leave' })).toBe(false);
    r.last().receive(WELCOME);
    expect(r.socket.send({ t: 'leave' })).toBe(true);
    expect(r.last().kinds()).toEqual(['hello', 'leave']);
  });

  it('a send that throws returns false', () => {
    const r = rig();
    const ws = online(r);
    ws.send = () => {
      throw new Error('closing');
    };
    expect(r.socket.send({ t: 'leave' })).toBe(false);
  });

  it('hands every message but pong to the driver', () => {
    const r = rig();
    const ws = online(r);
    ws.receive({ t: 'left' });
    ws.receive({ t: 'pong', n: 99, now: 1 });
    expect(r.messages.map((m) => m.t)).toEqual(['welcome', 'left']);
  });

  it('ignores frames that are not messages, and never throws', () => {
    const r = rig();
    const ws = online(r);
    const count = r.messages.length;
    for (const frame of ['not json', '42', 'null', '[]', '"x"', '{}', new ArrayBuffer(2), 7]) {
      expect(() => ws.receiveRaw(frame)).not.toThrow();
    }
    expect(r.messages).toHaveLength(count);
  });

  it('a try that gets no welcome in time has failed', () => {
    const r = rig();
    r.socket.connect();
    r.last().open();
    advance(WELCOME_WAIT_MS - 1);
    expect(r.statuses).toEqual(['connecting']);
    advance(1);
    expect(r.statuses).toEqual(['connecting', 'reconnecting']);
    expect(r.sockets[0]?.closedWith).not.toBeNull();
    advance(FIRST_WAIT);
    expect(r.sockets).toHaveLength(2);
  });

  it('a WebSocket that cannot be made counts as a failed try', () => {
    let calls = 0;
    const factory = socketFactory();
    const r = rig({
      open: (url) => {
        calls++;
        if (calls === 1) throw new Error('blocked');
        return factory.open(url);
      },
    });
    r.socket.connect();
    expect(r.statuses).toEqual(['connecting', 'reconnecting']);
    advance(FIRST_WAIT);
    expect(factory.sockets).toHaveLength(1);
  });
});

describe('the heartbeat (§19.4)', () => {
  it('pings every 20 s, each with a new number, while pongs come back', () => {
    const r = rig();
    const ws = online(r);
    for (let n = 1; n <= 3; n++) {
      advance(MP_PING_EVERY_MS - 1);
      expect(pings(ws)).toBe(n - 1);
      advance(1);
      expect(ws.sent[ws.sent.length - 1]).toEqual({ t: 'ping', n });
      ws.receive({ t: 'pong', n, now: 1 });
    }
    expect(status(r)).toBe('online');
    expect(r.sockets).toHaveLength(1);
  });

  it('does not ping before welcome', () => {
    const r = rig();
    r.socket.connect();
    r.last().open();
    advance(WELCOME_WAIT_MS - 1);
    expect(pings(r.last())).toBe(0);
  });

  it('no pong within 10 s means the socket is dead: it reconnects and says hello again', () => {
    const r = rig();
    const ws = online(r);
    advance(MP_PING_EVERY_MS + MP_PONG_WAIT_MS - 1);
    expect(status(r)).toBe('online');
    advance(1);
    expect(status(r)).toBe('reconnecting');
    expect(ws.closedWith).not.toBeNull();
    advance(FIRST_WAIT);
    expect(r.sockets).toHaveLength(2);
    r.last().open();
    expect(r.last().sent[0]).toEqual({ t: 'hello', v: MP_PROTOCOL_VERSION, initData: 'INIT-DATA' });
  });

  it('a pong with another number does not count', () => {
    const r = rig();
    const ws = online(r);
    advance(MP_PING_EVERY_MS);
    ws.receive({ t: 'pong', n: 41, now: 1 });
    advance(MP_PONG_WAIT_MS);
    expect(status(r)).toBe('reconnecting');
  });

  it('events of a socket that was replaced do nothing', () => {
    const r = rig();
    const old = online(r);
    const handlers = { message: old.onmessage, close: old.onclose };
    old.drop(1006);
    advance(FIRST_WAIT);
    const next = r.last();
    next.open();
    next.receive(WELCOME);
    const count = r.messages.length;
    handlers.message?.({ data: JSON.stringify({ t: 'left' }) });
    handlers.close?.({ code: 1006 });
    expect(r.messages).toHaveLength(count);
    expect(status(r)).toBe('online');
  });
});

describe('reconnecting (§19.4)', () => {
  it('waits 0.5, 1, 2, 4, 8, 8 s between tries', () => {
    const r = rig();
    r.socket.connect();
    const waits = [500, 1000, 2000, 4000, 8000, 8000];
    waits.forEach((wait, i) => {
      r.last().drop(1006);
      advance(wait - 1);
      expect(r.sockets, `before try ${i + 2}`).toHaveLength(i + 1);
      advance(1);
      expect(r.sockets, `at try ${i + 2}`).toHaveLength(i + 2);
    });
  });

  it.each([
    [0, 400],
    [0.75, 550],
  ])('each wait is ±20%% (random %f)', (random, wait) => {
    const r = rig({ random: () => random });
    r.socket.connect();
    r.last().drop(1006);
    advance(wait - 1);
    expect(r.sockets).toHaveLength(1);
    advance(1);
    expect(r.sockets).toHaveLength(2);
  });

  it('welcome starts the waits over', () => {
    const r = rig();
    r.socket.connect();
    r.last().drop(1006);
    advance(500);
    r.last().drop(1006);
    advance(1000);
    r.last().open();
    r.last().receive(WELCOME);
    r.last().drop(1006);
    advance(FIRST_WAIT);
    expect(r.sockets).toHaveLength(4);
  });

  it('is reconnecting from the first failure, online again at welcome', () => {
    const r = rig();
    online(r);
    r.last().drop(1006);
    expect(status(r)).toBe('reconnecting');
    advance(FIRST_WAIT);
    r.last().open();
    r.last().receive(WELCOME);
    expect(r.statuses).toEqual(['connecting', 'online', 'reconnecting', 'online']);
  });

  it.each([1000, 1006, 1008, 1011, 4004, 4009])('close %i is retried', (code) => {
    const r = rig();
    online(r);
    r.last().drop(code);
    advance(FIRST_WAIT);
    expect(r.sockets).toHaveLength(2);
    expect(r.stopped).toEqual([]);
  });

  it.each([1009, 1012, 4001, 4002, 4003, 4005])('close %i stops for good', (code) => {
    const r = rig();
    online(r);
    r.last().drop(code);
    expect(r.stopped).toEqual([code]);
    expect(status(r)).toBe('idle');
    advance(600_000);
    expect(r.sockets).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('close 4008 (rate limit) waits 10 s', () => {
    const r = rig();
    online(r);
    r.last().drop(4008);
    advance(RATE_LIMIT_WAIT_MS - 1);
    expect(r.sockets).toHaveLength(1);
    advance(1);
    expect(r.sockets).toHaveLength(2);
  });
});

/** Fails every try until `status` says it stopped; returns how long it took. */
function failUntilLost(r: Rig): number {
  const start = Date.now();
  for (let i = 0; i < 200 && status(r) !== 'lost'; i++) {
    r.last().drop(1006);
    if (status(r) !== 'lost') advance(8000 * 1.25);
  }
  return Date.now() - start;
}

describe('after two minutes of failures (§19.4)', () => {
  it('it stops, says lost, and dials no more', () => {
    const r = rig();
    online(r);
    const elapsed = failUntilLost(r);
    expect(status(r)).toBe('lost');
    expect(elapsed).toBeGreaterThanOrEqual(GIVE_UP_AFTER_MS);
    expect(elapsed).toBeLessThan(GIVE_UP_AFTER_MS + 20_000);
    const count = r.sockets.length;
    advance(600_000);
    expect(r.sockets).toHaveLength(count);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('"Try again" dials at once and starts the waits over', () => {
    const r = rig();
    online(r);
    failUntilLost(r);
    const count = r.sockets.length;
    r.socket.retry();
    expect(r.sockets).toHaveLength(count + 1);
    expect(status(r)).toBe('reconnecting');
    r.last().drop(1006);
    advance(FIRST_WAIT);
    expect(r.sockets).toHaveLength(count + 2);
    r.last().open();
    r.last().receive(WELCOME);
    expect(status(r)).toBe('online');
  });

  it('retry does nothing while a socket is up', () => {
    const r = rig();
    online(r);
    r.socket.retry();
    expect(r.sockets).toHaveLength(1);
    expect(status(r)).toBe('online');
  });
});

describe('a hidden page (§19.4)', () => {
  it('waits, and tries at once when it is visible again', () => {
    const r = rig();
    online(r);
    r.socket.setHidden(true);
    r.last().drop(1006);
    advance(600_000);
    expect(r.sockets).toHaveLength(1);
    expect(status(r)).toBe('reconnecting');
    r.socket.setHidden(false);
    expect(r.sockets).toHaveLength(2);
  });

  it('a try already waiting holds until the page is visible', () => {
    const r = rig();
    online(r);
    r.last().drop(1006);
    r.socket.setHidden(true);
    advance(FIRST_WAIT * 10);
    expect(r.sockets).toHaveLength(1);
    r.socket.setHidden(false);
    expect(r.sockets).toHaveLength(2);
  });

  it('time spent hidden is not two minutes of failures', () => {
    const r = rig();
    online(r);
    r.socket.setHidden(true);
    r.last().drop(1006);
    advance(GIVE_UP_AFTER_MS * 3);
    r.socket.setHidden(false);
    r.last().drop(1006);
    expect(status(r)).toBe('reconnecting');
  });

  it('keeps pinging a socket that is up', () => {
    const r = rig();
    const ws = online(r);
    r.socket.setHidden(true);
    advance(MP_PING_EVERY_MS);
    expect(pings(ws)).toBe(1);
  });

  it('showing the page does nothing when no try was due', () => {
    const r = rig();
    online(r);
    r.socket.setHidden(true);
    r.socket.setHidden(false);
    expect(r.sockets).toHaveLength(1);
  });
});

describe('closing', () => {
  it('closes the socket, stops every timer, says idle, and ignores what comes late', () => {
    const r = rig();
    const ws = online(r);
    const handlers = { message: ws.onmessage, close: ws.onclose };
    r.socket.close();
    expect(ws.closedWith).toBe(1000);
    expect(status(r)).toBe('idle');
    expect(r.socket.online).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    const count = r.messages.length;
    handlers.message?.({ data: JSON.stringify({ t: 'left' }) });
    handlers.close?.({ code: 1006 });
    advance(600_000);
    expect(r.messages).toHaveLength(count);
    expect(r.sockets).toHaveLength(1);
    expect(r.stopped).toEqual([]);
  });

  it('a timer that could not be cleared does nothing (pitfall 22)', () => {
    const noClear: Timers = { ...realTimers, clearTimeout: () => {} };
    const r = rig({ timers: noClear });
    const ws = online(r);
    ws.drop(1006); // a try is due
    r.socket.close();
    advance(600_000);
    expect(r.sockets).toHaveLength(1);
    expect(status(r)).toBe('idle');
  });

  it('it can connect again after close', () => {
    const r = rig();
    online(r);
    r.socket.close();
    r.socket.connect();
    expect(r.sockets).toHaveLength(2);
    expect(status(r)).toBe('connecting');
  });
});
