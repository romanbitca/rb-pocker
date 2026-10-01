/**
 * SimpleBot: the Stage 3 bot (PLAN §18 Stage 3), now a scripted self-play baseline (§0.1
 * `scripts/bots/`, §9.7; `scripts/selfplay.ts` imports it from here). The game's bots run the real
 * brain in `brain.worker`; until chunk 5.7 adds `decide()`, the worker runs a copy of these rules,
 * `src/brain/standIn.ts` (the §2.1 boundary keeps `src/` from importing `scripts/`; the test
 * `tests/brain/standIn.test.ts` checks the two decide alike). Chunk 5.7 deletes the copy.
 *
 * It decides from an `Observation` only (§4.8): a pure function of it, so it cannot see a hand
 * state, the deck or another seat's hidden cards.
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
 * cards too: the bot is simple on purpose.
 */
import { rankOf } from '../../src/core/cards.ts';
import { categoryOf, score7, type HandCategory } from '../../src/eval/evaluate.ts';
import type { LegalActions, Observation, PlayerAction } from '../../src/engine/types.ts';

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
