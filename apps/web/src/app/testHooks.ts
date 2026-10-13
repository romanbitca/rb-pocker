/**
 * Test hooks for development and E2E builds only (PLAN "Testing strategy" → Rules, §18 Stage 3):
 * - `?seed=<hex>` fixes the table and hand seeds, so a run can be repeated exactly;
 * - `?script=<name>` (Stage 6): scripted bots and grades instead of brain.worker
 *   (`app/botScripts.ts`);
 * - `window.__pc` exposes the store state, `dispatch` and the controller's logs.
 *
 * ⚠️ Never in a production build. main.tsx loads this module only behind the build constant
 * `__PC_TEST_HOOKS__` (vite.config.ts: true for `vite` dev, Vitest and `vite build --mode e2e`,
 * false for a normal `vite build`), so the production bundle does not contain it
 * (tests/app/testHooks.bundle.test.ts builds both and searches the output for `TEST_HOOKS_MARKER`
 * and `__pc`). The saved game already holds the deck (§14.5); these hooks only make it easy to
 * reach in test builds.
 */
import { deriveSeed, type Seed128 } from '../core/rng.ts';
export { scriptedBrain, scriptFromSearch, SCRIPT_HOOK_MARKER } from './botScripts.ts';
import type {
  ControllerLogs,
  ControllerSnapshot,
  SeedSource,
  TableController,
} from './controller.ts';
import type { AppState, AppStore, Command, EquitySlice } from './store.ts';

/** Present in every build that has the hooks, and in no other (the bundle test looks for it). */
export const TEST_HOOKS_MARKER = 'rb-pc-test-hooks-v1';

/**
 * The seed in `?seed=<hex>`: 1 to 32 hex digits, case-insensitive, left-padded with zeros to a
 * `Seed128`. Anything else (or no `seed`) gives null: the game uses random seeds.
 */
export function seedFromSearch(search: string): Seed128 | null {
  const raw = new URLSearchParams(search).get('seed');
  if (raw === null || !/^[0-9a-f]{1,32}$/i.test(raw)) return null;
  return raw.toLowerCase().padStart(32, '0');
}

/**
 * Fixed seeds from one seed: the first table of the page uses `seed` itself, table n ≥ 1 uses
 * `deriveSeed(seed, 'table', n)`; the hand with `handSeq` k uses `deriveSeed(seed, 'hand', k)`.
 * handSeq is global (§14.3), so the same actions give the same game.
 */
export function fixedSeeds(seed: Seed128): SeedSource {
  let tables = 0;
  return {
    tableSeed: () => {
      const n = tables++;
      return n === 0 ? seed : deriveSeed(seed, 'table', n);
    },
    handSeed: (handSeq) => deriveSeed(seed, 'hand', handSeq),
  };
}

/** `window.__pc`. */
export interface PcHooks {
  marker: typeof TEST_HOOKS_MARKER;
  /** The seed from `?seed=`, or null. */
  seed: Seed128 | null;
  /** The bot script from `?script=`, or null. */
  script: string | null;
  /** The whole store state (it holds the full hand state: test builds only). */
  state(): AppState;
  dispatch(cmd: Command): void;
  /** The controller's logs: events, errors, brain requests and replies, voided hands. */
  logs(): ControllerLogs;
  /** The controller's hand state and the current hand's inputs. */
  snapshot(): ControllerSnapshot;
  /**
   * Writes the `equity` slice as the equity jobs would (E2E and screenshots: the win badge, draw
   * chips and "By river" column in a chosen state, without the worker).
   */
  setEquity(slice: EquitySlice): void;
}

/** Sets `window.__pc`; returns it. */
export function installTestHooks(
  win: Window,
  store: AppStore,
  controller: TableController,
  seed: Seed128 | null,
  script: string | null = null,
): PcHooks {
  const hooks: PcHooks = {
    marker: TEST_HOOKS_MARKER,
    seed,
    script,
    state: () => store.getState(),
    dispatch: (cmd) => store.getState().dispatch(cmd),
    logs: () => controller.logs(),
    snapshot: () => controller.snapshot(),
    setEquity: (slice) => store.setState({ equity: slice }),
  };
  (win as Window & { __pc?: PcHooks }).__pc = hooks;
  return hooks;
}
