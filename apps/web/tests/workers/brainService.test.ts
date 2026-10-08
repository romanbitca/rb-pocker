/**
 * The job runner of `brain.worker` (PLAN §2.2, §8.11, §9.8, Appendix A.6): `botDecision` answers
 * with the decision and its think time, echoing the job's id and epoch; `hint` answers with the
 * coach's advice, cached by observation (LRU of 32); `grade` and `bench` answer "not available
 * yet" until chunk 6.1 and the #bench hint row; a throwing brain gives an `error` reply and the
 * runner goes on. Node, no worker globals. The last block runs the real brain (`brain/decide.ts`)
 * through the runner, as `brain.worker.ts` does.
 */
import { describe, expect, it } from 'vitest';
import { simpleDecide } from '../helpers/simpleDecide.ts';
import { coachHint, decide, hint } from '../../src/brain/decide.ts';
import type { Explanation } from '../../src/brain/explain.ts';
import { isLegalAction } from '../../src/brain/guardrails.ts';
import { profileFor } from '../../src/brain/profiles.ts';
import { thinkMs } from '../../src/brain/think.ts';
import type { Decision } from '../../src/brain/types.ts';
import { deriveSeed } from '../../src/core/rng.ts';
import { observe } from '../../src/engine/observe.ts';
import type { Observation, ObserveExtras } from '../../src/engine/types.ts';
import {
  createBrainService,
  HINT_CACHE_SIZE,
  type DecideFn,
  type HintFn,
} from '../../src/workers/brainService.ts';
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
const PROFILE = profileFor('station', 'easy');

function rig(decide: DecideFn = simpleDecide, think?: typeof thinkMs, coach?: HintFn) {
  const replies: BrainReply[] = [];
  const service = createBrainService({
    decide,
    ...(think !== undefined && { thinkMs: think }),
    ...(coach !== undefined && { hint: coach }),
    post: (reply) => replies.push(reply),
  });
  return { service, replies };
}

/** A fake coach: SimpleBot's action, with `eRandom` echoed so a test can tell calls apart. */
const fakeHint: HintFn = (obs, eRandom) => ({
  decision: { ...simpleDecide(obs), eRandom: eRandom ?? -1 },
  explanation: { headline: { key: 'headline.check', params: {} } } as unknown as Explanation,
});
/** The reply the runner posts for a coach answer. */
const hintReply = (jobId: number, epoch: number, answer: ReturnType<HintFn>) => ({
  kind: 'hint',
  jobId,
  epoch,
  decision: answer.decision,
  explanation: answer.explanation,
});

/** The same table with the hero's cards changed: another observation. */
function otherObs(i: number): Observation {
  const ranks = '23456789TJQKA';
  const hole = `${ranks[i % 13]}c ${ranks[(i + 1 + Math.floor(i / 13)) % 13]}d`;
  return observe(
    rigDeck(deal(tableWith([10000, 10000, 10000, 10000, 10000, 10000], { button: 0 })), {
      holes: { 3: hole },
    }),
    3,
    extras(6),
  );
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
    const decision = simpleDecide(OBS);
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
      return simpleDecide(OBS);
    });
    service.handle(botDecision(1, 1));
    expect(calls).toEqual([[OBS, PROFILE, SEED]]);
  });

  it('takes the think time from the injected function, given the decision, the observation and the seed', () => {
    const seen: unknown[][] = [];
    const { service, replies } = rig(simpleDecide, (obs, decision, seed) => {
      seen.push([obs, decision, seed]);
      return 1234;
    });
    service.handle(botDecision(2, 5));
    expect(seen).toEqual([[OBS, simpleDecide(OBS), SEED]]);
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
      return simpleDecide(obs);
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
    const { service, replies } = rig(simpleDecide, () => {
      throw new Error('no clock');
    });
    service.handle(botDecision(9, 2));
    expect(replies).toEqual([{ kind: 'error', jobId: 9, epoch: 2, message: 'no clock' }]);
  });

  it('passes the decision through unchanged, whatever it holds', () => {
    const custom: Decision = {
      ...simpleDecide(OBS),
      ev: { call: 12, fold: 0 },
      trace: [{ code: 'OPEN_RANGE', data: { pct: 22 } }],
    };
    const { service, replies } = rig(() => custom);
    service.handle(botDecision(1, 1));
    expect(replies[0]).toMatchObject({ kind: 'botDecision', decision: custom });
  });
});

