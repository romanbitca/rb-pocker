/**
 * Brain types (PLAN Appendix A.5). Types only: a `DecisionRecord` (A.7) stores a `Grade` and a
 * `LeakId`, and the worker protocol (A.6, `workers/protocol.ts`) carries `BrainProfile`,
 * `Decision` and `GradeResult`. Stage 5 adds the functions (`profileFor`, `COACH`, `decide`,
 * `hint`, `grade`) in their own files.
 */
import type { PlayerAction } from '../engine/types.ts';

/** The five grades of a hero decision, best first (§8.9). */
export type Grade = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

/** Leak tags attached to a graded mistake (§8.9). */
export type LeakId =
  | 'open-loose'
  | 'open-tight'
  | 'limp'
  | 'call-pre-wide'
  | 'fold-pre-much'
  | 'pushfold'
  | 'missed-value'
  | 'bluff-much'
  | 'overfold'
  | 'chase'
  | 'river-call'
  | 'call-light'
  | 'sizing';

/** Named BrainProfile so it never collides with the persisted Profile (A.7). */
export interface BrainProfile {
  /** "tag/hard" or "coach". */
  id: string;
  looseness: number;
  pfrRatio: number;
  aggressionBias: number;
  bluffFreq: number;
  bluff3betFreq: number;
  stickiness: number;
  slowplayFreq: number;
  equityNoiseSD: number;
  mcTrials: number;
  rangeModel: 'random' | 'static' | 'reweight' | 'reweight+stats';
  positionAwareness: 0 | 0.5 | 1;
  sizing: 'half' | 'two' | 'texture' | 'texture+exploit';
  temperature: number;
  defenseFactor: number;
  preflopJitter: number;
  exploit: boolean;
  deterministic: boolean;
  neverLimp: boolean;
}

export type Bucket = 'monster' | 'strong' | 'medium' | 'draw' | 'air';
export type Texture = 'dry' | 'wet' | 'veryWet';
export type CandidateKey =
  'fold' | 'check' | 'call' | `bet:${number}` | `raise:${number}` | 'allin';

export type ReasonCode =
  | 'OPEN_RANGE'
  | 'FOLD_RANGE'
  | 'ISOLATE'
  | 'CHECK_FREE'
  | 'THREE_BET_VALUE'
  | 'FOUR_BET_VALUE'
  | 'CALL_PREFLOP'
  | 'FOLD_VS_RAISE'
  | 'SET_MINING'
  | 'CALL_PROFITABLE'
  | 'FOLD_PRICE'
  | 'IMPLIED'
  | 'VALUE_BET'
  | 'VALUE_RAISE'
  | 'RAISE_PROTECT'
  | 'THIN_VALUE'
  | 'POT_CONTROL'
  | 'SEMI_BLUFF'
  | 'CBET_DRY'
  | 'CHECK_WEAK'
  | 'PUSH_FOLD'
  | 'CALL_ALLIN'
  | 'FOLD_ALLIN'
  | 'COMMITTED'
  | 'NUTS'
  | 'BOARD_PLAYS'
  | 'RANGE_ADJUST'
  | 'WHY_NOT_FOLD'
  | 'WHY_NOT_CHECK'
  | 'WHY_NOT_CALL'
  | 'WHY_NOT_BET'
  | 'WHY_NOT_RAISE'
  | 'CLOSE_SPOT'
  | 'GUARDRAIL'
  | 'RULE_2_4'
  | 'RULE_2_4_BIG';

export interface Reason {
  code: ReasonCode;
  data: Record<string, number | string>;
}

export interface Decision {
  /** Always legal. */
  action: PlayerAction;
  kind: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';
  /** Chips vs folding. */
  ev: Partial<Record<CandidateKey, number>>;
  eRandom: number;
  eRange: number;
  need: number;
  /** null preflop. */
  bucket: Bucket | null;
  strength: 'weak' | 'marginal' | 'decent' | 'strong' | 'monster';
  confidence: 'clear' | 'normal' | 'close';
  alt: PlayerAction | null;
  trace: Reason[];
}

export interface GradeResult {
  decisionId: number;
  grade: Grade;
  rec: PlayerAction;
  taken: PlayerAction;
  lossChips: number;
  lossPot: number;
  /** Integer. */
  lossMilliBB: number;
  leak: LeakId | null;
  trace: Reason[];
}
