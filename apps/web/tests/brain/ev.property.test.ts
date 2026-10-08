/**
 * EV model properties at random decision points of hands played by the real engine (PLAN §8.9,
 * §9.6): every candidate is legal (the engine accepts it) with a unique key and a finite EV, and
 * EV(fold) = 0; the EVs depend on the observation and the seed alone, so re-dealing every card the
 * observer cannot see (`permuteHidden`, then `observe()` again) or copying the observation
 * through JSON gives the same candidates and the same numbers.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { candidateEVs, candidateKey, type EvSpot } from '../../src/brain/ev.ts';
import { features } from '../../src/brain/features.ts';
import { isLegalAction } from '../../src/brain/guardrails.ts';
import { rngFromSeed, type Seed128 } from '../../src/core/rng.ts';
import { observe } from '../../src/engine/observe.ts';
import { step } from '../../src/engine/step.ts';
import type { HandState, Observation, PlayerAction } from '../../src/engine/types.ts';
import { FC_SEED } from '../engine/helpers.ts';
import { permuteHidden } from '../engine/permute.ts';
import { handArb, randomInput, seedArb } from '../engine/play.ts';
import { extrasFor, testProfile } from './fixtures.ts';

const PROFILE = testProfile('reweight', 24);

function decisionPoints(h: HandState, policySeed: Seed128): HandState[] {
  const rng = rngFromSeed(policySeed);
  const points: HandState[] = [];
  let s = h;
  for (let i = 0; i < 400 && s.phase !== 'complete'; i++) {
    if (s.phase === 'betting') points.push(s);
    s = step(s, randomInput(s, rng));
  }
  return points;
}

function engineAccepts(h: HandState, seat: number, action: PlayerAction): boolean {
  try {
    step(h, { kind: 'act', seat, action });
    return true;
  } catch {
    return false;
  }
}

function spotOf(obs: Observation, seed: Seed128): EvSpot {
  const f = features(obs, PROFILE, seed, 0.5);
  return { obs, f, R: 0.9, implied: 10, seed, trials: 24 };
}

describe('EV model properties (§8.9, §9.6)', () => {
  it(
    'legal candidates with finite EVs; the same numbers after a re-deal of the hidden cards',
    { timeout: 120_000 },
    () => {
      let checked = 0;
      let bets = 0;
      fc.assert(
        fc.property(handArb, seedArb, seedArb, ({ h, policySeed }, permSeed, seed) => {
          const extras = extrasFor(h.seats.length);
          for (const s of decisionPoints(h, policySeed).filter((_, i) => i % 3 === 0)) {
            const seat = s.toAct as number;
            const obs = observe(s, seat, extras);
            const cands = candidateEVs(spotOf(obs, seed));
            expect(new Set(cands.map((c) => c.key)).size).toBe(cands.length);
            for (const c of cands) {
              expect(isLegalAction(obs.legal, c.action)).toBe(true);
              expect(engineAccepts(s, seat, c.action)).toBe(true);
              expect(candidateKey(obs.legal, c.action)).toBe(c.key);
              expect(Number.isFinite(c.ev)).toBe(true);
              if (c.action.type === 'bet' || c.action.type === 'raise') bets++;
            }
            expect(cands.some((c) => c.key === 'check' || c.key === 'call')).toBe(true);
            if (obs.legal.canFold) expect(cands[0]).toMatchObject({ key: 'fold', ev: 0 });

            const other = observe(permuteHidden(s, seat, permSeed), seat, extras);
            expect(candidateEVs(spotOf(other, seed))).toEqual(cands);
            const copy = JSON.parse(JSON.stringify(obs)) as Observation;
            expect(candidateEVs(spotOf(copy, seed))).toEqual(cands);
            checked++;
          }
        }),
        { seed: FC_SEED, numRuns: 100 },
      );
      expect(checked).toBeGreaterThan(150);
      expect(bets).toBeGreaterThan(300);
    },
  );
});
