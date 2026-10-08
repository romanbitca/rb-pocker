/**
 * The job runner of `brain.worker` (PLAN §2.2, §9.8, Appendix A.6): `botDecision` answers with the
 * decision and its think time, echoing the job's id and epoch; `hint`, `grade` and `bench` answer
 * "not available yet" until chunks 5.7, 6.1 and the #bench hint row; a throwing brain gives an
 * `error` reply and the runner goes on. Node, no worker globals.
 */
import { describe, expect, it } from 'vitest';
import { decide as standInDecide } from '../../src/brain/standIn.ts';
import { thinkMs } from '../../src/brain/think.ts';
import type { Decision } from '../../src/brain/types.ts';
import { deriveSeed } from '../../src/core/rng.ts';
import { observe } from '../../src/engine/observe.ts';
import type { Observation, ObserveExtras } from '../../src/engine/types.ts';
import { createBrainService, type DecideFn } from '../../src/workers/brainService.ts';
import type { BrainReply, BrainRequest } from '../../src/workers/protocol.ts';
import { deal, rigDeck, tableWith } from '../engine/helpers.ts';

const extras = (n: number): ObserveExtras => ({
  seatStats: new Array(n).fill(null),
  visiblePersonality: new Array(n).fill(null),
  seatLevels: new Array(n).fill('easy'),
});

/** Seat 3 (UTG, six seats, 50/100) with a pair of sevens: raise to 300. */
const OBS: Observation = observe(
  rigDeck(deal(tableWith([10000, 10000, 10000, 10000, 10000, 10000], { button: 0 })), {
    holes: { 3: '7c 7d' },
  }),
  3,
  extras(6),
);
const SEED = deriveSeed('0123456789abcdef0123456789abcdef', 'bot', 1, 3, 2);
const PROFILE = { id: 'station/easy' };

function rig(decide: DecideFn = standInDecide, think?: typeof thinkMs) {
  const replies: BrainReply[] = [];
  const service = createBrainService({
    decide,
    ...(think !== undefined && { thinkMs: think }),
    post: (reply) => replies.push(reply),
  });
  return { service, replies };
}

const botDecision = (jobId: number, epoch: number): BrainRequest => ({
  kind: 'botDecision',
  jobId,
  epoch,
  obs: OBS,
  profile: PROFILE,
  seed: SEED,
});

describe('botDecision', () => {
  it('answers with the decision and its think time, echoing the job id and the epoch', () => {
    const { service, replies } = rig();
    service.handle(botDecision(7, 3));
    const decision = standInDecide(OBS);
    expect(replies).toEqual([
      {
        kind: 'botDecision',
        jobId: 7,
        epoch: 3,
        decision,
        thinkMs: thinkMs(OBS, decision, SEED),
      },
    ]);
    expect(decision.action).toEqual({ type: 'raise', to: 300 });
    expect(replies[0]).toMatchObject({ thinkMs: expect.any(Number) });
  });

  it('hands decide the observation, the profile and the seed exactly as sent', () => {
    const calls: unknown[][] = [];
    const { service } = rig((...args) => {
      calls.push(args);
      return standInDecide(OBS);
    });
    service.handle(botDecision(1, 1));
    expect(calls).toEqual([[OBS, PROFILE, SEED]]);
  });

  it('takes the think time from the injected function, given the decision, the observation and the seed', () => {
    const seen: unknown[][] = [];
    const { service, replies } = rig(standInDecide, (obs, decision, seed) => {
      seen.push([obs, decision, seed]);
      return 1234;
    });
    service.handle(botDecision(2, 5));
    expect(seen).toEqual([[OBS, standInDecide(OBS), SEED]]);
    expect(replies[0]).toMatchObject({ kind: 'botDecision', thinkMs: 1234 });
  });

  it('answers each job once, in the order of the messages', () => {
    const { service, replies } = rig();
    service.handle(botDecision(1, 1));
    service.handle(botDecision(2, 1));
    service.handle(botDecision(3, 2));
    expect(replies.map((r) => [r.kind, r.jobId, 'epoch' in r ? r.epoch : null])).toEqual([
      ['botDecision', 1, 1],
      ['botDecision', 2, 1],
      ['botDecision', 3, 2],
    ]);
  });

  it('turns a throwing brain into an error reply for that job, and carries on', () => {
    let calls = 0;
    const { service, replies } = rig((obs) => {
      if (++calls === 1) throw new Error('boom');
      return standInDecide(obs);
    });
    service.handle(botDecision(1, 4));
    service.handle(botDecision(2, 4));
    expect(replies[0]).toEqual({ kind: 'error', jobId: 1, epoch: 4, message: 'boom' });
    expect(replies[1]).toMatchObject({ kind: 'botDecision', jobId: 2, epoch: 4 });
  });

  it('turns a thrown non-Error into text', () => {
    const { service, replies } = rig(() => {
      throw 'plain text';
    });
    service.handle(botDecision(1, 1));
    expect(replies).toEqual([{ kind: 'error', jobId: 1, epoch: 1, message: 'plain text' }]);
  });

  it('turns a throwing think time into an error reply too', () => {
    const { service, replies } = rig(standInDecide, () => {
      throw new Error('no clock');
    });
    service.handle(botDecision(9, 2));
    expect(replies).toEqual([{ kind: 'error', jobId: 9, epoch: 2, message: 'no clock' }]);
  });

  it('passes the decision through unchanged, whatever it holds', () => {
    const custom: Decision = {
      ...standInDecide(OBS),
      ev: { call: 12, fold: 0 },
      trace: [{ code: 'OPEN_RANGE', data: { pct: 22 } }],
    };
    const { service, replies } = rig(() => custom);
    service.handle(botDecision(1, 1));
    expect(replies[0]).toMatchObject({ kind: 'botDecision', decision: custom });
  });
});

describe('what is not there yet', () => {
  it('answers hint with an error (chunk 5.7)', () => {
    const { service, replies } = rig();
    service.handle({ kind: 'hint', jobId: 4, epoch: 2, obs: OBS, eRandom: 0.5 });
    expect(replies).toEqual([
      { kind: 'error', jobId: 4, epoch: 2, message: 'hint: not available yet' },
    ]);
  });

  it('answers grade with an error (chunk 6.1)', () => {
    const { service, replies } = rig();
    service.handle({
      kind: 'grade',
      jobId: 5,
      epoch: 2,
      obs: OBS,
      taken: { type: 'fold' },
      eRandom: null,
      decisionId: 11,
    });
    expect(replies).toEqual([
      { kind: 'error', jobId: 5, epoch: 2, message: 'grade: not available yet' },
    ]);
  });

  it('answers bench with an error for epoch 0', () => {
    const { service, replies } = rig();
    service.handle({ kind: 'bench', jobId: 6 });
    expect(replies).toEqual([
      { kind: 'error', jobId: 6, epoch: 0, message: 'bench: not available yet' },
    ]);
  });

  it('never calls the brain for them', () => {
    let calls = 0;
    const { service } = rig(() => {
      calls++;
      return standInDecide(OBS);
    });
    service.handle({ kind: 'hint', jobId: 1, epoch: 1, obs: OBS, eRandom: null });
    service.handle({ kind: 'bench', jobId: 2 });
    expect(calls).toBe(0);
  });
});

describe('cancel', () => {
  it('posts nothing: every job has finished inside its own message', () => {
    const { service, replies } = rig();
    service.handle(botDecision(1, 1));
    service.handle({ kind: 'cancel', jobId: 1 });
    service.handle({ kind: 'cancel', jobId: 99 });
    expect(replies).toHaveLength(1);
  });
});
