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
  /**
   * A weak out (§6.3, decided 6 Nov 2026, open question Q): on a paired board it only makes two
   * pair with the board's pair, or three or four of a kind of the board's rank (no hole card in
   * it). It stays an out, but it does not make the hand a draw (§8.2's bucket, §8.5, the coach's
   * draw words).
   */
  weak: boolean;
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
