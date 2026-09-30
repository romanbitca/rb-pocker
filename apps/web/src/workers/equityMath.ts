/**
 * The maths behind `equity.worker` (the `EquityMath` interface of `equityService.ts`):
 * - `equity`: `equitySteps` (§7.2–7.3): exact enumeration up to 500,000 deals, else the seeded
 *   fixed-n Monte Carlo with progress at n = 2,500 and 10,000;
 * - `equityKnown`: `runoutSteps` (§7.2): known hands of an all-in run-out, exact from the flop,
 *   a 20,000-trial Monte Carlo preflop;
 * - `handInfo` (§6): `analyzeHand` (draws, outs, risky outs, beaters, nuts) and the exact chances
 *   by the river (`chancesByRiver`, `outsChances`).
 *
 * Preflop, both come from the build-time tables (§7.2, §7.5, §6.6; `analysis/preflop.ts`, chunk
 * 4.4): the win chance is a lookup (`preflopEquity`: one final result at once, 500,000 trials
 * behind it, well inside the 50 ms budget) and the chances by the river are the exact `finals`
 * row (`preflopChances`): enumerating the 2,118,760 boards here would take about 65 ms on a
 * desktop, far above the handInfo budget (< 20 ms).
 */
import { chancesByRiver, outsChances } from '../analysis/chances.ts';
import { equitySteps, runoutSteps } from '../analysis/equity.ts';
import { analyzeHand } from '../analysis/handinfo.ts';
import { preflopChances, preflopEquity } from '../analysis/preflop.ts';
import type { HandAnalysis } from '../analysis/types.ts';
import type { Card } from '../core/cards.ts';
import type { EquityMath } from './equityService.ts';

/** The `handInfo` result (Appendix A.5 `HandAnalysis`) for the hero's cards and the board. */
export function handInfo(hero: readonly Card[], board: readonly Card[]): HandAnalysis {
  const { draws, outs, beaters, nuts } = analyzeHand(hero, board);
  const { nextCardPct, byRiverPct } = outsChances(outs.length, board.length);
  const chances = board.length === 0 ? preflopChances(hero) : chancesByRiver(hero, board);
  return { draws, outs, nextCardPct, byRiverPct, chances, beaters, nuts };
}

export const equityMath: EquityMath = {
  // Before the flop (§7.2): the table's cell as the one and final step. A bad request throws at
  // once, like `equitySteps`.
  equitySteps: (hero, board, nOpp) =>
    board.length === 0 ? [preflopEquity(hero, nOpp)].values() : equitySteps({ hero, board, nOpp }),
  runoutSteps: (hands, board) => runoutSteps({ hands, board }),
  handInfo,
};
