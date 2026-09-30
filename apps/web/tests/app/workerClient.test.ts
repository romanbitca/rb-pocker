/**
 * The worker client (PLAN §2.2, §12.14, Appendix A.6, pitfall 22; Stage 4 acceptance 2): job ids,
 * epochs, cancel, stale-reply drop, the latest job per slot, timeouts, restart on crash, the log.
 * A fake worker in manual mode: the test decides what the worker answers, and when.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EquityResult } from '../../src/analysis/types.ts';
import { realTimers } from '../../src/app/controller.ts';
import {
  createEquityClient,
  EQUITY_TIMEOUT_MS,
  equityReplyIsFinal,
  equitySummary,
  fromWorker,
  startEquityWorker,
  type EquityClient,
  type JobEvent,
} from '../../src/app/workerClient.ts';
import type { EquityReply, EquityRequest } from '../../src/workers/protocol.ts';
import { fakeWorker, type FakeWorker } from '../workers/fakeWorker.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const AH_KH: [number, number] = [50, 46];

function result(n: number, equity: number, final: boolean): EquityResult {
  return { n, win: equity, split: 0, equity, exact: false, final, truncated: false };
}

interface Recorded {
  events: JobEvent<EquityReply>[];
  onEvent: (event: JobEvent<EquityReply>) => void;
}

function recorder(): Recorded {
  const events: JobEvent<EquityReply>[] = [];
  return { events, onEvent: (event) => events.push(event) };
}

/** Sends an `equity` job for `epoch` in `slot`. */
function equityJob(
  client: EquityClient,
  rec: Recorded,
  epoch = 1,
  slot = 'equity',
  nOpp = 2,
): number | null {
  return client.request({
    slot,
    epoch,
    timeoutMs: EQUITY_TIMEOUT_MS,
    build: (jobId): EquityRequest => ({
      kind: 'equity',
      jobId,
      epoch,
      hero: AH_KH,
      board: [],
      nOpp,
    }),
    onEvent: rec.onEvent,
  });
}

const progress = (jobId: number, epoch: number, n: number, eq: number): EquityReply => ({
  kind: 'equity',
  jobId,
  epoch,
  result: result(n, eq, false),
});
const final = (jobId: number, epoch: number, eq: number): EquityReply => ({
  kind: 'equity',
  jobId,
  epoch,
  result: result(40_000, eq, true),
});

const replies = (rec: Recorded): EquityReply[] =>
  rec.events.flatMap((e) => (e.type === 'reply' ? [e.reply] : []));

let fake: FakeWorker;
let client: EquityClient;

beforeEach(() => {
  fake = fakeWorker();
  client = createEquityClient(fake.spawn, realTimers);
});

describe('jobs', () => {
  it('numbers jobs, posts them with their epoch, and delivers progress then the final reply', () => {
    const rec = recorder();
    const a = equityJob(client, rec, 3);
    const b = equityJob(client, recorder(), 3, 'other');
    expect(a).toBe(1);
    expect(b).toBe(2);
    expect(fake.current().received[0]).toEqual({
      kind: 'equity',
      jobId: 1,
      epoch: 3,
      hero: AH_KH,
      board: [],
      nOpp: 2,
    });
    fake.current().reply(progress(1, 3, 2_500, 0.61));
    fake.current().reply(progress(1, 3, 10_000, 0.62));
    fake.current().reply(final(1, 3, 0.625));
    expect(rec.events.map((e) => e.type === 'reply' && e.final)).toEqual([false, false, true]);
    expect(replies(rec).map((r) => r.kind === 'equity' && r.result.n)).toEqual([
      2_500, 10_000, 40_000,
    ]);
    // Finished: anything more for this job is dropped.
    fake.current().reply(final(1, 3, 0.9));
    expect(rec.events).toHaveLength(3);
    expect(client.pending()).toEqual([2]);
  });

  it('treats an error reply as the last one', () => {
    const rec = recorder();
    const id = equityJob(client, rec) as number;
    fake.current().reply({ kind: 'error', jobId: id, epoch: 1, message: 'bad cards' });
    expect(rec.events).toEqual([
      {
        type: 'reply',
        reply: { kind: 'error', jobId: id, epoch: 1, message: 'bad cards' },
        final: true,
      },
    ]);
    expect(client.pending()).toEqual([]);
  });

  it('knows which replies are final', () => {
    expect(equityReplyIsFinal(progress(1, 1, 2_500, 0.5))).toBe(false);
    expect(equityReplyIsFinal(final(1, 1, 0.5))).toBe(true);
    const known = { kind: 'equityKnown', jobId: 1, epoch: 1, perPlayer: [0.5, 0.5], exact: true };
    expect(equityReplyIsFinal({ ...known, final: false } as EquityReply)).toBe(false);
    expect(equityReplyIsFinal({ ...known, final: true } as EquityReply)).toBe(true);
    expect(equityReplyIsFinal({ kind: 'error', jobId: 1, epoch: 1, message: '' })).toBe(true);
  });
});

