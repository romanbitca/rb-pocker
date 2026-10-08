/**
 * The controller's bot path through `brain.worker` (PLAN §2.2, §2.4, §9.6, §9.8, §12.14,
 * Appendix A.6; chunk 5.8): what is posted to the worker, the bot seed, stale replies, think time,
 * and what happens when the worker is killed, silent or gone. A fake worker runs the production job
 * runner (`brainService.ts`) with the stand-in brain, or answers only when the test says so.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { botSeed, HERO, realTimers, TIMING } from '../../src/app/controller.ts';
import type { SeedSource } from '../../src/app/controller.ts';
import { createBrainClient } from '../../src/app/workerClient.ts';
import { decide as standInDecide } from '../../src/brain/standIn.ts';
import { thinkMs } from '../../src/brain/think.ts';
import type { Card } from '../../src/core/cards.ts';
import { deriveSeed, type Seed128 } from '../../src/core/rng.ts';
import { legalActions } from '../../src/engine/legal.ts';
import { observe } from '../../src/engine/observe.ts';
import type {
  EngineInput,
  HandState,
  LegalActions,
  PlayerAction,
  TableState,
} from '../../src/engine/types.ts';
import { fakeBrainWorker, type FakeBrainInstance } from '../workers/fakeBrainWorker.ts';
import {
  drive,
  elapse,
  flush,
  heroPolicy,
  makeHarness,
  manualBrain,
  spyBrain,
  tick,
  type BotDecisionMsg,
  type Harness,
  type ManualBrain,
} from './harness.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const passive = (legal: LegalActions): PlayerAction =>
  legal.canCheck ? { type: 'check' } : { type: 'call' };

/** §4.5, §12.14 spelled out (not the controller's own `safestAction`): check when free, else fold. */
const safest = (legal: LegalActions): PlayerAction =>
  legal.canCheck ? { type: 'check' } : { type: 'fold' };

/** Jams every decision, so showdowns and run-outs (revealed cards) come often. */
const jam = (legal: LegalActions): PlayerAction => {
  if (legal.raise !== null) return { type: 'raise', to: legal.raise.max };
  if (legal.bet !== null) return { type: 'bet', to: legal.bet.max };
  return passive(legal);
};

const inputsOf = (h: Harness): EngineInput[] => h.controller.snapshot().inputs;

/** The hero checks or calls until a bot is to act (its request is sent at that moment). */
async function toBotTurn(h: Harness): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const s = h.state();
    if (s.game.mode === 'botTurn') return;
    if (s.game.mode === 'heroTurn' && s.game.legal !== null) {
      h.dispatch({ type: 'act', action: passive(s.game.legal) });
    } else {
      await tick();
    }
  }
  throw new Error('no bot turn');
}

/** Runs timers until the controller has applied `count` inputs in this hand. */
async function untilInputs(h: Harness, count: number): Promise<void> {
  for (let i = 0; i < 50 && inputsOf(h).length < count; i++) await tick();
  expect(inputsOf(h).length).toBeGreaterThanOrEqual(count);
}

/**
 * Plays on (the hero checks or calls) until a request reaches `instance` and is still unanswered;
 * returns it.
 */
async function untilRequestTo(
  h: Harness,
  instance: FakeBrainInstance,
  brain: ManualBrain,
): Promise<BotDecisionMsg> {
  for (let i = 0; i < 200; i++) {
    const found = [...brain.pending.values()].find((p) => p.instance === instance);
    if (found !== undefined) return found.req;
    const s = h.state();
    if (s.game.mode === 'heroTurn' && s.game.legal !== null) {
      h.dispatch({ type: 'act', action: passive(s.game.legal) });
    } else {
      await tick();
    }
  }
  throw new Error('no request reached the worker');
}

