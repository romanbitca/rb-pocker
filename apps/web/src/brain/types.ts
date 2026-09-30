/**
 * Brain types (PLAN Appendix A.5). Types only: a `DecisionRecord` (A.7) stores a `Grade` and a
 * `LeakId`, and the worker protocol (A.6, `workers/protocol.ts`) carries `BrainProfile`,
 * `Decision` and `GradeResult`. Stage 5 adds the functions (`profileFor`, `COACH`, `decide`,
 * `hint`, `grade`) in their own files. `Features` (§8.2) is what `features.ts` hands the policies.
 */
import type { HandAnalysis } from '../analysis/types.ts';
import type { PlayerAction, Street } from '../engine/types.ts';
import type { HandInfo } from '../eval/describe.ts';
import type { OpponentRange } from './ranges.ts';

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

/** What the hero faces on this street (§8.2 `facing`). */
export type Facing = 'none' | 'limpers' | 'open' | '3bet' | '4bet+' | 'bet' | 'raise' | 'allin';
export type Position = 'IP' | 'OOP';

/** The §8.2 features of one decision (chips are integers, fractions in [0, 1]). */
export interface Features {
  street: Street;
  /** Σ totalBet (§0.3). */
  pot: number;
  /** min(currentBet − streetBet, stack): the chips a call puts in. */
  toCall: number;
  /** §0.3 pot the hero can win after calling (== pot when the hero covers the bet). */
  winPot: number;
  /** toCall / (winPot + toCall); 0 when toCall == 0. */
  need: number;
  /** min(hero chips, largest live opponent's chips), chips = stack + streetBet (street start). */
  effStack: number;
  effBB: number;
  /** effStack ÷ the pot at the start of the street (preflop: the blinds). */
  spr: number;
  /** Preflop: dealt-in, unfolded players still to act after the hero, blinds included. */
  k: number;
  position: Position;
  /** Live opponents. */
  nOpp: number;
  /** HUD equity vs random hands (coach; bots: = eRange). */
  eRandom: number;
  /** Equity vs the estimated ranges (§8.6). */
  eRange: number;
  /** Per-opponent strength eRange^(1/nOpp). */
  p: number;
  /** null preflop. */
  bucket: Bucket | null;
  /** null preflop. */
  texture: Texture | null;
  facing: Facing;
  wasPreflopAggressor: boolean;
  handInfo: HandInfo;
  /** §6.2 draws (flop and turn), [] otherwise. */
  draws: HandAnalysis['draws'];
  /** §6.3 outs (flop and turn), 0 otherwise. */
  outs: number;
  /** Starting-hand percentile (§8.3). */
  rankPct: number;
  /** §8.10: the coach must show both equities (RANGE_ADJUST). */
  rangeAdjust: boolean;
  /** The ranges behind eRange, reused by the EV model (§8.9). */
  ranges: OpponentRange[];
}
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