describe('cancel (acceptance 2: a cancelled job never posts again)', () => {
  it('sends cancel and never calls the job again, whatever the worker still sends', () => {
    const rec = recorder();
    const id = equityJob(client, rec) as number;
    fake.current().reply(progress(id, 1, 2_500, 0.4));
    client.cancel(id);
    expect(fake.current().received.at(-1)).toEqual({ kind: 'cancel', jobId: id });
    fake.current().reply(progress(id, 1, 10_000, 0.41));
    fake.current().reply(final(id, 1, 0.42));
    expect(rec.events).toHaveLength(1);
    expect(client.log().filter((e) => e.what === 'drop')).toHaveLength(2);
    // Its timeout is gone too: no timeout event later.
    vi.advanceTimersByTime(EQUITY_TIMEOUT_MS * 2);
    expect(rec.events).toHaveLength(1);
  });

  it('a new job in the same slot cancels the old one; the old one is never delivered', () => {
    const old = recorder();
    const oldId = equityJob(client, old, 1, 'equity', 3) as number;
    const cur = recorder();
    const newId = equityJob(client, cur, 1, 'equity', 2) as number;
    expect(fake.current().received.map((m) => m.kind)).toEqual(['equity', 'cancel', 'equity']);
    fake.current().reply(final(oldId, 1, 0.3));
    fake.current().reply(final(newId, 1, 0.5));
    expect(old.events).toEqual([]);
    expect(replies(cur)).toHaveLength(1);
  });

  it('cancelAll cancels every pending job', () => {
    const recs = [recorder(), recorder(), recorder()];
    const ids = recs.map((rec, i) => equityJob(client, rec, 1, `slot${i}`) as number);
    client.cancelAll();
    expect(client.pending()).toEqual([]);
    const cancels = fake.current().received.filter((m) => m.kind === 'cancel');
    expect(cancels.map((m) => m.jobId)).toEqual(ids);
    for (const id of ids) fake.current().reply(final(id, 1, 0.5));
    for (const rec of recs) expect(rec.events).toEqual([]);
  });
});

describe('epochs (acceptance 2: a stale reply is never delivered)', () => {
  it('a newer epoch cancels older jobs and drops their replies', () => {
    const rec = recorder();
    const id = equityJob(client, rec, 1) as number;
    client.setEpoch(2);
    expect(fake.current().received.at(-1)).toEqual({ kind: 'cancel', jobId: id });
    fake.current().reply(progress(id, 1, 2_500, 0.5));
    fake.current().reply(final(id, 1, 0.5));
    expect(rec.events).toEqual([]);
  });

  it('a request for a newer epoch makes it current and cancels the older jobs of every slot', () => {
    const old = recorder();
    const oldId = equityJob(client, old, 1, 'a') as number;
    const cur = recorder();
    const newId = equityJob(client, cur, 2, 'b') as number;
    expect(client.epoch).toBe(2);
    fake.current().reply(final(oldId, 1, 0.1));
    fake.current().reply(final(newId, 2, 0.2));
    expect(old.events).toEqual([]);
    expect(replies(cur)).toHaveLength(1);
  });

  it('refuses a request for an older epoch', () => {
    client.setEpoch(5);
    const rec = recorder();
    expect(equityJob(client, rec, 4)).toBeNull();
    expect(fake.current().received).toEqual([]);
    expect(client.log().at(-1)?.what).toBe('refused');
  });

  it('drops a reply whose epoch does not match its job', () => {
    const rec = recorder();
    const id = equityJob(client, rec, 7) as number;
    fake.current().reply(final(id, 6, 0.5));
    fake.current().reply({ kind: 'handInfo', jobId: id, epoch: 7 } as unknown as EquityReply);
    expect(rec.events).toEqual([]);
    fake.current().reply(final(id, 7, 0.5));
    expect(replies(rec)).toHaveLength(1);
  });

  it('drops replies for unknown jobs', () => {
    fake.current().reply(final(99, 0, 0.5));
    expect(client.log().at(-1)).toMatchObject({ what: 'drop', jobId: 99 });
  });
});