/** Every bot action the controller applies from now on, with the legal actions it had. */
function watchBotActs(h: Harness): { seat: number; action: PlayerAction; legal: LegalActions }[] {
  const acts: { seat: number; action: PlayerAction; legal: LegalActions }[] = [];
  h.store.subscribe((s, prev) => {
    const hand = s.game.hand;
    const before = prev.game.hand;
    if (hand === null || before === null || hand === before || hand.handSeq !== before.handSeq) {
      return;
    }
    const input = h.controller.snapshot().inputs.at(-1);
    if (input === undefined || input.kind !== 'act' || input.seat === HERO) return;
    const legal = legalActions(before);
    if (legal !== null) acts.push({ seat: input.seat, action: input.action, legal });
  });
  return acts;
}

/** Every key at every depth of a JSON value. */
function keysOf(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, into));
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      into.add(k);
      keysOf(v, into);
    }
  }
  return into;
}

/** What a `HandState` has and an `Observation` does not (§4.8). */
const HAND_STATE_ONLY_KEYS = [
  'schema', 'engineVersion', 'seed', 'seats', 'phase', 'deck', 'deckPos', 'currentBet',
  'minRaiseInc', 'lastAggressor', 'preflopAggressor', 'toAct', 'runout', 'revealed',
  'undoneDecisions', 'startTotal', 'startStacks', 'log', 'result',
]; // prettier-ignore

const OBS_KEYS = [
  'allIn', 'bb', 'bbSeat', 'board', 'button', 'dealtIn', 'folded', 'handSeq', 'history', 'hole',
  'legal', 'pot', 'revealedHoles', 'sb', 'sbSeat', 'seat', 'seatLevels', 'seatStats', 'stacks',
  'street', 'streetBets', 'totalBets', 'visiblePersonality',
]; // prettier-ignore

interface Seen {
  msg: BotDecisionMsg;
  hand: HandState;
  table: TableState;
}

describe('what is posted to brain.worker (§2.2, §9.6, pitfall 13; Stage 5 acceptance 4 part)', () => {
  it('over 40 seeded hands, nothing but an Observation, a profile id and a table-only seed goes out', async () => {
    const seen: Seen[] = [];
    let h: Harness | null = null;
    const spy = spyBrain((msg) => {
      const snap = (h as Harness).controller.snapshot();
      seen.push({ msg, hand: snap.hand as HandState, table: snap.table as TableState });
    });
    h = makeHarness({
      brain: spy.client,
      settings: { players: 9, startingStack: 400, sb: 10, bb: 20 },
    });
    h.dispatch({ type: 'play' });
    // The hero jams half the time, so run-outs and showdowns (public cards) are in the sample.
    const hero = heroPolicy(deriveSeed(`${'0'.repeat(31)}b`, 'hero'));
    let jams = 0;
    await drive(h, {
      hands: 40,
      hero: (legal) => (jams++ % 2 === 0 ? jam(legal) : hero(legal)),
    });
    const posted = spy.fake.received;
    expect(seen.length).toBeGreaterThan(250);
    expect(posted.filter((m) => m.kind === 'botDecision')).toHaveLength(seen.length);

    // Every message, whatever its kind: a botDecision or a bare cancel; never a HandState.
    for (const msg of posted) {
      expect(['botDecision', 'cancel']).toContain(msg.kind);
      if (msg.kind === 'cancel') expect(Object.keys(msg).sort()).toEqual(['jobId', 'kind']);
    }

    for (const { msg, hand, table } of seen) {
      expect(Object.keys(msg).sort()).toEqual(['epoch', 'jobId', 'kind', 'obs', 'profile', 'seed']);
      expect(Object.keys(msg.profile)).toEqual(['id']);
      expect(msg.profile.id).toBe(`${table.slots[msg.obs.seat]?.personality}/easy`);
      expect(Object.keys(msg.obs).sort()).toEqual(OBS_KEYS);

      // No HandState field at any depth, and nothing that is the hand seed or contains it.
      const keys = keysOf({ obs: msg.obs, profile: msg.profile });
      for (const key of HAND_STATE_ONLY_KEYS) expect(keys.has(key)).toBe(false);
      const text = JSON.stringify(msg);
      expect(text).not.toContain(hand.seed);
      expect(msg.seed).not.toBe(hand.seed);
      expect(msg.seed).toBe(botSeed(table.tableSeed, hand.handSeq, msg.obs.seat, hand.log.length));

      // The observation is exactly what observe() gives for that seat at that moment.
      const { obs } = msg;
      expect(obs).toEqual(
        observe(hand, obs.seat, {
          seatStats: obs.seatStats,
          visiblePersonality: obs.visiblePersonality,
          seatLevels: obs.seatLevels,
        }),
      );
      expect(obs.seat).not.toBe(HERO);
      expect(hand.toAct).toBe(obs.seat);

      // Cards: the bot's own, the board, and the hands that are public by rule. No other card.
      const hidden = new Set<Card>();
      hand.seats.forEach((s, i) => {
        if (i === obs.seat || hand.revealed.includes(i)) return;
        for (const card of s.hole ?? []) hidden.add(card);
      });
      const shown = [...obs.hole, ...obs.board, ...obs.revealedHoles.flatMap((x) => x ?? [])];
      for (const card of shown) expect(hidden.has(card)).toBe(false);
      expect(obs.hole).toEqual(hand.seats[obs.seat]?.hole);
      // (Bots never decide after a reveal, since nobody can bet then: these are all null.)
      obs.revealedHoles.forEach((hole, i) => {
        if (hole === null) return;
        expect(hand.revealed).toContain(i);
        expect(hole).toEqual(hand.seats[i]?.hole);
      });
      // The undealt stub never shows: every card sent is dealt (the board or a hole card).
      const stub = new Set(hand.deck.slice(hand.deckPos));
      for (const card of shown) expect(stub.has(card)).toBe(false);
    }
  }, 120_000);
});

