/**
 * Brain types (PLAN Appendix A.5). Types only: a `DecisionRecord` (A.7) stores a `Grade` and a
 * `LeakId`, and the worker protocol (A.6, `workers/protocol.ts`) carries `BrainProfile`,
 * `Decision` and `GradeResult`. Stage 5 adds the functions (`profileFor`, `COACH`, `decide`,
 * `hint`, `grade`) in their own files. `Features` (§8.2) is what `features.ts` hands the policies.
 */
import type { HandAnalysis, OutCard } from '../analysis/types.ts';
import type { Card } from '../core/cards.ts';
import type { LegalActions, PlayerAction, Street } from '../engine/types.ts';
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

// --- 5.5 guardrails / EV ---

/**
 * The §8.8 guardrails. Rule 4 has two halves, each its own rule so that each can be tested alone:
 * `allInPriceGood` (always call) and `allInPriceBad` (never call). `legalAmount` is rule 5.
 */
export type GuardrailId =
  | 'checkFree'
  | 'tooStrongToFold'
  | 'riverNoChance'
  | 'allInPriceGood'
  | 'allInPriceBad'
  | 'legalAmount';

/** What the guardrails did to a proposed action (§8.8). */
export interface GuardrailResult {
  /** The corrected action: legal whenever every rule is on. */
  action: PlayerAction;
  /** The rules that changed the action, in the order they fired ([] when it stood). */
  fired: GuardrailId[];
  /**
   * One GUARDRAIL reason per fired rule 1–4, data `{ rule, detail }` with `detail` the rule's id
   * (Appendix F.1 `{detail}`); rule 5 only snaps an amount and explains nothing.
   */
  trace: Reason[];
}

/** One §8.9 candidate: its key, the legal action and its EV in chips relative to folding. */
export interface EvCandidate {
  key: CandidateKey;
  action: PlayerAction;
  ev: number;
}

// --- 5.3 preflop / push-fold ---

/**
 * What the preflop policy (§8.3–8.4) recommends before the EV model (§8.9) and the guardrails
 * (§8.8) run: a legal action, its kind and the reason codes that explain it (the brain never
 * builds English, §8.10). `decide()` adds the numbers of `Decision`.
 */
export interface PreflopDecision {
  action: PlayerAction;
  kind: Decision['kind'];
  trace: Reason[];
}

/**
 * The preflop parts of a profile (§9.2, §9.4). The coach's are `COACH_PREFLOP_STYLE`: no noise,
 * the thresholds as written, full position awareness. A bot's come from its decision seed
 * (`preflopStyle()`): its N(0, σ) draw and its U(−j, j) draw.
 */
export interface PreflopStyle {
  /** Added to every equity the rules compare: E' = clamp(E + equityNoise, 0, 1). */
  equityNoise: number;
  /** Every "rankPct ≤ X" threshold X becomes min(100, X × thresholdFactor). */
  thresholdFactor: number;
  /** 1: openPct(k); 0: openPct(4) everywhere; 0.5: the mean of the two (§9.2). */
  positionAwareness: 0 | 0.5 | 1;
}

// --- 5.4 postflop / sizing ---

/**
 * What a bet or raise is for: it picks the §8.7 row that sizes it. `value` (Monster or Strong),
 * `protect` (a Strong raise on a Wet or Very wet board), `thinValue` (Medium, 1/3 pot),
 * `semiBluff` (a Draw), `cbet` (Air, the flop continuation bet), `bluff` (bots only: the policy
 * never bluffs; chunk 5.7 sizes its bluff candidates with it).
 */
export type BetPurpose = 'value' | 'protect' | 'thinValue' | 'semiBluff' | 'cbet' | 'bluff';

/** A profile's size set (§9.2 "Sizes"): `BrainProfile.sizing`. */
export type SizeSet = BrainProfile['sizing'];

/**
 * The facts the postflop policy (§8.5) and the sizing (§8.7) read beyond `Features`, all taken
 * from the `Observation` by `postflopSpot(obs)`. Chips are integers.
 */
export interface PostflopSpot {
  hole: [Card, Card];
  board: Card[];
  sb: number;
  bb: number;
  /** The hero's own legal bounds (the hero is to act). */
  legal: LegalActions;
  /** The street's highest bet ("to"): what a call matches. */
  currentBet: number;
  /** The hero's chips already in on this street. */
  heroStreetBet: number;
  /** The hero's chips behind, before acting. */
  heroStack: number;
  /** §8.5 implied odds: min(the hero's chips behind after calling, the deepest live opponent's). */
  stackBehind: number;
  /** §6.3 outs with the hand each makes (flop and turn; [] on the river). */
  outCards: OutCard[];
  /** §6.5: no two-card hand beats the hero's hand now. */
  nuts: boolean;
  /** Earlier postflop streets of this hand on which the hero bet or raised (§8.5 rule 6). */
  heroBetStreets: number;
}

/** A rule action before sizing (§8.2 `act = policy(f)`): the kind, and for a bet or raise its row. */
export interface PolicyIntent {
  kind: 'fold' | 'check' | 'call' | 'bet' | 'raise';
  /** Which §8.7 row sizes a bet or raise; null otherwise. */
  purpose: BetPurpose | null;
  /** A bet or raise that goes all-in whatever its row says (§8.5 rule 6: committed, SPR ≤ 3). */
  allIn: boolean;
}

/**
 * What a policy returns: the Appendix A.5 `Decision` fields a policy fills. `action` is legal for
 * the observation it came from ("raise to", snapped to the small blind); `trace` holds reason
 * codes (main first) whose `data` are numbers (chips, fractions in [0, 1]) and keys, never English.
 */
export type PolicyDecision = Pick<Decision, 'action' | 'kind' | 'trace'>;
