/**
 * TableController (PLAN §2.3, Appendix A.8, Stage 3): gates, `advance` gating, epoch and stale
 * timers/replies (pitfall 22), the non-cheating boundary (§4.8, §9.6), speeds and pauses (§9.8,
 * §12.8), hand end, bust, reload, top-up, bot replacement, void (§4.5), new table (§3.1).
 * Fake timers throughout; `harness.ts` builds a controller on its own store.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InvariantError } from '../../src/core/assert.ts';
import { deriveSeed } from '../../src/core/rng.ts';
import { botSeed, HERO, safestAction, TIMING, type Timers } from '../../src/app/controller.ts';
import { GATES, selectCanTopUp, type Gate } from '../../src/app/store.ts';
import type { BrainClient } from '../../src/app/workerClient.ts';
import { observe } from '../../src/engine/observe.ts';
import { replay } from '../../src/engine/replay.ts';
import { step } from '../../src/engine/step.ts';
import type {
  EngineInput,
  HandState,
  LegalActions,
  Observation,
  PlayerAction,
  ReplayRecord,
  TableState,
} from '../../src/engine/types.ts';
import {
  drive,
  elapse,
  flush,
  heroPolicy,
  makeHarness,
  manualBrain,
  scriptedBrain,
  SEED,
  setGate,
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

/** Plays (hero passive) until the controller pauses before an `advance`. */
async function toAdvancing(h: Harness): Promise<void> {
  for (let i = 0; i < 400; i++) {
    const s = h.state();
    if (s.game.mode === 'advancing') return;
    if (s.game.mode === 'heroTurn' && s.game.legal !== null) {
      h.dispatch({ type: 'act', action: passive(s.game.legal) });
    } else {
      await tick();
    }
  }
  throw new Error('never advancing');
}

const inputsOf = (h: Harness): EngineInput[] => h.controller.snapshot().inputs;

/** A brain that answers with the stand-in's action (or `choose`) and a fixed think time. */
function fixedBrain(thinkMs: number, choose?: (obs: Observation) => PlayerAction): BrainClient {
  return scriptedBrain({ thinkMs, ...(choose !== undefined && { choose }) });
}

/** Runs timers until the controller has applied `count` inputs in this hand. */
async function untilInputs(h: Harness, count: number): Promise<void> {
  for (let i = 0; i < 50 && inputsOf(h).length < count; i++) await tick();
  expect(inputsOf(h).length).toBeGreaterThanOrEqual(count);
}

/** Answers the pending manual job(s) of the current bot turn, then lets its think time pass. */
async function answerAndWait(h: Harness, brain: ManualBrain): Promise<void> {
  await flush();
  const before = inputsOf(h).length;
  brain.answerAll();
  await untilInputs(h, before + 1);
}

describe('one tap to play (§12.1, Stage 3 acceptance 9)', () => {
  it('Play deals a hand at once and shows the table, with the default table', () => {
    const h = makeHarness();
    expect(h.state().game.mode).toBe('idle');
    h.dispatch({ type: 'play' });
    const s = h.state();
    expect(s.ui.screen).toBe('table');
    expect(s.ui.nav.screens).toEqual(['home', 'table']); // the Table sits on Home
    expect(s.game.hand?.phase).toBe('betting');
    expect(s.game.hand?.seats[HERO]?.hole).not.toBeNull();
    expect(s.game.table?.slots.map((slot) => slot.stack)).toEqual(new Array(6).fill(2000));
    expect(s.game.table?.config).toMatchObject({ sb: 10, bb: 20, botLevel: 'easy' });
    expect(s.game.table?.slots[HERO]?.name).toBe('You');
  });

  it('Play continues the table after Leave table, with the same hand', async () => {
    const h = makeHarness();
    h.dispatch({ type: 'play' });
    await toBotTurn(h);
    const hand = h.state().game.hand;
    h.dispatch({ type: 'leaveTable' });
    expect(h.state().ui.nav).toEqual({ screens: ['home'], overlays: [] });
    expect(h.state().ui.gates).toContain('offTable');
    await elapse(30_000);
    expect(h.state().game.hand).toBe(hand);
    h.dispatch({ type: 'play' });
    expect(h.state().ui.screen).toBe('table');
    expect(h.state().game.hand).toBe(hand);
    await elapse(5000);
    expect(h.state().game.hand).not.toBe(hand);
  });
});