describe('the bot seed comes from the table seed only (§2.4, §9.6 3b)', () => {
  const TABLE: Seed128 = '7ab1e5eed7ab1e5eed7ab1e5eed7ab1e';
  const OTHER_TABLE: Seed128 = '0ddba11c0ffee0ddba11c0ffee0ddba1';

  /** The bot requests of the first hands, keyed by what the seed is a function of. */
  async function requestsFor(
    table: Seed128,
    hands: Seed128,
  ): Promise<Map<string, { seed: Seed128; hole: readonly Card[]; handSeed: Seed128 }>> {
    const seeds: SeedSource = {
      tableSeed: () => table,
      handSeed: (handSeq) => deriveSeed(hands, 'hand', handSeq),
    };
    const out = new Map<string, { seed: Seed128; hole: readonly Card[]; handSeed: Seed128 }>();
    let h: Harness | null = null;
    const spy = spyBrain((msg) => {
      const hand = (h as Harness).controller.snapshot().hand as HandState;
      out.set(`${hand.handSeq}|${msg.obs.seat}|${hand.log.length}`, {
        seed: msg.seed,
        hole: msg.obs.hole,
        handSeed: hand.seed,
      });
    });
    h = makeHarness({ brain: spy.client, seeds, settings: { players: 6 } });
    h.dispatch({ type: 'play' });
    for (let i = 0; i < 40 && out.size < 12; i++) await tick();
    await drive(h, { hands: 1, hero: passive });
    return out;
  }

  it('changing the hand seed (same table, same position in the hand) leaves the bot seed unchanged', async () => {
    const a = await requestsFor(TABLE, '0000000000000000000000000000000a');
    const b = await requestsFor(TABLE, '0000000000000000000000000000000b');
    const common = [...a.keys()].filter((key) => b.has(key));
    expect(common.length).toBeGreaterThanOrEqual(3);
    for (const key of common) {
      const x = a.get(key);
      const y = b.get(key);
      expect(x?.handSeed).not.toBe(y?.handSeed);
      expect(x?.seed).toBe(y?.seed);
    }
    // The hand seeds really did change the deals.
    expect(common.some((key) => a.get(key)?.hole.join() !== b.get(key)?.hole.join())).toBe(true);
    // And the seed is not derived from either hand seed.
    for (const { seed, handSeed } of [...a.values(), ...b.values()]) {
      expect(seed).not.toBe(handSeed);
      for (const label of ['bots', 'bot', 'deck', 'think']) {
        expect(seed).not.toBe(deriveSeed(handSeed, label));
      }
    }
  }, 30_000);

  it('changing the table seed changes it', async () => {
    const a = await requestsFor(TABLE, '0000000000000000000000000000000a');
    const c = await requestsFor(OTHER_TABLE, '0000000000000000000000000000000a');
    const seedsA = new Set([...a.values()].map((x) => x.seed));
    for (const { seed } of c.values()) expect(seedsA.has(seed)).toBe(false);
  }, 30_000);
});

