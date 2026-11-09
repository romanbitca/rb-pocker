/**
 * `TableController.park()` / `unpark()` (PLAN §19.6, Stage 10 acceptance 11): while a table of the
 * server's is on, the controller does not write the `game` slice and its equity and coach slices
 * are empty; a local hand in progress stands still and comes back unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { realTimers } from '../../src/app/controller.ts';
import { initialCoach, type AppState } from '../../src/app/store.ts';
import { createEquityClient, type BrainClient } from '../../src/app/workerClient.ts';
import type { LegalActions, PlayerAction } from '../../src/engine/types.ts';
import { fakeWorker } from '../workers/fakeWorker.ts';
import { stubGrader } from './graders.ts';
import { elapse, flush, makeHarness, scriptedBrain, type Harness } from './harness.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const passive = (legal: LegalActions): PlayerAction =>
  legal.canCheck ? { type: 'check' } : { type: 'call' };

const bots = (): BrainClient =>
  scriptedBrain({ thinkMs: 300, choose: (obs) => passive(obs.legal) });

async function untilMode(h: Harness, mode: AppState['game']['mode']): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (h.state().game.mode === mode) return;
    await elapse(100);
  }
  throw new Error(`never reached ${mode}`);
}

function table(options: Parameters<typeof makeHarness>[0] = {}): Harness {
  const h = makeHarness({ brain: bots(), settings: { players: 3, speed: 'normal' }, ...options });
  h.dispatch({ type: 'play' });
  return h;
}

/** What `MpDriver` does on entering: park, then the `offTable` hold. */
function enter(h: Harness): void {
  h.controller.park();
  h.dispatch({ type: 'gate', gate: 'offTable', closed: true, owner: 'mp' });
}

/** What `MpDriver` does on leaving: Home first, then back. */
function leave(h: Harness): void {
  h.dispatch({ type: 'go', screen: 'home' });
  h.controller.unpark();
  h.dispatch({ type: 'gate', gate: 'offTable', closed: false, owner: 'mp' });
}

const inputs = (h: Harness): number => h.controller.snapshot().inputs.length;

describe('a local hand in progress', () => {
  it('stands still while parked and comes back unchanged', async () => {
    const h = table();
    await untilMode(h, 'heroTurn');
    h.dispatch({ type: 'leaveTable' }); // to Home, where Play with friends is
    const local = h.state().game;
    const before = inputs(h);

    enter(h);
    const remote = { ...local, mode: 'idle' as const, hand: null, table: null, legal: null };
    h.store.setState({ game: remote });
    h.dispatch({ type: 'go', screen: 'table' }); // the driver's Table on show
    await elapse(120_000);
    expect(h.state().game).toBe(remote);
    expect(inputs(h)).toBe(before);

    leave(h);
    const back = h.state().game;
    expect(back.hand).toBe(local.hand);
    expect(back.table).toBe(local.table);
    expect(back.next).toBe(local.next);
    expect(back.mode).toBe(local.mode);
    expect(back.legal).toEqual(local.legal);
    expect(back.decisions).toBe(local.decisions);
    expect(inputs(h)).toBe(before);
  });

  it('goes on from where it stood after Play', async () => {
    const h = table();
    await untilMode(h, 'heroTurn');
    h.dispatch({ type: 'leaveTable' });
    enter(h);
    await elapse(60_000);
    leave(h);
    h.dispatch({ type: 'play' });
    expect(h.state().ui.screen).toBe('table');
    const legal = h.state().game.legal as LegalActions;
    const before = inputs(h);
    h.dispatch({ type: 'act', action: passive(legal) });
    await elapse(5_000);
    expect(inputs(h)).toBeGreaterThan(before);
  });

  it('a bot`s turn in flight waits, even with the Table on show', async () => {
    const h = table();
    await untilMode(h, 'botTurn');
    const before = inputs(h);
    enter(h);
    expect(h.state().ui.screen).toBe('table');
    await elapse(60_000);
    expect(inputs(h)).toBe(before);
    h.controller.unpark();
    h.dispatch({ type: 'gate', gate: 'offTable', closed: false, owner: 'mp' });
    await elapse(5_000);
    expect(inputs(h)).toBeGreaterThan(before);
  });

  it('its feedback card stays away from the other table and returns with its own', async () => {
    const h = table({ grader: stubGrader({ answer: () => 'mistake' }) });
    await untilMode(h, 'heroTurn');
    h.dispatch({ type: 'act', action: passive(h.state().game.legal as LegalActions) });
    await flush();
    h.dispatch({ type: 'leaveTable' });
    enter(h);
    h.dispatch({ type: 'go', screen: 'table' });
    expect(h.state().ui.overlays).not.toContain('feedback');
    leave(h);
    h.dispatch({ type: 'play' });
    expect(h.state().ui.overlays).toContain('feedback');
  });
});