describe('gates (Appendix A.8): bots, think timers and advance wait while any gate is closed', () => {
  it.each(GATES)('no bot acts while the %s gate is closed (request in flight)', async (gate) => {
    const h = makeHarness();
    h.dispatch({ type: 'play' });
    await toBotTurn(h);
    const before = inputsOf(h).length;
    setGate(h, gate, true);
    expect(h.state().ui.gates).toContain(gate);
    await elapse(60_000);
    expect(inputsOf(h)).toHaveLength(before);
    expect(h.state().game.mode).toBe('botTurn');
    setGate(h, gate, false);
    await elapse(TIMING.resumeAfterVisibleMs + 4000);
    expect(inputsOf(h).length).toBeGreaterThan(before);
  });

  it.each(GATES)('the think timer pauses while the %s gate is closed', async (gate) => {
    const h = makeHarness({ brain: fixedBrain(2000) });
    h.dispatch({ type: 'play' });
    await toBotTurn(h);
    await elapse(1500); // the reply has landed; 500 ms of think time are left
    const before = inputsOf(h).length;
    setGate(h, gate, true);
    await elapse(60_000);
    expect(inputsOf(h)).toHaveLength(before);
    setGate(h, gate, false);
    const reopen = gate === 'hidden' ? TIMING.resumeAfterVisibleMs : 0;
    await elapse(reopen + 499);
    expect(inputsOf(h)).toHaveLength(before);
    await elapse(1);
    expect(inputsOf(h)).toHaveLength(before + 1);
  });

  it.each(GATES)('no advance happens while the %s gate is closed', async (gate) => {
    const h = makeHarness();
    h.dispatch({ type: 'play' });
    await toAdvancing(h);
    const before = inputsOf(h).length;
    const board = h.state().game.hand?.board.length;
    setGate(h, gate, true);
    await elapse(60_000);
    expect(inputsOf(h)).toHaveLength(before);
    expect(h.state().game.hand?.board.length).toBe(board);
    setGate(h, gate, false);
    await elapse(TIMING.resumeAfterVisibleMs + 2000);
    expect(inputsOf(h)[before]).toEqual({ kind: 'advance' });
  });

  it('several gates: every one must open before a bot acts', async () => {
    const h = makeHarness();
    h.dispatch({ type: 'play' });
    await toBotTurn(h);
    const before = inputsOf(h).length;
    const closed: Gate[] = ['menu', 'sheet', 'tip'];
    for (const gate of closed) setGate(h, gate, true);
    for (const gate of closed.slice(0, -1)) {
      setGate(h, gate, false);
      await elapse(30_000);
      expect(inputsOf(h)).toHaveLength(before);
    }
    setGate(h, 'tip', false);
    await elapse(4000);
    expect(inputsOf(h).length).toBeGreaterThan(before);
  });

  it('the hidden gate reopens exactly 300 ms after the page is visible (§12.13)', async () => {
    const h = makeHarness();
    h.dispatch({ type: 'visibility', hidden: true });
    expect(h.state().ui.gates).toContain('hidden');
    h.dispatch({ type: 'visibility', hidden: false });
    await elapse(299);
    expect(h.state().ui.gates).toContain('hidden');
    await elapse(1);
    expect(h.state().ui.gates).not.toContain('hidden');
    // Hidden again before the 300 ms: stays closed.
    h.dispatch({ type: 'visibility', hidden: true });
    h.dispatch({ type: 'visibility', hidden: false });
    await elapse(100);
    h.dispatch({ type: 'visibility', hidden: true });
    await elapse(1000);
    expect(h.state().ui.gates).toContain('hidden');
  });

  it('the sizing tray is not a gate (A.8)', async () => {
    const h = makeHarness();
    h.dispatch({ type: 'play' });
    await toBotTurn(h);
    const before = inputsOf(h).length;
    h.dispatch({ type: 'open', overlay: 'tray' });
    expect(h.state().ui.gates).toEqual([]);
    await elapse(4000);
    expect(inputsOf(h).length).toBeGreaterThan(before);
  });
});

