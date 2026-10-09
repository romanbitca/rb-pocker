/**
 * SimpleBot (`scripts/bots/simple.ts`, the Stage 3 bot) as a `decide`, for the tests of the
 * controller and the worker plumbing: fast and deterministic, with the full `Decision` shape
 * (Appendix A.5). Chunk 5.8 ran the game on this brain (`brain/standIn.ts`); chunk 5.7 replaced it
 * with the real `decide()`, whose own tests are in `tests/brain/`.
 *
 * It has no model of the hand: no EVs (so `thinkMs` reads every decision as a clear one), neutral
 * numbers. The profile and the seed are ignored.
 */
import { simpleBotAction } from '../../scripts/bots/simple.ts';
import { isAllInAction } from '../../src/brain/think.ts';
import type { Decision } from '../../src/brain/types.ts';
import type { Observation } from '../../src/engine/types.ts';

export function simpleDecide(obs: Observation): Decision {
  const action = simpleBotAction(obs);
  const allIn =
    (action.type === 'bet' || action.type === 'raise') && isAllInAction(obs.legal, action);
  return {
    action,
    kind: allIn ? 'allin' : action.type,
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
