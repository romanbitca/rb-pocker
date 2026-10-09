/**
 * Random decision points for the brain's property tests (PLAN §8.11, §9.6): hands played by the
 * real engine with the random legal policy (the brain never runs the engine; the tests do, so the
 * observations are exactly what the game builds), random seat levels and visible labels, and the
 * engine's own check of an action.
 */
import fc from 'fast-check';
import type { Decision } from '../../src/brain/types.ts';
import { rngFromSeed, type Seed128 } from '../../src/core/rng.ts';
import { step } from '../../src/engine/step.ts';
import {
  BOT_LEVELS,
  PERSONALITY_IDS,
  type BotLevel,
  type HandState,
  type ObserveExtras,
  type PersonalityId,
} from '../../src/engine/types.ts';
import { randomInput } from '../engine/play.ts';

/** Decision points looked at per hand: the `pick % DEPTH`-th, or the last one before the end. */
const DEPTH = 12;

/**
 * A decision point of the hand played with the random legal policy: the `pick % 12`-th one, or the
 * last one when the hand ends before it; null when nobody ever has a decision (blinds all-in).
 * The hand is played only as far as needed.
 */
export function decisionPointAt(h: HandState, policySeed: Seed128, pick: number): HandState | null {
  const rng = rngFromSeed(policySeed);
  const target = pick % DEPTH;
  let last: HandState | null = null;
  let seen = 0;
  let s = h;
  for (let i = 0; i < 400 && s.phase !== 'complete'; i++) {
    if (s.phase === 'betting') {
      if (seen++ === target) return s;
      last = s;
    }
    s = step(s, randomInput(s, rng));
  }
  return last;
}

/** Random levels per seat, with a visible label at Easy and Medium seats (as the controller does). */
export const extrasArb: fc.Arbitrary<(n: number) => ObserveExtras> = fc
  .record({
    levels: fc.array(fc.constantFrom(...BOT_LEVELS), { minLength: 9, maxLength: 9 }),
    labels: fc.array(fc.constantFrom(...PERSONALITY_IDS), { minLength: 9, maxLength: 9 }),
  })
  .map(({ levels, labels }) => (n: number): ObserveExtras => ({
    seatStats: new Array<null>(n).fill(null),
    seatLevels: levels.slice(0, n) as BotLevel[],
    visiblePersonality: levels
      .slice(0, n)
      .map((l, i) => (l === 'easy' || l === 'medium' ? (labels[i] as PersonalityId) : null)),
  }));

/** The engine accepts the decision's action from `seat` now. */
export function engineAccepts(h: HandState, seat: number, d: Decision): boolean {
  try {
    step(h, { kind: 'act', seat, action: d.action });
    return true;
  } catch {
    return false;
  }
}