describe('while parked', () => {
  it('commands do not write the game slice', async () => {
    const h = table();
    await untilMode(h, 'heroTurn');
    enter(h);
    const remote = { ...h.state().game, mode: 'idle' as const };
    h.store.setState({ game: remote });
    h.dispatch({ type: 'settings', patch: { amounts: 'bb' } });
    expect(h.state().settings.amounts).toBe('bb');
    expect(h.state().game).toBe(remote);
  });

  it('the data slice keeps being written', () => {
    const h = makeHarness({ tips: true });
    h.dispatch({ type: 'go', screen: 'table' });
    enter(h);
    h.dispatch({ type: 'tip', tip: 'undo' });
    h.dispatch({ type: 'close', overlay: 'tip' });
    expect(h.state().data.tips?.undo).toBe(true);
  });

  it('the coach slice empties, and this game`s comes back', () => {
    const h = makeHarness();
    const coach = { ...initialCoach(), key: 'k', status: 'ready' as const, opened: 'k' };
    h.store.setState({ coach });
    h.controller.park();
    expect(h.state().coach).toEqual(initialCoach());
    h.controller.unpark();
    expect(h.state().coach).toBe(coach);
  });

  it('the equity slice empties, and no job runs for the parked hand', async () => {
    const fake = fakeWorker({
      math: {
        // eslint-disable-next-line require-yield -- the job never finishes by itself
        *equitySteps() {
          return;
        },
        *runoutSteps() {},
        handInfo: () => {
          throw new Error('not asked');
        },
      },
      service: { now: () => 0 },
    });
    const h = table({ equity: createEquityClient(fake.spawn, realTimers) });
    await untilMode(h, 'heroTurn');
    expect(h.state().equity.situation).not.toBeNull();
    h.controller.park();
    expect(h.state().equity).toMatchObject({ status: 'off', situation: null, result: null });
    h.controller.unpark();
    expect(h.state().equity.situation).not.toBeNull();
  });
});

describe('park and unpark', () => {
  it('twice is the same as once', async () => {
    const h = table();
    await untilMode(h, 'heroTurn');
    const coach = { ...initialCoach(), key: 'k' };
    h.store.setState({ coach });
    h.controller.park();
    h.controller.park();
    h.controller.unpark();
    expect(h.state().coach).toBe(coach);
    h.controller.unpark();
    expect(h.state().coach).toBe(coach);
  });

  it('unpark without park changes nothing', async () => {
    const h = table();
    await untilMode(h, 'heroTurn');
    const game = h.state().game;
    h.controller.unpark();
    expect(h.state().game).toBe(game);
  });

  it('a game that was never parked publishes as always', async () => {
    const h = table();
    await untilMode(h, 'heroTurn');
    const before = h.state().game;
    h.dispatch({ type: 'act', action: passive(before.legal as LegalActions) });
    expect(h.state().game).not.toBe(before);
  });
});
