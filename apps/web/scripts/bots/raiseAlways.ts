/**
 * "Raise every hand" (PLAN §9.7): a scripted self-play baseline. Whenever a bet or a raise is
 * legal it makes the smallest one (`legal.bet.min` / `legal.raise.min`, which is all-in when the
 * stack is short of a full raise); otherwise it calls, or checks when that is free. It never folds.
 * Before the flop that is a min-raise with any two cards; after it, a minimum bet or raise on
 * every street. Hard bots must beat it (§9.7, Stage 7).
 *
 * It decides from an `Observation` only (§4.8); its action is always legal for `obs.legal`.
 */
import type { Observation, PlayerAction } from '../../src/engine/types.ts';

export function raiseAlwaysAction(obs: Observation): PlayerAction {
  const { legal } = obs;
  if (legal.raise !== null) return { type: 'raise', to: legal.raise.min };
  if (legal.bet !== null) return { type: 'bet', to: legal.bet.min };
  return legal.canCheck ? { type: 'check' } : { type: 'call' };
}
