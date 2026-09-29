/**
 * Types of the hero-facing maths (PLAN Appendix A.5). `analysis` imports core and eval, and only
 * types from engine/types (PLAN §2.1).
 */
import type { Card } from '../core/cards.ts';
import type { HandCategory } from '../eval/evaluate.ts';

export type DrawKind =
  | 'flush'
  | 'nutFlush'
  | 'oesd'
  | 'doubleGutshot'
  | 'gutshot'
  | 'overcards'
  | 'backdoorFlush'
  | 'backdoorStraight';

export type RiskRule = 'R1' | 'R2' | 'R3' | 'R4' | 'R5';

export interface OutCard {
  card: Card;
  makes: HandCategory;
  risky: RiskRule[];
}

/** The equity.worker 'handInfo' result (§6). */
export interface HandAnalysis {
  draws: { kind: DrawKind; outs: number }[];
  outs: OutCard[]; // union, grouped in UI by `makes`
  nextCardPct: number | null;
  byRiverPct: number | null;
  chances: Record<HandCategory, { exactly: number; atLeast: number; boardShared: boolean }> | null;
  beaters: { count: number; total: number } | null;
  nuts: boolean;
}

export interface EquityResult {
  n: number;
  win: number;
  split: number;
  equity: number;
  exact: boolean;
  final: boolean;
  truncated: boolean;
}