describe('timeouts and crashes (§12.14)', () => {
  it('a timeout gives the failure state: the job gets `timeout`, and the worker a cancel', () => {
    const rec = recorder();
    const id = equityJob(client, rec) as number;
    fake.current().reply(progress(id, 1, 2_500, 0.5)); // progress does not stop the clock
    vi.advanceTimersByTime(EQUITY_TIMEOUT_MS - 1);
    expect(rec.events).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(rec.events.at(-1)).toEqual({ type: 'timeout' });
    expect(fake.current().received.at(-1)).toEqual({ kind: 'cancel', jobId: id });
    // A late final reply is dropped.
    fake.current().reply(final(id, 1, 0.5));
    expect(rec.events).toHaveLength(2);
    expect(client.status).toBe('ready');
    expect(fake.instances).toHaveLength(1);
  });

  it('a reply between two timeouts resets the count', () => {
    equityJob(client, recorder());
    vi.advanceTimersByTime(EQUITY_TIMEOUT_MS);
    const id = equityJob(client, recorder()) as number;
    fake.current().reply(final(id, 1, 0.5));
    equityJob(client, recorder());
    vi.advanceTimersByTime(EQUITY_TIMEOUT_MS);
    expect(fake.instances).toHaveLength(1);
  });

  it('two timeouts in a row restart the worker once; two more make the client fail', () => {
    const recs = [recorder(), recorder()];
    equityJob(client, recs[0] as Recorded, 1, 'a');
    vi.advanceTimersByTime(EQUITY_TIMEOUT_MS);
    const pending = recorder();
    const oldId = equityJob(client, recs[1] as Recorded, 1, 'b') as number;
    equityJob(client, pending, 1, 'c'); // pending when the worker is replaced
    vi.advanceTimersByTime(EQUITY_TIMEOUT_MS);
    expect(fake.instances).toHaveLength(2);
    expect(fake.instances[0]?.terminated).toBe(true);
    expect(client.restartCount).toBe(1);
    expect(client.status).toBe('ready');
    expect(pending.events.at(-1)).toMatchObject({ type: 'failed' });
    // Nothing from the old worker is delivered.
    fake.instances[0]?.reply(final(oldId, 1, 0.5));
    expect(recs[1]?.events).toEqual([{ type: 'timeout' }]);

    equityJob(client, recorder(), 1, 'a');
    vi.advanceTimersByTime(EQUITY_TIMEOUT_MS);
    equityJob(client, recorder(), 1, 'a');
    vi.advanceTimersByTime(EQUITY_TIMEOUT_MS);
    expect(client.status).toBe('failed');
    expect(fake.instances[1]?.terminated).toBe(true);
    expect(fake.instances).toHaveLength(2);
    expect(equityJob(client, recorder())).toBeNull();
    expect(client.log().map((e) => e.what)).toContain('failed');
  });

  it('an error event restarts the worker once and fails the pending jobs; a second one fails', () => {
    const rec = recorder();
    equityJob(client, rec);
    fake.current().crash('out of memory');
    expect(rec.events).toEqual([{ type: 'failed', reason: 'out of memory' }]);
    expect(fake.instances).toHaveLength(2);
    expect(client.status).toBe('ready');
    const next = recorder();
    const id = equityJob(client, next) as number;
    fake.current().reply(final(id, 1, 0.7));
    expect(replies(next)).toHaveLength(1);
    fake.current().crash();
    expect(client.status).toBe('failed');
    expect(equityJob(client, recorder())).toBeNull();
    // An error from an old worker changes nothing.
    fake.instances[0]?.crash();
    expect(fake.instances).toHaveLength(2);
  });

  it('retry() starts a fresh worker after `failed`', () => {
    fake.current().crash();
    fake.current().crash();
    expect(client.status).toBe('failed');
    client.retry();
    expect(client.status).toBe('ready');
    expect(fake.instances).toHaveLength(3);
    const rec = recorder();
    const id = equityJob(client, rec) as number;
    fake.current().reply(final(id, 1, 0.5));
    expect(replies(rec)).toHaveLength(1);
  });

  it('fails when no worker can be started (no module workers), after one more try', () => {
    const noWorkers = fakeWorker();
    noWorkers.failSpawns = 2;
    const c = createEquityClient(noWorkers.spawn, realTimers);
    expect(c.status).toBe('failed');
    expect(c.restartCount).toBe(1);
    expect(equityJob(c, recorder())).toBeNull();
  });

  it('dispose() cancels everything and terminates the worker', () => {
    const rec = recorder();
    const id = equityJob(client, rec) as number;
    client.dispose();
    expect(fake.current().terminated).toBe(true);
    fake.current().reply(final(id, 1, 0.5));
    expect(rec.events).toEqual([]);
    expect(equityJob(client, recorder())).toBeNull();
  });
});

