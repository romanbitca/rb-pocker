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
 * - Timeouts (main thread): equity 4,000 ms (above the worker's own 3 s `truncated` cap, so a
 *   truncated reply still lands); bot decision 2,000 ms; grade 1,500 ms.
 * - The Monte Carlo seed text (§7.3) writes hero cards sorted by `Card` value descending and the
 *   board in deal order.
 */
import type { EquityResult, HandAnalysis } from '../analysis/types.ts';
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

export type EquityReply =
  /** Several; the last has `result.final: true`. */
  | { kind: 'equity'; jobId: number; epoch: number; result: EquityResult }
  | {
      kind: 'equityKnown';
      jobId: number;
      epoch: number;
      perPlayer: number[];
      exact: boolean;
      final: boolean;
    }
  | { kind: 'handInfo'; jobId: number; epoch: number; analysis: HandAnalysis }
  | {
      kind: 'bench';
      jobId: number;
      result: { evalsPerSec: number; eq8Ms: number; eqFlopMs: number; ua: string };
    }
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
  | { kind: 'hint'; jobId: number; epoch: number; decision: Decision }
  | { kind: 'grade'; jobId: number; epoch: number; result: GradeResult }
  | { kind: 'bench'; jobId: number; result: { hintP50Ms: number; hintP95Ms: number } }
  | { kind: 'error'; jobId: number; epoch: number; message: string };