describe('stale replies (pitfall 22; Stage 5 acceptance: dropped after an epoch change)', () => {
  it('a reply to a job of the previous hand, held back across a new table, is dropped', async () => {
    const brain = manualBrain();
    const h = makeHarness({ brain: brain.client });
    h.dispatch({ type: 'play' });
    await toBotTurn(h);
    await flush();
    const [old] = [...brain.pending.values()];
    if (old === undefined) throw new Error('no request');
    const oldEpoch = old.req.epoch;
    expect(h.controller.snapshot().epoch).toBe(oldEpoch);
    h.dispatch({ type: 'newTable', confirmed: true });
    // The unfinished hand is finished without animation: answer its bots, not the old job.
    const oldTable = h.controller.snapshot().table;
    for (let i = 0; i < 200 && h.controller.snapshot().table === oldTable; i++) {
      await flush();
      for (const jobId of [...brain.pending.keys()]) {
        if (jobId !== old.req.jobId) brain.answer(jobId);
      }
    }
    expect(h.controller.snapshot().epoch).toBeGreaterThan(oldEpoch);
    const inputs = inputsOf(h).length;
    const hand = h.state().game.hand;
    brain.answer(old.req.jobId); // the late reply of the old epoch
    await flush();
    expect(
      h.controller.logs().brainWorker.filter((e) => e.what === 'drop' && e.jobId === old.req.jobId),
    ).toEqual([expect.objectContaining({ kind: 'botDecision', epoch: oldEpoch })]);
    expect(inputsOf(h)).toHaveLength(inputs);
    expect(h.state().game.hand).toBe(hand);
    expect(h.state().game.diag.botFallbacks).toBe(0);
  });

  it('the old job is cancelled at the worker when the epoch changes', async () => {
    const brain = manualBrain();
    const h = makeHarness({ brain: brain.client });
    h.dispatch({ type: 'play' });
    await toBotTurn(h);
    await flush();
    const [old] = [...brain.pending.values()];
    if (old === undefined) throw new Error('no request');
    h.dispatch({ type: 'newTable', confirmed: true });
    expect(brain.cancelled).toContain(old.req.jobId);
  });
});

describe('think time (§9.8): computed in the worker, applied by the controller', () => {
  it('every reply’s think time is the §9.8 function of its request (obs and table-only seed)', async () => {
    const spy = spyBrain();
    const h = makeHarness({ brain: spy.client, settings: { players: 6 } });
    h.dispatch({ type: 'play' });
    await drive(h, { hands: 6, hero: passive });
    const replies = h.controller.logs().brain.filter((e) => e.what === 'reply');
    expect(replies.length).toBeGreaterThan(20);
    const byJob = new Map(spy.requests.map((r) => [r.jobId, r]));
    for (const entry of replies) {
      const { jobId, thinkMs: got } = entry.detail as { jobId: number; thinkMs: number };
      const req = byJob.get(jobId) as BotDecisionMsg;
      expect(got).toBe(thinkMs(req.obs, standInDecide(req.obs), req.seed));
      expect(got).toBeGreaterThanOrEqual(450);
      expect(got).toBeLessThanOrEqual(1750);
    }
  }, 30_000);

  it('a bot acts after its think time at Normal speed (the first of a hand also waits for the deal)', async () => {
    const asked = new Map<number, number>();
    const spy = spyBrain((msg) => asked.set(msg.jobId, Date.now()));
    const h = makeHarness({ brain: spy.client, settings: { players: 6, speed: 'normal' } });
    const delays: { ms: number; think: number }[] = [];
    h.store.subscribe((s, prev) => {
      const hand = s.game.hand;
      if (hand === null || prev.game.hand === null || hand === prev.game.hand) return;
      if (hand.handSeq !== prev.game.hand.handSeq) return;
      const input = h.controller.snapshot().inputs.at(-1);
      if (input?.kind !== 'act' || input.seat === HERO) return;
      const req = [...spy.requests].reverse().find((r) => r.obs.seat === input.seat);
      const reply = h.controller
        .logs()
        .brain.filter((e) => e.what === 'reply')
        .at(-1);
      if (req === undefined || reply === undefined) return;
      const { thinkMs: think } = reply.detail as { thinkMs: number };
      delays.push({ ms: Date.now() - (asked.get(req.jobId) as number), think });
    });
    h.dispatch({ type: 'play' });
    await drive(h, { hands: 2, hero: passive });
    expect(delays.length).toBeGreaterThan(5);
    for (const d of delays) expect(d.ms).toBeGreaterThanOrEqual(d.think);
    expect(delays.filter((d) => d.ms === d.think).length).toBeGreaterThan(delays.length / 2);
  }, 30_000);
});

