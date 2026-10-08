/**
 * The coach's hint at the hero's turn (PLAN §8.2, §8.11, §10.2, §12.6, Appendix A.6; chunk 5.7):
 * the controller asks `brain.worker` for `hint(obs, eRandom)` once per hero decision, with the
 * hero's own observation and nothing else, and writes the answer to the store's `coach` slice under
 * the decision's key; the hero's action and a new epoch cancel a hint still on its way, and a late
 * answer is dropped; no answer in 4 s, an `error` reply or a failed worker mark it 'failed'.
 * C4: the coach level changes nothing the coach is asked, so nothing it answers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HERO, realTimers } from '../../src/app/controller.ts';
import { coachKeyOf, HINT_TIMEOUT_MS } from '../../src/app/hintJobs.ts';
import { createBrainClient } from '../../src/app/workerClient.ts';
import { hint } from '../../src/brain/decide.ts';
import type { Decision } from '../../src/brain/types.ts';
import { observe } from '../../src/engine/observe.ts';
import {
  COACH_LEVELS,
  observationKey,
  type CoachLevel,
  type HandState,
  type LegalActions,
  type Observation,
  type PlayerAction,
} from '../../src/engine/types.ts';
import type { HintFn } from '../../src/workers/brainService.ts';
import type { BrainReply, BrainRequest } from '../../src/workers/protocol.ts';
import { simpleDecide } from '../helpers/simpleDecide.ts';
import { fakeBrainWorker, type FakeBrainInstance } from '../workers/fakeBrainWorker.ts';
import { elapse, flush, makeHarness, tick, type Harness } from './harness.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

type HintMsg = Extract<BrainRequest, { kind: 'hint' }>;

interface CoachBrain {
  client: ReturnType<typeof createBrainClient>;
  /** Every hint request, as the worker received it. */
  hints: HintMsg[];
  /** The job ids of every `cancel` posted. */
  cancelled: number[];
  /** Hint jobs held unanswered (`hold`). */
  held: Map<number, { msg: HintMsg; instance: FakeBrainInstance }>;
  answer(jobId: number, reply?: BrainReply): void;
}

/**
 * A brain whose bots are SimpleBot (answered at once, no think time) and whose coach is `coach`
 * (default: the real `hint`); with `hold`, hint requests wait for `answer`.
 */
function coachBrain(
  options: { coach?: HintFn; hold?: boolean; failSpawns?: number } = {},
): CoachBrain {
  const coach = options.coach ?? hint;
  const hints: HintMsg[] = [];
  const cancelled: number[] = [];
  const held = new Map<number, { msg: HintMsg; instance: FakeBrainInstance }>();
  const fake = fakeBrainWorker({
    onReceive: (msg, instance) => {
      if (msg.kind === 'botDecision') {
        const decision = simpleDecide(msg.obs);
        const { jobId, epoch } = msg;
        void Promise.resolve().then(() =>
          instance.reply({ kind: 'botDecision', jobId, epoch, decision, thinkMs: 0 }),
        );
      } else if (msg.kind === 'hint') {
        hints.push(msg);
        if (options.hold === true) {
          held.set(msg.jobId, { msg, instance });
        } else {
          const decision = coach(msg.obs, msg.eRandom);
          const { jobId, epoch } = msg;
          void Promise.resolve().then(() =>
            instance.reply({ kind: 'hint', jobId, epoch, decision }),
          );
        }
      } else if (msg.kind === 'cancel') {
        cancelled.push(msg.jobId);
      }
    },
  });
  fake.failSpawns = options.failSpawns ?? 0;
  return {
    client: createBrainClient(fake.spawn, realTimers),
    hints,
    cancelled,
    held,
    answer(jobId, reply) {
      const job = held.get(jobId);
      if (job === undefined) throw new Error(`no held hint ${jobId}`);
      held.delete(jobId);
      const { msg, instance } = job;
      instance.reply(
        reply ?? {
          kind: 'hint',
          jobId,
          epoch: msg.epoch,
          decision: coach(msg.obs, msg.eRandom),
        },
      );
    },
  };
}

const passive = (legal: LegalActions): PlayerAction =>
  legal.canCheck ? { type: 'check' } : { type: 'call' };

/** Ticks until it is the hero's turn (the hint request is posted at that moment). */
async function toHeroTurn(h: Harness): Promise<HandState> {
  for (let i = 0; i < 400; i++) {
    const s = h.state();
    if (s.game.mode === 'heroTurn' && s.game.legal !== null && s.game.hand !== null) {
      return s.game.hand;
    }
    if (s.ui.overlays.includes('outOfChips')) h.dispatch({ type: 'reload' });
    else await tick();
  }
  throw new Error('no hero turn');
}

const settings = { players: 6, startingStack: 2000, sb: 10, bb: 20 };

