/**
 * Scripted bots for development and E2E builds: `?script=<name>` (PLAN §18 Stage 6, next to the
 * Stage 3 `?seed=` hook). The bots follow a named script instead of `brain.worker`, and so do the
 * hero's grades until chunk 6.1 brings `grade()`: with a fixed seed a run is the same every time,
 * e.g. the scripted blunder of Stage 6 acceptance 2.
 *
 * ⚠️ Loaded only through `app/testHooks.ts`, which main.tsx imports behind `__PC_TEST_HOOKS__`:
 * never in a production build (tests/app/testHooks.bundle.test.ts searches the built files for
 * `SCRIPT_HOOK_MARKER`).
 *
 * The scripted "worker" runs on the main thread inside a real brain client (`createBrainClient`),
 * so job ids, epochs, cancels and timeouts behave as with `brain.worker`; replies arrive on a later
 * microtask, like `postMessage`. It sees what the worker would see: observations only (§4.8).
 */
import { feedbackLine } from '../brain/explain.ts';
import type { Decision, GradeResult } from '../brain/types.ts';
import type { LegalActions, Observation, PlayerAction } from '../engine/types.ts';
import type { BrainReply, BrainRequest } from '../workers/protocol.ts';
import {
  createBrainClient,
  type BrainClient,
  type ClientTimers,
  type SpawnWorker,
} from './workerClient.ts';

/** Present in every build that has the script hook, and in no other (the bundle test looks). */
export const SCRIPT_HOOK_MARKER = 'rb-pc-script-hook-v1';

type GradeRequest = Extract<BrainRequest, { kind: 'grade' }>;

export interface BotScript {
  /** What the bot at `obs.seat` does (always legal). */
  act(obs: Observation): PlayerAction;
  /** The grade of a hero decision; null answers `error` (as brain.worker before 6.1). */
  grade(req: GradeRequest): GradeResult | null;
  /** The bots' think time at Normal speed, ms (§9.8). */
  thinkMs: number;
}

const passive = (legal: LegalActions): PlayerAction =>
  legal.canCheck ? { type: 'check' } : { type: 'call' };

/** §0.3: the price of the observer's call, with the capped pot it can win. */
function needOf(obs: Observation): number {
  const toCall = obs.legal.callAmount;
  if (toCall <= 0) return 0;
  const own = obs.totalBets[obs.seat] ?? 0;
  let winPot = own;
  obs.totalBets.forEach((bet, s) => {
    if (s !== obs.seat && obs.dealtIn[s] === true) winPot += Math.min(bet, own + toCall);
  });
  return toCall / (winPot + toCall);
}

/** A Best grade: the move taken was the coach's. */
function best(req: GradeRequest): GradeResult {
  return {
    decisionId: req.decisionId,
    grade: 'best',
    rec: req.taken,
    taken: req.taken,
    lossChips: 0,
    lossPot: 0,
    lossMilliBB: 0,
    leak: null,
    trace: [],
    feedback: null,
  };
}

/** A fold facing a bet with the best hand: a Big mistake; the coach calls (F.5 price row). */
function foldedTheBest(req: GradeRequest): GradeResult {
  const { obs } = req;
  const pot = obs.pot;
  return {
    decisionId: req.decisionId,
    grade: 'blunder',
    rec: { type: 'call' },
    taken: req.taken,
    lossChips: pot,
    lossPot: 1,
    lossMilliBB: Math.round((1000 * pot) / obs.bb),
    leak: 'overfold',
    trace: [],
    feedback: feedbackLine({
      row: 'foldedPrice',
      E: req.eRandom ?? 1,
      need: needOf(obs),
      rangeAdjust: false,
    }),
  };
}

/** The named scripts. */
export const BOT_SCRIPTS: Readonly<Record<string, BotScript>> = {
  /** Everyone checks or calls; every hero decision is Best. */
  passive: {
    thinkMs: 400,
    act: (obs) => passive(obs.legal),
    grade: best,
  },
  /**
   * Bots check and call; on the river the first bot that can open bets the minimum, a small bet.
   * A hero fold facing a bet is a Big mistake (the acceptance 2 seed gives the hero the nuts on
   * that river); every other hero decision is Best.
   */
  'river-min-bet': {
    thinkMs: 400,
    act: (obs) =>
      obs.street === 'river' && obs.legal.bet !== null
        ? { type: 'bet', to: obs.legal.bet.min }
        : passive(obs.legal),
    grade: (req) =>
      req.taken.type === 'fold' && req.obs.legal.callAmount > 0 ? foldedTheBest(req) : best(req),
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

function answer(script: BotScript, msg: BrainRequest): BrainReply | null {
  switch (msg.kind) {
    case 'cancel':
      return null;
    case 'botDecision':
      return {
        kind: 'botDecision',
        jobId: msg.jobId,
        epoch: msg.epoch,
        decision: decisionOf(script.act(msg.obs)),
        thinkMs: script.thinkMs,
      };
    case 'grade': {
      const result = script.grade(msg);
      return result === null
        ? { kind: 'error', jobId: msg.jobId, epoch: msg.epoch, message: 'grade: not scripted' }
        : { kind: 'grade', jobId: msg.jobId, epoch: msg.epoch, result };
    }
    case 'hint':
      return { kind: 'error', jobId: msg.jobId, epoch: msg.epoch, message: 'hint: scripted bots' };
    case 'bench':
      return { kind: 'error', jobId: msg.jobId, epoch: 0, message: 'bench: scripted bots' };
  }
}

/** A "worker" that answers from `script` on the main thread. */
function spawnScript(script: BotScript): SpawnWorker<BrainRequest, BrainReply> {
  return (events) => {
    let live = true;
    return {
      postMessage(message) {
        if (!live) throw new Error('posted to a stopped script');
        const copy = structuredClone(message); // what a worker would receive
        void Promise.resolve().then(() => {
          if (!live) return;
          const reply = answer(script, copy);
          if (reply !== null) events.message(reply);
        });
      },
      terminate() {
        live = false;
      },
    };
  };
}

/** The brain client for `?script=<name>`. */
export function scriptedBrain(name: string, timers: ClientTimers): BrainClient {
  const script = BOT_SCRIPTS[name];
  if (script === undefined) throw new Error(`no bot script "${name}"`);
  return createBrainClient(spawnScript(script), timers);
}