describe('the worker is killed, silent or gone (§12.14: the hand always finishes)', () => {
  it('killed mid-hand: the pending bot takes the safest legal action, a new worker serves the rest', async () => {
    const brain = manualBrain();
    const h = makeHarness({ brain: brain.client, settings: { players: 6 } });
    h.dispatch({ type: 'play' });
    await toBotTurn(h);
    await flush();
    const [job] = [...brain.pending.values()];
    if (job === undefined) throw new Error('no request');
    const before = inputsOf(h).length;
    const handSeq = h.state().game.hand?.handSeq as number;

    brain.fake.current().crash('killed'); // the worker dies with the bot's decision pending
    expect(brain.fake.instances).toHaveLength(2); // recreated once (§12.14)
    expect(brain.client.status).toBe('ready');
    await untilInputs(h, before + 1);
    expect(inputsOf(h)[before]).toEqual({
      kind: 'act',
      seat: job.req.obs.seat,
      action: safest(job.req.obs.legal),
    });
    expect(h.state().game.diag.botFallbacks).toBe(1);

    // The test plays the new worker's part: it answers what the controller asks.
    const done = await drive(h, {
      hands: 3,
      hero: passive,
      beforeStep: () => brain.answerAll(),
    });
    expect(done.map((x) => x.phase)).toEqual(['complete', 'complete', 'complete']);
    expect(done[0]?.handSeq).toBe(handSeq); // the hand that was running when the worker died
    expect(h.state().game.diag).toEqual({ engineErrors: 0, botFallbacks: 1, voidedHands: 0 });
    const log = h.controller.logs().brainWorker.map((e) => e.what);
    expect(log).toEqual(expect.arrayContaining(['crash', 'restart']));
    expect(log).not.toContain('failed');
  }, 30_000);

  it('killed twice: no worker is left, every bot takes the safest legal action, and hands go on', async () => {
    const brain = manualBrain();
    const h = makeHarness({ brain: brain.client, settings: { players: 6 } });
    h.dispatch({ type: 'play' });
    await toBotTurn(h);
    await flush();
    brain.fake.current().crash('killed');
    await drive(h, { hands: 1, hero: passive, beforeStep: () => brain.answerAll() });
    await toBotTurn(h);
    await flush();
    const acts = watchBotActs(h);
    brain.fake.current().crash('killed again');
    expect(brain.client.status).toBe('failed');
    expect(brain.fake.instances).toHaveLength(2);

    const sent = brain.fake.received.length;
    const done = await drive(h, { hands: 5, hero: passive });
    expect(done).toHaveLength(5);
    expect(brain.fake.received).toHaveLength(sent); // a failed client sends nothing more
    expect(acts.length).toBeGreaterThan(10);
    for (const { action, legal } of acts) {
      // Never folds when checking is free (B32: folding is then illegal anyway).
      expect(action).toEqual(safest(legal));
    }
    expect(h.state().game.diag.botFallbacks).toBeGreaterThanOrEqual(acts.length);
    expect(h.state().game.diag.voidedHands).toBe(0);
    expect(h.controller.logs().brainWorker.map((e) => e.what)).toContain('failed');
  }, 60_000);

  it('a worker that cannot start at all: bots take the safest legal action from the first hand', async () => {
    const fake = fakeBrainWorker({ service: { decide: standInDecide } });
    fake.failSpawns = 2; // the first start and its one retry
    const client = createBrainClient(fake.spawn, realTimers);
    expect(client.status).toBe('failed');
    const h = makeHarness({ brain: client, settings: { players: 6 } });
    const acts = watchBotActs(h);
    h.dispatch({ type: 'play' });
    const done = await drive(h, {
      hands: 8,
      hero: heroPolicy(deriveSeed(`${'0'.repeat(31)}c`, 'hero')),
    });
    expect(done).toHaveLength(8);
    expect(acts.length).toBeGreaterThan(20);
    for (const { action, legal } of acts) expect(action).toEqual(safest(legal));
    expect(h.state().game.diag.botFallbacks).toBe(acts.length);
    expect(fake.received).toEqual([]); // nothing was ever sent
  }, 60_000);

  it('the headless finish of a new table works with a dead worker too (§3.1)', async () => {
    const fake = fakeBrainWorker({ service: { decide: standInDecide } });
    fake.failSpawns = 2;
    const h = makeHarness({ brain: createBrainClient(fake.spawn, realTimers) });
    h.dispatch({ type: 'play' });
    await toBotTurn(h);
    const oldTable = h.controller.snapshot().table;
    h.dispatch({ type: 'newTable', confirmed: true });
    for (let i = 0; i < 200 && h.controller.snapshot().table === oldTable; i++) await flush();
    expect(h.controller.snapshot().table).not.toBe(oldTable);
    expect(h.state().game.hand?.phase).toBe('betting');
  });

  it('a silent worker: on timeout the bot takes the safest action; two timeouts in a row recreate it', async () => {
    const brain = manualBrain();
    const h = makeHarness({ brain: brain.client, settings: { players: 6 } });
    h.dispatch({ type: 'play' });
    await toBotTurn(h);
    await flush();
    const [first] = [...brain.pending.values()];
    if (first === undefined) throw new Error('no request');
    const before = inputsOf(h).length;
    await elapse(TIMING.botFirstTimeoutMs - 1);
    expect(inputsOf(h)).toHaveLength(before);
    expect(brain.fake.instances).toHaveLength(1);
    await elapse(1);
    expect(brain.cancelled).toContain(first.req.jobId);
    await untilInputs(h, before + 1);
    expect(inputsOf(h)[before]).toEqual({
      kind: 'act',
      seat: first.req.obs.seat,
      action: safest(first.req.obs.legal),
    });
    expect(brain.fake.instances).toHaveLength(1); // one timeout is not a crash

    // The next bot is silent too: the second timeout in a row recreates the worker.
    await toBotTurn(h);
    await flush();
    const second = [...brain.pending.values()].find((p) => p.req.jobId !== first.req.jobId);
    if (second === undefined) throw new Error('no second request');
    await elapse(TIMING.botFirstTimeoutMs);
    expect(brain.fake.instances).toHaveLength(2);
    expect(brain.fake.instances[0]?.terminated).toBe(true);
    expect(h.state().game.diag.botFallbacks).toBe(2);

    // The new worker answers: bots decide again.
    const third = await untilRequestTo(h, brain.fake.current(), brain);
    const n = inputsOf(h).length;
    brain.answer(third.jobId);
    await untilInputs(h, n + 1);
    expect(h.state().game.diag.botFallbacks).toBe(2);
  }, 30_000);

  it('the first decision of a session waits up to 3 s for a worker still starting; once it has answered, 2 s', async () => {
    expect(TIMING.botFirstTimeoutMs).toBe(3000);
    expect(TIMING.botTimeoutMs).toBe(2000);
    const brain = manualBrain();
    const h = makeHarness({ brain: brain.client });
    h.dispatch({ type: 'play' });
    await toBotTurn(h);
    await flush();
    const [first] = [...brain.pending.values()];
    if (first === undefined) throw new Error('no request');
    const before = inputsOf(h).length;
    await elapse(TIMING.botTimeoutMs); // 2 s: the worker is still starting; the bot waits
    expect(inputsOf(h)).toHaveLength(before);
    expect(brain.cancelled).not.toContain(first.req.jobId);
    brain.answer(first.req.jobId); // the worker is up and answers
    await untilInputs(h, before + 1);
    expect(h.state().game.diag.botFallbacks).toBe(0);

    // From now on a silent worker costs the bot 2 s.
    await toBotTurn(h);
    await flush();
    const next = [...brain.pending.values()].find((p) => p.req.jobId !== first.req.jobId);
    if (next === undefined) throw new Error('no second request');
    await elapse(TIMING.botTimeoutMs - 1);
    expect(brain.cancelled).not.toContain(next.req.jobId);
    await elapse(1);
    expect(brain.cancelled).toContain(next.req.jobId);
    expect(h.state().game.diag.botFallbacks).toBe(1);
  });

  it('a reply that comes after the timeout is dropped: the bot keeps the safest action', async () => {
    const brain = manualBrain();
    const h = makeHarness({ brain: brain.client });
    h.dispatch({ type: 'play' });
    await toBotTurn(h);
    await flush();
    const [job] = [...brain.pending.values()];
    if (job === undefined) throw new Error('no request');
    const before = inputsOf(h).length;
    await elapse(TIMING.botFirstTimeoutMs);
    await untilInputs(h, before + 1);
    expect(inputsOf(h)[before]).toEqual({
      kind: 'act',
      seat: job.req.obs.seat,
      action: safest(job.req.obs.legal),
    });
    const after = inputsOf(h).length;
    brain.answer(job.req.jobId); // too late
    await flush();
    expect(inputsOf(h)).toHaveLength(after);
    expect(
      h.controller.logs().brainWorker.filter((e) => e.what === 'drop' && e.jobId === job.req.jobId),
    ).toHaveLength(1);
    expect(h.state().game.diag.botFallbacks).toBe(1);
  });
});