describe('stale replies and timers (pitfall 22)', () => {
  it('drops a reply to a job cancelled when the page was hidden, and asks again when visible', async () => {
    const brain = manualBrain();
    const h = makeHarness({ brain: brain.client });
    h.dispatch({ type: 'play' });
    await toBotTurn(h);
    const [first] = [...brain.pending.values()];
    if (first === undefined) throw new Error('no request');
    const before = inputsOf(h).length;
    setGate(h, 'hidden', true);
    expect(brain.cancelled).toEqual([first.req.jobId]);
    brain.answer(first.req.jobId);
    await elapse(10_000);
    expect(inputsOf(h)).toHaveLength(before);
    expect(h.controller.logs().brainWorker.some((e) => e.what === 'drop')).toBe(true);
    setGate(h, 'hidden', false);
    await elapse(TIMING.resumeAfterVisibleMs);
    const [again] = [...brain.pending.values()];
    expect(again?.req.jobId).not.toBe(first.req.jobId);
    expect(again?.req.obs).toEqual(first.req.obs);
    expect(again?.req.seed).toBe(first.req.seed);
    await answerAndWait(h, brain);
    expect(inputsOf(h)).toHaveLength(before + 1);
    expect(inputsOf(h)[before]).toMatchObject({ kind: 'act', seat: first.req.obs.seat });
  });

  it('drops a reply from the previous hand after a new table (epoch)', async () => {
    const brain = manualBrain();
    const h = makeHarness({ brain: brain.client });
    h.dispatch({ type: 'play' });
    await toBotTurn(h);
    const [old] = [...brain.pending.values()];
    if (old === undefined) throw new Error('no request');
    const oldTable = h.state().game.table;
    h.dispatch({ type: 'newTable', confirmed: true });
    // The unfinished hand is finished without animation: answer its bots, not the old job.
    for (let i = 0; i < 200 && h.state().game.table === oldTable; i++) {
      await flush();
      for (const jobId of [...brain.pending.keys()]) {
        if (jobId !== old.req.jobId) brain.answer(jobId);
      }
    }
    expect(h.state().game.table).not.toBe(oldTable);
    const inputs = inputsOf(h).length;
    const hand = h.state().game.hand;
    brain.answer(old.req.jobId);
    await flush();
    expect(h.controller.logs().brainWorker.filter((e) => e.what === 'drop').length).toBeGreaterThan(
      0,
    );
    expect(inputsOf(h)).toHaveLength(inputs);
    expect(h.state().game.hand).toBe(hand);
  });

  it('a timer that fires after it was cancelled never acts (clearTimeout that does nothing)', async () => {
    // Every cancelled timer still fires: only the epoch and token checks keep the game right.
    const leaky: Timers = {
      setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
      clearTimeout: () => {},
      now: () => Date.now(),
    };
    const h = makeHarness({ timers: leaky, settings: { players: 4 } });
    h.dispatch({ type: 'play' });
    const hero = heroPolicy(deriveSeed('00000000000000000000000000000022', 'hero'));
    const gates: Gate[] = ['hidden', 'menu', 'sheet'];
    const hands = await drive(h, {
      hands: 25,
      hero,
      beforeStep: (i) => {
        // Close a gate for a few steps now and then (pausing and restarting the flow timer).
        const gate = gates[Math.floor(i / 9) % 3] as Gate;
        if (i % 9 === 2) setGate(h, gate, true);
        if (i % 9 === 5) setGate(h, gate, false);
        if (i === 150) h.dispatch({ type: 'newTable', confirmed: true });
      },
      onComplete: (hand, inputs) => {
        expect(inputs.every((x) => x.kind !== 'act' || x.seat >= 0)).toBe(true);
        expect(hand.result).not.toBeNull();
      },
    });
    for (const gate of gates) setGate(h, gate, false);
    expect(hands).toHaveLength(25);
    expect(h.controller.logs().events.some((e) => e.what === 'stale timer dropped')).toBe(true);
    expect(h.state().game.diag).toEqual({ engineErrors: 0, botFallbacks: 0, voidedHands: 0 });
  }, 60_000);
});

describe('non-cheating boundary (§4.8, §9.6): the brain gets an Observation only', () => {
  const OBS_KEYS = [
    'allIn', 'bb', 'bbSeat', 'board', 'button', 'dealtIn', 'folded', 'handSeq', 'history', 'hole',
    'legal', 'pot', 'revealedHoles', 'sb', 'sbSeat', 'seat', 'seatLevels', 'seatStats', 'stacks',
    'street', 'streetBets', 'totalBets', 'visiblePersonality',
  ]; // prettier-ignore

  it('every request is exactly observe(state, seat) plus a table-only seed; never a HandState', async () => {
    const seen: { req: BotDecisionMsg; hand: HandState; table: TableState }[] = [];
    let h: Harness | null = null;
    const brain = spyBrain((req) => {
      const snap = (h as Harness).controller.snapshot();
      seen.push({ req, hand: snap.hand as HandState, table: snap.table as TableState });
    });
    h = makeHarness({
      brain: brain.client,
      settings: { players: 9, startingStack: 400, sb: 10, bb: 20 },
    });
    h.dispatch({ type: 'play' });
    await drive(h, { hands: 40, hero: heroPolicy(deriveSeed(`${'0'.repeat(31)}9`, 'hero')) });
    expect(seen.length).toBeGreaterThan(200);
    for (const { req, hand, table } of seen) {
      expect(Object.keys(req).sort()).toEqual(['epoch', 'jobId', 'kind', 'obs', 'profile', 'seed']);
      expect(Object.keys(req.obs).sort()).toEqual(OBS_KEYS);
      const seat = req.obs.seat;
      expect(seat).not.toBe(HERO);
      expect(hand.toAct).toBe(seat);
      const extras = {
        seatStats: req.obs.seatStats,
        visiblePersonality: req.obs.visiblePersonality,
        seatLevels: req.obs.seatLevels,
      };
      expect(req.obs).toEqual(observe(hand, seat, extras));
      expect(req.obs.seatStats.every((x) => x === null)).toBe(true);
      const text = JSON.stringify(req);
      expect(text).not.toMatch(/"deck"|"deckPos"|"startStacks"|"log"/);
      expect(req.seed).toBe(botSeed(table.tableSeed, hand.handSeq, seat, hand.log.length));
      expect(req.seed).not.toBe(hand.seed);
      // Only revealed seats' cards (and bots never decide after a reveal: nobody can bet then).
      req.obs.revealedHoles.forEach((hole, i) => {
        if (!hand.revealed.includes(i)) expect(hole).toBeNull();
      });
      // Nobody else's hidden hole card appears anywhere in the request.
      hand.seats.forEach((s, i) => {
        if (i === seat || s.hole === null || hand.revealed.includes(i)) return;
        const cards = JSON.stringify(s.hole);
        expect(JSON.stringify(req.obs.revealedHoles)).not.toContain(cards);
        expect(JSON.stringify(req.obs.hole)).not.toBe(cards);
      });
      expect(req.profile.id).toBe(`${table.slots[seat]?.personality}/easy`);
    }
  }, 60_000);

  it('the bot seed depends on the table seed, never on the hand seed (§9.6 3b)', () => {
    const table = 'abcdefabcdefabcdefabcdefabcdef01';
    const a = botSeed(table, 7, 3, 12);
    expect(botSeed(table, 7, 3, 12)).toBe(a);
    expect(botSeed('abcdefabcdefabcdefabcdefabcdef02', 7, 3, 12)).not.toBe(a);
    expect(botSeed(table, 8, 3, 12)).not.toBe(a);
    // The signature has no hand seed: the same table, hand number and history give the same seed
    // whatever the deck was.
    expect(botSeed.length).toBe(4);
  });
});

