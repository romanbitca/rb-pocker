/**
 * The bots' decisions at random decision points of hands played by the real engine (PLAN §9.4,
 * §9.6; fast-check; Stage 5 acceptance 4): every Easy and Medium profile (5 personalities × 2
 * levels) decides at each point with the run's seed.
 * - §9.6.3 non-cheating, 1,000 runs per profile: every card the bot cannot see is dealt again
 *   (other seats' unrevealed hole cards, the burn cards, the stub; `permuteHidden`) and the hand
 *   observed again: the observation is the same, and `decide()` returns an identical Decision.
 * - Always legal (the brain's own check and the engine's), `kind` matching the action, never a
 *   fold when checking is free, the guardrails a fixed point of the pick (§8.8: they override it).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decide, deliberate, kindOf } from '../../src/brain/decide.ts';
import { guardrails, guardSpot, isLegalAction } from '../../src/brain/guardrails.ts';
import { profileFor } from '../../src/brain/profiles.ts';
import type { BrainProfile } from '../../src/brain/types.ts';
import { observe } from '../../src/engine/observe.ts';
import { PERSONALITY_IDS, type HandState } from '../../src/engine/types.ts';
import { FC_SEED } from '../engine/helpers.ts';
import { permuteHidden } from '../engine/permute.ts';
import { handArb, seedArb } from '../engine/play.ts';
import { decisionPointAt, engineAccepts, extrasArb } from './points.ts';

const RUNS = 1000;

const PROFILES: readonly BrainProfile[] = PERSONALITY_IDS.flatMap((id) => [
  profileFor(id, 'easy'),
  profileFor(id, 'medium'),
]);

describe('the Easy and Medium bots at random decision points (§9.4, §9.6)', () => {
  it(
    'every profile: legal, guarded, and blind to the cards it cannot see (1,000 runs each)',
    { timeout: 600_000 },
    () => {
      expect(PROFILES).toHaveLength(10);
      let runs = 0;
      let mixed = 0;
      const kinds = new Set<string>();
      fc.assert(
        fc.property(
          handArb,
          extrasArb,
          fc.nat(),
          seedArb,
          seedArb,
          ({ h, policySeed }, extrasFor, pick, permSeed, botSeed) => {
            const point = decisionPointAt(h, policySeed, pick);
            fc.pre(point !== null);
            const s = point as HandState;
            const seat = s.toAct as number;
            const extras = extrasFor(s.seats.length);
            const obs = observe(s, seat, extras);
            const other = observe(permuteHidden(s, seat, permSeed), seat, extras);
            expect(other).toEqual(obs);
            runs++;
            const actions = new Set<string>();
            for (const profile of PROFILES) {
              const { decision: d, f } = deliberate(obs, profile, botSeed);
              expect(isLegalAction(obs.legal, d.action)).toBe(true);
              expect(engineAccepts(s, seat, d)).toBe(true);
              expect(d.kind).toBe(kindOf(obs.legal, d.action));
              if (obs.legal.canCheck) expect(d.action.type).not.toBe('fold');
              expect(guardrails(guardSpot(obs, f), d.action).fired).toEqual([]);
              expect(d.eRandom).toBe(d.eRange); // a bot never computes the HUD number
              // §9.6.3: the re-dealt hand gives the same decision.
              expect(decide(other, profile, botSeed)).toEqual(d);
              kinds.add(d.kind);
              actions.add(JSON.stringify(d.action));
            }
            if (actions.size > 1) mixed++;
          },
        ),
        { seed: FC_SEED, numRuns: RUNS },
      );
      expect(runs).toBe(RUNS);
      expect(mixed).toBeGreaterThan(RUNS / 10); // the profiles do play differently
      expect([...kinds].sort()).toEqual(['allin', 'bet', 'call', 'check', 'fold', 'raise']);
    },
  );
});