describe('a new table while a bot is deciding (§3.1 headless finish)', () => {
  it('a second new table releases the first finish: its job is cancelled and nothing hangs', async () => {
    const brain = manualBrain();
    const h = makeHarness({ brain: brain.client, settings: { players: 6 } });
    h.dispatch({ type: 'play' });
    await toBotTurn(h);
    await flush();
    const table0 = h.controller.snapshot().table;
    h.dispatch({ type: 'newTable', confirmed: true });
    // The first finish asks the next bot (no animation, no think time) and waits for it.
    for (let i = 0; i < 20 && brain.pending.size < 2; i++) await flush();
    const asked = [...brain.pending.keys()];
    expect(asked.length).toBeGreaterThanOrEqual(2);
    const headless = asked.at(-1) as number;

    h.dispatch({ type: 'newTable', confirmed: true }); // another one, before the first finished
    expect(brain.cancelled).toContain(headless);
    await flush();
    // The first finish was let go (its bot job was cancelled and would never answer).
    const events = () =>
      h.controller.logs().events.filter((e) => e.what === 'headless finish dropped');
    expect(events()).toHaveLength(1);
    // The second finish needs its own answers; give them until a new table is dealt.
    for (let i = 0; i < 400 && h.controller.snapshot().table === table0; i++) {
      await flush();
      for (const jobId of [...brain.pending.keys()]) {
        if (!asked.includes(jobId)) brain.answer(jobId);
      }
    }
    expect(h.controller.snapshot().table).not.toBe(table0);
    expect(h.state().game.hand?.phase).toBe('betting');
    // A late reply from the cancelled headless job changes nothing.
    const hand = h.state().game.hand;
    brain.answer(headless);
    await flush();
    expect(h.state().game.hand).toBe(hand);
  }, 30_000);
});