describe('speed and pauses (§9.8, §12.8)', () => {
  /** A brain with a fixed think time that records when it was asked, per seat. */
  function timedBrain(thinkMs: number, asked: Map<number, number>): BrainClient {
    return scriptedBrain({
      thinkMs,
      choose: (o) => passive(o.legal),
      onRequest: (req) => asked.set(req.obs.seat, Date.now()),
    });
  }

  /** Calls `onInput` with every input the controller applies inside a hand, and the time. */
  function watchInputs(h: Harness, onInput: (input: EngineInput, hand: HandState) => void): void {
    h.store.subscribe((s, prev) => {
      const hand = s.game.hand;
      if (hand === null || prev.game.hand === null || hand === prev.game.hand) return;
      if (hand.handSeq !== prev.game.hand.handSeq) return;
      const inputs = h.controller.snapshot().inputs;
      onInput(inputs[inputs.length - 1] as EngineInput, hand);
    });
  }

  /** From each bot request to that bot's act, over three hands (the hero never folds). */
  async function botDelays(speed: 'normal' | 'fast' | 'instant'): Promise<number[]> {
    const asked = new Map<number, number>(); // seat → request time
    const h = makeHarness({ brain: timedBrain(1000, asked), settings: { speed, players: 6 } });
    const delays: number[] = [];
    watchInputs(h, (input) => {
      if (input.kind === 'act' && input.seat !== HERO) {
        delays.push(Date.now() - (asked.get(input.seat) as number));
      }
    });
    h.dispatch({ type: 'play' });
    await drive(h, { hands: 3, hero: passive });
    return delays;
  }

  it('a bot with a 1,000 ms think time acts after 1,000 ms at Normal (the hero never folds)', async () => {
    const delays = await botDelays('normal');
    expect(delays.length).toBeGreaterThan(5);
    expect(new Set(delays)).toEqual(new Set([1000]));
  });

  it('… after 500 ms at Fast, 80 ms at Instant', async () => {
    expect(new Set(await botDelays('fast'))).toEqual(new Set([500]));
    expect(new Set(await botDelays('instant'))).toEqual(new Set([TIMING.instantBotMs]));
  });

  it.each([
    ['normal', 1],
    ['fast', 0.5],
    ['instant', 0],
  ] as const)(
    'at %s: 700 ms before each advance, the reveal adds 500 ms per hand; next hand after 3 s',
    async (speed, factor) => {
      // Heads-up, everyone checks or calls: a showdown with two hands shown.
      const asked = new Map<number, number>();
      const h = makeHarness({ brain: timedBrain(600, asked), settings: { speed, players: 2 } });
      const times: { input: EngineInput; at: number }[] = [];
      watchInputs(h, (input) => times.push({ input, at: Date.now() }));
      h.dispatch({ type: 'play' });
      const [done] = await drive(h, { hands: 1, hero: passive });
      expect(done?.result?.endedBy).toBe('showdown');
      const gaps = times.flatMap((t, i) =>
        t.input.kind === 'advance' && i > 0 ? [t.at - (times[i - 1] as { at: number }).at] : [],
      );
      const base = (TIMING.chipsToPotMs + TIMING.streetPauseMs) * factor;
      const expected = [base, base, base, base, base + 2 * TIMING.revealPerHandMs * factor];
      if (speed === 'instant') {
        // setTimeout(0) from inside a timer is 1 ms under fake timers (as in Node).
        for (const gap of gaps) expect([0, 1]).toContain(gap);
        expect(gaps).toHaveLength(expected.length);
      } else {
        expect(gaps).toEqual(expected);
      }
      const end = Date.now();
      const handSeq = done?.handSeq;
      await elapse(Math.max(TIMING.nextHandMinMs, TIMING.nextHandMs * factor) - 1);
      expect(h.state().game.hand?.handSeq).toBe(handSeq);
      await elapse(1);
      expect(h.state().game.hand?.handSeq).toBe((handSeq as number) + 1);
      expect(Date.now() - end).toBe(Math.max(TIMING.nextHandMinMs, TIMING.nextHandMs * factor));
    },
  );

  it('after the hero folds, a Normal hand goes on at Fast (§11.3 r6)', async () => {
    const asked = new Map<number, number>();
    const h = makeHarness({ brain: timedBrain(1000, asked), settings: { players: 6 } });
    const after: { input: EngineInput; at: number }[] = [];
    h.dispatch({ type: 'play' });
    for (let i = 0; i < 2000 && h.state().game.legal?.canFold !== true; i++) {
      const s = h.state();
      if (s.game.mode === 'heroTurn' && s.game.legal !== null) {
        h.dispatch({ type: 'act', action: passive(s.game.legal) });
      } else {
        await tick();
      }
    }
    expect(h.state().game.legal?.canFold).toBe(true);
    await elapse(2000); // past the deal pause; nothing moves on the hero's turn
    watchInputs(h, (input) => after.push({ input, at: Date.now() }));
    const at = Date.now();
    h.dispatch({ type: 'act', action: { type: 'fold' } });
    expect(after[0]?.input).toEqual({ kind: 'act', seat: HERO, action: { type: 'fold' } });
    for (let i = 0; i < 20 && after.length < 2; i++) await tick();
    const next = after[1] as { input: EngineInput; at: number };
    // A bot's 1,000 ms think time is halved; so is the 700 ms pause before an advance.
    const expected = next.input.kind === 'advance' ? 350 : 500;
    expect(next.at - at).toBe(expected);
  });

  it('the first bot waits until the hole cards have been dealt (180 ms + 60 ms per card)', async () => {
    const h = makeHarness({ brain: fixedBrain(0), settings: { players: 9 } });
    const start = Date.now();
    h.dispatch({ type: 'play' });
    for (let i = 0; i < 20 && inputsOf(h).length === 0; i++) {
      const s = h.state();
      if (s.game.mode === 'heroTurn' && s.game.legal !== null) {
        h.dispatch({ type: 'act', action: passive(s.game.legal) });
        return; // the hero was first: nothing to measure for this seed
      }
      await tick();
    }
    expect(Date.now() - start).toBe(TIMING.dealCardMs + TIMING.dealStaggerMs * (2 * 9 - 1));
  });
});

