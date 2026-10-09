/**
 * The real app store and a TableController with fixed seeds, for component tests that render the
 * Table or the App (jsdom, Vitest fake timers). The UI reads the app's one store (`appStore`), so
 * each test resets it; the controller's timers follow the fake clock.
 */
import { act } from '@testing-library/react';
import { vi } from 'vitest';
import { createTableController, type TableController } from '../../src/app/controller.ts';
import type { Grader } from '../../src/app/grading.ts';
import { installBackHandler } from '../../src/app/lifecycle.ts';
import {
  appStore,
  defaultGameSettings,
  initialCoach,
  initialGame,
  initialUi,
  type AppState,
  type GameSettings,
} from '../../src/app/store.ts';
import { fixedSeeds } from '../../src/app/testHooks.ts';
import type { BrainClient } from '../../src/app/workerClient.ts';
import type { Seed128 } from '../../src/core/rng.ts';
import type { LegalActions, PlayerAction } from '../../src/engine/types.ts';
import { testBrain } from '../workers/fakeBrainWorker.ts';

export const TABLE_SEED: Seed128 = '5eed0000000000000000000000000034';

export interface TableHarness {
  controller: TableController;
  state(): AppState;
  /** Stops the controller and the Back handler; real timers again. */
  dispose(): void;
}

/**
 * A fresh store on Home and a booted controller; `play` is not sent yet. `hints`: ask the brain
 * for the coach's hint at every hero decision (chunk 5.7). `brain`: the brain client (default
 * `testBrain()`: SimpleBot bots and the real coach, `coachHint`; `coachBrain` holds or fails it).
 */
export function startTableHarness(
  options: {
    seed?: Seed128;
    settings?: Partial<GameSettings>;
    hints?: boolean;
    brain?: BrainClient;
    grader?: Grader;
  } = {},
): TableHarness {
  vi.useFakeTimers();
  window.history.replaceState(null, '');
  const settings = { ...defaultGameSettings(), ...options.settings };
  if (options.settings?.players !== undefined && options.settings.seatLevels === undefined) {
    settings.seatLevels = new Array<null>(settings.players).fill(null);
  }
  appStore.setState({ game: initialGame(), ui: initialUi(false), coach: initialCoach(), settings });
  const controller = createTableController({
    store: appStore,
    brain: options.brain ?? testBrain(),
    heroName: 'You',
    seeds: fixedSeeds(options.seed ?? TABLE_SEED),
    ...(options.hints !== undefined && { hints: options.hints }),
    ...(options.grader !== undefined && { grader: options.grader }),
  });
  controller.boot();
  const unhook = installBackHandler(window, appStore);
  return {
    controller,
    state: () => appStore.getState(),
    dispose() {
      unhook();
      controller.dispose();
      vi.useRealTimers();
    },
  };
}

/** Passive hero: check when free, else call. */
export const passive = (legal: LegalActions): PlayerAction =>
  legal.canCheck ? { type: 'check' } : { type: 'call' };

/** Runs the next due timer inside `act` (bot replies are promises: let them land too). */
export async function nextTimer(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersToNextTimerAsync();
  });
}

/** Moves the fake clock by `ms` inside `act`. */
export async function elapse(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/**
 * Plays until `done()` holds: the hero acts with `hero` on its turns, timers run otherwise.
 * `onStep` runs after every step (DOM checks); `beforeHero` on each hero turn, before the hero
 * acts (e.g. to let a coach hint land, or open the coach sheet), and `done()` is asked again
 * after it. Throws after `maxSteps`.
 */
export async function playUntil(
  done: () => boolean,
  options: {
    hero?: (legal: LegalActions) => PlayerAction;
    onStep?: () => void;
    beforeHero?: () => Promise<void> | void;
    maxSteps?: number;
  } = {},
): Promise<void> {
  const hero = options.hero ?? passive;
  const max = options.maxSteps ?? 5000;
  for (let i = 0; i < max; i++) {
    if (done()) return;
    const before = appStore.getState();
    if (before.game.mode === 'heroTurn' && before.game.legal !== null && options.beforeHero) {
      await options.beforeHero();
      if (done()) return;
    }
    const s = appStore.getState();
    if (s.game.mode === 'heroTurn' && s.game.legal !== null) {
      const action = hero(s.game.legal);
      act(() => s.dispatch({ type: 'act', action }));
    } else if (s.game.mode === 'idle' && s.ui.overlays.includes('outOfChips')) {
      act(() => s.dispatch({ type: 'reload' }));
    } else {
      await nextTimer();
    }
    options.onStep?.();
  }
  throw new Error(`playUntil: not done after ${max} steps`);
}
