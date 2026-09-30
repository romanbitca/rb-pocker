/**
 * The maths behind `equity.worker` (the `EquityMath` interface of `equityService.ts`):
 * - `equity`: `equitySteps` (§7.2–7.3): exact enumeration up to 500,000 deals, else the seeded
 *   fixed-n Monte Carlo with progress at n = 2,500 and 10,000;
 * - `equityKnown`: `runoutSteps` (§7.2): known hands of an all-in run-out, exact from the flop,
 *   a 20,000-trial Monte Carlo preflop;
 * - `handInfo` (§6): `analyzeHand` (draws, outs, risky outs, beaters, nuts) and the exact chances
 *   by the river (`chancesByRiver`, `outsChances`).
 *
 * Preflop, the chances by the river come from the build-time `finals` table (§6.6, §7.5, chunk
 * 4.4): enumerating the 2,118,760 boards here would take about 65 ms on a desktop, far above the
 * handInfo budget (< 20 ms). Until that table exists, preflop `chances` is null.
 */
import { chancesByRiver, outsChances } from '../analysis/chances.ts';
import { equitySteps, runoutSteps } from '../analysis/equity.ts';
import { analyzeHand } from '../analysis/handinfo.ts';
import type { HandAnalysis } from '../analysis/types.ts';
import type { Card } from '../core/cards.ts';
import type { EquityMath } from './equityService.ts';

/** The `handInfo` result (Appendix A.5 `HandAnalysis`) for the hero's cards and the board. */
export function handInfo(hero: readonly Card[], board: readonly Card[]): HandAnalysis {
  const { draws, outs, beaters, nuts } = analyzeHand(hero, board);
  const { nextCardPct, byRiverPct } = outsChances(outs.length, board.length);
  const chances = board.length === 0 ? null : chancesByRiver(hero, board);
  return { draws, outs, nextCardPct, byRiverPct, chances, beaters, nuts };
}

export const equityMath: EquityMath = {
  equitySteps: (hero, board, nOpp) => equitySteps({ hero, board, nOpp }),
  runoutSteps: (hands, board) => runoutSteps({ hands, board }),
  handInfo,
};
