/**
 * "Call everything" (PLAN §9.7): a scripted self-play baseline. It checks when checking is free
 * and calls any bet otherwise, all-in for less included; it never folds, bets or raises. Hard bots
 * must beat it (§9.7, Stage 7).
 *
 * Like every baseline in `scripts/bots/`, it decides from an `Observation` only (§4.8) and its
 * action is always legal for `obs.legal`.
 */
import type { Observation, PlayerAction } from '../../src/engine/types.ts';

export function callAlwaysAction(obs: Observation): PlayerAction {
  return obs.legal.canCheck ? { type: 'check' } : { type: 'call' };
}
