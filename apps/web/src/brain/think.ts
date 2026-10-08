/**
 * Bot think time (PLAN §9.8): how long a bot "thinks" at Normal speed. `brain.worker` computes it
 * with every decision and sends it as `thinkMs`; the controller applies the speed setting and
 * waits `max(think time, compute time)`.
 *
 * `t = 450 ms + 900 ms × closeness + U(0, 400 ms)`, clamped to 300–3,000 ms; an all-in decision
 * takes at least 1,500 ms. `closeness = 1 − min(1, EVgap / pot / 0.2)`: a clear decision (one
 * candidate far ahead) is quick, a close one slow. `EVgap` is the gap between the two best
 * candidate EVs of the decision (`Decision.ev`); a decision with fewer than two EVs counts as
 * clear. `U` is the first draw of `deriveSeed(seed, 'think')`, a stream of the bot's decision seed
 * (§2.4) of its own: `decide()` draws its noise and mixing from the seed's other streams (chunk
 * 5.7), so the same decision always takes the same time and the two never share a draw.
 */
import { deriveSeed, randInt, rngFromSeed, type Seed128 } from '../core/rng.ts';
import type { LegalActions, Observation, PlayerAction } from '../engine/types.ts';
import type { Decision } from './types.ts';

/** §9.8 bounds: every think time is clamped to 300–3,000 ms; all-in decisions take ≥ 1,500 ms. */
export const THINK_MIN_MS = 300;
export const THINK_MAX_MS = 3000;
export const THINK_ALL_IN_MS = 1500;

/** The action puts every chip the bot has left into the pot. */
export function isAllInAction(legal: LegalActions, action: PlayerAction): boolean {
  switch (action.type) {
    case 'call':
      return legal.callIsAllIn;
    case 'bet':
      return legal.bet !== null && action.to === legal.bet.max;
    case 'raise':
      return legal.raise !== null && action.to === legal.raise.max;
    default:
      return false;
  }
}

/** 0 = a clear decision, 1 = the two best candidates are worth the same (§9.8). */
export function closeness(ev: Decision['ev'], pot: number): number {
  const best = Object.values(ev)
    .filter((x): x is number => x !== undefined && Number.isFinite(x))
    .sort((a, b) => b - a);
  const [first, second] = best;
  if (first === undefined || second === undefined || !(pot > 0)) return 0;
  return 1 - Math.min(1, (first - second) / pot / 0.2);
}

/** Think time at Normal speed for `decision`, in whole milliseconds (§9.8). */
export function thinkMs(obs: Observation, decision: Decision, seed: Seed128): number {
  const jitter = randInt(rngFromSeed(deriveSeed(seed, 'think')), 401);
  let t = 450 + 900 * closeness(decision.ev, obs.pot) + jitter;
  if (isAllInAction(obs.legal, decision.action)) t = Math.max(t, THINK_ALL_IN_MS);
  return Math.round(Math.min(THINK_MAX_MS, Math.max(THINK_MIN_MS, t)));
}
