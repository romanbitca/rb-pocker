/**
 * "Bet pot every street with any two cards" (PLAN §9.7): a scripted self-play baseline, the
 * anti-exploit check (a Hard table must beat it, Stage 7). It never folds:
 * - before the flop, while nobody has raised (the current bet is still the big blind, limpers or
 *   not), it raises the size of the pot; facing a raise it calls;
 * - after the flop, when nobody has bet the street, it bets the pot; facing a bet it calls.
 * A pot-size raise goes to `currentBet + (pot + toCall)` (call, then raise by the pot that makes),
 * a pot-size bet to `pot`; §0.3's `pot` already holds every chip in the middle. Amounts are snapped
 * to a multiple of the small blind and clamped to the legal bounds; with no bet or raise legal (the
 * others are all-in) it calls or checks.
 *
 * It decides from an `Observation` only (§4.8); its action is always legal for `obs.legal`.
 */
import type { LegalActions, Observation, PlayerAction } from '../../src/engine/types.ts';

export function potBettorAction(obs: Observation): PlayerAction {
  const { legal } = obs;
  const passive: PlayerAction = legal.canCheck ? { type: 'check' } : { type: 'call' };
  const currentBet = (obs.streetBets[obs.seat] as number) + legal.toCall;
  const unopened = obs.street === 'preflop' ? currentBet <= obs.bb : currentBet === 0;
  if (!unopened) return passive;
  const to = snap(currentBet + obs.pot + legal.toCall, obs.sb);
  if (legal.raise !== null) return { type: 'raise', to: clamp(to, legal.raise) };
  if (legal.bet !== null) return { type: 'bet', to: clamp(to, legal.bet) };
  return passive;
}

/** The nearest multiple of the small blind. */
const snap = (x: number, sb: number): number => Math.round(x / sb) * sb;

const clamp = (to: number, bounds: NonNullable<LegalActions['bet']>): number =>
  Math.min(bounds.max, Math.max(bounds.min, to));