describe('errors (§4.5)', () => {
  it('an illegal bot action is replaced by the safest legal action and counted', async () => {
    const brain = manualBrain();
    const h = makeHarness({ brain: brain.client });
    h.dispatch({ type: 'play' });
    await toBotTurn(h);
    await flush();
    const [job] = [...brain.pending.values()];
    if (job === undefined) throw new Error('no request');
    const legal = job.req.obs.legal;
    const before = inputsOf(h).length;
    brain.answer(job.req.jobId, { decision: { action: { type: 'raise', to: 1 } } } as never);
    await untilInputs(h, before + 1);
    expect(inputsOf(h)[before]).toEqual({
      kind: 'act',
      seat: job.req.obs.seat,
      action: safestAction(legal),
    });
    expect(h.state().game.diag).toEqual({ engineErrors: 1, botFallbacks: 1, voidedHands: 0 });
  });

  it('a brain error or a reply later than the timeout gives the safest legal action', async () => {
    const brain = manualBrain();
    const h = makeHarness({ brain: brain.client });
    h.dispatch({ type: 'play' });
    await toBotTurn(h);
    await flush();
    const [job] = [...brain.pending.values()];
    if (job === undefined) throw new Error('no request');
    const before = inputsOf(h).length;
    // The very first decision of a session gets 3 s: the worker may still be starting (§12.14).
    await elapse(TIMING.botFirstTimeoutMs - 1);
    expect(inputsOf(h)).toHaveLength(before);
    await elapse(1);
    expect(brain.cancelled).toContain(job.req.jobId);
    await untilInputs(h, before + 1);
    expect(inputsOf(h)[before]).toEqual({
      kind: 'act',
      seat: job.req.obs.seat,
      action: safestAction(job.req.obs.legal),
    });
    const after = inputsOf(h).length;
    brain.answer(job.req.jobId); // too late: dropped
    await flush();
    expect(inputsOf(h)).toHaveLength(after);
    expect(h.state().game.diag.botFallbacks).toBe(1);

    await toBotTurn(h);
    await flush();
    const [next] = [...brain.pending.values()].filter((p) => p.req.jobId !== job.req.jobId);
    if (next === undefined) throw new Error('no second request');
    const n = inputsOf(h).length;
    brain.answer(next.req.jobId, { kind: 'error', message: 'boom' } as never);
    await untilInputs(h, n + 1);
    expect(inputsOf(h)[n]).toEqual({
      kind: 'act',
      seat: next.req.obs.seat,
      action: safestAction(next.req.obs.legal),
    });
    expect(h.state().game.diag.botFallbacks).toBe(2);
  });

  it('the hero cannot act out of turn, and an illegal hero action is refused', async () => {
    const h = makeHarness();
    h.dispatch({ type: 'play' });
    await toBotTurn(h);
    const n = inputsOf(h).length;
    h.dispatch({ type: 'act', action: { type: 'call' } });
    expect(inputsOf(h)).toHaveLength(n);
    for (let i = 0; i < 200 && h.state().game.mode !== 'heroTurn'; i++) await tick();
    const legal = h.state().game.legal as LegalActions;
    const m = inputsOf(h).length;
    h.dispatch({ type: 'act', action: { type: 'raise', to: legal.toCall + 1 } });
    expect(inputsOf(h)).toHaveLength(m);
    expect(h.state().game.mode).toBe('heroTurn');
    expect(h.state().game.diag.engineErrors).toBe(1);
    h.dispatch({ type: 'act', action: passive(legal) });
    expect(inputsOf(h)).toHaveLength(m + 1);
  });

  it('a broken invariant voids the hand: chips back, toast, record kept, next hand dealt', async () => {
    let calls = 0;
    const failing: typeof step = (s, input) => {
      if (++calls === 4) throw new InvariantError(['I1 chip conservation: test']);
      return step(s, input);
    };
    const h = makeHarness({ step: failing });
    h.dispatch({ type: 'play' });
    const voidedTable = h.state().game.table as TableState;
    const voidedHand = h.state().game.hand as HandState;
    for (let i = 0; i < 400 && h.state().game.diag.voidedHands === 0; i++) {
      const s = h.state();
      if (s.game.mode === 'heroTurn' && s.game.legal !== null) {
        h.dispatch({ type: 'act', action: passive(s.game.legal) });
      } else {
        await tick();
      }
    }
    const s = h.state();
    expect(s.game.diag.voidedHands).toBe(1);
    expect(s.ui.toasts.map((t) => t.kind)).toContain('handVoided');
    const record = h.controller.logs().voided[0];
    expect(record?.table).toBe(voidedTable);
    expect(record?.seed).toBe(voidedHand.seed);
    expect(record?.inputs).toHaveLength(4);
    expect(s.game.hand?.handSeq).toBe(voidedHand.handSeq + 1);
    expect(s.game.hand?.startStacks).toEqual(voidedTable.slots.map((slot) => slot.stack));
    await elapse(TIMING.toastMs);
    expect(h.state().ui.toasts).toEqual([]);
  });
});

