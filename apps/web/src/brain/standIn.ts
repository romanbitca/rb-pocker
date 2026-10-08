/**
 * The stand-in `decide` (PLAN §18 Stage 5, chunk 5.8): the temporary bot brain behind
 * `brain.worker` until chunk 5.7 adds the real `decide(obs, profile, seed)` (`brain/decide.ts`).
 * It has the signature of `decide` (Appendix A.5) and returns a full `Decision`, so 5.7 only
 * changes the import in `workers/brain.worker.ts`, then deletes this file and its test.
 *
 * The rules are SimpleBot's (§18 Stage 3, the Stage 3 bot): the game plays exactly as it did
 * before the worker. They are a copy of `scripts/bots/simple.ts`, the self-play baseline SimpleBot
 * moved to: the §2.1 boundary keeps `src/` from importing `scripts/`.
 * `tests/brain/standIn.test.ts` checks both decide alike. Like the real thing, it sees an
 * `Observation` only (§4.8): `brain/` imports nothing from the engine but types.
 *
 * It has no model of the hand, so the `Decision` carries the action and `kind` and neutral values
 * for the rest (no EVs: `thinkMs` reads every decision as a clear one, §9.8).
 */
import { rankOf } from '../core/cards.ts';
import { categoryOf, score7, type HandCategory } from '../eval/evaluate.ts';
import type { LegalActions, Observation, PlayerAction } from '../engine/types.ts';
import { isAllInAction } from './think.ts';
import type { Decision } from './types.ts';

/** Rank index of a ten (ranks 0..12 are 2..A). */
const TEN = 8;

/** SimpleBot's action (always legal for `obs.legal`, which must be the bot's own turn). */
export function standInAction(obs: Observation): PlayerAction {
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

/**
 * The stand-in for `decide(obs, profile, seed)` (A.5): the same rules for every profile and no
 * randomness, so it takes neither (the think-time jitter uses the seed, `think.ts`).
 */
export function decide(obs: Observation): Decision {
  const action = standInAction(obs);
  return {
    action,
    kind: isAllInAction(obs.legal, action) ? 'allin' : action.type,
    ev: {},
    eRandom: 0,
    eRange: 0,
    need: 0,
    bucket: null,
    strength: 'marginal',
    confidence: 'clear',
    alt: null,
    trace: [],
  };
}
