/**
 * "Skip to result ›" (PLAN §12.7, 1.3.99): after the hero folds, the rest of the hand runs at
 * Instant speed, this hand only. It changes no setting, the hand is the same hand (the same
 * inputs, the same result) and nothing shows at an earlier step than in the normal flow. A running
 * pause is cut short; a feedback card still waits for its answer; Undo ends it. Fake timers
 * throughout; `harness.ts` builds a controller on its own store.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HERO, TIMING } from '../../src/app/controller.ts';
import { selectCanSkip } from '../../src/app/store.ts';
import type { EngineInput, LegalActions, PlayerAction } from '../../src/engine/types.ts';
import { stubGrader } from './graders.ts';
import { elapse, flush, makeHarness, scriptedBrain, tick, type Harness } from './harness.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const passive = (legal: LegalActions): PlayerAction =>
  legal.canCheck ? { type: 'check' } : { type: 'call' };

/** Bots that check and call and think for a second, so a hand runs to the river. */
const callingBots = () =>
  scriptedBrain({
    thinkMs: 1000,
    choose: (obs) => passive(obs.legal),
  });

const FOLD: PlayerAction = { type: 'fold' };

/** The hero's next decision where folding is legal (they check or call until then). */
async function toFoldDecision(h: Harness): Promise<void> {
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
}

async function toHandEnd(h: Harness): Promise<void> {
  for (let i = 0; i < 2000 && h.state().game.mode !== 'handEnd'; i++) await tick();
  expect(h.state().game.mode).toBe('handEnd');
}

/** What the table shows at each step: nothing here may come earlier with the skip. */
function watchShown(h: Harness): string[] {
  const shown: string[] = [];
  h.store.subscribe((s, prev) => {
    const hand = s.game.hand;
    if (hand === null || hand === prev.game.hand) return;
    shown.push(`${hand.log.length}:${hand.phase}:${hand.board.join()}:${hand.revealed.join()}`);
  });
  return shown;
}

interface Run {
  h: Harness;
  shown: string[];
  ms: number;
  inputs: readonly EngineInput[];
}

/** The hero folds at the first chance; the hand runs to its end, skipped or not. */
async function foldAndFinish(skip: boolean): Promise<Run> {
  const h = makeHarness({
    brain: callingBots(),
    settings: { players: 6, speed: 'normal', autoNext: false },
  });
  await toFoldDecision(h);
  const shown = watchShown(h);
  const at = Date.now();
  h.dispatch({ type: 'act', action: FOLD });
  if (skip) h.dispatch({ type: 'skipHand' });
  await toHandEnd(h);
  return { h, shown, ms: Date.now() - at, inputs: h.controller.snapshot().inputs };
}