describe('hand end, next hand, bust, reload, top-up (§3.1, §12.9)', () => {
  /** The hero shoves every hand: raise or bet all-in when allowed, else call. */
  const shove = (legal: LegalActions): PlayerAction => {
    if (legal.raise !== null) return { type: 'raise', to: legal.raise.max };
    if (legal.bet !== null) return { type: 'bet', to: legal.bet.max };
    return legal.canCall ? { type: 'call' } : { type: 'check' };
  };

  /** Plays shoving hands until the hero is out of chips (the dialog is not answered). */
  async function bust(h: Harness): Promise<void> {
    h.dispatch({ type: 'play' });
    for (let i = 0; i < 20_000; i++) {
      const s = h.state();
      if (s.ui.overlays.includes('outOfChips')) return;
      if (s.game.mode === 'heroTurn' && s.game.legal !== null) {
        h.dispatch({ type: 'act', action: shove(s.game.legal) });
      } else {
        await tick();
      }
    }
    throw new Error('the hero never busted');
  }

  it('with auto next hand off, the next hand waits for a tap', async () => {
    const h = makeHarness({ settings: { autoNext: false } });
    h.dispatch({ type: 'play' });
    const [done] = await drive(h, { hands: 1, hero: passive });
    await elapse(60_000);
    expect(h.state().game.mode).toBe('handEnd');
    expect(h.state().game.hand).toBe(done);
    expect(h.state().game.next?.handsDealt).toBe(1);
    h.dispatch({ type: 'nextHand' });
    expect(h.state().game.hand?.handSeq).toBe((done as HandState).handSeq + 1);
  });

  it('a tap on the banner starts the next hand before the pause ends', async () => {
    const h = makeHarness();
    h.dispatch({ type: 'play' });
    const [done] = await drive(h, { hands: 1, hero: passive });
    expect(h.state().game.mode).toBe('handEnd');
    h.dispatch({ type: 'nextHand' });
    expect(h.state().game.hand?.handSeq).toBe((done as HandState).handSeq + 1);
    // The cancelled pause does not deal another hand later.
    await elapse(TIMING.nextHandMs);
    expect(h.state().game.hand?.handSeq).toBe((done as HandState).handSeq + 1);
  });

  it('a hero with no chips gets the out-of-chips dialog; Reload refills and deals', async () => {
    const h = makeHarness({ settings: { players: 3, startingStack: 200, sb: 10, bb: 20 } });
    await bust(h);
    let s = h.state();
    expect(s.game.heroBust).toBe(true);
    expect(s.game.mode).toBe('idle');
    expect(s.game.hand?.phase).toBe('complete');
    expect(s.ui.gates).toContain('dialog');
    const handSeq = s.game.hand?.handSeq as number;
    await elapse(60_000);
    expect(h.state().game.hand?.handSeq).toBe(handSeq);
    h.dispatch({ type: 'reload' });
    s = h.state();
    expect(s.ui.overlays).not.toContain('outOfChips');
    expect(s.game.heroBust).toBe(false);
    expect(s.game.hand?.handSeq).toBe(handSeq + 1);
    expect(s.game.table?.slots[HERO]?.stack).toBe(200);
    expect(s.game.table?.reloads).toBe(1);
  });

  it('Back on the out-of-chips dialog goes Home; Play shows it again; Change table goes to Setup', async () => {
    const h = makeHarness({ settings: { players: 3, startingStack: 200, sb: 10, bb: 20 } });
    await bust(h);
    h.dispatch({ type: 'back' });
    expect(h.state().ui.screen).not.toBe('table');
    h.dispatch({ type: 'play' });
    expect(h.state().ui.screen).toBe('table');
    expect(h.state().ui.overlays).toEqual(['outOfChips']);
    h.dispatch({ type: 'changeTable' });
    const s = h.state();
    expect(s.ui.screen).toBe('setup');
    expect(s.ui.overlays).toEqual([]);
    expect(s.game).toMatchObject({ table: null, hand: null, next: null, mode: 'idle' });
    h.dispatch({ type: 'newTable', setup: { players: 4 } });
    await flush();
    expect(h.state().game.table?.slots).toHaveLength(4);
    expect(h.state().ui.screen).toBe('table');
  });

  it('busted bots are replaced, with one toast for all newcomers (§3.1)', async () => {
    const h = makeHarness({ settings: { players: 9, startingStack: 200, sb: 10, bb: 20 } });
    h.dispatch({ type: 'play' });
    let joined: string[] | null = null;
    for (let i = 0; i < 20_000 && joined === null; i++) {
      const s = h.state();
      const toast = s.ui.toasts.find((t) => t.kind === 'botsJoined');
      if (toast?.kind === 'botsJoined') joined = toast.names;
      else if (s.ui.overlays.includes('outOfChips')) h.dispatch({ type: 'reload' });
      else if (s.game.mode === 'heroTurn' && s.game.legal !== null) {
        h.dispatch({ type: 'act', action: shove(s.game.legal) });
      } else await tick();
    }
    expect(joined).not.toBeNull();
    const table = h.state().game.table as TableState;
    for (const name of joined as string[]) {
      const slot = table.slots.find((x) => x.name === name);
      expect(slot?.stack).toBe(200);
      expect(slot?.kind).toBe('bot');
    }
    expect(new Set(table.slots.map((x) => x.name)).size).toBe(9);
    await elapse(TIMING.toastMs);
    expect(h.state().ui.toasts.filter((t) => t.kind === 'botsJoined')).toHaveLength(0);
  });

  it('Menu → Top up refills the hero between hands (§3.1)', async () => {
    const h = makeHarness({ settings: { autoNext: false, players: 3 } });
    h.dispatch({ type: 'play' });
    for (let i = 0; i < 100; i++) {
      await drive(h, { hands: 1, hero: heroPolicy(deriveSeed(`${'0'.repeat(31)}5`, 'hero', i)) });
      const stack = h.state().game.next?.slots[HERO]?.stack ?? 0;
      if (stack > 0 && stack < 2000) break;
      h.dispatch({ type: 'nextHand' });
    }
    expect(selectCanTopUp(h.state())).toBe(true);
    const reloads = h.state().game.next?.reloads as number;
    h.dispatch({ type: 'topUp' });
    expect(h.state().game.next?.slots[HERO]?.stack).toBe(2000);
    expect(h.state().game.next?.reloads).toBe(reloads + 1);
    expect(selectCanTopUp(h.state())).toBe(false);
    h.dispatch({ type: 'nextHand' });
    expect(h.state().game.hand?.startStacks[HERO]).toBe(2000);
  });

  it('Top up is refused during a hand', async () => {
    const h = makeHarness();
    h.dispatch({ type: 'play' });
    await toBotTurn(h);
    const table = h.state().game.table;
    h.dispatch({ type: 'topUp' });
    expect(h.state().game.table).toBe(table);
    expect(h.state().game.next).toBeNull();
  });
});

