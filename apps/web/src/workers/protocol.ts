/**
 * The worker protocol (PLAN Appendix A.6): the messages between the main thread and the two
 * workers. Types only (§2.1: `workers/protocol` imports only types).
 *
 * - Every job has a `jobId` (unique per client, increasing) and, except `bench` and `cancel`, the
 *   `epoch` it was made for. The main thread drops any reply whose `epoch` is not current or whose
 *   `jobId` is not the latest for its kind (per seat for `botDecision`); `app/workerClient.ts`
 *   does this.
 * - ⚠️ `equity.worker` receives the hero's hole cards, the board and the number of live
 *   opponents; face-up hands only during an all-in run-out (`equityKnown`, only seats in
 *   `hand.revealed`). Never an unrevealed bot card (§2.2, pitfall 13). Folded players' cards are
 *   not sent: they are unknown and stay in the pool (pitfall 14).
 * - `equity` replies are progressive: several, the last with `result.final === true`
 *   (Monte Carlo at n = 2,500 and 10,000, then the final; an exact enumeration sends only the
 *   final). `equityKnown` likewise, with `final`. `handInfo` sends one reply.
 * - ⚠️ `brain.worker` receives an `Observation` built by `observe()`, a profile and a seed, and
 *   nothing else about the hand: never a `HandState`, the deck or a value derived from the hand
 *   seed (§2.2, §9.6, pitfall 13). The bot seed comes from the table seed only (§2.4).
 * - Brain replies are single replies: the first one is the last (an `error` reply too). `grade`
 *   (chunk 6.1) answers the `GradeResult` of `grade(obs, taken, eRandom, decisionId)`
 *   (`brain/grade.ts`), echoing the request's `decisionId`; an illegal move answers `error`.
 * - `botDecision` carries the bot's whole `BrainProfile` (`profileFor(personality, level)`, §9.1 ×
 *   §9.2); `hint` the hero's observation and the HUD's final win chance when the main thread
 *   already has it, else null (§8.2 `eRandom`). No coach level is ever sent: the level changes
 *   what is shown, never the advice (C4).
 * - Timeouts (main thread): equity 4,000 ms (above the worker's own 3 s `truncated` cap, so a
 *   truncated reply still lands); bot decision 2,000 ms; hint 4,000 ms (chunk 5.7: the strip says
 *   "Coach is not available" after it, §12.11); grade: the hand waits 1,500 ms for it, the job
 *   itself 5,000 ms, then one retry (§11.3 r5, `app/grading.ts`).
 * - The Monte Carlo seed text (§7.3) writes hero cards sorted by `Card` value descending and the
 *   board in deal order.
 * - Timing (§15.3 "worker timing logs", chunk 4.7): `equity`, `equityKnown` and `handInfo` replies
 *   carry `timing`, how long the job has taken in the worker so far. The client's message log
 *   keeps it (`window.__pc.logs().equity` in test builds).
 * - `bench` (§15.4, the `#bench` screen): the worker measures itself and answers once.
 */
import type { EquityResult, HandAnalysis } from '../analysis/types.ts';
import type { Explanation } from '../brain/explain.ts';
import type { BrainProfile, Decision, GradeResult } from '../brain/types.ts';
import type { Card } from '../core/cards.ts';
import type { Seed128 } from '../core/rng.ts';
import type { Observation, PlayerAction } from '../engine/types.ts';

export type EquityRequest =
  | {
      kind: 'equity';
      jobId: number;
      epoch: number;
      hero: [Card, Card];
      board: Card[];
      nOpp: number;
    }
  | { kind: 'equityKnown'; jobId: number; epoch: number; hands: [Card, Card][]; board: Card[] }
  | { kind: 'handInfo'; jobId: number; epoch: number; hero: [Card, Card]; board: Card[] }
  | { kind: 'bench'; jobId: number }
  | { kind: 'cancel'; jobId: number };

/**
 * How long a job has taken in the worker when a reply is posted (§15.3 "worker timing logs").
 * Chrome's CPU throttling (CDP `Emulation.setCPUThrottlingRate`) slows the page's main thread
 * only, never a worker, so the E2E budget check models a CPU `r` times slower as
 * `ms + (r − 1) × busyMs`: only the computing stretches, the waiting does not.
 */
export interface JobTiming {
  /** Wall time since the worker took the request off its queue, in ms. */
  ms: number;
  /** How much of `ms` the worker spent computing, on this job or on others in between. */
  busyMs: number;
}

/** The `#bench` numbers of `equity.worker` (§15.4). Times are in ms. */
export interface EquityBenchResult {
  /** Evaluations per second over 5,000,000 random seven-card hands. */
  evalsPerSec: number;
  /**
   * Time to the final HUD win chance through the worker's own job runner (time slices and pauses
   * included, as in the game), the median of three runs after a warm-up: A♥K♥ against 8
   * opponents before the flop, the same on Q♥ 7♥ 2♣, and against 1 opponent on that flop.
   */
  eq8PreflopMs: number;
  eq8FlopMs: number;
  eq1FlopMs: number;
  /** The worker's `navigator.userAgent`. */
  ua: string;
}

export type EquityReply =
  /** Several; the last has `result.final: true`. */
  | { kind: 'equity'; jobId: number; epoch: number; result: EquityResult; timing?: JobTiming }
  | {
      kind: 'equityKnown';
      jobId: number;
      epoch: number;
      perPlayer: number[];
      exact: boolean;
      final: boolean;
      timing?: JobTiming;
    }
  | {
      kind: 'handInfo';
      jobId: number;
      epoch: number;
      analysis: HandAnalysis;
      timing?: JobTiming;
    }
  | { kind: 'bench'; jobId: number; result: EquityBenchResult }
  | { kind: 'error'; jobId: number; epoch: number; message: string };

export type BrainRequest =
  | {
      kind: 'botDecision';
      jobId: number;
      epoch: number;
      obs: Observation;
      profile: BrainProfile;
      seed: Seed128;
    }
  | { kind: 'hint'; jobId: number; epoch: number; obs: Observation; eRandom: number | null }
  | {
      kind: 'grade';
      jobId: number;
      epoch: number;
      obs: Observation;
      taken: PlayerAction;
      eRandom: number | null;
      decisionId: number;
    }
  | { kind: 'bench'; jobId: number }
  | { kind: 'cancel'; jobId: number };

export type BrainReply =
  | { kind: 'botDecision'; jobId: number; epoch: number; decision: Decision; thinkMs: number }
  /** The coach's advice and `explain()` of it (chunk 5.7; the main thread renders the lines). */
  | { kind: 'hint'; jobId: number; epoch: number; decision: Decision; explanation: Explanation }
  | { kind: 'grade'; jobId: number; epoch: number; result: GradeResult }
  | { kind: 'bench'; jobId: number; result: { hintP50Ms: number; hintP95Ms: number } }
  | { kind: 'error'; jobId: number; epoch: number; message: string };
