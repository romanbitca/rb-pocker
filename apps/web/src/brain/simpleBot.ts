/**
 * SimpleBot: the temporary Stage 3 bot (PLAN §18 Stage 3). Stage 5's `decide()` and `brain.worker`
 * replace it. It decides from an `Observation` only (§4.8): this module is in `brain/`, which may
 * import nothing from the engine but types (§2.1), so it cannot see a hand state, the deck or
 * another seat's hidden cards. `app/brain.ts` serves it on the main thread behind the same async
 * request/reply interface `brain.worker` will serve (§2.2, Appendix A.6).
 *
 * The rules, exactly as §18 Stage 3 gives them:
 * - Postflop, facing a bet: call with a pair or better; otherwise fold if the bet is at least half
 *   the pot, else call. Not facing a bet: bet half the pot with two pair or better, else check.
 * - Preflop: raise to 3 bb with a pair or two cards 10 or higher (call instead when 3 bb is below
 *   the legal minimum raise-to or raising is not legal); otherwise check if free, call if the
 *   price is at most 3 bb, else fold.
 * - Every amount is snapped to a multiple of the small blind and clamped to the legal bounds.
 * "The bet" is what the bot must put in to call (`legal.toCall`) and "the pot" is §0.3's `pot`
 * (every chip in the middle, this street's bets included). Pairs and two pair count the board's
 * cards too: the bot is simple on purpose. Its decisions are a pure function of the observation.
 */
import { rankOf } from '../core/cards.ts';
import { randInt, rngFromSeed, type Seed128 } from '../core/rng.ts';
import { categoryOf, score7, type HandCategory } from '../eval/evaluate.ts';
import type { LegalActions, Observation, PlayerAction } from '../engine/types.ts';

/** Rank index of a ten (ranks 0..12 are 2..A). */
const TEN = 8;

/** The action SimpleBot takes (always legal for `obs.legal`, which must be the bot's own turn). */
export function simpleBotAction(obs: Observation): PlayerAction {
  return obs.street === 'preflop' ? preflop(obs) : postflop(obs);
}

function preflop(obs: Observation): PlayerAction {
  const { legal, bb, sb } = obs;
  const [a, b] = obs.hole;
  const high = rankOf(a) === rankOf(b) || (rankOf(a) >= TEN && rankOf(b) >= TEN);
  if (high) {
    const to = snap(3 * bb, sb);
    if (legal.raise !== null && to >= legal.raise.min) {
      return { type: 'raise', to: clamp(to, legal.raise) };
    }
    return legal.canCall ? { type: 'call' } : { type: 'check' };
  }
  if (legal.canCheck) return { type: 'check' };
  return legal.toCall <= 3 * bb ? { type: 'call' } : { type: 'fold' };
}

function postflop(obs: Observation): PlayerAction {
  const { legal } = obs;
  const made = category(obs);
  if (legal.toCall > 0) {
    if (made !== 'highCard') return { type: 'call' };
    return 2 * legal.toCall >= obs.pot ? { type: 'fold' } : { type: 'call' };
  }
  if (made !== 'highCard' && made !== 'pair' && legal.bet !== null) {
    return { type: 'bet', to: clamp(snap(obs.pot / 2, obs.sb), legal.bet) };
  }
  return { type: 'check' };
}

/** The bot's made hand with the board (5, 6 or 7 cards). */
function category(obs: Observation): HandCategory {
  const cards = [...obs.hole, ...obs.board];
  return categoryOf(score7(cards, cards.length));
}

/** The nearest multiple of the small blind. */
const snap = (x: number, sb: number): number => Math.round(x / sb) * sb;

const clamp = (to: number, bounds: NonNullable<LegalActions['bet']>): number =>
  Math.min(bounds.max, Math.max(bounds.min, to));

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

/** §9.8 bounds: every think time is clamped to 300–3,000 ms; all-in decisions take ≥ 1,500 ms. */
export const THINK_MIN_MS = 300;
export const THINK_MAX_MS = 3000;
export const THINK_ALL_IN_MS = 1500;

/**
 * Think time at Normal speed (§9.8): `450 ms + 900 ms × closeness + U(0, 400 ms)`, clamped to
 * 300–3,000 ms, all-in decisions ≥ 1,500 ms. SimpleBot has no EV model, so every decision is a
 * clear one (`closeness` = 0). `U` is the first draw of the bot's decision seed (§2.4), so the
 * same decision always takes the same time. The controller applies the speed setting.
 */
export function simpleBotThinkMs(obs: Observation, action: PlayerAction, seed: Seed128): number {
  const closeness = 0;
  const jitter = randInt(rngFromSeed(seed), 401);
  let t = 450 + 900 * closeness + jitter;
  if (isAllInAction(obs.legal, action)) t = Math.max(t, THINK_ALL_IN_MS);
  return Math.min(THINK_MAX_MS, Math.max(THINK_MIN_MS, t));
}
