/**
 * Scripted bots for development and E2E builds: `?script=<name>` (PLAN §18 Stage 6, next to the
 * Stage 3 `?seed=` hook). The bots follow a named script instead of `brain.worker`'s `decide()`;
 * the coach does not: hints and grades still come from the real `brain.worker` (chunk 6.1), so a
 * scripted run is graded exactly as the app grades. With a fixed seed a run is the same every
 * time (the coach is deterministic too, §2.4), e.g. the scripted blunder of Stage 6 acceptance 2.
 *
 * ⚠️ Loaded only through `app/testHooks.ts`, which main.tsx imports behind `__PC_TEST_HOOKS__`:
 * never in a production build (tests/app/testHooks.bundle.test.ts searches the built files for
 * `SCRIPT_HOOK_MARKER`).
 *
 * The scripted "worker" sits in front of the real one inside a real brain client
 * (`createBrainClient`), so job ids, epochs, cancels, timeouts and restarts behave as with
 * `brain.worker` alone: a `botDecision` is answered from the script on a later microtask, like
 * `postMessage`; every other message (hint, grade, bench, cancel) goes on to `brain.worker`, whose
 * replies come back through the same client. The script sees what the worker would see:
 * observations only (§4.8).
 */
import type { Decision } from '../brain/types.ts';
import type { LegalActions, Observation, PlayerAction } from '../engine/types.ts';
import type { BrainReply, BrainRequest } from '../workers/protocol.ts';
import { spawnBrainWorker } from '../workers/spawn.ts';
import {
  createBrainClient,
  fromWorker,
  type BrainClient,
  type ClientTimers,
  type SpawnWorker,
} from './workerClient.ts';

/** Present in every build that has the script hook, and in no other (the bundle test looks). */
export const SCRIPT_HOOK_MARKER = 'rb-pc-script-hook-v1';

export interface BotScript {
  /** What the bot at `obs.seat` does (always legal). */
  act(obs: Observation): PlayerAction;
  /** The bots' think time at Normal speed, ms (§9.8). */
  thinkMs: number;
}

const passive = (legal: LegalActions): PlayerAction =>
  legal.canCheck ? { type: 'check' } : { type: 'call' };

/** The named scripts. */
export const BOT_SCRIPTS: Readonly<Record<string, BotScript>> = {
  /** Everyone checks or calls. */
  passive: {
    thinkMs: 400,
    act: (obs) => passive(obs.legal),
  },
  /**
   * Bots check and call; on the river the first bot that can open bets the minimum, a small bet.
   * With `?seed=46` and 3 players the hero holds the nut flush on the river of hand 1 and faces
   * that bet: folding there is the scripted blunder of Stage 6 acceptance 2.
   */
  'river-min-bet': {
    thinkMs: 400,
    act: (obs) =>
      obs.street === 'river' && obs.legal.bet !== null
        ? { type: 'bet', to: obs.legal.bet.min }
        : passive(obs.legal),
  },
};

/** The script named by `?script=<name>`, if there is one by that name. */
export function scriptFromSearch(search: string): string | null {
  const name = new URLSearchParams(search).get('script');
  return name !== null && Object.hasOwn(BOT_SCRIPTS, name) ? name : null;
}

/** A bot decision that is only an action (the controller reads nothing else of it). */
function decisionOf(action: PlayerAction): Decision {
  const kind = action.type;
  return {
    action,
    kind,
    ev: {},
    eRandom: 0,
    eRange: 0,
    need: 0,
    bucket: null,
    strength: 'weak',
    confidence: 'normal',
    alt: null,
    trace: [],
  };
}

/**
 * A "worker" that answers bot decisions from `script` on the main thread and passes everything
 * else to the coach's worker, started by `coach` with the same events.
 */
function spawnScript(
  script: BotScript,
  coach: SpawnWorker<BrainRequest, BrainReply>,
): SpawnWorker<BrainRequest, BrainReply> {
  return (events) => {
    let live = true;
    const worker = coach(events);
    return {
      postMessage(message) {
        if (!live) throw new Error('posted to a stopped script');
        if (message.kind !== 'botDecision') {
          worker.postMessage(message);
          return;
        }
        const copy = structuredClone(message); // what a worker would receive
        void Promise.resolve().then(() => {
          if (!live) return;
          events.message({
            kind: 'botDecision',
            jobId: copy.jobId,
            epoch: copy.epoch,
            decision: decisionOf(script.act(copy.obs)),
            thinkMs: script.thinkMs,
          });
        });
      },
      terminate() {
        live = false;
        worker.terminate();
      },
    };
  };
}

/**
 * The worker of `?script=<name>`: the script's bots, and the coach of `coach` (default: a real
 * `brain.worker`; tests pass a fake one) for everything else.
 */
export function scriptedSpawn(
  name: string,
  coach: SpawnWorker<BrainRequest, BrainReply> = fromWorker(spawnBrainWorker),
): SpawnWorker<BrainRequest, BrainReply> {
  const script = BOT_SCRIPTS[name];
  if (script === undefined) throw new Error(`no bot script "${name}"`);
  return spawnScript(script, coach);
}

/** The brain client for `?script=<name>` (see `scriptedSpawn`). */
export function scriptedBrain(
  name: string,
  timers: ClientTimers,
  coach: SpawnWorker<BrainRequest, BrainReply> = fromWorker(spawnBrainWorker),
): BrainClient {
  return createBrainClient(scriptedSpawn(name, coach), timers);
}