describe('new table mid-hand (§3.1)', () => {
  /** Lets the headless finish (bot replies are promises) run until the table changes. */
  async function untilNewTable(h: Harness, old: TableState | null): Promise<void> {
    for (let i = 0; i < 100 && h.state().game.table === old; i++) await flush();
    expect(h.state().game.table).not.toBe(old);
  }

  it('asks first (the newTable dialog, a gate); No keeps the hand, Yes starts the new table', async () => {
    const h = makeHarness({ settings: { players: 6 } });
    h.dispatch({ type: 'play' });
    await toBotTurn(h);
    const old = h.state().game.table;
    const n = inputsOf(h).length;
    h.dispatch({ type: 'newTable', setup: { players: 3 } });
    expect(h.state().ui.overlays).toEqual(['newTable']);
    expect(h.state().ui.gates).toEqual(['dialog']);
    await elapse(30_000);
    expect(inputsOf(h)).toHaveLength(n); // no bot acts behind the question
    h.dispatch({ type: 'close', overlay: 'newTable' }); // No
    await elapse(4000);
    expect(h.state().game.table).toBe(old);
    expect(inputsOf(h).length).toBeGreaterThan(n);
    h.dispatch({ type: 'newTable', setup: { players: 4 } });
    h.dispatch({ type: 'newTable', confirmed: true }); // Yes: with Setup's values
    await untilNewTable(h, old);
    expect(h.state().game.table?.slots).toHaveLength(4);
    expect(h.state().ui.overlays).toEqual([]);
    expect(h.state().ui.screen).toBe('table');
  });

  it('between hands (no hand in play) it does not ask', async () => {
    const h = makeHarness({ settings: { autoNext: false } });
    h.dispatch({ type: 'play' });
    await drive(h, { hands: 1, hero: passive });
    const old = h.state().game.table;
    h.dispatch({ type: 'newTable', setup: { players: 2 } });
    expect(h.state().ui.overlays).toEqual([]);
    expect(h.state().game.table).not.toBe(old);
    expect(h.state().game.table?.slots).toHaveLength(2);
  });

  it('finishes the unfinished hand without animation, then deals the new table', async () => {
    const h = makeHarness({ settings: { players: 6 } });
    h.dispatch({ type: 'play' });
    await toBotTurn(h);
    const old = h.controller.snapshot();
    h.dispatch({ type: 'newTable', setup: { players: 3, startingStack: 1000 }, confirmed: true });
    await untilNewTable(h, old.table);
    const s = h.state();
    expect(s.game.table?.slots.map((x) => x.stack)).toEqual([1000, 1000, 1000]);
    expect(s.game.table?.tableSeed).not.toBe(old.table?.tableSeed);
    expect(s.game.hand?.handSeq).toBe((old.hand?.handSeq as number) + 1);
    expect(s.settings.players).toBe(3);
    expect(s.ui.screen).toBe('table');
    // No stale timer from the old hand touches the new one.
    await elapse(10_000);
    expect(h.state().game.table).toBe(s.game.table);
  });

  it('the old hand is played to the end: from then on the hero only checks or folds', async () => {
    for (let game = 0; game < 10; game++) {
      const h = makeHarness({ seed: deriveSeed(SEED, 'headless', game), settings: { players: 4 } });
      h.dispatch({ type: 'play' });
      await toBotTurn(h);
      const n = inputsOf(h).length;
      const old = h.state().game.table;
      h.dispatch({ type: 'newTable', confirmed: true });
      await untilNewTable(h, old);
      const event = h.controller.logs().events.find((e) => e.what === 'hand finished headless');
      const record = (event?.detail as { record: ReplayRecord }).record;
      expect(record.table).toBe(old);
      expect(replay(record).phase).toBe('complete');
      for (const input of record.inputs.slice(n)) {
        if (input.kind === 'act' && input.seat === HERO) {
          expect(['check', 'fold']).toContain(input.action.type);
        }
      }
    }
  });
});