describe('the hint at the hero`s turn', () => {
  it('one request per hero decision, the hero`s observation only; the advice lands under its key', async () => {
    const brain = coachBrain();
    const h = makeHarness({ brain: brain.client, settings, hints: true });
    h.dispatch({ type: 'play' });
    let decisions = 0;
    for (let n = 0; n < 12; n++) {
      const hand = await toHeroTurn(h);
      await flush();
      decisions++;
      expect(brain.hints).toHaveLength(decisions);
      const req = brain.hints.at(-1) as HintMsg;
      expect(Object.keys(req).sort()).toEqual(['eRandom', 'epoch', 'jobId', 'kind', 'obs']);
      expect(req.eRandom).toBeNull(); // no HUD value yet (no equity worker here)
      expect(req.obs).toEqual(
        observe(hand, HERO, {
          seatStats: req.obs.seatStats,
          visiblePersonality: req.obs.visiblePersonality,
          seatLevels: req.obs.seatLevels,
        }),
      );
      expect(req.obs.seat).toBe(HERO);
      const coach = h.state().coach;
      expect(coach).toMatchObject({ key: coachKeyOf(hand), status: 'ready' });
      expect(coach.decision).toEqual(hint(req.obs, null));
      // Re-publishing the same decision asks nothing new.
      h.dispatch({ type: 'gate', gate: 'tip', closed: true });
      h.dispatch({ type: 'gate', gate: 'tip', closed: false });
      expect(brain.hints).toHaveLength(decisions);
      h.dispatch({ type: 'act', action: passive(h.state().game.legal as LegalActions) });
    }
    expect(brain.cancelled).toEqual([]);
  });

  it('the hero`s action cancels a hint still on its way; its late answer is dropped', async () => {
    const brain = coachBrain({ hold: true });
    const h = makeHarness({ brain: brain.client, settings, hints: true });
    h.dispatch({ type: 'play' });
    const hand = await toHeroTurn(h);
    const [job] = [...brain.held.keys()];
    expect(job).toBeDefined();
    h.dispatch({ type: 'act', action: passive(h.state().game.legal as LegalActions) });
    expect(brain.cancelled).toContain(job);
    brain.answer(job as number);
    await flush();
    expect(h.state().coach.key).not.toBe(coachKeyOf(hand));
    expect(h.state().coach.decision).toBeNull();
  });

  it('a new epoch (a new table) cancels it too', async () => {
    const brain = coachBrain({ hold: true });
    const h = makeHarness({ brain: brain.client, settings, hints: true });
    h.dispatch({ type: 'play' });
    await toHeroTurn(h);
    const [job] = [...brain.held.keys()];
    h.dispatch({ type: 'newTable', confirmed: true });
    await flush();
    expect(brain.cancelled).toContain(job);
    brain.answer(job as number);
    await flush();
    expect(h.state().coach.decision).toBeNull();
  });

  it('no answer in 4 s, or an error reply, marks the decision failed', async () => {
    const brain = coachBrain({ hold: true });
    const h = makeHarness({ brain: brain.client, settings, hints: true });
    h.dispatch({ type: 'play' });
    const hand = await toHeroTurn(h);
    await elapse(HINT_TIMEOUT_MS - 1);
    expect(h.state().coach.status).toBe('idle');
    await elapse(1);
    expect(h.state().coach).toMatchObject({
      key: coachKeyOf(hand),
      status: 'failed',
      decision: null,
    });

    h.dispatch({ type: 'act', action: passive(h.state().game.legal as LegalActions) });
    const next = await toHeroTurn(h);
    const job = [...brain.held.keys()].at(-1) as number;
    const { epoch } = brain.held.get(job)?.msg as HintMsg;
    brain.answer(job, { kind: 'error', jobId: job, epoch, message: 'boom' });
    await flush();
    expect(h.state().coach).toMatchObject({ key: coachKeyOf(next), status: 'failed' });
  });

  it('with no brain worker at all, the coach is failed at once and the bots still play', async () => {
    const brain = coachBrain({ failSpawns: 10 });
    expect(brain.client.status).toBe('failed');
    const h = makeHarness({ brain: brain.client, settings, hints: true });
    h.dispatch({ type: 'play' });
    const hand = await toHeroTurn(h);
    await flush();
    expect(h.state().coach).toMatchObject({ key: coachKeyOf(hand), status: 'failed' });
    expect(brain.hints).toEqual([]);
  });

  it('off by default: a controller without hints posts none', async () => {
    const brain = coachBrain();
    const h = makeHarness({ brain: brain.client, settings });
    h.dispatch({ type: 'play' });
    await toHeroTurn(h);
    await flush();
    expect(brain.hints).toEqual([]);
    expect(h.state().coach).toMatchObject({ key: null, status: 'idle' });
  });
});

describe('C4: the coach level never changes the advice', () => {
  it(
    'the same game at each coach level asks the same hints and gets the same advice (2,000 decisions)',
    { timeout: 300_000 },
    async () => {
      // A cheap, deterministic stand-in for the coach: a pure function of what it is asked (the
      // real hint is a pure function of the same inputs, C3, checked at 2,000 decision points in
      // tests/brain/hint.property.test.ts).
      const coach: HintFn = (obs: Observation, eRandom) => ({
        ...simpleDecide(obs),
        eRandom: eRandom ?? -1,
        trace: [{ code: 'OPEN_RANGE', data: { key: observationKey(obs) } }],
      });
      const DECISIONS = 2000;
      const games: { requests: string[]; advice: (Decision | null)[] }[] = [];
      for (const level of COACH_LEVELS as readonly CoachLevel[]) {
        const brain = coachBrain({ coach });
        const h = makeHarness({
          brain: brain.client,
          settings: { ...settings, coachLevel: level },
          hints: true,
        });
        h.dispatch({ type: 'play' });
        const advice: (Decision | null)[] = [];
        while (advice.length < DECISIONS) {
          await toHeroTurn(h);
          await flush();
          advice.push(h.state().coach.decision);
          h.dispatch({ type: 'act', action: passive(h.state().game.legal as LegalActions) });
        }
        expect(h.state().settings.coachLevel).toBe(level);
        games.push({
          requests: brain.hints.slice(0, DECISIONS).map((m) => JSON.stringify([m.obs, m.eRandom])),
          advice,
        });
        h.controller.dispose();
      }
      const [first, ...others] = games as [(typeof games)[number], ...typeof games];
      expect(first.requests).toHaveLength(DECISIONS);
      for (const g of others) {
        expect(g.requests).toEqual(first.requests);
        expect(g.advice).toEqual(first.advice);
      }
    },
  );
});