describe('"Skip to result ›" (§12.7, 1.3.99)', () => {
  it('runs the rest of the hand at Instant speed: 80 ms a bot, no other pause', async () => {
    const skipped = await foldAndFinish(true);
    const at = skipped.inputs.findIndex(
      (i) => i.kind === 'act' && i.seat === HERO && i.action.type === 'fold',
    );
    const rest = skipped.inputs.slice(at + 1);
    const bots = rest.filter((i) => i.kind === 'act').length;
    const advances = rest.length - bots;
    expect(bots).toBeGreaterThan(0);
    // (A fake clock runs a 0 ms timer set during a tick 1 ms later.)
    expect(skipped.ms).toBe(bots * TIMING.instantBotMs + advances);
    const normal = await foldAndFinish(false);
    expect(normal.ms).toBeGreaterThan(skipped.ms * 5);
  });

  it('it is the same hand: the same inputs, the same result, nothing shown at an earlier step', async () => {
    const skipped = await foldAndFinish(true);
    const normal = await foldAndFinish(false);
    expect(skipped.inputs).toEqual(normal.inputs);
    expect(skipped.h.state().game.hand?.result).toEqual(normal.h.state().game.hand?.result);
    // One by one, the states the table draws: cards and shown hands step by step, in step.
    expect(skipped.shown).toEqual(normal.shown);
  });

  it('changes no setting', async () => {
    const h = makeHarness({
      brain: callingBots(),
      settings: { players: 6, speed: 'normal', autoNext: false },
    });
    await toFoldDecision(h);
    const before = h.state().settings;
    h.dispatch({ type: 'act', action: FOLD });
    h.dispatch({ type: 'skipHand' });
    expect(h.state().game.skipping).toBe(true);
    await toHandEnd(h);
    expect(h.state().settings).toBe(before);
    expect(h.state().settings.speed).toBe('normal');
  });

  it("is for this hand only: the next hand is at the player's speed", async () => {
    const h = makeHarness({
      brain: callingBots(),
      settings: { players: 6, speed: 'normal', autoNext: false },
    });
    await toFoldDecision(h);
    h.dispatch({ type: 'act', action: FOLD });
    h.dispatch({ type: 'skipHand' });
    await toHandEnd(h);
    expect(h.state().game.skipping).toBe(true);
    h.dispatch({ type: 'nextHand' });
    expect(h.state().game.skipping).toBe(false);
    // The next bot takes its own second again (or the deal's pause), not 80 ms.
    const inputs = () => h.controller.snapshot().inputs.length;
    const before = inputs();
    if (h.state().game.mode !== 'botTurn') return; // the hero is first in this hand
    const at = Date.now();
    for (let i = 0; i < 40 && inputs() === before; i++) await tick();
    expect(Date.now() - at).toBeGreaterThanOrEqual(1000);
  });

  it('cuts short the pause already running', async () => {
    const h = makeHarness({
      brain: callingBots(),
      settings: { players: 6, speed: 'normal', autoNext: false },
    });
    await toFoldDecision(h);
    h.dispatch({ type: 'act', action: FOLD });
    await flush(); // the next bot's answer is in: its 500 ms (Fast, §11.3 r6) are running
    expect(h.state().game.mode).toBe('botTurn');
    const inputs = h.controller.snapshot().inputs.length;
    await elapse(10);
    h.dispatch({ type: 'skipHand' });
    await elapse(TIMING.instantBotMs - 1);
    expect(h.controller.snapshot().inputs.length).toBe(inputs);
    await elapse(1);
    expect(h.controller.snapshot().inputs.length).toBe(inputs + 1);
  });

  it('is refused unless the hero has folded and the hand runs on', async () => {
    const h = makeHarness({
      brain: callingBots(),
      settings: { players: 6, speed: 'normal', autoNext: false },
    });
    await toFoldDecision(h);
    h.dispatch({ type: 'skipHand' }); // the hero's turn, cards still live
    expect(h.state().game.skipping).toBe(false);
    expect(selectCanSkip(h.state())).toBe(false);
    h.dispatch({ type: 'act', action: FOLD });
    expect(selectCanSkip(h.state())).toBe(true);
    // A server table (§19.6) has no skip: the other players set its pace.
    const atServerTable = { ...h.state(), mp: { ...h.state().mp, active: true } };
    expect(selectCanSkip(atServerTable)).toBe(false);
    await toHandEnd(h);
    expect(selectCanSkip(h.state())).toBe(false);
    h.dispatch({ type: 'skipHand' }); // over: nothing to skip
    expect(h.state().game.skipping).toBe(false);
  });

  it('once tapped the button goes: it cannot be tapped twice', async () => {
    const h = makeHarness({
      brain: callingBots(),
      settings: { players: 6, speed: 'normal', autoNext: false },
    });
    await toFoldDecision(h);
    h.dispatch({ type: 'act', action: FOLD });
    expect(selectCanSkip(h.state())).toBe(true);
    h.dispatch({ type: 'skipHand' });
    expect(selectCanSkip(h.state())).toBe(false);
  });
});

describe('"Skip to result ›" and the mistake feedback (§11, §12.7)', () => {
  // The hero folds only at the end of `toFoldDecision`: every earlier move grades Best.
  const foldsBadly = () =>
    stubGrader({ answer: (ask) => (ask.taken.type === 'fold' ? 'blunder' : 'best') });

  it('a feedback card still waits for its answer, and the button is not offered meanwhile', async () => {
    const h = makeHarness({
      brain: callingBots(),
      grader: foldsBadly(),
      settings: { players: 6, speed: 'normal', autoNext: false, coachLevel: 'beginner' },
    });
    await toFoldDecision(h);
    h.dispatch({ type: 'act', action: FOLD });
    expect(h.state().game.mode).toBe('grading');
    expect(selectCanSkip(h.state())).toBe(true);
    h.dispatch({ type: 'skipHand' }); // while the grade is on its way
    await flush();
    expect(h.state().game.mode).toBe('feedback');
    expect(selectCanSkip(h.state())).toBe(false);
    await elapse(60_000);
    expect(h.state().game.mode).toBe('feedback'); // nothing moves until the answer (§11.1)
    h.dispatch({ type: 'keepMove' });
    await toHandEnd(h);
  });

  it('Undo takes the fold back: the skip is over and the hero plays on', async () => {
    const h = makeHarness({
      brain: callingBots(),
      grader: foldsBadly(),
      settings: { players: 6, speed: 'normal', autoNext: false, coachLevel: 'beginner' },
    });
    await toFoldDecision(h);
    h.dispatch({ type: 'act', action: FOLD });
    h.dispatch({ type: 'skipHand' });
    await flush();
    expect(h.state().game.mode).toBe('feedback');
    expect(h.state().game.skipping).toBe(true);
    h.dispatch({ type: 'undo' });
    expect(h.state().game.mode).toBe('heroTurn');
    expect(h.state().game.skipping).toBe(false);
    expect(selectCanSkip(h.state())).toBe(false);
  });
});