describe('hint', () => {
  it('answers with the coach`s advice for the observation and the HUD number, echoing id and epoch', () => {
    const { service, replies } = rig(simpleDecide, undefined, fakeHint);
    service.handle({ kind: 'hint', jobId: 4, epoch: 2, obs: OBS, eRandom: 0.5 });
    expect(replies).toEqual([hintReply(4, 2, fakeHint(OBS, 0.5))]);
  });

  it('computes each observation once: the same job again answers from the cache (§8.11)', () => {
    const calls: unknown[][] = [];
    const counting: HintFn = (obs, eRandom) => {
      calls.push([obs, eRandom]);
      return fakeHint(obs, eRandom);
    };
    const { service, replies } = rig(simpleDecide, undefined, counting);
    service.handle({ kind: 'hint', jobId: 1, epoch: 1, obs: OBS, eRandom: null });
    service.handle({ kind: 'hint', jobId: 2, epoch: 2, obs: structuredClone(OBS), eRandom: null });
    expect(calls).toHaveLength(1);
    expect(replies[1]).toEqual(hintReply(2, 2, fakeHint(OBS, null)));
    // Another HUD number is another job.
    service.handle({ kind: 'hint', jobId: 3, epoch: 2, obs: OBS, eRandom: 0.25 });
    expect(calls).toHaveLength(2);
  });

  it('keeps the 32 most recently used hints', () => {
    let calls = 0;
    const counting: HintFn = (obs, eRandom) => {
      calls++;
      return fakeHint(obs, eRandom);
    };
    const { service } = rig(simpleDecide, undefined, counting);
    const ask = (i: number): void =>
      service.handle({ kind: 'hint', jobId: i, epoch: 1, obs: otherObs(i), eRandom: null });
    for (let i = 0; i <= HINT_CACHE_SIZE; i++) ask(i); // 33 observations: the first is dropped
    expect(calls).toBe(HINT_CACHE_SIZE + 1);
    ask(HINT_CACHE_SIZE); // the newest: cached
    expect(calls).toBe(HINT_CACHE_SIZE + 1);
    ask(1); // still cached; it becomes the newest
    expect(calls).toBe(HINT_CACHE_SIZE + 1);
    ask(0); // dropped: computed again
    expect(calls).toBe(HINT_CACHE_SIZE + 2);
  });

  it('turns a throwing coach into an error reply, and a worker without one answers an error', () => {
    const { service, replies } = rig(simpleDecide, undefined, () => {
      throw new Error('no table');
    });
    service.handle({ kind: 'hint', jobId: 4, epoch: 2, obs: OBS, eRandom: 0.5 });
    expect(replies).toEqual([{ kind: 'error', jobId: 4, epoch: 2, message: 'no table' }]);
    const bare = rig();
    bare.service.handle({ kind: 'hint', jobId: 5, epoch: 3, obs: OBS, eRandom: null });
    expect(bare.replies).toEqual([
      { kind: 'error', jobId: 5, epoch: 3, message: 'hint: no coach in this worker' },
    ]);
  });
});

describe('what is not there yet', () => {
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

  it('never calls decide for a hint, a grade or a bench', () => {
    let calls = 0;
    const { service } = rig(
      () => {
        calls++;
        return simpleDecide(OBS);
      },
      undefined,
      fakeHint,
    );
    service.handle({ kind: 'hint', jobId: 1, epoch: 1, obs: OBS, eRandom: null });
    service.handle({ kind: 'bench', jobId: 2 });
    expect(calls).toBe(0);
  });
});

describe('the real brain through the runner (brain.worker.ts)', () => {
  it('a bot decision is decide(obs, profile, seed), legal, with its think time', () => {
    const { service, replies } = rig(decide);
    service.handle(botDecision(1, 1));
    const decision = decide(OBS, PROFILE, SEED);
    expect(replies).toEqual([
      { kind: 'botDecision', jobId: 1, epoch: 1, decision, thinkMs: thinkMs(OBS, decision, SEED) },
    ]);
    expect(isLegalAction(OBS.legal, decision.action)).toBe(true);
  });

  it('a hint is hint(obs, eRandom), the same through a structured clone of the message', () => {
    const { service, replies } = rig(decide, undefined, coachHint);
    service.handle(structuredClone({ kind: 'hint', jobId: 1, epoch: 1, obs: OBS, eRandom: null }));
    expect(replies).toEqual([hintReply(1, 1, coachHint(OBS, null))]);
    expect(coachHint(OBS, null).decision).toEqual(hint(OBS, null));
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