describe('the log', () => {
  it('records what went out and came back, without card data', () => {
    const id = equityJob(client, recorder(), 2) as number;
    fake.current().reply(final(id, 2, 0.5));
    client.cancel(id); // already finished: nothing to send
    const log = client.log();
    expect(log.map(({ what, kind, jobId, epoch }) => ({ what, kind, jobId, epoch }))).toEqual([
      { what: 'out', kind: 'equity', jobId: id, epoch: 2 },
      { what: 'in', kind: 'equity', jobId: id, epoch: 2 },
    ]);
    expect(JSON.stringify(log)).not.toContain('hero');
  });

  it('keeps what a request is about (no cards) and each reply’s worker timing (§15.3)', () => {
    const id = equityJob(client, recorder(), 3) as number;
    fake.current().reply({ ...progress(id, 3, 2_500, 0.4), timing: { ms: 12.5, busyMs: 9 } });
    fake.current().reply({ ...final(id, 3, 0.41), timing: { ms: 40, busyMs: 31.5 } });
    const log = client.log();
    expect(log[0]).toMatchObject({ what: 'out', kind: 'equity', detail: expect.any(String) });
    expect(log.slice(1).map((e) => e.timing)).toEqual([
      { ms: 12.5, busyMs: 9, final: false },
      { ms: 40, busyMs: 31.5, final: true },
    ]);
    // The summary names sizes, never cards.
    expect(
      equitySummary({ kind: 'equity', jobId: 1, epoch: 1, hero: AH_KH, board: [1, 2, 3], nOpp: 5 }),
    ).toBe('board 3 · 5 opponents');
    expect(
      equitySummary({ kind: 'equityKnown', jobId: 1, epoch: 1, hands: [AH_KH, [0, 1]], board: [] }),
    ).toBe('board 0 · 2 hands');
    expect(equitySummary({ kind: 'handInfo', jobId: 1, epoch: 1, hero: AH_KH, board: [9] })).toBe(
      'board 1',
    );
    expect(equitySummary({ kind: 'cancel', jobId: 1 })).toBeUndefined();
  });

  it('keeps the last 200 lines', () => {
    for (let i = 0; i < 150; i++) equityJob(client, recorder()); // each: cancel + equity
    expect(client.log()).toHaveLength(200);
  });
});

describe('the real worker', () => {
  it('fromWorker routes message, error and messageerror events (and handles the error)', () => {
    const worker = {
      onmessage: null as ((e: { data: unknown }) => void) | null,
      onerror: null as ((e: { message: string; preventDefault(): void }) => void) | null,
      onmessageerror: null as (() => void) | null,
      postMessage: vi.fn(),
      terminate: vi.fn(),
    };
    const events = { message: vi.fn(), error: vi.fn() };
    const port = fromWorker<EquityRequest, EquityReply>(() => worker as unknown as Worker)(events);
    expect(port).toBe(worker);
    worker.onmessage?.({ data: { kind: 'handInfo', jobId: 1 } });
    expect(events.message).toHaveBeenCalledWith({ kind: 'handInfo', jobId: 1 });
    const preventDefault = vi.fn();
    worker.onerror?.({ message: 'Script error', preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    worker.onerror?.({ message: '', preventDefault });
    worker.onmessageerror?.();
    expect(events.error.mock.calls).toEqual([['Script error'], ['worker error'], ['messageerror']]);
  });

  it('without module workers (Node, jsdom, old browsers) the client fails after one retry', () => {
    expect(typeof globalThis.Worker).toBe('undefined');
    const c = startEquityWorker(realTimers);
    expect(c.status).toBe('failed');
    expect(c.restartCount).toBe(1);
    expect(c.log().map((e) => e.what)).toEqual(['crash', 'restart', 'crash', 'failed']);
  });
});
